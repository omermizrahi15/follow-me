import { CLASSIFY_FETCH_OPTIONS, CLASSIFY_TIMEOUT_MS, UPLOAD_FETCH_OPTIONS } from './appFetch';
import { RequestTimeoutError, resilientFetch, UPLOAD_TIMEOUT_MS } from './resilientFetch';

/** The real uploadFetch, minus the two things a test cannot wait for. */
function makeUploadFetch(fetchImpl: jest.Mock, waits: number[]): typeof fetch {
  return resilientFetch({
    ...UPLOAD_FETCH_OPTIONS,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms: number) => { waits.push(ms); return Promise.resolve(); },
  });
}

const gatewayError = { ok: false, status: 502 } as Response;
const ok = { ok: true, status: 200 } as Response;

describe('uploadFetch — Cloudinary gateway failures (issue #177)', () => {
  it('rides out two 502s in a row', async () => {
    const waits: number[] = [];
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(gatewayError)
      .mockResolvedValueOnce(gatewayError)
      .mockResolvedValueOnce(ok);

    const response = await makeUploadFetch(fetchImpl, waits)('https://api.cloudinary.com/upload', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('waits longer before each retry, so a struggling gateway gets room', async () => {
    const waits: number[] = [];
    const fetchImpl = jest.fn().mockResolvedValue(gatewayError);

    await makeUploadFetch(fetchImpl, waits)('https://api.cloudinary.com/upload', { method: 'POST' });

    expect(waits).toEqual([2_000, 8_000]);
  });

  it('gives up after the retries rather than looping', async () => {
    const waits: number[] = [];
    const fetchImpl = jest.fn().mockResolvedValue(gatewayError);

    const response = await makeUploadFetch(fetchImpl, waits)('https://api.cloudinary.com/upload', { method: 'POST' });

    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps the long upload deadline', () => {
    expect(UPLOAD_FETCH_OPTIONS.timeoutMs).toBe(UPLOAD_TIMEOUT_MS);
  });
});

/** The real classifyFetch, minus the clock a test cannot wait out. */
function makeClassifyFetch(fetchImpl: jest.Mock): typeof fetch {
  return resilientFetch({
    ...CLASSIFY_FETCH_OPTIONS,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    // Fires the deadline the moment it is armed, so the test exercises the
    // timeout path without spending the real one.
    schedule: (run: () => void) => { run(); return 0; },
    cancel: () => undefined,
  });
}

describe('classifyFetch — a request that carries a dozen photos (issue #174)', () => {
  it('gives the Edge Function the whole of its own wall clock', () => {
    // The function is allowed 150s to answer; giving up at 60 abandoned work
    // that was still running — and already charged to the day's budget.
    expect(CLASSIFY_FETCH_OPTIONS.timeoutMs).toBe(CLASSIFY_TIMEOUT_MS);
    expect(CLASSIFY_TIMEOUT_MS).toBeGreaterThanOrEqual(150_000);
  });

  it('abandons the request once the deadline passes, as a timeout and not a refusal', async () => {
    const fetchImpl = jest.fn().mockReturnValue(new Promise(() => undefined));

    await expect(
      makeClassifyFetch(fetchImpl)('https://fn.test/classify-photos', { method: 'POST' }),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it('never re-sends the request, because the function charges the budget before it grades', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(
      resilientFetch({ ...CLASSIFY_FETCH_OPTIONS, fetchImpl: fetchImpl as unknown as typeof fetch })(
        'https://fn.test/classify-photos',
        { method: 'POST' },
      ),
    ).rejects.toThrow('network down');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
