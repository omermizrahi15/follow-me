import { FEED_PAGE_ROWS, ListFeedUseCase } from './ListFeedUseCase';
import { mergeFeedPages } from '../services/mergeFeedPages';
import { Media } from '../../domain/entities/Media';
import type { MediaProps } from '../../domain/entities/Media';
import type { MediaWindow } from '../../domain/interfaces';
import type { FeedPostingDto } from '../dtos';
import { InMemoryMediaRepository } from '../../test-support/fakes';

/** Remembers what was asked of the store, to check reads stay bounded. */
class RecordingMediaRepository extends InMemoryMediaRepository {
  readonly windows: MediaWindow[] = [];

  override findByOwner(ownerId: string, window: MediaWindow): Promise<Media[]> {
    this.windows.push(window);
    return super.findByOwner(ownerId, window);
  }
}

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

    const { postings: feed } = await useCase.list('user-1');

    expect(feed).toHaveLength(1);
    expect(feed[0]?.id).toBe('post-a');
    expect(feed[0]?.media.map(m => m.id).sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns separate postings newest first', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('old', { postingId: 'post-old', createdAt: new Date('2026-06-01T10:00:00Z') }));
    await mediaRepo.save(makeMedia('new', { postingId: 'post-new', createdAt: new Date('2026-06-18T10:00:00Z') }));

    const { postings: feed } = await useCase.list('user-1');

    expect(feed.map(p => p.id)).toEqual(['post-new', 'post-old']);
  });

  it('carries the url and the posting createdAt/location', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a', location: 'Lisbon, Portugal' }));

    const { postings: feed } = await useCase.list('user-1');

    expect(feed[0]?.media[0]?.url).toBe('https://cdn.example.com/m1.jpg');
    expect(feed[0]?.createdAt).toBe('2026-06-18T10:00:00.000Z');
    expect(feed[0]?.location).toBe('Lisbon, Portugal');
  });

  it('location is null when no item carries one', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));

    const { postings: feed } = await useCase.list('user-1');

    expect(feed[0]?.location).toBeNull();
  });

  it('only returns the requested publisher media', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('mine', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('theirs', { ownerId: 'user-2', postingId: 'post-b' }));

    const { postings: feed } = await useCase.list('user-1');

    expect(feed).toHaveLength(1);
    expect(feed[0]?.media[0]?.id).toBe('mine');
  });

  it('returns an empty feed when the publisher has no media', async (): Promise<void> => {
    const { useCase } = makeSut();
    expect((await useCase.list('user-1')).postings).toEqual([]);
  });

  it('throws when publisherId is empty', async (): Promise<void> => {
    const { useCase } = makeSut();
    await expect(useCase.list('')).rejects.toThrow('publisherId is required');
  });
});

describe('ListFeedUseCase — coordinate for the globe', () => {
  const lisbon = { latitude: 38.7223, longitude: -9.1393 };

  it('exposes the coordinate of the first item that carries one', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-a', coordinate: lisbon }));

    const { postings: feed } = await useCase.list('user-1');

    expect(feed[0]?.coordinate).toEqual(lisbon);
  });

  it('coordinate is null when no item in the posting has GPS', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a', location: 'Lisbon, Portugal' }));

    const { postings: feed } = await useCase.list('user-1');

    // A place label is not a coordinate — such posts stay off the map until the
    // backfill geocodes them.
    expect(feed[0]?.coordinate).toBeNull();
  });

  it('keeps each posting on its own coordinate', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    const rio = { latitude: -22.9068, longitude: -43.1729 };
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-old', coordinate: lisbon, createdAt: new Date('2026-06-01T10:00:00Z') }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-new', coordinate: rio, createdAt: new Date('2026-06-18T10:00:00Z') }));

    const { postings: feed } = await useCase.list('user-1');

    expect(feed.map(p => p.coordinate)).toEqual([rio, lisbon]);
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

describe('ListFeedUseCase — trash', () => {
  const trashed = { deletedAt: new Date('2026-07-20T12:00:00Z') };

  it('leaves trashed postings out of the feed', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('live', { postingId: 'post-live' }));
    await mediaRepo.save(makeMedia('gone', { postingId: 'post-gone', ...trashed }));

    const { postings: feed } = await useCase.list('user-1');

    expect(feed.map(p => p.id)).toEqual(['post-live']);
    expect(feed[0]?.deletedAt).toBeNull();
  });

  it('listDeleted returns only trashed postings, with the photos they had', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('live', { postingId: 'post-live' }));
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-gone', ...trashed }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-gone', ...trashed }));

    const { postings: deleted } = await useCase.listDeleted('user-1');

    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.id).toBe('post-gone');
    expect(deleted[0]?.media.map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(deleted[0]?.deletedAt).toBe('2026-07-20T12:00:00.000Z');
  });

  it('orders the trash by when it was deleted, not when it was posted', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    // The older post was deleted most recently, so it comes first.
    await mediaRepo.save(makeMedia('m1', {
      postingId: 'post-old',
      createdAt: new Date('2026-06-01T10:00:00Z'),
      deletedAt: new Date('2026-07-25T12:00:00Z'),
    }));
    await mediaRepo.save(makeMedia('m2', {
      postingId: 'post-new',
      createdAt: new Date('2026-06-18T10:00:00Z'),
      deletedAt: new Date('2026-07-20T12:00:00Z'),
    }));

    const { postings: deleted } = await useCase.listDeleted('user-1');

    expect(deleted.map(p => p.id)).toEqual(['post-old', 'post-new']);
  });

  it('returns an empty trash when nothing is deleted', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('live', { postingId: 'post-live' }));

    expect((await useCase.listDeleted('user-1')).postings).toEqual([]);
  });

  it('throws when publisherId is empty', async (): Promise<void> => {
    const { useCase } = makeSut();
    await expect(useCase.listDeleted('')).rejects.toThrow('publisherId is required');
  });
});

describe('ListFeedUseCase — paging', () => {
  /** `count` postings of one photo each, oldest last. */
  async function seedPostings(mediaRepo: InMemoryMediaRepository, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await mediaRepo.save(
        makeMedia(`m${i}`, {
          postingId: `post-${i}`,
          createdAt: new Date(Date.UTC(2026, 5, 18, 10, 0, count - i)),
        }),
      );
    }
  }

  it('never reads the store unbounded', async (): Promise<void> => {
    const mediaRepo = new RecordingMediaRepository();
    const useCase = new ListFeedUseCase(mediaRepo);
    await seedPostings(mediaRepo, 3);

    await useCase.list('user-1');
    await useCase.listDeleted('user-1');

    expect(mediaRepo.windows).toEqual([
      { limit: FEED_PAGE_ROWS, offset: 0 },
      { limit: FEED_PAGE_ROWS, offset: 0 },
    ]);
  });

  it('returns one page and where the next one starts', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await seedPostings(mediaRepo, 5);

    const page = await useCase.list('user-1', { limit: 2 });

    expect(page.postings.map(p => p.id)).toEqual(['post-0', 'post-1']);
    expect(page.nextOffset).toBe(2);
  });

  it('reports the feed exhausted when a page comes back short', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await seedPostings(mediaRepo, 3);

    const page = await useCase.list('user-1', { limit: 2, offset: 2 });

    expect(page.postings.map(p => p.id)).toEqual(['post-2']);
    expect(page.nextOffset).toBeNull();
  });

  it('covers the whole feed once, in order, over successive pages', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await seedPostings(mediaRepo, 7);

    let postings: FeedPostingDto[] = [];
    let offset: number | null = 0;
    while (offset != null) {
      const page = await useCase.list('user-1', { limit: 2, offset });
      postings = mergeFeedPages(postings, page.postings);
      offset = page.nextOffset;
    }

    expect(postings.map(p => p.id)).toEqual((await useCase.list('user-1')).postings.map(p => p.id));
    expect(postings).toHaveLength(7);
  });

  it('splits a posting whose photos do not fit in one page, and merging joins it back', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    const shared = { postingId: 'post-a', createdAt: new Date('2026-06-18T10:00:00Z') };
    await mediaRepo.save(makeMedia('m1', shared));
    await mediaRepo.save(makeMedia('m2', shared));
    await mediaRepo.save(makeMedia('m3', shared));

    const first = await useCase.list('user-1', { limit: 2 });
    const second = await useCase.list('user-1', { limit: 2, offset: first.nextOffset ?? 0 });

    // Both pages carry the same posting — the boundary fell inside it.
    expect(first.postings[0]?.media).toHaveLength(2);
    expect(second.postings[0]?.id).toBe('post-a');

    const merged = mergeFeedPages(first.postings, second.postings);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.media.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('counts trashed rows towards the page, so paging never stalls on them', async (): Promise<void> => {
    // The filter runs after the read: a page made entirely of trashed rows is
    // empty but still advances, or the caller would ask for it forever.
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('gone1', { postingId: 'post-gone', deletedAt: new Date('2026-07-20T12:00:00Z'), createdAt: new Date('2026-06-19T10:00:00Z') }));
    await mediaRepo.save(makeMedia('gone2', { postingId: 'post-gone', deletedAt: new Date('2026-07-20T12:00:00Z'), createdAt: new Date('2026-06-19T10:00:00Z') }));
    await mediaRepo.save(makeMedia('live', { postingId: 'post-live', createdAt: new Date('2026-06-18T10:00:00Z') }));

    const page = await useCase.list('user-1', { limit: 2 });

    expect(page.postings).toEqual([]);
    expect(page.nextOffset).toBe(2);
    expect((await useCase.list('user-1', { limit: 2, offset: 2 })).postings.map(p => p.id)).toEqual(['post-live']);
  });
});

describe('ListFeedUseCase — one posting by id', () => {
  it('returns the posting with all of its photos', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a', location: 'Lisbon, Portugal' }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('other', { postingId: 'post-b' }));

    const posting = await useCase.posting('user-1', 'post-a');

    expect(posting?.id).toBe('post-a');
    expect(posting?.media.map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(posting?.location).toBe('Lisbon, Portugal');
  });

  it('reads only that posting, not the feed', async (): Promise<void> => {
    const mediaRepo = new RecordingMediaRepository();
    const useCase = new ListFeedUseCase(mediaRepo);
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));

    await useCase.posting('user-1', 'post-a');

    expect(mediaRepo.windows).toEqual([]);
  });

  it('returns null for a posting the publisher does not have', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('theirs', { ownerId: 'user-2', postingId: 'post-a' }));

    expect(await useCase.posting('user-1', 'post-a')).toBeNull();
  });

  it('returns null for a trashed posting, like the feed does', async (): Promise<void> => {
    const { useCase, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a', deletedAt: new Date('2026-07-20T12:00:00Z') }));

    expect(await useCase.posting('user-1', 'post-a')).toBeNull();
  });

  it('throws when publisherId is empty', async (): Promise<void> => {
    const { useCase } = makeSut();
    await expect(useCase.posting('', 'post-a')).rejects.toThrow('publisherId is required');
  });
});
