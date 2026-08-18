import { ClassificationFailedError, GeminiPhotoClassifier } from './GeminiPhotoClassifier';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
/** Stands in for the monitoring hook the composition root injects. */
const reportedQuota = jest.fn();

/**
 * Concurrency/finish-condition tests: whatever mix of fast and slow responses
 * the network produces, classify() must settle — resolving with the batch, or
 * rejecting the moment the classifier itself fails — and stop early when asked.
 *
 * "Settles" replaced "always resolves" deliberately. Resolving with a short
 * batch made a dead classifier indistinguishable from a thin photo library,
 * and the app then cached the shortfall as fact.
 */

const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

function candidate(id: string): PhotoCandidate {
  return { id, uri: `https://cdn.test/${id}.jpg`, createdAt: new Date(0) };
}

function okResponse(id: string): { ok: true; json: () => Promise<unknown> } {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        classifications: [
          { id, category: 'food', confidence: 0.9, quality: 0.8, caption: '', scene: 's' },
        ],
      }),
  };
}

/** Responds after `delayMs`, reading the photo id from the request body. */
function respondWithDelay(delayMs: (id: string) => number): void {
  mockFetch.mockImplementation((_url: string, init: { body: string }) => {
    const id = (JSON.parse(init.body) as { photos: Array<{ id: string }> }).photos[0]!.id;
    return new Promise(resolve => setTimeout(() => resolve(okResponse(id)), delayMs(id)));
  });
}

function makeSut(): GeminiPhotoClassifier {
  return new GeminiPhotoClassifier(
    'https://fn.test/classify', 'anon-key', undefined, undefined, reportedQuota,
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  reportedQuota.mockClear();
});

/** Every request answers 429, as the Edge Function does once the day's budget is spent. */
function respondQuotaExhausted(): void {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 429,
    text: () => Promise.resolve('Daily classification quota exceeded'),
    json: () =>
      Promise.resolve({ error: 'Daily classification quota exceeded', reason: 'daily_quota' }),
  });
}

/**
 * Every request answers 429 with the provider's per-minute reason — the wall
 * that clears in seconds, not the one that lasts until tomorrow (issue #141).
 */
function respondRateLimited(retryAfterSeconds = 0): void {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 429,
    text: () => Promise.resolve('Classification rate limited'),
    json: () =>
      Promise.resolve({
        error: 'Classification rate limited',
        reason: 'rate_limited',
        retry_after_seconds: retryAfterSeconds,
      }),
  });
}

describe('GeminiPhotoClassifier.classify — settles', () => {
  it('resolves with all results for a batch larger than the concurrency window', async () => {
    respondWithDelay(() => 1);
    const candidates = Array.from({ length: 15 }, (_, i) => candidate(`p${i}`));
    const results = await makeSut().classify(candidates);
    expect(results).toHaveLength(15);
  });

  it('resolves when responses finish out of order (fast and slow mixed)', async () => {
    respondWithDelay(id => (Number(id.slice(1)) % 2 === 0 ? 1 : 25));
    const candidates = Array.from({ length: 8 }, (_, i) => candidate(`p${i}`));
    const results = await makeSut().classify(candidates);
    expect(results).toHaveLength(8);
  });

  it('rejects rather than resolving empty when every request fails', async () => {
    // The old contract resolved with []. That is what let a dead classifier
    // reach the publisher as "no photos worth posting" — a claim about their
    // library that nothing had established.
    mockFetch.mockRejectedValue(new Error('network down'));
    const candidates = Array.from({ length: 5 }, (_, i) => candidate(`p${i}`));
    await expect(makeSut().classify(candidates)).rejects.toThrow(ClassificationFailedError);
  });

  it('rejects on the first failure rather than returning a partial batch', async () => {
    // A half-graded window presented as a finished post is indistinguishable
    // from a real one, so the run aborts instead of quietly shrinking.
    mockFetch.mockImplementation((_url: string, init: { body: string }) => {
      const id = (JSON.parse(init.body) as { photos: Array<{ id: string }> }).photos[0]!.id;
      if (id === 'p1' || id === 'p3') return Promise.reject(new Error('boom'));
      return Promise.resolve(okResponse(id));
    });
    await expect(
      makeSut().classify([candidate('p0'), candidate('p1'), candidate('p2'), candidate('p3')]),
    ).rejects.toThrow(ClassificationFailedError);
  });

  it('reports the results it did obtain before the failure, via onEach', async () => {
    // The grades bought before the abort are real; the use case persists them
    // from `onEach` so a retry does not pay for them twice.
    mockFetch.mockImplementation((_url: string, init: { body: string }) => {
      const id = (JSON.parse(init.body) as { photos: Array<{ id: string }> }).photos[0]!.id;
      if (id === 'p3') return Promise.reject(new Error('boom'));
      return Promise.resolve(okResponse(id));
    });
    const seen: string[] = [];
    await expect(
      makeSut().classify(
        [candidate('p0'), candidate('p1'), candidate('p2'), candidate('p3')],
        r => { seen.push(r.candidate.id); },
      ),
    ).rejects.toThrow(ClassificationFailedError);
    expect(seen).toContain('p0');
  });

  it('skips an unreadable photo without failing the run', async () => {
    // A photo whose bytes never arrive (iCloud original still in the cloud) is
    // a property of that one photo — it costs a suggestion, not the scan.
    mockFetch.mockImplementation((_url: string, init: { body: string }) => {
      const id = (JSON.parse(init.body) as { photos: Array<{ id: string }> }).photos[0]!.id;
      return Promise.resolve(okResponse(id));
    });
    const classifier = new GeminiPhotoClassifier(
      'https://fn.test/classify',
      'anon-key',
      c => Promise.resolve(c.id === 'p1' ? null : { id: c.id, url: c.uri }),
    );
    const results = await classifier.classify([candidate('p0'), candidate('p1'), candidate('p2')]);
    expect(results.map(r => r.candidate.id).sort()).toEqual(['p0', 'p2']);
  });

  it('stops early when shouldStop returns true, resolving with the partial batch', async () => {
    respondWithDelay(() => 1);
    const candidates = Array.from({ length: 30 }, (_, i) => candidate(`p${i}`));
    let seen = 0;
    const results = await makeSut().classify(
      candidates,
      () => { seen++; },
      () => seen >= 5,
    );
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.length).toBeLessThan(30);
  });

  it('reports progress via onEach with a running index and the batch total', async () => {
    respondWithDelay(() => 1);
    const calls: Array<[number, number]> = [];
    await makeSut().classify(
      [candidate('p0'), candidate('p1'), candidate('p2')],
      (_result, index, total) => calls.push([index, total]),
    );
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('resolves immediately for an empty batch', async () => {
    const results = await makeSut().classify([]);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('GeminiPhotoClassifier — daily quota (issue #81)', () => {
  it('flags exhaustion so a backfill can stop instead of scanning on', async () => {
    respondQuotaExhausted();
    const sut = makeSut();

    const results = await sut.classify([candidate('p1'), candidate('p2')]);

    // Nothing throws — the run just comes back empty, which is exactly why the
    // caller needs an explicit signal to tell "out of budget" from "no photos".
    expect(results).toEqual([]);
    expect(sut.quotaExhausted()).toBe(true);
  });

  it('reports the quota wall to monitoring once per run, not once per photo', async () => {
    respondQuotaExhausted();

    await makeSut().classify(Array.from({ length: 6 }, (_, i) => candidate(`p${i}`)));

    // Once for the whole run, with the run's size — not once per rejected photo.
    expect(reportedQuota).toHaveBeenCalledTimes(1);
    expect(reportedQuota).toHaveBeenCalledWith(6);
  });

  it('clears the flag on the next run, so tomorrow’s scan is not poisoned', async () => {
    respondQuotaExhausted();
    const sut = makeSut();
    await sut.classify([candidate('p1')]);
    expect(sut.quotaExhausted()).toBe(true);

    respondWithDelay(() => 1);
    await sut.classify([candidate('p2')]);

    expect(sut.quotaExhausted()).toBe(false);
  });

  it('does not treat the provider’s per-minute limit as the daily quota', async () => {
    // The bug in issue #141: staging logs showed Gemini answering 429
    // ("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", limit 5) four
    // seconds into a scan, with the next request succeeding — and the app
    // telling the publisher their daily AI limit was gone, on the first try of
    // the day. A throttle must never set the flag that means "come back
    // tomorrow", and must never be filed as a spent budget.
    respondRateLimited();
    const sut = makeSut();

    const results = await sut.classify([candidate('p1'), candidate('p2')]);

    expect(results).toEqual([]);
    expect(sut.quotaExhausted()).toBe(false);
    expect(sut.rateLimited()).toBe(true);
    expect(reportedQuota).not.toHaveBeenCalled();
  });

  it('waits out a throttle and finishes the run rather than abandoning it', async () => {
    // The common case by far: one burst trips the per-minute ceiling, the
    // window reopens, and the scan completes. Retrying the same photo is the
    // whole point — the old code returned null for it and stopped the run.
    let calls = 0;
    mockFetch.mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve('rate limited'),
          json: () => Promise.resolve({ reason: 'rate_limited', retry_after_seconds: 0 }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            classifications: [
              { id: 'p1', category: 'nature', confidence: 0.9, quality: 0.9, caption: 'c', scene: 's' },
            ],
          }),
      });
    });

    const sut = makeSut();
    const results = await sut.classify([candidate('p1')]);

    expect(results).toHaveLength(1);
    expect(sut.rateLimited()).toBe(false);
    expect(sut.quotaExhausted()).toBe(false);
  });

  it('clears the throttle flag on the next run', async () => {
    respondRateLimited();
    const sut = makeSut();
    await sut.classify([candidate('p1')]);
    expect(sut.rateLimited()).toBe(true);

    respondWithDelay(() => 1);
    await sut.classify([candidate('p2')]);

    expect(sut.rateLimited()).toBe(false);
  });

  it('treats a 429 with no reason as the daily quota, for older deployments', async () => {
    // A client ahead of the function must not sit in a retry loop against a
    // wall that genuinely lasts until tomorrow.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Daily classification quota exceeded'),
      json: () => Promise.resolve({ error: 'Daily classification quota exceeded' }),
    });
    const sut = makeSut();

    await sut.classify([candidate('p1')]);

    expect(sut.quotaExhausted()).toBe(true);
    expect(sut.rateLimited()).toBe(false);
  });

  it('does not report or flag the quota for an ordinary server failure', async () => {
    // A 500 is a broken classifier, not a spent budget: it must abort the run
    // loudly, and must not be filed as "you have used up today's AI".
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });
    const sut = makeSut();

    await expect(sut.classify([candidate('p1'), candidate('p2')])).rejects.toThrow(
      ClassificationFailedError,
    );

    expect(sut.quotaExhausted()).toBe(false);
    expect(reportedQuota).not.toHaveBeenCalled();
  });
});
