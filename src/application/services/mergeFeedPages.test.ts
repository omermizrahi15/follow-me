import { mergeFeedPages } from './mergeFeedPages';
import type { FeedPostingDto } from '../dtos';

function posting(id: string, mediaIds: string[]): FeedPostingDto {
  return {
    id,
    createdAt: '2026-06-18T10:00:00.000Z',
    location: null,
    coordinate: null,
    deletedAt: null,
    media: mediaIds.map(m => ({ id: m, url: `https://cdn.example.com/${m}.jpg` })),
  };
}

describe('mergeFeedPages', () => {
  it('appends a page of new postings', () => {
    const merged = mergeFeedPages([posting('post-a', ['m1'])], [posting('post-b', ['m2'])]);
    expect(merged.map(p => p.id)).toEqual(['post-a', 'post-b']);
  });

  it('joins a posting whose photos straddle the page boundary', () => {
    // The page ended mid-posting, so post-a arrives twice — once with the
    // photos that fit, once with the rest.
    const merged = mergeFeedPages(
      [posting('post-a', ['m1', 'm2'])],
      [posting('post-a', ['m3']), posting('post-b', ['m4'])],
    );

    expect(merged.map(p => p.id)).toEqual(['post-a', 'post-b']);
    expect(merged[0]?.media.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('only joins at the boundary, never a posting further up the feed', () => {
    // Nothing but the last posting can be continued: pages are read in one
    // total order, so an id seen earlier is already complete.
    const merged = mergeFeedPages(
      [posting('post-a', ['m1']), posting('post-b', ['m2'])],
      [posting('post-c', ['m3'])],
    );

    expect(merged.map(p => p.id)).toEqual(['post-a', 'post-b', 'post-c']);
    expect(merged[0]?.media).toHaveLength(1);
  });

  it('leaves the loaded feed untouched by an empty page', () => {
    const loaded = [posting('post-a', ['m1'])];
    expect(mergeFeedPages(loaded, [])).toEqual(loaded);
  });

  it('starts the feed from the first page', () => {
    expect(mergeFeedPages([], [posting('post-a', ['m1'])]).map(p => p.id)).toEqual(['post-a']);
  });

  it('does not mutate the pages it was given', () => {
    const loaded = [posting('post-a', ['m1'])];
    mergeFeedPages(loaded, [posting('post-a', ['m2'])]);
    expect(loaded[0]?.media.map(m => m.id)).toEqual(['m1']);
  });
});
