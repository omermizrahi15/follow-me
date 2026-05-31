export interface PhotoDto {
  id: string;
  ownerId: string;
  url: string;
  createdAt: string; // ISO string — safe to serialize to UI
}

export interface SubscriberDto {
  id: string;
  publisherId: string;
  contactHandle: string;
  status: 'pending' | 'active' | 'revoked';
}
