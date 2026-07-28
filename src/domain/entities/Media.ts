export interface MediaProps {
  id: string;
  ownerId: string;
  url: string;
  createdAt: Date;
  location?: string;
  /** Groups the items shared together in one send — the feed's "posting". */
  postingId?: string;
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
  get postingId(): string | undefined { return this.props.postingId; }
  get backfilled(): boolean { return this.props.backfilled ?? false; }
}
