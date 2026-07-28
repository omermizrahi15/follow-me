import type { IMediaRepository } from '../../domain/interfaces';

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
 * Trash and restore are the same write with a different value, so they live in
 * one use case rather than two files that differ by a null.
 */
export class TrashPostingUseCase {
  constructor(private readonly mediaRepo: IMediaRepository) {}

  /** Hide the posting. `now` is injectable so tests don't race the clock. */
  async trash(input: TrashPostingInput, now: Date = new Date()): Promise<void> {
    this.validate(input);
    await this.mediaRepo.setPostingDeleted(input.publisherId, input.postingId, now);
  }

  /** Put it back in the feed, at its original date — a restore, not a repost. */
  async restore(input: TrashPostingInput): Promise<void> {
    this.validate(input);
    await this.mediaRepo.setPostingDeleted(input.publisherId, input.postingId, null);
  }

  /**
   * Ownership is enforced by the write itself (it matches on owner + posting),
   * so there is no read-then-write round trip here — only a guard against
   * empty ids, which would otherwise match nothing and look like success.
   */
  private validate(input: TrashPostingInput): void {
    if (!input.publisherId) throw new Error('publisherId is required');
    if (!input.postingId) throw new Error('postingId is required');
  }
}
