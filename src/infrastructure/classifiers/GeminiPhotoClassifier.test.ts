import { ClassificationFailedError, GeminiPhotoClassifier } from './GeminiPhotoClassifier';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import { CLASSIFY_TIMEOUT_MS } from '../http/appFetch';
import { RequestTimeoutError } from '../http/resilientFetch';
/** Stands in for the monitoring hook the composition root injects. */
const reportedQuota = jest.fn();
/** And for the one that reports a run cut short by a deadline (issue #174). */
const reportedTimeout = jest.fn();

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

/**
 * A grade for every photo the request asked about.
 *
 * The classifier batches photos into one request, so a fake that answers with a
 * single grade regardless of what was asked models a server that no longer
 * exists — and would let a real regression in the id-mapping pass unnoticed.
 */
function okResponse(ids: string[]): { ok: true; json: () => Promise<unknown> } {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        classifications: ids.map(id => ({
          id, category: 'food', confidence: 0.9, quality: 0.8, caption: '', scene: 's',
        })),
      }),
  };
}

/** Every photo id carried by a request body. */
function requestedIds(body: string): string[] {
  return (JSON.parse(body) as { photos: Array<{ id: string }> }).photos.map(p => p.id);
}

/** Responds after `delayMs`, keyed on the first photo id in the request body. */
function respondWithDelay(delayMs: (id: string) => number): void {
  mockFetch.mockImplementation((_url: string, init: { body: string }) => {
    const ids = requestedIds(init.body);
    return new Promise(resolve => setTimeout(() => resolve(okResponse(ids)), delayMs(ids[0]!)));
  });
}

function makeSut(): GeminiPhotoClassifier {
  return new GeminiPhotoClassifier(
    'https://fn.test/classify', 'anon-key', undefined, undefined, reportedQuota, reportedTimeout,
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  reportedQuota.mockClear();
  reportedTimeout.mockClear();
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
      const ids = requestedIds(init.body);
      if (ids.includes('p1')) return Promise.reject(new Error('boom'));
      return Promise.resolve(okResponse(ids));
    });
    await expect(
      makeSut().classify([candidate('p0'), candidate('p1'), candidate('p2'), candidate('p3')]),
    ).rejects.toThrow(ClassificationFailedError);
  });

  it('reports the results it did obtain before the failure, via onEach', async () => {
    // The grades bought before the abort are real; the use case persists them
    // from `onEach` so a retry does not pay for them twice. Photos travel in
    // groups now, so the boundary this protects is a whole chunk: enough
    // candidates for two requests, with the second one failing.
    const many = Array.from({ length: 24 }, (_, i) => candidate(`p${i}`));
    mockFetch.mockImplementation((_url: string, init: { body: string }) => {
      const ids = requestedIds(init.body);
      if (ids.includes('p12')) return Promise.reject(new Error('boom'));
      return Promise.resolve(okResponse(ids));
    });
    const seen: string[] = [];
    await expect(
      makeSut().classify(many, r => { seen.push(r.candidate.id); }),
    ).rejects.toThrow(ClassificationFailedError);
    expect(seen).toContain('p0');
  });

  it('skips an unreadable photo without failing the run', async () => {
    // A photo whose bytes never arrive (iCloud original still in the cloud) is
    // a property of that one photo — it costs a suggestion, not the scan.
    mockFetch.mockImplementation((_url: string, init: { body: string }) =>
      Promise.resolve(okResponse(requestedIds(init.body))));
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

describe('GeminiPhotoClassifier — face reference (issue #137)', () => {
  /** Every request answers with the face fields set, as the function does with a reference. */
  function respondWithMatch(contains: boolean, confidence: number): void {
    mockFetch.mockImplementation((_url: string, init: { body: string }) => {
      const id = (JSON.parse(init.body) as { photos: Array<{ id: string }> }).photos[0]!.id;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            classifications: [
              {
                id,
                category: 'food',
                confidence: 0.9,
                quality: 0.8,
                caption: '',
                scene: 's',
                contains_reference_person: contains,
                reference_confidence: confidence,
              },
            ],
          }),
      });
    });
  }

  function sentBody(): Record<string, unknown> {
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    return JSON.parse(init.body) as Record<string, unknown>;
  }

  it('sends no reference when none is given, so the question is never asked', async () => {
    respondWithDelay(() => 0);

    await makeSut().classify([candidate('p1')]);

    expect(sentBody()).not.toHaveProperty('reference');
  });

  it('sends the profile photo as a URL, never as uploaded bytes', async () => {
    respondWithMatch(true, 0.92);

    await makeSut().classify([candidate('p1')], undefined, undefined, {
      url: 'https://cdn.test/avatar.jpg',
    });

    expect(sentBody().reference).toEqual({ url: 'https://cdn.test/avatar.jpg' });
  });

  it("carries the model's verdict onto the classification", async () => {
    respondWithMatch(true, 0.92);

    const [result] = await makeSut().classify([candidate('p1')], undefined, undefined, {
      url: 'https://cdn.test/avatar.jpg',
    });

    expect(result?.containsPublisher).toBe(true);
    expect(result?.publisherConfidence).toBe(0.92);
  });

  it('reads a response without the face fields as not containing the publisher', async () => {
    // An older deployment of classify-photos, or any request that carried no
    // reference. Absent must not become a confident `true`.
    respondWithDelay(() => 0);

    const [result] = await makeSut().classify([candidate('p1')]);

    expect(result?.containsPublisher).toBe(false);
    expect(result?.publisherConfidence).toBe(0);
  });
});

describe('GeminiPhotoClassifier — session token', () => {
  const withToken = (token: () => Promise<string | null>): GeminiPhotoClassifier =>
    new GeminiPhotoClassifier(
      'https://fn.test/classify', 'anon-key', undefined, token, reportedQuota,
    );

  it('never sends the anon key in place of a missing session token', async () => {
    // classify-photos rejects the anon key outright, so substituting it is a
    // guaranteed 401 — and 401 is fatal, so it took the whole scan with it.
    let token: string | null = null;
    const seen: string[] = [];
    mockFetch.mockImplementation((_url: string, init: { body: string; headers: Record<string, string> }) => {
      seen.push(String(init.headers.Authorization));
      return Promise.resolve(okResponse(requestedIds(init.body)));
    });

    const classifier = withToken(() => Promise.resolve(token));
    const run = classifier.classify([candidate('p0')]);
    // The refresh lands while the first attempt is waiting it out.
    token = 'fresh-jwt';
    await run;

    expect(seen).not.toContain('Bearer anon-key');
    expect(seen).toContain('Bearer fresh-jwt');
  });

  it('re-reads the session for every attempt, so a long scan survives expiry', async () => {
    // A scan runs for minutes and the access token does not. A bearer captured
    // once before the retry loop is stale by the time a retry uses it.
    const tokens = ['expired-jwt', 'refreshed-jwt'];
    let next = 0;
    const seen: string[] = [];
    mockFetch.mockImplementation((_url: string, init: { body: string; headers: Record<string, string> }) => {
      seen.push(String(init.headers.Authorization));
      if (String(init.headers.Authorization) === 'Bearer expired-jwt') {
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('unauthorized') });
      }
      return Promise.resolve(okResponse(requestedIds(init.body)));
    });

    const classifier = withToken(() => Promise.resolve(tokens[Math.min(next++, 1)]!));
    const results = await classifier.classify([candidate('p0')]);

    expect(seen).toEqual(['Bearer expired-jwt', 'Bearer refreshed-jwt']);
    expect(results).toHaveLength(1);
  });

  it('gives up with a clear error when the session never arrives', async () => {
    // Bounded, so a genuinely signed-out user surfaces instead of looping.
    mockFetch.mockImplementation((_url: string, init: { body: string }) =>
      Promise.resolve(okResponse(requestedIds(init.body))));
    await expect(withToken(() => Promise.resolve(null)).classify([candidate('p0')]))
      .rejects.toThrow(/not signed in/);
  });

  it('still uses the anon key when no session provider was configured at all', async () => {
    // A caller with no session concept is a different case from a signed-in
    // user mid-refresh, and must keep working as it did.
    const seen: string[] = [];
    mockFetch.mockImplementation((_url: string, init: { body: string; headers: Record<string, string> }) => {
      seen.push(String(init.headers.Authorization));
      return Promise.resolve(okResponse(requestedIds(init.body)));
    });
    await makeSut().classify([candidate('p0')]);
    expect(seen).toEqual(['Bearer anon-key']);
  });
});

describe('GeminiPhotoClassifier — the request ran out of time (issue #174)', () => {
  /** Every request outlives its deadline, as a weak uplink makes it do. */
  function respondTimedOut(): void {
    mockFetch.mockImplementation((url: string) =>
      Promise.reject(new RequestTimeoutError(url, CLASSIFY_TIMEOUT_MS)),
    );
  }

  it('stops the run and keeps what it graded, rather than throwing the scan away', async () => {
    // A deadline that passed is the publisher's connection, not a broken
    // classifier: it says nothing about the photos and nothing about the AI, so
    // it must not abort the scan with an error the way a 500 does.
    const many = Array.from({ length: 24 }, (_, i) => candidate(`p${i}`));
    // The chunk that answers gets in first, as it does in life: a deadline is
    // 150 seconds and a healthy round trip is a couple.
    mockFetch.mockImplementation((url: string, init: { body: string }) => {
      const ids = requestedIds(init.body);
      if (ids.includes('p12')) {
        return new Promise((_, reject) =>
          setTimeout(() => reject(new RequestTimeoutError(url, CLASSIFY_TIMEOUT_MS)), 25),
        );
      }
      return new Promise(resolve => setTimeout(() => resolve(okResponse(ids)), 1));
    });
    const sut = makeSut();

    const results = await sut.classify(many);

    expect(results).toHaveLength(12);
    expect(sut.timedOut()).toBe(true);
  });

  it('does not re-send a chunk that timed out — the budget is charged before the grading', async () => {
    // The function counts the photos against the day's quota on the way in, so
    // a chunk sent twice is paid for twice while the publisher gets one answer
    // at most. One request per chunk, then stop.
    respondTimedOut();
    const sut = makeSut();

    await sut.classify([candidate('p1')]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('is not filed as a spent budget or a throttle', async () => {
    // Three different walls with three different remedies. A timeout says
    // "your connection", not "come back tomorrow" and not "the AI is busy".
    respondTimedOut();
    const sut = makeSut();

    await sut.classify([candidate('p1')]);

    expect(sut.quotaExhausted()).toBe(false);
    expect(sut.rateLimited()).toBe(false);
    expect(reportedQuota).not.toHaveBeenCalled();
  });

  it('stops feeding the queue once a request has timed out', async () => {
    // Every remaining chunk would be sent over the same connection and hit the
    // same wall, so the run stops rather than spending a deadline on each.
    respondTimedOut();
    const many = Array.from({ length: 96 }, (_, i) => candidate(`p${i}`));

    await makeSut().classify(many);

    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('reports the stall once per run, so its frequency stays visible in the field', async () => {
    // The whole reason issue #174 was ever noticed is that a timeout arrived in
    // Sentry. Handling it must not make it invisible — but it is expected and
    // handled now, so it goes as a warning rather than as a crash, and once
    // rather than once per chunk in flight.
    respondTimedOut();
    const many = Array.from({ length: 36 }, (_, i) => candidate(`p${i}`));

    await makeSut().classify(many);

    expect(reportedTimeout).toHaveBeenCalledTimes(1);
    expect(reportedTimeout).toHaveBeenCalledWith(36);
  });

  it('clears the flag on the next run', async () => {
    respondTimedOut();
    const sut = makeSut();
    await sut.classify([candidate('p1')]);
    expect(sut.timedOut()).toBe(true);

    respondWithDelay(() => 1);
    await sut.classify([candidate('p2')]);

    expect(sut.timedOut()).toBe(false);
  });

  it('still fails loudly for a network error that never reached the server', async () => {
    // A dropped connection is the case the retry exists for, and a run that
    // learned nothing at all must not be reported as a finished scan.
    mockFetch.mockRejectedValue(new Error('Network request failed'));
    const sut = makeSut();

    await expect(sut.classify([candidate('p1')])).rejects.toThrow(ClassificationFailedError);
    expect(sut.timedOut()).toBe(false);
  });
});

/**
 * Issue #189: the model itself was momentarily overloaded (Gemini 503), which
 * the function reported as a plain failure and the app turned into a
 * ClassificationFailedError — ending a scan over a condition that clears by
 * itself in seconds. It belongs with the throttle: wait, retry, and if it is
 * still busy, stop softly and keep the grades already in hand.
 */
describe('GeminiPhotoClassifier.classify — the model is busy', () => {
  /** The function's answer when every provider was momentarily unavailable. */
  function busyResponse(retryAfterSeconds = 0): unknown {
    return {
      ok: false,
      status: 503,
      text: () => Promise.resolve('Classification provider unavailable'),
      json: () =>
        Promise.resolve({
          error: 'Classification provider unavailable',
          reason: 'upstream_busy',
          retry_after_seconds: retryAfterSeconds,
        }),
    };
  }

  it('waits out an overloaded model and finishes the run', async () => {
    let calls = 0;
    mockFetch.mockImplementation((_url: string, init: { body: string }) => {
      calls++;
      if (calls === 1) return Promise.resolve(busyResponse());
      return Promise.resolve(okResponse(requestedIds(init.body)));
    });

    const sut = makeSut();
    const results = await sut.classify([candidate('p1')]);

    expect(results).toHaveLength(1);
    expect(sut.rateLimited()).toBe(false);
    expect(sut.quotaExhausted()).toBe(false);
  });

  it('stops softly as busy — never as a failure — when it stays overloaded', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(busyResponse()));
    const sut = makeSut();

    const results = await sut.classify([candidate('p1'), candidate('p2')]);

    expect(results).toEqual([]);
    expect(sut.rateLimited()).toBe(true);
    expect(sut.quotaExhausted()).toBe(false);
    expect(reportedQuota).not.toHaveBeenCalled();
  });

  it('treats a 503 with no reason as busy too, for older deployments', async () => {
    // 503 means "unavailable" whoever sent it; guessing "broken" instead ends
    // the scan, which is the exact damage of issue #189. A body with no delay
    // in it falls back to a few seconds' wait, so time is driven by hand here
    // rather than actually slept through.
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Usage unavailable'),
        json: () => Promise.resolve({ error: 'Usage unavailable' }),
      }),
    );
    jest.useFakeTimers();
    const sut = makeSut();

    const run = sut.classify([candidate('p1')]);
    await jest.runAllTimersAsync();
    const results = await run;
    jest.useRealTimers();

    expect(results).toEqual([]);
    expect(sut.rateLimited()).toBe(true);
  });

  it('still fails hard on a broken request, which no wait will fix', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve('too many photos'),
        json: () => Promise.resolve({ error: 'too many photos' }),
      }),
    );

    await expect(makeSut().classify([candidate('p1')])).rejects.toThrow(ClassificationFailedError);
  });
});
