import type { FeedMedia, FeedPosting } from '../components/PhotoFeed';
import type { MediaType } from '../../domain/entities/Media';

/**
 * Mock data for the Home feed.
 *
 * The real feed will come from grouping a publisher's uploaded media into
 * "postings" (the batch sent together), each carrying a date and a
 * reverse-geocoded place — tracked in issue #34. Until then the Home screen
 * renders this rich mock so the feed looks fully populated.
 *
 * Shape mirrors the domain `Media` (type/location/createdAt) so swapping to
 * live data is a drop-in replacement. Every item gets a real picsum.photos URL
 * (real photographs, deterministic per seed) — no null/placeholder sources.
 */
const cover = (seed: string): string => `https://picsum.photos/seed/${seed}/900/1100`;
const thumb = (seed: string): string => `https://picsum.photos/seed/${seed}/600/600`;
const m = (id: string, type: MediaType = 'image'): FeedMedia => ({ id, type, uri: thumb(id) });

export const feedStubs: FeedPosting[] = [
  {
    id: 'post-1',
    date: 'June 18, 2026',
    place: 'Lisbon, Portugal',
    coverUri: cover('lisbon-tram'),
    media: [m('p1-1'), m('p1-2'), m('p1-3', 'video'), m('p1-4'), m('p1-5')],
  },
  {
    id: 'post-2',
    date: 'June 11, 2026',
    place: 'Sintra, Portugal',
    coverUri: cover('sintra-palace'),
    media: [m('p2-1'), m('p2-2'), m('p2-3')],
  },
  {
    id: 'post-3',
    date: 'June 4, 2026',
    place: 'Porto, Portugal',
    coverUri: cover('porto-river'),
    media: [m('p3-1', 'video'), m('p3-2')],
  },
  {
    id: 'post-4',
    date: 'May 28, 2026',
    place: 'Algarve, Portugal',
    coverUri: cover('algarve-cliffs'),
    media: [m('p4-1'), m('p4-2'), m('p4-3'), m('p4-4')],
  },
  {
    id: 'post-5',
    date: 'May 20, 2026',
    place: 'Madrid, Spain',
    coverUri: cover('madrid-plaza'),
    media: [m('p5-1'), m('p5-2'), m('p5-3', 'video'), m('p5-4')],
  },
  {
    id: 'post-6',
    date: 'May 12, 2026',
    place: 'San Sebastián, Spain',
    coverUri: cover('sansebastian-beach'),
    media: [m('p6-1'), m('p6-2')],
  },
];
