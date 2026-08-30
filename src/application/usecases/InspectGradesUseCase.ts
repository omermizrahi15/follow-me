import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IClassificationStore, ISentPhotoTracker } from '../../domain/interfaces';
import { explainAll, type GradeExplanation } from '../../domain/services/gradeExplanation';
import type { PhotoFacts, SelectionRules } from '../../domain/services/photoSelection';

/** Headline numbers for a set of grades, counted once here rather than in the view. */
export interface GradeSummary {
  /** Grades in hand. */
  graded: number;
  /** Photos no rule excludes — the ones a post could actually draw from. */
  eligible: number;
  /** Photos at least one rule excluded. */
  blocked: number;
  /** Photos the next post would take. */
  inBatch: number;
  /** Mean quality across everything graded, 2dp. Zero when nothing is graded. */
  averageQuality: number;
}

export interface GradeInspection {
  /** Every remembered grade, explained and ranked exactly as the post ranks them. */
  photos: GradeExplanation<PhotoClassification>[];
  summary: GradeSummary;
}

/** How the app's classification shape answers the selection rules' questions. */
function facts(c: PhotoClassification): PhotoFacts {
  return {
    id: c.candidate.id,
    category: c.category,
    quality: c.quality,
    createdAt: c.candidate.createdAt.getTime(),
    scene: c.scene,
    containsPublisher: c.containsPublisher,
  };
}

/**
 * Everything the AI currently believes about this device's photos, with the
 * reasoning attached.
 *
 * Built because the grading was only ever observable through its output: a post
 * appeared, some photos were in it, and the publisher's only options were to
 * accept it or distrust the whole feature. Nothing said what any photo scored,
 * which setting excluded it, or what the model thought it was looking at.
 *
 * Reads from the grade cache rather than running a scan, deliberately. The
 * cache is where a scan's results already live, it holds far more than any one
 * window, and reading it costs no AI budget at all — so the screen can be
 * opened as often as it takes to understand something, which is the entire
 * point of a debugging tool.
 */
export class InspectGradesUseCase {
  constructor(
    private readonly grades: IClassificationStore,
    private readonly sentTracker: ISentPhotoTracker,
    /**
     * The publisher's profile photo, which is the face "photos of me" grades
     * against. Injected for the same reason SuggestPhotosUseCase injects it:
     * this stays ignorant of profiles, and absent simply means never asking.
     */
    private readonly avatarUrl?: (publisherId: string) => Promise<string | null>,
  ) {}

  async execute(config: PublisherConfig): Promise<GradeInspection> {
    // The same key the scan buys grades under, so the inspector reads the same
    // grades the post was built from. Reading under the wrong key would show a
    // set of photos nothing has ever actually ranked.
    const referenceKey =
      config.photosOfMe === 'off'
        ? ''
        : ((await this.avatarUrl?.(config.publisherId).catch(() => null)) ?? '');

    const [photos, alreadySent] = await Promise.all([
      this.grades.loadAll(referenceKey),
      this.sentTracker.sentCandidateIds(config.publisherId),
    ]);

    const rules: SelectionRules = {
      enabledCategories: config.enabledCategories,
      photosPerPost: config.photosPerPost,
      minQuality: config.minQuality,
      photosOfMe: config.photosOfMe,
    };

    const explained = explainAll(photos, facts, rules, alreadySent);

    return { photos: explained, summary: summarise(explained) };
  }
}

function summarise(photos: GradeExplanation<PhotoClassification>[]): GradeSummary {
  const blocked = photos.filter(p => p.blockers.length > 0).length;
  const total = photos.reduce((sum, p) => sum + p.facts.quality, 0);
  return {
    graded: photos.length,
    eligible: photos.length - blocked,
    blocked,
    inBatch: photos.filter(p => p.inBatch).length,
    // Two decimal places: the grades themselves are only meaningful to about
    // that, and a fifteen-digit float in a headline is noise.
    averageQuality: photos.length === 0 ? 0 : Math.round((total / photos.length) * 100) / 100,
  };
}
