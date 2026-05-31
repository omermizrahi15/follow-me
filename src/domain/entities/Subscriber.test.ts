import { Subscriber } from './Subscriber';

const validProps = {
  id: 'sub-1',
  publisherId: 'user-1',
  contactHandle: '+972501234567',
  status: 'pending' as const,
};

describe('Subscriber', () => {
  it('creates a valid subscriber', () => {
    const sub = Subscriber.create(validProps);
    expect(sub.id).toBe('sub-1');
    expect(sub.isActive()).toBe(false);
  });

  it('throws if publisherId is missing', () => {
    expect(() => Subscriber.create({ ...validProps, publisherId: '' }))
      .toThrow('Subscriber must have a publisher');
  });

  it('throws if contactHandle is missing', () => {
    expect(() => Subscriber.create({ ...validProps, contactHandle: '' }))
      .toThrow('Subscriber must have a contact handle');
  });

  it('activates a pending subscriber', () => {
    const sub = Subscriber.create(validProps).activate();
    expect(sub.isActive()).toBe(true);
    expect(sub.status).toBe('active');
  });

  it('revokes an active subscriber', () => {
    const sub = Subscriber.create(validProps).activate().revoke();
    expect(sub.isActive()).toBe(false);
    expect(sub.status).toBe('revoked');
  });
});
