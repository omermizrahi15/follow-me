/**
 * The PR preview comment: a QR that opens this PR's JS in an installed PR
 * preview build. The link shapes are the whole feature — a wrong scheme or an
 * unencoded `?` in the nested update URL produces a QR that scans fine and then
 * opens nothing — so they are pinned here instead of discovered on a phone.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const preview = require('./prPreview.js') as {
  MARKER: string;
  previewLinks: (a: { projectId: string; groupId: string; slug?: string }) => {
    deepLink: string;
    dashboardUrl: string;
    qrUrl: string;
  };
  renderComment: (a: {
    prNumber: number;
    sha: string;
    links: { deepLink: string; dashboardUrl: string; qrUrl: string };
    runtimeVersion: string;
  }) => string;
};

const links = preview.previewLinks({ projectId: 'proj-1', groupId: 'grp-2' });

describe('previewLinks', () => {
  it('opens the update group through the dev-client scheme', () => {
    const url = new URL(links.deepLink);
    expect(url.protocol).toBe('exp+follow-me:');
    expect(url.host).toBe('expo-development-client');
    expect(url.searchParams.get('url')).toBe('https://u.expo.dev/proj-1/group/grp-2');
  });

  it('percent-encodes the nested update URL', () => {
    expect(links.deepLink).toContain(encodeURIComponent('https://u.expo.dev/proj-1/group/grp-2'));
  });

  it('encodes the deep link into the QR image URL', () => {
    expect(links.qrUrl).toContain(encodeURIComponent(links.deepLink));
  });

  it('honours a custom slug', () => {
    expect(preview.previewLinks({ projectId: 'p', groupId: 'g', slug: 'other' }).deepLink).toMatch(
      /^exp\+other:\/\//,
    );
  });
});

describe('renderComment', () => {
  const body = preview.renderComment({
    prNumber: 42,
    sha: 'abcdef1234567890',
    links,
    runtimeVersion: 'rv-9',
  });

  it('carries the marker so the next push edits this comment instead of adding one', () => {
    expect(body.startsWith(preview.MARKER)).toBe(true);
  });

  it('shows the QR, a tappable link, the short sha and the runtime version', () => {
    expect(body).toContain(`![QR](${links.qrUrl})`);
    expect(body).toContain(`(${links.deepLink})`);
    expect(body).toContain('abcdef1');
    expect(body).not.toContain('abcdef12');
    expect(body).toContain('rv-9');
  });
});

describe('pr-preview EAS profile', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { build } = require('../../eas.json') as {
    build: Record<string, { env: Record<string, string>; developmentClient?: boolean }>;
  };

  it('is a dev client on the staging backend, differing from staging only by variant', () => {
    expect(build['pr-preview']!.developmentClient).toBe(true);
    const strip = (env: Record<string, string>) => {
      const copy = { ...env };
      delete copy.APP_VARIANT;
      delete copy.EXPO_PUBLIC_APP_VARIANT;
      return copy;
    };
    const pr = strip(build['pr-preview']!.env);
    const staging = strip(build.preview!.env);
    expect(pr).toEqual(staging);
  });
});
