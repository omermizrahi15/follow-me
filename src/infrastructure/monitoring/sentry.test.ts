import * as Sentry from '@sentry/react-native';
import { initErrorMonitoring, monitored, reportError } from './sentry';

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: jest.fn((component: unknown) => component),
  captureException: jest.fn(),
}));

const captureException = Sentry.captureException as jest.Mock;
const init = Sentry.init as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('initErrorMonitoring', () => {
  it('is disabled outside EAS builds (no EXPO_PUBLIC_APP_VARIANT set)', () => {
    initErrorMonitoring();
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('never sends PII or performance traces', () => {
    initErrorMonitoring();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ sendDefaultPii: false, tracesSampleRate: 0 }),
    );
  });
});

describe('reportError', () => {
  it('tags the exception with the failing operation', () => {
    const boom = new Error('supabase down');
    reportError(boom, 'share_photo');
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { operation: 'share_photo' } });
  });
});

describe('monitored', () => {
  class FakeUseCase {
    constructor(private readonly fail: boolean) {}
    run(value: string): Promise<string> {
      if (this.fail) return Promise.reject(new Error(`failed ${value}`));
      return Promise.resolve(`ok ${value}`);
    }
    syncThrow(): never {
      throw new Error('sync boom');
    }
    label = 'not-a-function';
  }

  it('passes through successful async results untouched', async () => {
    const useCase = monitored('share_photo', new FakeUseCase(false));
    await expect(useCase.run('a')).resolves.toBe('ok a');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports a rejected method tagged with the operation, then rethrows', async () => {
    const useCase = monitored('share_photo', new FakeUseCase(true));
    await expect(useCase.run('a')).rejects.toThrow('failed a');
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'failed a' }),
      { tags: { operation: 'share_photo' } },
    );
  });

  it('reports synchronous throws too', () => {
    const useCase = monitored('share_photo', new FakeUseCase(false));
    expect(() => useCase.syncThrow()).toThrow('sync boom');
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'sync boom' }),
      { tags: { operation: 'share_photo' } },
    );
  });

  it('leaves non-function properties readable', () => {
    const useCase = monitored('share_photo', new FakeUseCase(false));
    expect(useCase.label).toBe('not-a-function');
  });

  it('wraps plain async functions as well as objects', async () => {
    const wipe = monitored('delete_uploaded_photos', () =>
      Promise.reject(new Error('wipe failed')));
    await expect(wipe()).rejects.toThrow('wipe failed');
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'wipe failed' }),
      { tags: { operation: 'delete_uploaded_photos' } },
    );
  });
});
