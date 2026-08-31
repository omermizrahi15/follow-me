import { UPLOAD_FETCH_OPTIONS } from './appFetch';
import { resilientFetch, UPLOAD_TIMEOUT_MS } from './resilientFetch';

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
