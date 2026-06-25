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

  describe('reminder schedule + suggestion settings', () => {
    it('applies sensible defaults when new fields are omitted', () => {
      const config = PublisherConfig.create(validProps);
      expect(config.notifyDayOfWeek).toBe(0);
      expect(config.notifyTime).toBe('18:00');
      expect(config.notifyHour).toBe(18);
      expect(config.notifyMinute).toBe(0);
      expect(config.enabledCategories).toEqual([
        'selfie_with_view',
        'selfie_with_people',
        'view_only',
        'food',
      ]);
      expect(config.lookbackDays).toBe(7);
      expect(config.minQuality).toBe(0.4);
    });

    it('parses a custom notifyTime into hour and minute', () => {
      const config = PublisherConfig.create({ ...validProps, notifyTime: '07:45' });
      expect(config.notifyHour).toBe(7);
      expect(config.notifyMinute).toBe(45);
    });

    it('stores a custom day, categories, lookback and minQuality', () => {
      const config = PublisherConfig.create({
        ...validProps,
        notifyDayOfWeek: 5,
        enabledCategories: ['food'],
        lookbackDays: 14,
        minQuality: 0.6,
      });
      expect(config.notifyDayOfWeek).toBe(5);
      expect(config.enabledCategories).toEqual(['food']);
      expect(config.lookbackDays).toBe(14);
      expect(config.minQuality).toBe(0.6);
    });

    it.each([-1, 7, 1.5])('rejects an out-of-range notifyDayOfWeek (%p)', day => {
      expect(() => PublisherConfig.create({ ...validProps, notifyDayOfWeek: day }))
        .toThrow('notifyDayOfWeek');
    });

    it.each(['7:45', '24:00', '18:60', 'noon'])('rejects a malformed notifyTime (%p)', time => {
      expect(() => PublisherConfig.create({ ...validProps, notifyTime: time }))
        .toThrow('notifyTime');
    });

    it('rejects an invalid category', () => {
      expect(() =>
        PublisherConfig.create({ ...validProps, enabledCategories: ['other'] as never }),
      ).toThrow('enabledCategories');
    });

    it.each([0, -3])('rejects a non-positive lookbackDays (%p)', days => {
      expect(() => PublisherConfig.create({ ...validProps, lookbackDays: days }))
        .toThrow('lookbackDays');
    });

    it.each([-0.1, 1.1])('rejects an out-of-range minQuality (%p)', q => {
      expect(() => PublisherConfig.create({ ...validProps, minQuality: q }))
        .toThrow('minQuality');
    });
  });
});
