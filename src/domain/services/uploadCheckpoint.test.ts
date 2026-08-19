import { CHECKPOINT_TTL_MS, usableUploads, withUploads } from './uploadCheckpoint';

const NOW = 1_700_000_000_000;

describe('withUploads', () => {
  it('records what this attempt uploaded', () => {
    const cp = withUploads(null, [{ mediaId: 'a', url: 'https://cdn/a.jpg' }], NOW);
    expect(cp.urls).toEqual({ a: 'https://cdn/a.jpg' });
    expect(cp.at).toBe(NOW);
  });

  it('adds to what an earlier attempt had already got through', () => {
    const first = withUploads(null, [{ mediaId: 'a', url: 'https://cdn/a.jpg' }], NOW);
    const second = withUploads(first, [{ mediaId: 'b', url: 'https://cdn/b.jpg' }], NOW + 1000);
    expect(second.urls).toEqual({ a: 'https://cdn/a.jpg', b: 'https://cdn/b.jpg' });
  });

  it('takes the newer url when the same item was uploaded twice', () => {
    const first = withUploads(null, [{ mediaId: 'a', url: 'https://cdn/old.jpg' }], NOW);
    const second = withUploads(first, [{ mediaId: 'a', url: 'https://cdn/new.jpg' }], NOW + 1000);
    expect(second.urls.a).toBe('https://cdn/new.jpg');
  });

  it('moves the timestamp forward, so finishing a post keeps it fresh', () => {
    const first = withUploads(null, [{ mediaId: 'a', url: 'https://cdn/a.jpg' }], NOW);
    expect(withUploads(first, [], NOW + 60_000).at).toBe(NOW + 60_000);
  });
});

describe('usableUploads', () => {
  it('has nothing to offer when there is no checkpoint', () => {
    expect(usableUploads(null, NOW)).toEqual({});
  });

  it('offers a recent checkpoint', () => {
    const cp = withUploads(null, [{ mediaId: 'a', url: 'https://cdn/a.jpg' }], NOW);
    expect(usableUploads(cp, NOW + 60_000)).toEqual({ a: 'https://cdn/a.jpg' });
  });

  it('drops a checkpoint older than the retention window', () => {
    // Those urls may have been pruned by the retention job by now; posting them
    // would put dead links in front of followers.
    const cp = withUploads(null, [{ mediaId: 'a', url: 'https://cdn/a.jpg' }], NOW);
    expect(usableUploads(cp, NOW + CHECKPOINT_TTL_MS + 1)).toEqual({});
  });

  it('drops all of a stale checkpoint, not just part of it', () => {
    const cp = withUploads(
      null,
      [
        { mediaId: 'a', url: 'https://cdn/a.jpg' },
        { mediaId: 'b', url: 'https://cdn/b.jpg' },
      ],
      NOW,
    );
    expect(usableUploads(cp, NOW + CHECKPOINT_TTL_MS * 2)).toEqual({});
  });

  it('distrusts a checkpoint stamped in the future', () => {
    // The clock moving backwards is ordinary here — this app is for people
    // crossing timezones — and a future stamp is not evidence of freshness.
    const cp = withUploads(null, [{ mediaId: 'a', url: 'https://cdn/a.jpg' }], NOW + 60_000);
    expect(usableUploads(cp, NOW)).toEqual({});
  });
});
