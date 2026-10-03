import {
  MAX_ZOOM,
  DOUBLE_TAP_ZOOM,
  clampScale,
  clampTranslate,
  zoomAbout,
  doubleTapTarget,
  pinchScale,
} from './photoZoom';

const view = { width: 400, height: 800 };

describe('clampScale', () => {
  it('keeps the scale between 1 and the maximum', () => {
    expect(clampScale(0.4)).toBe(1);
    expect(clampScale(2)).toBe(2);
    expect(clampScale(99)).toBe(MAX_ZOOM);
  });
});

describe('clampTranslate', () => {
  it('does not pan at all when not zoomed', () => {
    expect(clampTranslate({ x: 50, y: -30 }, 1, view)).toEqual({ x: 0, y: 0 });
  });

  it('lets the photo pan only as far as its edge reaching the screen edge', () => {
    // At 2x the content is 800 wide in a 400 viewport: 200 either side.
    expect(clampTranslate({ x: 999, y: -999 }, 2, view)).toEqual({ x: 200, y: -400 });
    expect(clampTranslate({ x: 120, y: 10 }, 2, view)).toEqual({ x: 120, y: 10 });
  });
});

describe('zoomAbout', () => {
  it('keeps the point under the fingers fixed on screen', () => {
    const next = zoomAbout({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, view);
    // screen = p * s + t must still equal the focal point's original screen spot
    expect(100 * 2 + next.x).toBe(100);
    expect(50 * 2 + next.y).toBe(50);
    expect(next.scale).toBe(2);
  });

  it('clamps the pan when the focal point is near an edge', () => {
    const next = zoomAbout({ scale: 1, x: 0, y: 0 }, 2, { x: 5000, y: 0 }, view);
    expect(next.x).toBe(-200);
  });

  it('returns to the centre when zoomed back to 1x', () => {
    expect(zoomAbout({ scale: 2, x: 150, y: 20 }, 1, { x: 0, y: 0 }, view)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});

describe('doubleTapTarget', () => {
  it('zooms in about the tap when at rest', () => {
    const t = doubleTapTarget({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, view);
    expect(t).toEqual({ scale: DOUBLE_TAP_ZOOM, x: 0, y: 0 });
  });

  it('zooms back out when already zoomed', () => {
    expect(doubleTapTarget({ scale: 2.5, x: 40, y: 10 }, { x: 9, y: 9 }, view)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
});

describe('pinchScale', () => {
  it('scales the start zoom by the ratio the fingers moved', () => {
    expect(pinchScale(1.5, 100, 200)).toBe(3);
  });

  it('is clamped, and ignores a degenerate zero start distance', () => {
    expect(pinchScale(1, 100, 9000)).toBe(MAX_ZOOM);
    expect(pinchScale(2, 0, 50)).toBe(2);
  });
});
