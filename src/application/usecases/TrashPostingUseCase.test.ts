import { TrashPostingUseCase } from './TrashPostingUseCase';
import { ListFeedUseCase } from './ListFeedUseCase';
import { Media } from '../../domain/entities/Media';
import type { MediaProps } from '../../domain/entities/Media';
import { InMemoryMediaRepository, InMemoryPostGalleryRepository } from '../../test-support/fakes';

function makeSut(): {
  trash: TrashPostingUseCase;
  feed: ListFeedUseCase;
  mediaRepo: InMemoryMediaRepository;
  galleryRepo: InMemoryPostGalleryRepository;
} {
  const mediaRepo = new InMemoryMediaRepository();
  const galleryRepo = new InMemoryPostGalleryRepository();
  return {
    trash: new TrashPostingUseCase(mediaRepo, galleryRepo),
    feed: new ListFeedUseCase(mediaRepo),
    mediaRepo,
    galleryRepo,
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

    expect((await feed.list('user-1')).postings).toHaveLength(0);
    const { postings: deleted } = await feed.listDeleted('user-1');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.media.map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(deleted[0]?.deletedAt).toBe('2026-07-28T09:00:00.000Z');
  });

  it('leaves other postings alone', async (): Promise<void> => {
    const { trash, feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-b' }));

    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    expect((await feed.list('user-1')).postings.map(p => p.id)).toEqual(['post-b']);
  });

  it('never touches another publisher’s posting of the same id', async (): Promise<void> => {
    const { trash, feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('mine', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('theirs', { ownerId: 'user-2', postingId: 'post-a' }));

    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    expect((await feed.list('user-2')).postings).toHaveLength(1);
    expect((await feed.listDeleted('user-2')).postings).toHaveLength(0);
  });

  it('restores a trashed posting back into the feed at its original date', async (): Promise<void> => {
    const { trash, feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1'));
    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    await trash.restore({ publisherId: 'user-1', postingId: 'post-a' });

    const { postings: live } = await feed.list('user-1');
    expect(live).toHaveLength(1);
    expect(live[0]?.createdAt).toBe('2026-06-18T10:00:00.000Z');
    expect((await feed.listDeleted('user-1')).postings).toHaveLength(0);
  });

  it('takes the posting out of the followers’ gallery too, not just the feed', async (): Promise<void> => {
    const { trash, galleryRepo, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { postingId: 'post-a' }));
    await mediaRepo.save(makeMedia('m2', { postingId: 'post-b' }));
    galleryRepo.publish('user-1', 'post-a');
    galleryRepo.publish('user-1', 'post-b');

    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' }, new Date('2026-07-28T09:00:00Z'));

    expect(galleryRepo.visible('user-1')).toEqual(['post-b']);
    expect(galleryRepo.deletedAt('user-1', 'post-a')).toEqual(new Date('2026-07-28T09:00:00Z'));
  });

  it('puts the posting back in the followers’ gallery when restored', async (): Promise<void> => {
    const { trash, galleryRepo, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1'));
    galleryRepo.publish('user-1', 'post-a');
    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    await trash.restore({ publisherId: 'user-1', postingId: 'post-a' });

    expect(galleryRepo.visible('user-1')).toEqual(['post-a']);
  });

  it('trashes a posting that followers never received', async (): Promise<void> => {
    // Backfilled postings are feed-only — no gallery row was ever written, so
    // the gallery write matches nothing and the delete still succeeds.
    const { trash, feed, mediaRepo, galleryRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1', { backfilled: true }));

    await trash.trash({ publisherId: 'user-1', postingId: 'post-a' });

    expect((await feed.list('user-1')).postings).toHaveLength(0);
    expect(galleryRepo.visible('user-1')).toEqual([]);
  });

  it('leaves the post in the feed when it cannot be hidden from followers', async (): Promise<void> => {
    // The half-failure worth guarding: never leave the publisher believing a
    // post is gone while followers can still open it.
    const { feed, mediaRepo } = makeSut();
    await mediaRepo.save(makeMedia('m1'));
    const failing = new TrashPostingUseCase(mediaRepo, {
      setPostingDeleted: (): Promise<void> => Promise.reject(new Error('network down')),
    });

    await expect(failing.trash({ publisherId: 'user-1', postingId: 'post-a' })).rejects.toThrow('network down');
    expect((await feed.list('user-1')).postings).toHaveLength(1);
  });

  it('rejects empty ids rather than matching nothing and reporting success', async (): Promise<void> => {
    const { trash } = makeSut();
    await expect(trash.trash({ publisherId: '', postingId: 'post-a' })).rejects.toThrow('publisherId');
    await expect(trash.restore({ publisherId: 'user-1', postingId: '' })).rejects.toThrow('postingId');
  });
});
