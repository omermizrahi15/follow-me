import type { IMediaRepository, IPostGalleryRepository } from '../../domain/interfaces';

interface TrashPostingInput {
  publisherId: string;
  postingId: string;
}

/**
 * Moves one of the publisher's own postings to the trash, and back out again.
 *
 * A soft delete, not a real one: the photos have already been delivered to
 * followers, so dropping the rows would destroy only the publisher's own copy
 * with no way back. Trashed postings disappear from the feed and the globe and
 * are listed by ListFeedUseCase.listDeleted until restored.
 *
 * A posting lives in two places — `media` (the publisher's feed) and the
 * gallery row followers open from the WhatsApp link — and deleting has to reach
 * both. It used to write only the first, so a publisher down to one post was
 * still showing their followers every post they had ever sent.
 *
 * Trash and restore are the same pair of writes with a different value, so they
 * live in one use case rather than two files that differ by a null.
 */
export class TrashPostingUseCase {
  constructor(
    private readonly mediaRepo: IMediaRepository,
    private readonly galleryRepo: IPostGalleryRepository,
  ) {}

  /** Hide the posting. `now` is injectable so tests don't race the clock. */
  async trash(input: TrashPostingInput, now: Date = new Date()): Promise<void> {
    this.validate(input);
    // Followers first, publisher second. Neither write depends on the other, so
    // the order only decides what a half-failure leaves behind — and the state
    // to avoid is a post the publisher believes is deleted that followers can
    // still open. If the gallery write fails, nothing is trashed and the error
    // reaches the UI to be retried.
    await this.galleryRepo.setPostingDeleted(input.publisherId, input.postingId, now);
    await this.mediaRepo.setPostingDeleted(input.publisherId, input.postingId, now);
  }

  /** Put it back in the feed, at its original date — a restore, not a repost. */
  async restore(input: TrashPostingInput): Promise<void> {
    this.validate(input);
    // Reversed for the same reason: bring it back for the publisher first, so a
    // failure can't republish to followers something the publisher can't see.
    await this.mediaRepo.setPostingDeleted(input.publisherId, input.postingId, null);
    await this.galleryRepo.setPostingDeleted(input.publisherId, input.postingId, null);
  }

  /**
   * Ownership is enforced by the writes themselves (they match on owner +
   * posting), so there is no read-then-write round trip here — only a guard
   * against empty ids, which would otherwise match nothing and look like
   * success.
   */
  private validate(input: TrashPostingInput): void {
    if (!input.publisherId) throw new Error('publisherId is required');
    if (!input.postingId) throw new Error('postingId is required');
  }
}
