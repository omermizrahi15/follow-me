export type SubscriptionStatus = 'pending' | 'active' | 'revoked';

export interface SubscriberProps {
  id: string;
  publisherId: string;
  contactHandle: string; // phone number, push token, email — notifier decides
  status: SubscriptionStatus;
}

export class Subscriber {
  private constructor(private props: SubscriberProps) {}

  static create(props: SubscriberProps): Subscriber {
    if (!props.publisherId) throw new Error('Subscriber must have a publisher');
    if (!props.contactHandle) throw new Error('Subscriber must have a contact handle');
    return new Subscriber(props);
  }

  get id(): string { return this.props.id; }
  get publisherId(): string { return this.props.publisherId; }
  get contactHandle(): string { return this.props.contactHandle; }
  get status(): SubscriptionStatus { return this.props.status; }

  isActive(): boolean { return this.props.status === 'active'; }

  activate(): Subscriber {
    return new Subscriber({ ...this.props, status: 'active' });
  }

  revoke(): Subscriber {
    return new Subscriber({ ...this.props, status: 'revoked' });
  }
}
