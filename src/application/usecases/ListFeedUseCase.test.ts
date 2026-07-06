import { ListFeedUseCase } from './ListFeedUseCase';
import { Media } from '../../domain/entities/Media';
import type { MediaProps } from '../../domain/entities/Media';
import { InMemoryMediaRepository } from '../../test-support/fakes';

function makeSut(): { useCase: ListFeedUseCase; mediaRepo: InMemoryMediaRepository } {
  const mediaRepo = new InMemoryMediaRepository();
  return { useCase: new ListFeedUseCase(mediaRepo), mediaRepo };
}

function makeMedia(id: string, overrides: Partial<MediaProps> = {}): Media {
  return Media.create({
    id,
    ownerId: 'user-1',
    url: `https://cdn.example.com/${id}.jpg`,
    createdAt: new Date('2026-06-18T10:00:00Z'),
    ...overrides,
  });
}

describe('ListFeedUseCase — grouping by postingId', () => {
  it('groups items sharing a postingId into one posting', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('m3', { postingId: 'post-a' }));

    const feed = await useCase.list('user-1');

    expect(feed).toHaveLength(1);
    expect(feed[0]?.id).toBe('post-a');
    expect(feed[0]?.media.map(m => m.id).sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns separate postings newest first', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('old', { postingId: 'post-old', createdAt: new Date('2026-06-01T10:00:00Z') }));
    await mediaRepo.save(makeMedia('new', { postingId: 'post-new', createdAt: new Date('2026-06-18T10:00:00Z') }));

    const feed = await useCase.list('user-1');

    expect(feed.map(p => p.id)).toEqual(['post-new', 'post-old']);
  });

  it('carries mediaType, url and the posting createdAt/location', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a', mediaType: 'video', location: 'Lisbon, Portugal' }));

    const feed = await useCase.list('user-1');

    expect(feed[0]?.media[0]?.mediaType).toBe('video');
    expect(feed[0]?.media[0]?.url).toBe('https://cdn.example.com/m1.jpg');
    expect(feed[0]?.createdAt).toBe('2026-06-18T10:00:00.000Z');
    expect(feed[0]?.location).toBe('Lisbon, Portugal');
  });

  it('location is null when no item carries one', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));

    const feed = await useCase.list('user-1');

    expect(feed[0]?.location).toBeNull();
  });

  it('only returns the requested publisher media', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('mine', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('theirs', { ownerId: 'user-2', postingId: 'post-b' }));

    const feed = await useCase.list('user-1');

    expect(feed).toHaveLength(1);
    expect(feed[0]?.media[0]?.id).toBe('mine');
  });

  it('returns an empty feed when the publisher has no media', async (): Promise<void> => {
    const { useCase } = makeSut();
    expect(await useCase.list('user-1')).toEqual([]);
  });

  it('throws when publisherId is empty', async (): Promise<void> => {
    const { useCase } = makeSut();
    await expect(useCase.list('')).rejects.toThrow('publisherId is required');
  });
});

describe('ListFeedUseCase — postingId invariant', () => {
  // ShareMediaUseCase stamps a postingId on every upload and the database
  // enforces NOT NULL; a row without one means some write bypassed the share
  // flow, and the feed should fail loudly rather than guess a grouping.
  it('throws when a media item has no postingId', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('rogue'));

    await expect(useCase.list('user-1')).rejects.toThrow(
      'media rogue has no postingId — it must be stamped at share time',
    );
  });
});
