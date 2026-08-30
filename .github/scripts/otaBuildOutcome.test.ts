/**
 * The rebuild check's outcome classification, which twice sent a real failure to
 * the wrong explanation.
 *
 * Run 33292706997 reported "🚫 The rebuild could not be started — run it
 * yourself" for build 4b5a01af, which had uploaded, queued, compiled for 4.6
 * minutes and then died inside EAS with `SERVER_ERROR: Failed to upload
 * application archive` — an Expo-side storage fault with no build logs and
 * nothing to do with the commit. Following that advice reproduces nothing.
 *
 * Two causes, both covered here: `eas build --json` waits for completion and
 * exits non-zero when the build FAILS, which is indistinguishable from never
 * having started one, and an EAS infrastructure fault was treated as the
 * author's problem. The script keeps the I/O; the decisions live here so they
 * can be exercised without spending a build.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const outcome = require('./otaBuildOutcome.js') as {
  PENDING: Set<string>;
  TERMINAL: Set<string>;
  isInfrastructureFailure: (build: unknown) => boolean;
};

const { PENDING, TERMINAL, isInfrastructureFailure } = outcome;

describe('build status sets', () => {
  it('treats states EAS can still resolve as pending', () => {
    for (const s of ['NEW', 'IN_QUEUE', 'IN_PROGRESS']) expect(PENDING.has(s)).toBe(true);
    for (const s of ['FINISHED', 'ERRORED', 'CANCELED']) expect(PENDING.has(s)).toBe(false);
  });

  it('treats every state EAS is finished with as terminal, whatever the outcome', () => {
    for (const s of ['FINISHED', 'ERRORED', 'CANCELED']) expect(TERMINAL.has(s)).toBe(true);
    for (const s of ['NEW', 'IN_QUEUE', 'IN_PROGRESS']) expect(TERMINAL.has(s)).toBe(false);
  });
});

describe('isInfrastructureFailure', () => {
  it('recognises the EAS-side fault that failed build 4b5a01af', () => {
    // Verbatim from `eas build:view 4b5a01af-7059-4308-a056-5407239ee780 --json`.
    expect(
      isInfrastructureFailure({
        status: 'ERRORED',
        error: { errorCode: 'SERVER_ERROR', message: 'Failed to upload application archive.' },
        logsUrl: null,
      }),
    ).toBe(true);
  });

  it('does not excuse a build that genuinely failed to compile', () => {
    // The distinction that matters: this one IS the author's problem, and
    // retrying it just spends a second build to fail the same way.
    expect(
      isInfrastructureFailure({
        status: 'ERRORED',
        error: { errorCode: 'XCODE_BUILD_FAILED', message: 'Xcode build failed' },
        logsUrl: 'https://expo.dev/...',
      }),
    ).toBe(false);
  });

  it('does not retry a build that succeeded or that a human cancelled', () => {
    expect(isInfrastructureFailure({ status: 'FINISHED' })).toBe(false);
    expect(isInfrastructureFailure({ status: 'CANCELED' })).toBe(false);
  });

  it('survives a payload with no error detail rather than throwing', () => {
    // eas-cli has renamed build payload fields twice already; a missing shape
    // must read as "not retryable", never crash the job at its last step.
    expect(isInfrastructureFailure({ status: 'ERRORED' })).toBe(false);
    expect(isInfrastructureFailure({ status: 'ERRORED', error: null })).toBe(false);
    expect(isInfrastructureFailure(undefined)).toBe(false);
  });
});
