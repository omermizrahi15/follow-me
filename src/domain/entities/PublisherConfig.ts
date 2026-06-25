import type { PhotoCategory } from './PhotoClassification';
import { SELECTABLE_CATEGORIES } from './PhotoClassification';

export type Frequency = 'weekly' | 'biweekly' | 'monthly';
export type PhotoCount = 5 | 10 | 15;

export interface PublisherConfigProps {
  publisherId: string;
  frequency: Frequency;
  photosPerPost: PhotoCount;
  requireApproval: boolean;
  /** Day the post reminder fires: 0 = Sunday … 6 = Saturday. Default 0. */
  notifyDayOfWeek?: number;
  /** Time the post reminder fires, 24h "HH:MM". Default "18:00". */
  notifyTime?: string;
  /** Which rule categories the publisher wants suggested. Default: all four. */
  enabledCategories?: PhotoCategory[];
  /** How far back to scan the library, in days. Default 7. */
  lookbackDays?: number;
  /** Minimum quality (0..1) a photo needs to be suggested. Default 0.4. */
  minQuality?: number;
  /** IANA timezone used to fire the schedule at the publisher's local time. Default 'UTC'. */
  timezone?: string;
  /** Expo push token for server-sent reminders (autonomous mode). Default ''. */
  expoPushToken?: string;
}

const DEFAULTS = {
  notifyDayOfWeek: 0,
  notifyTime: '18:00',
  enabledCategories: [...SELECTABLE_CATEGORIES] as PhotoCategory[],
  lookbackDays: 7,
  minQuality: 0.4,
  timezone: 'UTC',
  expoPushToken: '',
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

    const lookbackDays = props.lookbackDays ?? DEFAULTS.lookbackDays;
    if (!Number.isInteger(lookbackDays) || lookbackDays < 1) {
      throw new Error('PublisherConfig lookbackDays must be a positive integer');
    }

    const minQuality = props.minQuality ?? DEFAULTS.minQuality;
    if (minQuality < 0 || minQuality > 1) {
      throw new Error('PublisherConfig minQuality must be between 0 and 1');
    }

    const timezone = props.timezone ?? DEFAULTS.timezone;
    if (!timezone) throw new Error('PublisherConfig timezone must be a non-empty IANA name');

    const expoPushToken = props.expoPushToken ?? DEFAULTS.expoPushToken;

    return new PublisherConfig({
      publisherId: props.publisherId,
      frequency: props.frequency,
      photosPerPost: props.photosPerPost,
      requireApproval: props.requireApproval,
      notifyDayOfWeek,
      notifyTime,
      enabledCategories,
      lookbackDays,
      minQuality,
      timezone,
      expoPushToken,
    });
  }

  get publisherId(): string { return this.props.publisherId; }
  get frequency(): Frequency { return this.props.frequency; }
  get photosPerPost(): PhotoCount { return this.props.photosPerPost; }
  get requireApproval(): boolean { return this.props.requireApproval; }
  get notifyDayOfWeek(): number { return this.props.notifyDayOfWeek; }
  get notifyTime(): string { return this.props.notifyTime; }
  get enabledCategories(): PhotoCategory[] { return this.props.enabledCategories; }
  get lookbackDays(): number { return this.props.lookbackDays; }
  get minQuality(): number { return this.props.minQuality; }
  get timezone(): string { return this.props.timezone; }
  get expoPushToken(): string { return this.props.expoPushToken; }

  /** Hour parsed from notifyTime. */
  get notifyHour(): number { return Number(this.props.notifyTime.slice(0, 2)); }
  /** Minute parsed from notifyTime. */
  get notifyMinute(): number { return Number(this.props.notifyTime.slice(3, 5)); }
}
