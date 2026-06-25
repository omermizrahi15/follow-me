import { SaveProfileUseCase } from './SaveProfileUseCase';
import { LoadProfileUseCase } from './LoadProfileUseCase';
import { PublisherProfile } from '../../domain/entities/PublisherProfile';
import { InMemoryPublisherProfileRepository } from '../../test-support/fakes';

function makeProfile(overrides: Partial<{ displayName: string; bio: string | null; avatarUrl: string | null }> = {}): PublisherProfile {
  return PublisherProfile.create({
    publisherId: 'user-1',
    displayName: overrides.displayName ?? 'Omer',
    bio: overrides.bio ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
  });
}

describe('SaveProfileUseCase / LoadProfileUseCase', () => {
  it('persists and loads a profile', async (): Promise<void> => {
    const repo = new InMemoryPublisherProfileRepository();
    await new SaveProfileUseCase(repo).execute(makeProfile({ bio: 'Travel photos', avatarUrl: 'https://cdn.test/a.jpg' }));

    const loaded = await new LoadProfileUseCase(repo).execute('user-1');
    expect(loaded?.displayName).toBe('Omer');
    expect(loaded?.bio).toBe('Travel photos');
    expect(loaded?.avatarUrl).toBe('https://cdn.test/a.jpg');
  });

  it('returns null when the publisher has no profile', async (): Promise<void> => {
    const repo = new InMemoryPublisherProfileRepository();
    const loaded = await new LoadProfileUseCase(repo).execute('nobody');
    expect(loaded).toBeNull();
  });

  it('overwrites an existing profile for the same publisher', async (): Promise<void> => {
    const repo = new InMemoryPublisherProfileRepository();
    const save = new SaveProfileUseCase(repo);
    await save.execute(makeProfile({ displayName: 'Omer' }));
    await save.execute(makeProfile({ displayName: 'Omer M', bio: 'Updated' }));

    const loaded = await new LoadProfileUseCase(repo).execute('user-1');
    expect(loaded?.displayName).toBe('Omer M');
    expect(loaded?.bio).toBe('Updated');
  });

  // Onboarding makes the photo and bio optional (and "Skip for now" saves
  // nothing extra), so a name-only profile must round-trip cleanly.
  it('saves a name-only profile, reading bio and avatar back as null', async (): Promise<void> => {
    const repo = new InMemoryPublisherProfileRepository();
    await new SaveProfileUseCase(repo).execute(makeProfile({ displayName: 'Omer' }));

    const loaded = await new LoadProfileUseCase(repo).execute('user-1');
    expect(loaded?.displayName).toBe('Omer');
    expect(loaded?.bio).toBeNull();
    expect(loaded?.avatarUrl).toBeNull();
  });

  it('normalizes empty / whitespace-only bio and avatar to null on save', async (): Promise<void> => {
    const repo = new InMemoryPublisherProfileRepository();
    await new SaveProfileUseCase(repo).execute(makeProfile({ bio: '   ', avatarUrl: '' }));

    const loaded = await new LoadProfileUseCase(repo).execute('user-1');
    expect(loaded?.bio).toBeNull();
    expect(loaded?.avatarUrl).toBeNull();
  });

  it('trims the display name before persisting', async (): Promise<void> => {
    const repo = new InMemoryPublisherProfileRepository();
    await new SaveProfileUseCase(repo).execute(makeProfile({ displayName: '  Omer Mizrahi  ' }));

    const loaded = await new LoadProfileUseCase(repo).execute('user-1');
    expect(loaded?.displayName).toBe('Omer Mizrahi');
  });

  it('clears a previously set bio and avatar when re-saved empty', async (): Promise<void> => {
    const repo = new InMemoryPublisherProfileRepository();
    const save = new SaveProfileUseCase(repo);
    await save.execute(makeProfile({ bio: 'Travel photos', avatarUrl: 'https://cdn.test/a.jpg' }));
    await save.execute(makeProfile({ bio: null, avatarUrl: null }));

    const loaded = await new LoadProfileUseCase(repo).execute('user-1');
    expect(loaded?.bio).toBeNull();
    expect(loaded?.avatarUrl).toBeNull();
  });

  it('rejects saving a profile with a blank display name', (): void => {
    // The required field is enforced at construction, before the use case runs.
    expect(() => makeProfile({ displayName: '   ' })).toThrow('displayName');
  });
});
