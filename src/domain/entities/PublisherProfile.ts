export interface PublisherProfileProps {
  publisherId: string;
  displayName: string;
  /** Optional self-description; null when the publisher hasn't written one. */
  bio: string | null;
  /** Optional avatar URL (e.g. Cloudinary); null when no photo was chosen. */
  avatarUrl: string | null;
  /**
   * When the publisher's travels began; null until they say. It is what the
   * app measures posting coverage against, so it decides whether any history
   * is missing and therefore whether the History tab is offered (issue #81).
   */
  tripStartDate?: Date | null;
}

export class PublisherProfile {
  private constructor(private readonly props: PublisherProfileProps) {}

  static create(props: PublisherProfileProps): PublisherProfile {
    if (!props.publisherId) throw new Error('PublisherProfile must have a publisherId');
    if (!props.displayName.trim()) throw new Error('PublisherProfile must have a displayName');

    const tripStartDate = props.tripStartDate ?? null;
    if (tripStartDate != null && Number.isNaN(tripStartDate.getTime())) {
      throw new Error('PublisherProfile tripStartDate must be a valid date');
    }

    return new PublisherProfile({
      ...props,
      displayName: props.displayName.trim(),
      bio: normalizeOptional(props.bio),
      avatarUrl: normalizeOptional(props.avatarUrl),
      tripStartDate,
    });
  }

  get publisherId(): string { return this.props.publisherId; }
  get displayName(): string { return this.props.displayName; }
  get bio(): string | null { return this.props.bio; }
  get avatarUrl(): string | null { return this.props.avatarUrl; }
  get tripStartDate(): Date | null { return this.props.tripStartDate ?? null; }
}

/** Treat empty/whitespace-only optional values as "not set". */
function normalizeOptional(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
