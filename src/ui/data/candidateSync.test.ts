// In-memory AsyncStorage — the real one needs a React Native host. Declared
// with a `mock` prefix so jest allows it inside the hoisted factory.
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => { mockStore.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { mockStore.delete(k); return Promise.resolve(); }),
  },
}));

/** The gate the upload re-checks between batches, so a mid-run wipe stops it. */
type ShouldAbort = () => Promise<boolean>;
/** `(uploaded, total)` — uploaded 0 means the run is starting. */
type OnProgress = (uploaded: number, total: number) => void;

// The container's collaborators, held as plain typed mocks rather than reached
// for through `loadConfig.execute` — a reference to an unbound class method,
// which the linter rejects. `mock` prefix so jest allows them in a hoisted
// factory.
const mockUpload = jest.fn<Promise<void>, [string, number, ShouldAbort, OnProgress]>();
const mockLoadConfig = jest.fn<Promise<{ lookbackDays: number }>, [string]>();
const mockPrune = jest.fn<Promise<void>, [number]>();
const mockRecordState = jest.fn<Promise<void>, [string, string]>();
const mockReportError = jest.fn<void, [unknown, string]>();
const mockConsentEnabled = jest.fn<Promise<boolean>, []>();

jest.mock('../../composition/container', () => ({
  loadConfig: { execute: mockLoadConfig },
  syncCandidatePhotos: { execute: mockUpload },
  pruneUploadedPhotos: mockPrune,
  recordSyncState: mockRecordState,
  reportError: mockReportError,
}));

jest.mock('./photoSyncConsent', () => ({ isPhotoSyncEnabled: mockConsentEnabled }));

import { runCandidateSync, runCandidateSyncQuietly } from './candidateSync';
import { getSyncStatus, resetSyncStatusForTest } from './syncStatus';

const PUBLISHER = 'pub-1';
const NOW = 1_800_000_000_000;

const consentEnabled = mockConsentEnabled;
const upload = mockUpload;
const config = mockLoadConfig;
const prune = mockPrune;
const recordState = mockRecordState;
const report = mockReportError;

/** The upload's arguments from the run just made — narrowed for the assertions below. */
function uploadArgs(): { shouldAbort: ShouldAbort; onProgress: OnProgress } {
  const call = upload.mock.calls[0];
  if (call === undefined) throw new Error('the upload was never called');
  return { shouldAbort: call[2], onProgress: call[3] };
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  resetSyncStatusForTest();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  consentEnabled.mockResolvedValue(true);
  config.mockResolvedValue({ lookbackDays: 30 });
  upload.mockResolvedValue(undefined);
  prune.mockResolvedValue(undefined);
  recordState.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('runCandidateSync, with photo upload switched off', () => {
  beforeEach(() => consentEnabled.mockResolvedValue(false));

  it('uploads nothing', async () => {
    await runCandidateSync(PUBLISHER);
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports the outcome to its caller', async () => {
    expect(await runCandidateSync(PUBLISHER)).toBe('no-consent');
  });

  // The server stops holding a posting slot open for photos that cannot arrive,
  // and stops telling the publisher to open an app that is already open.
  it('tells the server why, rather than looking like a phone that never checked in', async () => {
    await runCandidateSync(PUBLISHER);
    expect(recordState).toHaveBeenCalledWith(PUBLISHER, 'no-consent');
  });

  it('shows it in the UI, so it is visible and reversible', async () => {
    await runCandidateSync(PUBLISHER);
    expect(getSyncStatus().phase).toBe('no-consent');
  });
});

describe('runCandidateSync, on a successful run', () => {
  it('uploads over the configured window', async () => {
    await runCandidateSync(PUBLISHER);
    expect(upload).toHaveBeenCalledWith(PUBLISHER, 30, expect.any(Function), expect.any(Function));
  });

  it('skips the config reload when the caller already has the window', async () => {
    await runCandidateSync(PUBLISHER, 7);

    expect(config).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(PUBLISHER, 7, expect.any(Function), expect.any(Function));
  });

  it('leaves the heartbeat the server reads to tell "nothing new" from "not checking in"', async () => {
    await runCandidateSync(PUBLISHER);
    expect(recordState).toHaveBeenCalledWith(PUBLISHER, 'active');
  });

  it('stamps the sync as finished', async () => {
    await runCandidateSync(PUBLISHER);

    expect(getSyncStatus()).toMatchObject({ phase: 'idle', lastSyncedAt: NOW, error: null });
  });

  it('still counts a zero-upload run as synced', async () => {
    expect(await runCandidateSync(PUBLISHER)).toBe('synced');
  });

  // A wipe partway through a long run must not be undone by batches still in
  // flight, so the gate is a live re-check rather than the value read at entry.
  it('gives the upload a live consent check to abort on mid-run', async () => {
    await runCandidateSync(PUBLISHER);
    const { shouldAbort } = uploadArgs();

    consentEnabled.mockResolvedValue(false);

    expect(await shouldAbort()).toBe(true);
  });

  it('reports progress as started, then advancing', async () => {
    await runCandidateSync(PUBLISHER);
    const { onProgress } = uploadArgs();

    onProgress(0, 12);
    expect(getSyncStatus()).toMatchObject({ phase: 'syncing', total: 12, uploaded: 0 });

    onProgress(5, 12);
    expect(getSyncStatus()).toMatchObject({ uploaded: 5, total: 12 });
  });

  it('survives a failed heartbeat, which is telemetry and not the point of the sync', async () => {
    recordState.mockRejectedValue(new Error('offline'));

    expect(await runCandidateSync(PUBLISHER)).toBe('synced');
    expect(report).toHaveBeenCalledWith(expect.any(Error), 'record_sync_state');
  });
});

describe('runCandidateSync, when the upload fails', () => {
  beforeEach(() => upload.mockRejectedValue(new Error('storage full')));

  // Issue #97: a sync that failed without a trace surfaced days later as an
  // empty push.
  it('throws rather than passing silently', async () => {
    await expect(runCandidateSync(PUBLISHER)).rejects.toThrow('storage full');
  });

  it('shows the reason to the only person who can act on it', async () => {
    await expect(runCandidateSync(PUBLISHER)).rejects.toThrow();

    expect(getSyncStatus()).toMatchObject({ phase: 'failed', error: 'storage full' });
  });

  // A missing heartbeat is precisely what "this phone is not syncing" means.
  it('leaves no heartbeat behind', async () => {
    await expect(runCandidateSync(PUBLISHER)).rejects.toThrow();
    expect(recordState).not.toHaveBeenCalled();
  });

  it('does not prune cloud copies on the way out', async () => {
    await expect(runCandidateSync(PUBLISHER)).rejects.toThrow();
    expect(prune).not.toHaveBeenCalled();
  });
});

describe('retention pruning', () => {
  it('keeps a grace week beyond the window, so a pending approval keeps its photos', async () => {
    await runCandidateSync(PUBLISHER, 30);
    expect(prune).toHaveBeenCalledWith(37);
  });

  it('runs at most once a day, not once per foreground', async () => {
    await runCandidateSync(PUBLISHER);
    expect(prune).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockReturnValue(NOW + 23 * 60 * 60 * 1000);
    await runCandidateSync(PUBLISHER);

    expect(prune).toHaveBeenCalledTimes(1);
  });

  it('runs again once a day has passed', async () => {
    await runCandidateSync(PUBLISHER);

    jest.spyOn(Date, 'now').mockReturnValue(NOW + 25 * 60 * 60 * 1000);
    await runCandidateSync(PUBLISHER);

    expect(prune).toHaveBeenCalledTimes(2);
  });

  // Stamped only after it worked, so a failing prune is retried on the next
  // sync rather than skipped for a day.
  it('retries on the next sync when it fails, instead of standing down for a day', async () => {
    prune.mockRejectedValueOnce(new Error('network'));
    await runCandidateSync(PUBLISHER);

    jest.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
    await runCandidateSync(PUBLISHER);

    expect(prune).toHaveBeenCalledTimes(2);
  });

  it('costs storage, never a post', async () => {
    prune.mockRejectedValue(new Error('network'));

    expect(await runCandidateSync(PUBLISHER)).toBe('synced');
    expect(report).toHaveBeenCalledWith(expect.any(Error), 'prune_candidate_photos');
  });
});

describe('overlapping triggers', () => {
  // Issue #77: two concurrent runs each see the same not-yet-uploaded set and
  // decode it twice — double the peak RAM, which is the watchdog kill.
  it('collapses a background task and a foreground into one upload', async () => {
    let release = (): void => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    upload.mockReturnValue(pending);

    const first = runCandidateSync(PUBLISHER);
    const second = runCandidateSync(PUBLISHER);
    release();
    await Promise.all([first, second]);

    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('lets the next caller start a fresh run after a failure, rather than re-serving the error', async () => {
    upload.mockRejectedValueOnce(new Error('offline'));
    await expect(runCandidateSync(PUBLISHER)).rejects.toThrow('offline');

    expect(await runCandidateSync(PUBLISHER)).toBe('synced');
  });
});

describe('runCandidateSyncQuietly', () => {
  it('never rejects into a caller that cannot act on the failure', async () => {
    upload.mockRejectedValue(new Error('storage full'));

    await expect(runCandidateSyncQuietly(PUBLISHER, 'background_task')).resolves.toBeUndefined();
  });

  it('is quiet, not silent — the failure lands tagged with its trigger', async () => {
    upload.mockRejectedValue(new Error('storage full'));

    await runCandidateSyncQuietly(PUBLISHER, 'background_task');

    expect(report).toHaveBeenCalledWith(expect.any(Error), 'background_task');
  });

  it('passes a window it already has straight through', async () => {
    await runCandidateSyncQuietly(PUBLISHER, 'save_settings', 14);

    expect(config).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith(PUBLISHER, 14, expect.any(Function), expect.any(Function));
  });
});
