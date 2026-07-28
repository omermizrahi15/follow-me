import { TrashPostingUseCase } from './TrashPostingUseCase';
import { ListFeedUseCase } from './ListFeedUseCase';
import { Media } from '../../domain/entities/Media';
import type { MediaProps } from '../../domain/entities/Media';
import { InMemoryMediaRepository } from '../../test-support/fakes';

function makeSut(): {
  trash: TrashPostingUseCase;
  feed: ListFeedUseCase;
  mediaRepo: InMemoryMediaRepository;
} {
  const mediaRepo = new InMemoryMediaRepository();
  return {
    trash: new TrashPostingUseCase(mediaRepo),
    feed: new ListFeedUseCase(mediaRepo),
    mediaRepo,
  };
}

function makeMedia(id: string, overrides: Partial<MediaProps> = {}): Media {
  return Media.create({
    id,
    ownerId: 'user-1',
    url: `https://cdn.example.com/${id}.jpg`,
    createdAt: new Date('2026-06-18T10:00:00Z'),
    postingId: 'post-a',
    ...overrides,
  });
}

describe('TrashPostingUseCase', (): void => {
  it('takes the whole posting out of the feed and into the trash', async (): Promise<void> => {
    const { trash, feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1'));
    await mediaRepo.save(makeMedia('m2'));

    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' }, new Date('2026-07-28T09:00:00Z'));

    expect(await feed.list('user-1')).toHaveLength(0);
    const deleted = await feed.listDeleted('user-1');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.media.map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(deleted[0]?.deletedAt).toBe('2026-07-28T09:00:00.000Z');
  });

  it('leaves other postings alone', async (): Promise<void> => {
    const { trash, feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-b' }));

    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    expect((await feed.list('user-1')).map(p => p.id)).toEqual(['post-b']);
  });

  it('never touches another publisher’s posting of the same id', async (): Promise<void> => {
    const { trash, feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('mine', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('theirs', { ownerId: 'user-2', postingId: 'post-a' }));

    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    expect(await feed.list('user-2')).toHaveLength(1);
    expect(await feed.listDeleted('user-2')).toHaveLength(0);
  });

  it('restores a trashed posting back into the feed at its original date', async (): Promise<void> => {
    const { trash, feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1'));
    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    await trash.restore({ publisherId: 'user-1', postingId: 'post-a' });

    const live = await feed.list('user-1');
    expect(live).toHaveLength(1);
    expect(live[0]?.createdAt).toBe('2026-06-18T10:00:00.000Z');
    expect(await feed.listDeleted('user-1')).toHaveLength(0);
  });

  it('rejects empty ids rather than matching nothing and reporting success', async (): Promise<void> => {
    const { trash } = makeSut();
    await expect(trash.trash({ publisherId: '', postingId: 'post-a' })).rejects.toThrow('publisherId');
    await expect(trash.restore({ publisherId: 'user-1', postingId: '' })).rejects.toThrow('postingId');
  });
});
