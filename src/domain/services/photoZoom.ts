/**
 * Pure maths for zooming a single photo (issue #201). Positions are measured
 * from the centre of the viewport, so a transform of `translate(x, y) scale(s)`
 * about the centre maps a content point p to `p * s + t`.
 */

export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface ZoomState extends Point {
  scale: number;
}

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(1, scale));
}

/** Pan only as far as the photo's edge reaching the screen's edge. */
export function clampTranslate(t: Point, scale: number, view: Size): Point {
  const maxX = Math.max(0, (view.width * scale - view.width) / 2);
  const maxY = Math.max(0, (view.height * scale - view.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, t.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, t.y)) + 0,
  };
}

/** Change zoom while the content under `focal` stays under the fingers. */
export function zoomAbout(
  from: ZoomState,
  nextScale: number,
  focal: Point,
  view: Size,
): ZoomState {
  const scale = clampScale(nextScale);
  if (scale === 1) return { scale: 1, x: 0, y: 0 };
  const ratio = scale / from.scale;
  const t = clampTranslate(
    { x: focal.x - (focal.x - from.x) * ratio, y: focal.y - (focal.y - from.y) * ratio },
    scale,
    view,
  );
  return { scale, ...t };
}

/** Double-tap: zoom in about the tap, or back out if already zoomed. */
export function doubleTapTarget(from: ZoomState, tap: Point, view: Size): ZoomState {
  if (from.scale > 1) return { scale: 1, x: 0, y: 0 };
  return zoomAbout(from, DOUBLE_TAP_ZOOM, tap, view);
}

export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return clampScale(startScale);
  return clampScale((startScale * distance) / startDistance);
}
