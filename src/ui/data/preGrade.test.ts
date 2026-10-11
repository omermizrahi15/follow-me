const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
    setItem: jest.fn((k: string, v: string) => { mockStore.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k: string) => { mockStore.delete(k); return Promise.resolve(); }),
  },
}));

const mockPreGrade = jest.fn<Promise<'busy' | 'done' | 'walled'>, [unknown]>();
const mockLoadConfig = jest.fn<Promise<unknown>, [string]>();
const mockReportError = jest.fn<void, [unknown, string]>();
const mockConsent = jest.fn<Promise<boolean>, []>();

jest.mock('../../composition/container', () => ({
  preGradePhotos: { execute: mockPreGrade },
  loadConfig: { execute: mockLoadConfig },
  reportError: mockReportError,
}));
jest.mock('./photoSyncConsent', () => ({ isPhotoSyncEnabled: mockConsent }));

import { runPreGradeQuietly } from './preGrade';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
let now = NOW;

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  now = NOW;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockConsent.mockResolvedValue(true);
  mockLoadConfig.mockResolvedValue({ publisherId: 'pub-1' });
  mockPreGrade.mockResolvedValue('done');
});

describe('runPreGradeQuietly', () => {
  it('pre-grades with the publisher\'s config', async () => {
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).toHaveBeenCalledWith({ publisherId: 'pub-1' });
  });

  it('does nothing without photo consent', async () => {
    mockConsent.mockResolvedValue(false);
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).not.toHaveBeenCalled();
  });

  it('does not run again within the minimum interval', async () => {
    await runPreGradeQuietly('pub-1', 'op');
    now += 30 * 60 * 1000;
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).toHaveBeenCalledTimes(1);
  });

  it('runs again once the interval has passed', async () => {
    await runPreGradeQuietly('pub-1', 'op');
    now += 3 * HOUR;
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).toHaveBeenCalledTimes(2);
  });

  it('backs off for longer after hitting a quota or rate wall', async () => {
    mockPreGrade.mockResolvedValue('walled');
    await runPreGradeQuietly('pub-1', 'op');
    now += 3 * HOUR;
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).toHaveBeenCalledTimes(1);
    now += 4 * HOUR;
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).toHaveBeenCalledTimes(2);
  });

  it('does not spend the interval when a live scan held the classifier', async () => {
    mockPreGrade.mockResolvedValueOnce('busy');
    await runPreGradeQuietly('pub-1', 'op');
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).toHaveBeenCalledTimes(2);
  });

  it('never rejects, but reports the failure', async () => {
    mockPreGrade.mockRejectedValue(new Error('boom'));
    await expect(runPreGradeQuietly('pub-1', 'op')).resolves.toBeUndefined();
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), 'op');
  });

  it('retries sooner after a failure than after a success', async () => {
    mockPreGrade.mockRejectedValueOnce(new Error('boom'));
    await runPreGradeQuietly('pub-1', 'op');
    await runPreGradeQuietly('pub-1', 'op');
    expect(mockPreGrade).toHaveBeenCalledTimes(2);
  });
});
