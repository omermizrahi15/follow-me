export type Frequency = 'weekly' | 'biweekly' | 'monthly';
export type PhotoCount = 1 | 3 | 5;

export interface PublisherConfigProps {
  publisherId: string;
  frequency: Frequency;
  photosPerPost: PhotoCount;
  requireApproval: boolean;
}

export class PublisherConfig {
  private constructor(private readonly props: PublisherConfigProps) {}

  static create(props: PublisherConfigProps): PublisherConfig {
    if (!props.publisherId) throw new Error('PublisherConfig must have a publisherId');
    return new PublisherConfig(props);
  }

  get publisherId(): string { return this.props.publisherId; }
  get frequency(): Frequency { return this.props.frequency; }
  get photosPerPost(): PhotoCount { return this.props.photosPerPost; }
  get requireApproval(): boolean { return this.props.requireApproval; }
}
