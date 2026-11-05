import { previewVolume, FADE_IN_SECONDS, FADE_OUT_SECONDS } from './previewFade';

describe('previewVolume', () => {
  it('is full volume in the middle of the clip', () => {
    expect(previewVolume(15, 30)).toBe(1);
  });

  it('ramps up from silence at the start', () => {
    expect(previewVolume(0, 30)).toBe(0);
    expect(previewVolume(FADE_IN_SECONDS / 2, 30)).toBeCloseTo(0.5);
    expect(previewVolume(FADE_IN_SECONDS, 30)).toBe(1);
  });

  it('ramps down to silence at the end', () => {
    expect(previewVolume(30 - FADE_OUT_SECONDS / 2, 30)).toBeCloseTo(0.5);
    expect(previewVolume(30, 30)).toBe(0);
  });

  it('stays at full volume until the duration is known', () => {
    expect(previewVolume(5, 0)).toBe(1);
    expect(previewVolume(5, Number.NaN)).toBe(1);
  });

  it('never leaves 0..1, even when the clip is shorter than both fades', () => {
    for (const t of [0, 0.3, 0.6, 1, 2]) {
      const v = previewVolume(t, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
