import type { Coordinate } from '../interfaces';

export interface MediaProps {
  id: string;
  ownerId: string;
  url: string;
  createdAt: Date;
  location?: string;
  /** Where the photo was taken — what the Me-page globe plots. */
  coordinate?: Coordinate;
  /** Groups the items shared together in one send — the feed's "posting". */
  postingId?: string;
  /** When the publisher moved this item to the trash; absent while it is live. */
  deletedAt?: Date;
  /**
   * True when the item was reconstructed by the history backfill rather than
   * shared live (issue #81). Backfilled items never notified subscribers, so
   * nothing downstream should treat them as a delivered send.
   */
  backfilled?: boolean;
}

export class Media {
  private constructor(private readonly props: MediaProps) {}

  static create(props: MediaProps): Media {
    if (!props.ownerId) throw new Error('Media must have an owner');
    if (!props.url) throw new Error('Media must have a url');
    return new Media(props);
  }

  get id(): string { return this.props.id; }
  get ownerId(): string { return this.props.ownerId; }
  get url(): string { return this.props.url; }
  get createdAt(): Date { return this.props.createdAt; }
  get location(): string | undefined { return this.props.location; }
  get coordinate(): Coordinate | undefined { return this.props.coordinate; }
  get postingId(): string | undefined { return this.props.postingId; }
  get deletedAt(): Date | undefined { return this.props.deletedAt; }
  get backfilled(): boolean { return this.props.backfilled ?? false; }

  /** In the trash — hidden from the feed and the globe, restorable. */
  get isDeleted(): boolean { return this.props.deletedAt != null; }

  /**
   * The same item moved to the trash (a date) or restored (null). Media is
   * immutable, so this returns a copy — and copies here rather than at each
   * call site so a new prop can't be dropped by a hand-written spread.
   */
  withDeletedAt(deletedAt: Date | null): Media {
    const next: MediaProps = { ...this.props };
    if (deletedAt != null) next.deletedAt = deletedAt;
    // Absent, not undefined: exactOptionalPropertyTypes forbids the latter.
    else delete next.deletedAt;
    return new Media(next);
  }
}
