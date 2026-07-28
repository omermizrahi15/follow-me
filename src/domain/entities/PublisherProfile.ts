export interface PublisherProfileProps {
  publisherId: string;
  displayName: string;
  /** Optional avatar URL (e.g. Cloudinary); null when no photo was chosen. */
  avatarUrl: string | null;
}

export class PublisherProfile {
  private constructor(private readonly props: PublisherProfileProps) {}

  static create(props: PublisherProfileProps): PublisherProfile {
    if (!props.publisherId) throw new Error('PublisherProfile must have a publisherId');
    if (!props.displayName.trim()) throw new Error('PublisherProfile must have a displayName');
    return new PublisherProfile({
      ...props,
      displayName: props.displayName.trim(),
      avatarUrl: normalizeOptional(props.avatarUrl),
    });
  }

  get publisherId(): string { return this.props.publisherId; }
  get displayName(): string { return this.props.displayName; }
  get avatarUrl(): string | null { return this.props.avatarUrl; }
}

/** Treat empty/whitespace-only optional values as "not set". */
function normalizeOptional(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
