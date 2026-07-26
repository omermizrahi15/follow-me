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
}
