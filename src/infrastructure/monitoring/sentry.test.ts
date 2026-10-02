import * as Sentry from '@sentry/react-native';
import { downgradeNetworkNoise, initErrorMonitoring, monitored, reportError } from './sentry';
import type * as SentryModule from './sentry';

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

  // .env.example calls EXPO_PUBLIC_SENTRY_DSN optional and tells a new
  // contributor to leave it unset (issue #110). That promise is only true if an
  // absent DSN disables monitoring on its own, in a build that would otherwise
  // report — the case above passes for the variant's sake alone.
  it('stays disabled with no DSN even in a build that would otherwise report', () => {
    jest.isolateModules(() => {
      const previous = process.env.EXPO_PUBLIC_APP_VARIANT as string | undefined;
      process.env.EXPO_PUBLIC_APP_VARIANT = 'production';
      delete process.env.EXPO_PUBLIC_SENTRY_DSN;
      try {
        // Re-required so the module re-reads the env at its top level.
        const fresh = jest.requireActual<typeof SentryModule>('./sentry');
        fresh.initErrorMonitoring();
        // Matched exactly, so this also proves there is no `dsn` key at all for
        // Sentry to pick up.
        expect(init).toHaveBeenCalledWith({
          enabled: false,
          environment: 'production',
          tracesSampleRate: 0,
          sendDefaultPii: false,
          beforeSend: fresh.downgradeNetworkNoise,
        });
      } finally {
        if (previous == null) delete process.env.EXPO_PUBLIC_APP_VARIANT;
        else process.env.EXPO_PUBLIC_APP_VARIANT = previous;
      }
    });
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

describe('downgradeNetworkNoise', () => {
  const eventWith = (value: string, type = 'TypeError'): Sentry.ErrorEvent =>
    ({ level: 'error', exception: { values: [{ type, value }] } }) as Sentry.ErrorEvent;

  it('downgrades a failed fetch to a warning so it stops filing bug issues', () => {
    const out = downgradeNetworkNoise(eventWith('Network request failed'));
    expect(out.level).toBe('warning');
  });

  it('also downgrades our own request timeout', () => {
    const out = downgradeNetworkNoise(eventWith('Request timed out after 15000ms: x', 'RequestTimeoutError'));
    expect(out.level).toBe('warning');
  });

  it('matches the wrapped form the repositories report', () => {
    const out = downgradeNetworkNoise(eventWith('TypeError: Network request failed', 'Error'));
    expect(out.level).toBe('warning');
  });

  it('leaves real errors at error level', () => {
    const out = downgradeNetworkNoise(eventWith('Cannot read property x of undefined'));
    expect(out.level).toBe('error');
  });

  it('never drops the event', () => {
    expect(downgradeNetworkNoise({ level: 'error' } as Sentry.ErrorEvent)).not.toBeNull();
  });
});
