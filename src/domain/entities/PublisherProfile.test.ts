import { PublisherProfile } from './PublisherProfile';

describe('PublisherProfile', () => {
  it('creates a profile with a display name', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: 'Omer',
      avatarUrl: null,
    });
    expect(profile.publisherId).toBe('user-1');
    expect(profile.displayName).toBe('Omer');
    expect(profile.avatarUrl).toBeNull();
  });

  it('trims the display name', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: '  Omer  ',
      avatarUrl: null,
    });
    expect(profile.displayName).toBe('Omer');
  });

  it('normalizes an empty or whitespace avatar to null', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: 'Omer',
      avatarUrl: '',
    });
    expect(profile.avatarUrl).toBeNull();
  });

  it('keeps a provided avatar', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: 'Omer',
      avatarUrl: 'https://cdn.test/a.jpg',
    });
    expect(profile.avatarUrl).toBe('https://cdn.test/a.jpg');
  });

  it('throws without a publisherId', (): void => {
    expect(() =>
      PublisherProfile.create({ publisherId: '', displayName: 'Omer', avatarUrl: null }),
    ).toThrow('publisherId');
  });

  it('throws without a display name', (): void => {
    expect(() =>
      PublisherProfile.create({ publisherId: 'user-1', displayName: '   ', avatarUrl: null }),
    ).toThrow('displayName');
  });
});
