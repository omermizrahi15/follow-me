/**
 * The PR preview comment and the EAS profile behind it. The profile is the part
 * that can silently rot: if its env drifts from staging, the preview app talks
 * to the wrong backend and nobody notices until a PR "works" for the wrong reason.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const preview = require('./prPreview.js') as {
  MARKER: string;
  renderComment: (a: { prNumber: number; sha: string; runtimeVersion: string }) => string;
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
