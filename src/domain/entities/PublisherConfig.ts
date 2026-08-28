import type { PhotoCategory } from './PhotoClassification';
import { SELECTABLE_CATEGORIES } from './PhotoClassification';

export type Frequency = '3days' | 'weekly' | 'biweekly' | 'monthly';
export type PhotoCount = 5 | 10 | 15;

/**
 * How much the publisher's own presence in a photo counts for (issue #137).
 *
 * - `off`   — it plays no part; no reference image is ever sent to the
 *             classifier, so the question is not even asked.
 * - `prefer` — photos they appear in outrank equivalent ones they don't, and a
 *             short post is still filled from the rest.
 * - `only`  — a photo has to contain them to be suggested at all.
 *
 * The reference is their profile photo and nothing else — there is no separate
 * enrollment, and the control is hidden outright when no avatar is set.
 */
export type PhotosOfMe = 'off' | 'prefer' | 'only';

export const PHOTOS_OF_ME_MODES: readonly PhotosOfMe[] = ['off', 'prefer', 'only'] as const;

/**
 * Hard ceiling on how many photos one post may carry, whatever `photosPerPost`
 * says. The configured count is what the AI pre-selects; the publisher can keep
 * adding past it while reviewing, and this is where that stops.
 *
 * It exists because the cost of a post is not flat: every extra photo is an
 * iCloud original to fetch, a full-resolution bitmap to downscale and upload,
 * and a row per subscriber to deliver. Twice the largest configurable count
 * leaves real room to keep adding without handing the upload path an unbounded
 * selection (the shape that got the app watchdog-killed in issue #77).
 */
export const MAX_PHOTOS_PER_POST = 30;

/** Lookback window (in days) for each posting frequency. The two are the same concept. */
export const FREQUENCY_DAYS: Record<Frequency, number> = {
  '3days': 3,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

export interface PublisherConfigProps {
  publisherId: string;
  frequency: Frequency;
  photosPerPost: PhotoCount;
  requireApproval: boolean;
  /** Day the post reminder fires: 0 = Sunday … 6 = Saturday. Default 0. */
  notifyDayOfWeek?: number;
  /** Time the post reminder fires, 24h "HH:MM". Default "18:00". */
  notifyTime?: string;
  /** Which rule categories the publisher wants suggested. Default: all. */
  enabledCategories?: PhotoCategory[];
  /** Minimum quality (0..1) a photo needs to be suggested. Default 0.15. */
  minQuality?: number;
  /** IANA timezone used to fire the schedule at the publisher's local time. Default 'UTC'. */
  timezone?: string;
  /** Expo push token for server-sent reminders (autonomous mode). Default ''. */
  expoPushToken?: string;
  /**
   * How much "is the publisher in this photo?" counts for. Default 'off', so
   * every row that predates issue #137 keeps behaving exactly as it did.
   */
  photosOfMe?: PhotosOfMe;
}

const DEFAULTS = {
  notifyDayOfWeek: 0,
  notifyTime: '18:00',
  enabledCategories: [...SELECTABLE_CATEGORIES] as PhotoCategory[],
  minQuality: 0.15,
  timezone: 'UTC',
  expoPushToken: '',
  photosOfMe: 'off' as PhotosOfMe,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface ResolvedProps extends Required<PublisherConfigProps> {}

export class PublisherConfig {
  private constructor(private readonly props: ResolvedProps) {}

  static create(props: PublisherConfigProps): PublisherConfig {
    if (!props.publisherId) throw new Error('PublisherConfig must have a publisherId');

    const notifyDayOfWeek = props.notifyDayOfWeek ?? DEFAULTS.notifyDayOfWeek;
    if (!Number.isInteger(notifyDayOfWeek) || notifyDayOfWeek < 0 || notifyDayOfWeek > 6) {
      throw new Error('PublisherConfig notifyDayOfWeek must be an integer 0..6');
    }

    const notifyTime = props.notifyTime ?? DEFAULTS.notifyTime;
    if (!TIME_RE.test(notifyTime)) {
      throw new Error('PublisherConfig notifyTime must be "HH:MM" (24h)');
    }

    const enabledCategories = props.enabledCategories ?? DEFAULTS.enabledCategories;
    for (const c of enabledCategories) {
      if (!SELECTABLE_CATEGORIES.includes(c)) {
        throw new Error(`PublisherConfig enabledCategories has invalid category: ${c}`);
      }
    }

    const minQuality = props.minQuality ?? DEFAULTS.minQuality;
    if (minQuality < 0 || minQuality > 1) {
      throw new Error('PublisherConfig minQuality must be between 0 and 1');
    }

    const timezone = props.timezone ?? DEFAULTS.timezone;
    if (!timezone) throw new Error('PublisherConfig timezone must be a non-empty IANA name');

    const expoPushToken = props.expoPushToken ?? DEFAULTS.expoPushToken;

    const photosOfMe = props.photosOfMe ?? DEFAULTS.photosOfMe;
    if (!PHOTOS_OF_ME_MODES.includes(photosOfMe)) {
      throw new Error(`PublisherConfig photosOfMe must be one of ${PHOTOS_OF_ME_MODES.join(', ')}`);
    }

    return new PublisherConfig({
      publisherId: props.publisherId,
      frequency: props.frequency,
      photosPerPost: props.photosPerPost,
      requireApproval: props.requireApproval,
      notifyDayOfWeek,
      notifyTime,
      enabledCategories,
      minQuality,
      timezone,
      expoPushToken,
      photosOfMe,
    });
  }

  get publisherId(): string { return this.props.publisherId; }
  get frequency(): Frequency { return this.props.frequency; }
  get photosPerPost(): PhotoCount { return this.props.photosPerPost; }
  get requireApproval(): boolean { return this.props.requireApproval; }
  get notifyDayOfWeek(): number { return this.props.notifyDayOfWeek; }
  get notifyTime(): string { return this.props.notifyTime; }
  get enabledCategories(): PhotoCategory[] { return this.props.enabledCategories; }
  /** Derived from frequency — the lookback window equals the posting interval. */
  get lookbackDays(): number { return FREQUENCY_DAYS[this.props.frequency]; }
  get minQuality(): number { return this.props.minQuality; }
  get timezone(): string { return this.props.timezone; }
  get expoPushToken(): string { return this.props.expoPushToken; }
  get photosOfMe(): PhotosOfMe { return this.props.photosOfMe; }

  /**
   * The same config with a different "photos of me" mode.
   *
   * Exists for one case: the preference is on but there is no face to compare
   * against — no avatar, or the profile simply didn't load. Under `only` that
   * would filter out every photo and produce an empty post, so the caller that
   * failed to resolve a reference downgrades to `off` for that run rather than
   * silently posting nothing. Every other field is carried across untouched.
   */
  withPhotosOfMe(mode: PhotosOfMe): PublisherConfig {
    return mode === this.props.photosOfMe
      ? this
      : new PublisherConfig({ ...this.props, photosOfMe: mode });
  }

  /** Hour parsed from notifyTime. */
  get notifyHour(): number { return Number(this.props.notifyTime.slice(0, 2)); }
  /** Minute parsed from notifyTime. */
  get notifyMinute(): number { return Number(this.props.notifyTime.slice(3, 5)); }
}
