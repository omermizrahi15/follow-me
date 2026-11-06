/**
 * The PR preview comment and the EAS profile behind it. The profile is the part
 * that can silently rot: if its env drifts from staging, the preview app talks
 * to the wrong backend and nobody notices until a PR "works" for the wrong reason.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const preview = require('./prPreview.js') as {
  MARKER: string;
  renderComment: (a: {
    prNumber: number;
    sha: string;
    runtimeVersion: string;
    reachability?: 'reachable' | 'unreachable' | 'unknown';
  }) => string;
  reachability: (builds: unknown[], runtimeVersion: string) => 'reachable' | 'unreachable' | 'unknown';
};

describe('renderComment', () => {
  const body = preview.renderComment({
    prNumber: 42,
    sha: 'abcdef1234567890',
    runtimeVersion: 'rv-9',
  });

  it('carries the marker so the next push edits this comment instead of adding one', () => {
    expect(body.startsWith(preview.MARKER)).toBe(true);
  });

  it('names the PR, the short sha and the runtime version', () => {
    expect(body).toContain('PR #42');
    expect(body).toContain('abcdef1');
    expect(body).not.toContain('abcdef12');
    expect(body).toContain('rv-9');
  });
});

describe('reachability', () => {
  const done = { status: 'FINISHED', runtimeVersion: 'rv-1' };

  it('is reachable when a finished build carries the same runtime version', () => {
    expect(preview.reachability([{ status: 'FINISHED', runtimeVersion: 'old' }, done], 'rv-1')).toBe(
      'reachable',
    );
  });

  it('reads the eas-cli 22 payload shape too', () => {
    expect(preview.reachability([{ status: 'FINISHED', runtime: { version: 'rv-1' } }], 'rv-1')).toBe(
      'reachable',
    );
  });

  it('is unreachable when every build has a different runtime version', () => {
    expect(preview.reachability([done], 'rv-2')).toBe('unreachable');
  });

  it('ignores builds that have not finished', () => {
    expect(preview.reachability([{ status: 'IN_PROGRESS', runtimeVersion: 'rv-1' }], 'rv-1')).toBe(
      'unreachable',
    );
  });

  it('is unreachable when no build exists yet', () => {
    expect(preview.reachability([], 'rv-1')).toBe('unreachable');
  });

  it('refuses to guess when no build reports a runtime version at all', () => {
    expect(preview.reachability([{ status: 'FINISHED' }], 'rv-1')).toBe('unknown');
  });
});

describe('renderComment reachability', () => {
  const base = { prNumber: 7, sha: 'abcdef1234', runtimeVersion: 'rv-1' };

  it('says the PR will not show, and how to fix it, when no installed build can take it', () => {
    const body = preview.renderComment({ ...base, reachability: 'unreachable' });
    expect(body).toContain('Rebuild needed');
    expect(body).toContain('eas build --profile pr-preview');
    expect(body).not.toContain('is live');
  });

  it('says it is live when reachable', () => {
    expect(preview.renderComment({ ...base, reachability: 'reachable' })).toContain('is live');
  });

  it('does not claim either way when it could not tell', () => {
    const body = preview.renderComment({ ...base, reachability: 'unknown' });
    expect(body).not.toContain('is live');
    expect(body).not.toContain('Rebuild needed');
    expect(body).toContain('could not check');
  });
});

describe('pr-preview EAS profile', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { build } = require('../../eas.json') as {
    build: Record<
      string,
      { env: Record<string, string>; developmentClient?: boolean; channel?: string }
    >;
  };

  it('is a regular build on its own channel, so it fetches updates on launch like staging', () => {
    expect(build['pr-preview']!.developmentClient).toBeUndefined();
    expect(build['pr-preview']!.channel).toBe('pr');
  });

  it('uses the staging backend, differing from staging only by variant', () => {
    const strip = (env: Record<string, string>) => {
      const copy = { ...env };
      delete copy.APP_VARIANT;
      delete copy.EXPO_PUBLIC_APP_VARIANT;
      return copy;
    };
    expect(strip(build['pr-preview']!.env)).toEqual(strip(build.preview!.env));
  });
});
