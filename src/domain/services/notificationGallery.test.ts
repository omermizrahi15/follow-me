import { resolveChosenGalleryUrls } from './notificationGallery';

const photo = (id: string, url: string): { id: string; url: string } => ({ id, url });

describe('resolveChosenGalleryUrls', () => {
  it('recovers the cloud copy of device-scanned photos instead of dropping them', () => {
    // The regression behind issue #85: a scanned batch holds iOS ph:// uris, which
    // the old code filtered out entirely — the chosen photos vanished and unrelated
    // recent candidates took their place.
    const batch = [photo('a', 'ph://asset-a'), photo('b', 'ph://asset-b')];
    const cloud = new Map([
      ['a', 'https://cdn/a.jpg'],
      ['b', 'https://cdn/b.jpg'],
    ]);

    const result = resolveChosenGalleryUrls(batch, cloud, 10);

    expect(result.urls).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg']);
    expect(result.missing).toEqual([]);
  });

  it('keeps the batch order, which is the order the review screen shows', () => {
    const batch = [photo('c', 'ph://c'), photo('a', 'ph://a'), photo('b', 'ph://b')];
    const cloud = new Map([
      ['a', 'https://cdn/a.jpg'],
      ['b', 'https://cdn/b.jpg'],
      ['c', 'https://cdn/c.jpg'],
    ]);

    expect(resolveChosenGalleryUrls(batch, cloud, 10).urls).toEqual([
      'https://cdn/c.jpg',
      'https://cdn/a.jpg',
      'https://cdn/b.jpg',
    ]);
  });

  it('prefers a url that is already remote over a lookup', () => {
    const batch = [photo('a', 'https://cdn/original-a.jpg')];
    const cloud = new Map([['a', 'https://cdn/other-a.jpg']]);

    expect(resolveChosenGalleryUrls(batch, cloud, 10).urls).toEqual(['https://cdn/original-a.jpg']);
  });

  it('reports chosen photos with no cloud copy instead of silently substituting', () => {
    const batch = [photo('a', 'ph://a'), photo('b', 'ph://b')];
    const cloud = new Map([['a', 'https://cdn/a.jpg']]);

    const result = resolveChosenGalleryUrls(batch, cloud, 10);

    expect(result.urls).toEqual(['https://cdn/a.jpg']);
    expect(result.missing).toEqual(['b']);
  });

  it('caps at the configured photo count', () => {
    const batch = Array.from({ length: 12 }, (_, i) => photo(`p${i}`, `https://cdn/${i}.jpg`));

    expect(resolveChosenGalleryUrls(batch, new Map(), 5).urls).toHaveLength(5);
  });

  it('never emits duplicates when a batch repeats an asset', () => {
    const batch = [photo('a', 'ph://a'), photo('a', 'ph://a')];
    const cloud = new Map([['a', 'https://cdn/a.jpg']]);

    expect(resolveChosenGalleryUrls(batch, cloud, 10).urls).toEqual(['https://cdn/a.jpg']);
  });

  it('returns nothing resolvable for an empty batch', () => {
    const result = resolveChosenGalleryUrls([], new Map(), 10);

    expect(result.urls).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

describe('resolveChosenGalleryUrls — ids needing a lookup', () => {
  it('is the set of non-remote ids, so the caller queries only what it must', () => {
    const batch = [photo('a', 'https://cdn/a.jpg'), photo('b', 'ph://b'), photo('c', 'ph://c')];

    // Passing an empty map models "before the lookup" — everything unresolved is
    // exactly what needs fetching.
    expect(resolveChosenGalleryUrls(batch, new Map(), 10).missing).toEqual(['b', 'c']);
  });
});
