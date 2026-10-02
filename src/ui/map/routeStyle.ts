/**
 * How the globe draws a trip: the route line and the photo pins on it.
 *
 * Kept as plain values (no React Native, no DOM) so the WebView page and its
 * test read the same numbers. The look is deliberately our own — a solid warm
 * line and rounded-square photo tiles — rather than the white dashed route with
 * round photo bubbles that most trip maps share (issue #205).
 */

export const ROUTE_STYLE = {
  /** Warm amber: reads on satellite blue, green and desert alike. */
  color: '#FFB547',
  width: 3,
  opacity: 0.95,
  /** Solid on purpose — see the file header. */
  dasharray: null,
  /** Dark halo under the line so it holds over pale sea and snow. */
  casingColor: '#0b1a2b',
  casingWidth: 6,
  casingOpacity: 0.4,
} as const;

export const MARKER_STYLE = {
  sizePx: 50,
  /** Well under half the size: a rounded square, not a circle. */
  radiusPx: 14,
  borderPx: 3,
  /** Frame colour — matches the route so a pin reads as part of its line. */
  borderColor: '#FFB547',
} as const;
