import { emptyRoundNote, scanShortfallNote, scanSummary } from './reviewCopy';
import type { ScanStats } from './reviewCopy';

const stats = (over: Partial<ScanStats> = {}): ScanStats => ({
  unique: 100,
  graded: 100,
  unreadable: 0,
  quotaExhausted: false,
  rateLimited: false,
  timedOut: false,
  ...over,
});

describe('emptyRoundNote', () => {
  it('says the day is spent when the AI budget ran out', () => {
    expect(emptyRoundNote('quota', 0)).toMatch(/limit is used up/);
  });

  it('sends a throttled publisher back in a moment, not tomorrow', () => {
    // `busy` is a per-minute ceiling that clears itself; telling someone to
    // come back the next day for a half-minute pause is what made the feature
    // look broken on the first attempt (issue #141).
    const note = emptyRoundNote('busy', 0);

    expect(note).toMatch(/busy right now/);
    expect(note).not.toMatch(/tomorrow/);
  });

  it('never blames the library when the round itself failed', () => {
    // The round errored before it could learn anything about the library, so
    // "nothing worth posting in those days" would be an unfounded claim.
    const note = emptyRoundNote('failed', 0);

    expect(note).toMatch(/Could not reach the photo AI/);
    expect(note).not.toMatch(/nothing worth|every photo/i);
  });

  it('invites another tap when the round only hit its wave cap', () => {
    // The distinction that matters: "capped" is not "there is nothing left",
    // and telling the publisher to stop is a claim the round never established.
    expect(emptyRoundNote('capped', 12)).toBe(
      'Checked 12 more photos — nothing worth adding yet. Tap again to keep looking.',
    );
    expect(emptyRoundNote('capped', 12)).toMatch(/Tap again/);
  });

  it('singularises a one-photo round', () => {
    expect(emptyRoundNote('capped', 1)).toMatch(/Checked 1 more photo —/);
  });

  it('drops the count when the round looked at nothing', () => {
    expect(emptyRoundNote('capped', 0)).toBe('Nothing yet — tap again to keep looking.');
  });

  it('is final only when the window is genuinely spent', () => {
    expect(emptyRoundNote('exhausted', 40)).toMatch(/every photo from those days/);
  });

  it('says nothing when the round was not empty', () => {
    expect(emptyRoundNote(null, 5)).toBeNull();
  });
});

describe('scanSummary', () => {
  it('reports what the AI analysed, not what the library handed over', () => {
    expect(scanSummary(10, stats({ unique: 109, graded: 12 }), 109)).toBe(
      'AI picked 10 photos — 12 of 109 analysed.',
    );
  });

  it('falls back to the scanned count when there are no stats (a cached batch)', () => {
    expect(scanSummary(10, null, 109)).toBe('AI picked 10 photos from 109 scanned.');
  });

  it('singularises a single picked photo', () => {
    expect(scanSummary(1, null, 4)).toBe('AI picked 1 photo from 4 scanned.');
    expect(scanSummary(1, stats({ unique: 4, graded: 4 }), 4)).toBe('AI picked 1 photo — 4 of 4 analysed.');
  });
});

describe('emptyRoundNote — the round ran out of time', () => {
  it('names the connection rather than the budget or the provider', () => {
    // Reported as its own reason so the advice can be the right one: this is
    // not a wall that lifts by waiting, and it is not the day being over.
    const note = emptyRoundNote('slow', 12);
    expect(note).toMatch(/too long/);
    expect(note).not.toMatch(/tomorrow/);
  });
});

describe('scanShortfallNote', () => {
  it('blames the daily budget first — it is the one the publisher cannot retry', () => {
    expect(scanShortfallNote(stats({ graded: 12, unreadable: 3, quotaExhausted: true }))).toMatch(
      /limit ran out after 12 photos/,
    );
  });

  it('reports a throttled scan as resumable, and ranks it under the daily quota', () => {
    expect(scanShortfallNote(stats({ graded: 40, rateLimited: true }))).toMatch(
      /was busy after 40 photos — rescan in a moment/,
    );
    // Quota wins when both are set: it is the one a rescan cannot fix.
    expect(scanShortfallNote(stats({ graded: 40, rateLimited: true, quotaExhausted: true }))).toMatch(
      /limit ran out/,
    );
  });

  it('blames the connection when the scan ran out of time, and ranks it under both walls', () => {
    // A deadline that passed is the publisher's uplink, not their budget and
    // not the provider's mood — and unlike either, it is worth retrying on a
    // better connection rather than at a better time (issue #174).
    expect(scanShortfallNote(stats({ graded: 40, timedOut: true }))).toMatch(
      /took too long after 40 photos/,
    );
    expect(
      scanShortfallNote(stats({ graded: 40, timedOut: true, rateLimited: true })),
    ).toMatch(/was busy after 40 photos/);
  });

  it('explains unreadable originals as iCloud downloads', () => {
    expect(scanShortfallNote(stats({ unreadable: 3 }))).toMatch(/3 photos couldn’t be read/);
  });

  it('singularises one unreadable photo', () => {
    expect(scanShortfallNote(stats({ unreadable: 1 }))).toMatch(/1 photo couldn’t be read/);
  });

  it('stays quiet on a clean scan', () => {
    expect(scanShortfallNote(stats())).toBeNull();
  });

  it('stays quiet with no stats at all', () => {
    expect(scanShortfallNote(null)).toBeNull();
  });
});
