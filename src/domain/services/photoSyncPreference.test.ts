import { resolvePhotoSyncPreference, type LegacyPhotoSyncSignals } from './photoSyncPreference';

function signals(over: Partial<LegacyPhotoSyncSignals> = {}): LegacyPhotoSyncSignals {
  return { legacyConsentAt: null, legacyPaused: false, ...over };
}

describe('resolvePhotoSyncPreference', () => {
  it('carries the old "Allow" forward', () => {
    expect(
      resolvePhotoSyncPreference(signals({ legacyConsentAt: '2026-01-01T00:00:00.000Z' })),
    ).toBe('on');
  });

  it('keeps sync off for a publisher who declined the old prompt', () => {
    // Declining left no trace of its own — on an install that was asked, the
    // missing stamp IS the trace. Reading it as "never asked" would silently
    // re-enable uploads for someone who deliberately said no, which is the
    // whole risk of turning the default on.
    expect(resolvePhotoSyncPreference(signals())).toBe('off');
  });

  it('keeps sync off for a device that wiped its cloud photos', () => {
    // The pause flag outlived the build that wrote it. Ignoring it would
    // re-upload everything the publisher just deleted (issue #72).
    expect(resolvePhotoSyncPreference(signals({ legacyPaused: true }))).toBe('off');
    // And a wiping device still carried the "Allow" stamp from before the wipe,
    // so the stamp must not win.
    expect(
      resolvePhotoSyncPreference(signals({ legacyPaused: true, legacyConsentAt: 'x' })),
    ).toBe('off');
  });
});
