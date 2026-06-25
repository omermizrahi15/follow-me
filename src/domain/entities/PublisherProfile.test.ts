import { PublisherProfile } from './PublisherProfile';

describe('PublisherProfile', () => {
  it('creates a profile with a display name', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: 'Omer',
      bio: null,
      avatarUrl: null,
    });
    expect(profile.publisherId).toBe('user-1');
    expect(profile.displayName).toBe('Omer');
    expect(profile.bio).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });

  it('trims the display name', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: '  Omer  ',
      bio: null,
      avatarUrl: null,
    });
    expect(profile.displayName).toBe('Omer');
  });

  it('normalizes empty or whitespace bio/avatar to null', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: 'Omer',
      bio: '   ',
      avatarUrl: '',
    });
    expect(profile.bio).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });

  it('keeps a provided bio and avatar', (): void => {
    const profile = PublisherProfile.create({
      publisherId: 'user-1',
      displayName: 'Omer',
      bio: 'Travel photos',
      avatarUrl: 'https://cdn.test/a.jpg',
    });
    expect(profile.bio).toBe('Travel photos');
    expect(profile.avatarUrl).toBe('https://cdn.test/a.jpg');
  });

  it('throws without a publisherId', (): void => {
    expect(() =>
      PublisherProfile.create({ publisherId: '', displayName: 'Omer', bio: null, avatarUrl: null }),
    ).toThrow('publisherId');
  });

  it('throws without a display name', (): void => {
    expect(() =>
      PublisherProfile.create({ publisherId: 'user-1', displayName: '   ', bio: null, avatarUrl: null }),
    ).toThrow('displayName');
  });
});
