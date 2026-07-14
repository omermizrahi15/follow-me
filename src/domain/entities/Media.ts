import type { Song } from './Song';

export interface MediaProps {
  id: string;
  ownerId: string;
  url: string;
  createdAt: Date;
  location?: string;
  /** Groups the items shared together in one send — the feed's "posting". */
  postingId?: string;
  /** The posting's soundtrack — like location, stamped on every item of the batch. */
  song?: Song;
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
  get song(): Song | undefined { return this.props.song; }
}
