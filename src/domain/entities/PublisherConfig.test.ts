import { PublisherConfig } from './PublisherConfig';

const validProps = {
  publisherId: 'user-1',
  frequency: 'weekly' as const,
  photosPerPost: 5 as const,
  requireApproval: true,
};

describe('PublisherConfig', () => {
  it('creates a valid config', () => {
    const config = PublisherConfig.create(validProps);
    expect(config.publisherId).toBe('user-1');
    expect(config.frequency).toBe('weekly');
    expect(config.photosPerPost).toBe(5);
    expect(config.requireApproval).toBe(true);
  });

  it('stores biweekly frequency', () => {
    const config = PublisherConfig.create({ ...validProps, frequency: 'biweekly' });
    expect(config.frequency).toBe('biweekly');
  });

  it('stores monthly frequency', () => {
    const config = PublisherConfig.create({ ...validProps, frequency: 'monthly' });
    expect(config.frequency).toBe('monthly');
  });

  it('stores requireApproval as false', () => {
    const config = PublisherConfig.create({ ...validProps, requireApproval: false });
    expect(config.requireApproval).toBe(false);
  });

  it('throws if publisherId is empty', () => {
    expect(() => PublisherConfig.create({ ...validProps, publisherId: '' }))
      .toThrow('PublisherConfig must have a publisherId');
  });
});
