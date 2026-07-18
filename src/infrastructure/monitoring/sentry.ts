import * as Sentry from '@sentry/react-native';

// Static references only — Expo inlines EXPO_PUBLIC_* at bundle time and a
// dynamic `process.env[key]` lookup would be undefined at runtime (see
// composition/container.ts).
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN as string | undefined;
const variant = process.env.EXPO_PUBLIC_APP_VARIANT as string | undefined;

/**
 * Monitoring is on only in EAS-built binaries: the preview/production profiles
 * set EXPO_PUBLIC_APP_VARIANT (staging/production); local dev and test builds
 * never set it, so they never report. An empty/missing DSN also disables it,
 * which keeps a fresh checkout safe by default.
 */
export const monitoringEnabled =
  Boolean(dsn) && !__DEV__ && (variant === 'staging' || variant === 'production');

/** Must run before the root component mounts (called at the top of App.js). */
export function initErrorMonitoring(): void {
  Sentry.init({
    ...(dsn != null ? { dsn } : {}),
    enabled: monitoringEnabled,
    environment: variant ?? 'development',
    // Errors and crashes only — no performance tracing, no PII.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

/** Wraps the root component so React render errors are captured too. */
export const withErrorMonitoring = Sentry.wrap;

/** Report a caught error, tagged with the operation that failed. */
export function reportError(error: unknown, operation: string): void {
  Sentry.captureException(error, { tags: { operation } });
}

function callReporting<R>(operation: string, fn: (...a: never[]) => R, thisArg: unknown, args: unknown[]): R {
  try {
    const result = Reflect.apply(fn, thisArg, args) as R;
    if (result instanceof Promise) {
      return result.catch((err: unknown) => {
        reportError(err, operation);
        throw err;
      }) as R;
    }
    return result;
  } catch (err) {
    reportError(err, operation);
    throw err;
  }
}

/**
 * Decorates a use case (or a plain function) so any error it throws or rejects
 * with is reported to Sentry tagged `operation: <name>`, then rethrown
 * unchanged — callers keep their existing error handling; monitoring is purely
 * additive. Reporting is a no-op while monitoring is disabled (local dev).
 */
export function monitored<T extends object>(operation: string, target: T): T {
  return new Proxy(target, {
    // Plain functions: monitored('op', fn) — intercept the call itself.
    apply(fn, thisArg, args) {
      return callReporting(operation, fn as unknown as (...a: never[]) => unknown, thisArg, args);
    },
    // Objects: intercept method calls, pass everything else through.
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => callReporting(operation, value as (...a: never[]) => unknown, obj, args);
    },
  });
}
