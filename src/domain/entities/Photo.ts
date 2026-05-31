export interface PhotoProps {
  id: string;
  ownerId: string;
  url: string;
  createdAt: Date;
}

export class Photo {
  private constructor(private readonly props: PhotoProps) {}

  static create(props: PhotoProps): Photo {
    if (!props.ownerId) throw new Error('Photo must have an owner');
    if (!props.url) throw new Error('Photo must have a url');
    return new Photo(props);
  }

  get id(): string { return this.props.id; }
  get ownerId(): string { return this.props.ownerId; }
  get url(): string { return this.props.url; }
  get createdAt(): Date { return this.props.createdAt; }
}
