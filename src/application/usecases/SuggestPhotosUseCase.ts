import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IMediaLibrary, IPhotoClassifier, ISentPhotoTracker } from '../../domain/interfaces';
import { PhotoSelectionService } from '../../domain/services/PhotoSelectionService';

/**
 * Builds the suggested batch for the publisher's next post: scan the recent
 * library, classify each photo with AI, then apply the pure selection rules.
 * Orchestration only — all the selection logic lives in PhotoSelectionService.
 */
export class SuggestPhotosUseCase {
  constructor(
    private readonly mediaLibrary: IMediaLibrary,
    private readonly classifier: IPhotoClassifier,
    private readonly sentTracker: ISentPhotoTracker,
    private readonly selection: PhotoSelectionService = new PhotoSelectionService(),
  ) {}

  async execute(config: PublisherConfig): Promise<PhotoClassification[]> {
    const candidates = await this.mediaLibrary.recentPhotos(config.lookbackDays);
    if (candidates.length === 0) return [];

    const [classifications, alreadySent] = await Promise.all([
      this.classifier.classify(candidates),
      this.sentTracker.sentCandidateIds(config.publisherId),
    ]);

    return this.selection.selectBatch(classifications, config, alreadySent);
  }
}
