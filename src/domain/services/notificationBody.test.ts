import { composeNotificationBody, selectTopLocations, formatLocationClause } from './notificationBody';
import { Media } from '../entities/Media';

function makeMedia(overrides: Partial<{ location: string; mediaType: 'image' | 'video' }> = {}): Media {
  return Media.create({
    id: 'media-1',
    ownerId: 'user-1',
    url: 'https://cdn.test/item.jpg',
    createdAt: new Date(),
    ...(overrides.location != null ? { location: overrides.location } : {}),
    mediaType: overrides.mediaType ?? 'image',
  });
}

describe('selectTopLocations — no location data', () => {
  it('returns an empty array for no media', () => {
    expect(selectTopLocations([])).toEqual([]);
  });

  it('returns an empty array when no media has a location', () => {
    expect(selectTopLocations([makeMedia(), makeMedia()])).toEqual([]);
  });
});

describe('selectTopLocations — single location', () => {
  it('returns the location when a single media item has one', () => {
    expect(selectTopLocations([makeMedia({ location: 'Paris' })])).toEqual(['Paris']);
  });

  it('deduplicates when all items share the same location', () => {
    const media = [makeMedia({ location: 'Tel Aviv' }), makeMedia({ location: 'Tel Aviv' })];
    expect(selectTopLocations(media)).toEqual(['Tel Aviv']);
  });
});

describe('selectTopLocations — multiple locations, sorted by frequency', () => {
  it('puts the most frequent location first', () => {
    const media = [
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia({ location: 'Paris' }),
    ];
    expect(selectTopLocations(media)).toEqual(['Tel Aviv', 'Paris']);
  });

  it('returns all unique locations in frequency order', () => {
    const media = [
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia({ location: 'Paris' }),
      makeMedia({ location: 'London' }),
    ];
    expect(selectTopLocations(media)).toHaveLength(3);
    // all tied at 1 — order follows first appearance
    expect(selectTopLocations(media)[0]).toBe('Tel Aviv');
  });

  it('ignores media with no location when computing frequency', () => {
    const media = [
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia(), // no location — not counted
    ];
    expect(selectTopLocations(media)).toEqual(['Tel Aviv']);
  });
});

describe('formatLocationClause', () => {
  it('returns null for an empty list', () => {
    expect(formatLocationClause([])).toBeNull();
  });

  it('returns the name as-is for a single location', () => {
    expect(formatLocationClause(['Paris'])).toBe('Paris');
  });

  it('joins two locations with " & "', () => {
    expect(formatLocationClause(['Paris', 'London'])).toBe('Paris & London');
  });

  it('shows the first two and appends "and more" for three locations', () => {
    expect(formatLocationClause(['Paris', 'London', 'Tel Aviv'])).toBe('Paris, London and more');
  });

  it('still shows only the first two for four or more locations', () => {
    expect(formatLocationClause(['Paris', 'London', 'Tel Aviv', 'Rome'])).toBe('Paris, London and more');
  });
});

describe('composeNotificationBody — publisher name', () => {
  it('includes the publisher name', () => {
    expect(composeNotificationBody('Omer', [makeMedia()])).toContain('Omer');
  });

  it('works with a different publisher name', () => {
    expect(composeNotificationBody('Dana', [makeMedia()])).toContain('Dana');
  });
});

describe('composeNotificationBody — media type description', () => {
  it('says "photos" for images only', () => {
    const body = composeNotificationBody('Omer', [makeMedia({ mediaType: 'image' })]);
    expect(body).toContain('photos');
    expect(body).not.toContain('videos');
  });

  it('says "videos" for videos only', () => {
    const body = composeNotificationBody('Omer', [makeMedia({ mediaType: 'video' })]);
    expect(body).toContain('videos');
    expect(body).not.toContain('photos');
  });

  it('says "photos and videos" for a mixed batch', () => {
    const body = composeNotificationBody('Omer', [
      makeMedia({ mediaType: 'image' }),
      makeMedia({ mediaType: 'video' }),
    ]);
    expect(body).toContain('photos and videos');
  });
});

describe('composeNotificationBody — location', () => {
  it('omits location when media has no location', () => {
    const body = composeNotificationBody('Omer', [makeMedia()]);
    expect(body).not.toContain('from');
  });

  it('shows a single location', () => {
    const body = composeNotificationBody('Omer', [makeMedia({ location: 'Tel Aviv' })]);
    expect(body).toContain('from Tel Aviv');
  });

  it('shows two locations joined by " & "', () => {
    const body = composeNotificationBody('Omer', [
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia({ location: 'Paris' }),
    ]);
    expect(body).toContain('from Tel Aviv & Paris');
  });

  it('shows the top two and "and more" for three or more distinct locations', () => {
    const body = composeNotificationBody('Omer', [
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia({ location: 'Tel Aviv' }),
      makeMedia({ location: 'Paris' }),
      makeMedia({ location: 'London' }),
    ]);
    expect(body).toContain('from Tel Aviv, Paris and more');
  });
});

describe('composeNotificationBody — overall format', () => {
  it('follows the "Checkout [name] latest [type] from [place]" pattern', () => {
    const body = composeNotificationBody('Dana', [makeMedia({ location: 'Paris, France' })]);
    expect(body).toMatch(/checkout Dana.*latest.*Paris, France/i);
  });

  it('omits "from" clause when there is no location', () => {
    const body = composeNotificationBody('Omer', [makeMedia()]);
    expect(body).toMatch(/checkout Omer.*latest/i);
    expect(body).not.toMatch(/from/i);
  });
});
