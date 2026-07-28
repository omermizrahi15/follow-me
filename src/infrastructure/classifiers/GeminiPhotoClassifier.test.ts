import { GeminiPhotoClassifier } from './GeminiPhotoClassifier';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import { reportMessage } from '../monitoring/sentry';

jest.mock('../monitoring/sentry', () => ({ reportMessage: jest.fn() }));

const reportedMessage = reportMessage as jest.Mock;

/**
 * Concurrency/finish-condition tests: whatever mix of fast, slow, and failing
 * responses the network produces, classify() must always resolve — and stop
 * early when asked to.
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
  return new GeminiPhotoClassifier('https://fn.test/classify', 'anon-key');
}

beforeEach(() => {
  mockFetch.mockReset();
  reportedMessage.mockClear();
});

/** Every request answers 429, as the Edge Function does once the day's budget is spent. */
function respondQuotaExhausted(): void {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 429,
    text: () => Promise.resolve('Daily classification quota exceeded'),
  });
}

describe('GeminiPhotoClassifier.classify — always resolves', () => {
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

  it('resolves even when every request fails', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const candidates = Array.from({ length: 5 }, (_, i) => candidate(`p${i}`));
    const results = await makeSut().classify(candidates);
    expect(results).toHaveLength(0);
    consoleWarn.mockRestore();
  });

  it('resolves with partial results when some requests fail', async () => {
    mockFetch.mockImplementation((_url: string, init: { body: string }) => {
      const id = (JSON.parse(init.body) as { photos: Array<{ id: string }> }).photos[0]!.id;
      if (id === 'p1' || id === 'p3') return Promise.reject(new Error('boom'));
      return Promise.resolve(okResponse(id));
    });
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const results = await makeSut().classify([candidate('p0'), candidate('p1'), candidate('p2'), candidate('p3')]);
    expect(results.map(r => r.candidate.id).sort()).toEqual(['p0', 'p2']);
    consoleWarn.mockRestore();
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

    expect(reportedMessage).toHaveBeenCalledTimes(1);
    expect(reportedMessage).toHaveBeenCalledWith(
      expect.stringContaining('quota'),
      'classify_photos',
      expect.objectContaining({ photosInRun: 6 }),
    );
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

  it('does not report or flag for ordinary per-photo failures', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });
    const sut = makeSut();

    await sut.classify([candidate('p1'), candidate('p2')]);

    expect(sut.quotaExhausted()).toBe(false);
    expect(reportedMessage).not.toHaveBeenCalled();
  });
});
