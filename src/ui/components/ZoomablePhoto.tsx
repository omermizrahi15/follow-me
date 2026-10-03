import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, PanResponder, Pressable, type GestureResponderEvent } from 'react-native';
import {
  doubleTapTarget,
  pinchScale,
  zoomAbout,
  clampTranslate,
  type Point,
  type ZoomState,
} from '../../domain/services/photoZoom';

/** A second tap inside this window is a double-tap, not two advances. */
const DOUBLE_TAP_MS = 260;
/** Movement under this is still a tap. */
const REST: ZoomState = { scale: 1, x: 0, y: 0 };

interface Props {
  width: number;
  height: number;
  /** A confirmed single tap, in viewport coordinates (the double-tap window passed). */
  onTap: (x: number) => void;
  /** Lets the pager stand down while a photo is zoomed, so panning isn't paging. */
  onZoomChange?: (zoomed: boolean) => void;
  children: React.ReactNode;
}

/** The two-finger reading of a touch list: how far apart, and where between. */
function pair(pts: Point[]): { dist: number; mid: Point } | null {
  const [a, b] = pts;
  if (a == null || b == null) return null;
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/**
 * Pinch-to-zoom, pan and double-tap for one full-screen photo (issue #201).
 *
 * At rest it claims nothing but taps, so the pager's swipe and the viewer's
 * swipe-down-to-close behave exactly as before. It takes over the gesture only
 * for a two-finger pinch, or a one-finger drag once zoomed in.
 */
export function ZoomablePhoto({
  width,
  height,
  onTap,
  onZoomChange,
  children,
}: Props): React.JSX.Element {
  const view = { width, height };
  const viewRef = useRef(view);
  viewRef.current = view;
  const cb = useRef({ onTap, onZoomChange });
  cb.current = { onTap, onZoomChange };

  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const state = useRef<ZoomState>(REST);
  const wasZoomed = useRef(false);

  const apply = useCallback(
    (next: ZoomState, animated: boolean): void => {
      state.current = next;
      const targets: [Animated.Value, number][] = [
        [scale, next.scale],
        [tx, next.x],
        [ty, next.y],
      ];
      if (animated) {
        Animated.parallel(
          targets.map(([v, to]) =>
            Animated.timing(v, { toValue: to, duration: 180, useNativeDriver: true }),
          ),
        ).start();
      } else {
        targets.forEach(([v, to]) => v.setValue(to));
      }
      const zoomed = next.scale > 1;
      if (zoomed !== wasZoomed.current) {
        wasZoomed.current = zoomed;
        cb.current.onZoomChange?.(zoomed);
      }
    },
    [scale, tx, ty],
  );

  // Back to rest when the page is recycled for another photo.
  useEffect(() => () => cb.current.onZoomChange?.(false), []);

  const gesture = useRef({
    start: REST,
    count: 0,
    originDx: 0,
    originDy: 0,
    pinch: null as null | { dist: number; mid: Point; from: ZoomState },
  });

  const centred = (e: GestureResponderEvent): Point[] =>
    e.nativeEvent.touches.map(t => ({
      x: t.pageX - viewRef.current.width / 2,
      y: t.pageY - viewRef.current.height / 2,
    }));

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e, g) =>
        e.nativeEvent.touches.length >= 2 ||
        (state.current.scale > 1 && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2)),
      // Once we have it, the pager must not take it back mid-pan.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, g) => {
        gesture.current = {
          start: state.current,
          count: 0,
          originDx: g.dx,
          originDy: g.dy,
          pinch: null,
        };
      },
      onPanResponderMove: (e, g) => {
        const pts = centred(e);
        const gs = gesture.current;
        if (pts.length !== gs.count) {
          // A finger came or went: re-anchor so the photo doesn't jump.
          gs.count = pts.length;
          gs.start = state.current;
          gs.originDx = g.dx;
          gs.originDy = g.dy;
          const p = pair(pts);
          gs.pinch = p != null ? { ...p, from: state.current } : null;
          return;
        }
        const now = pair(pts);
        if (gs.pinch != null && now != null) {
          const { mid } = now;
          const s = pinchScale(gs.pinch.from.scale, gs.pinch.dist, now.dist);
          const zoomed = zoomAbout(gs.pinch.from, s, gs.pinch.mid, viewRef.current);
          // Fingers drifting while pinching pan the photo along with them.
          const pan = clampTranslate(
            { x: zoomed.x + mid.x - gs.pinch.mid.x, y: zoomed.y + mid.y - gs.pinch.mid.y },
            zoomed.scale,
            viewRef.current,
          );
          apply(zoomed.scale === 1 ? zoomed : { scale: zoomed.scale, ...pan }, false);
          return;
        }
        const pan = clampTranslate(
          { x: gs.start.x + g.dx - gs.originDx, y: gs.start.y + g.dy - gs.originDy },
          gs.start.scale,
          viewRef.current,
        );
        apply({ scale: gs.start.scale, ...pan }, false);
      },
      onPanResponderRelease: () => {
        // Pinched out past 1x on release is already clamped; nothing to settle.
      },
    }),
  ).current;

  // Single vs double tap. A single tap waits out the window so a double-tap
  // doesn't also page the story; while zoomed, a lone tap does nothing.
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pending.current != null) clearTimeout(pending.current);
    },
    [],
  );

  const onPress = (e: GestureResponderEvent): void => {
    const { locationX: x, locationY: y, timestamp } = e.nativeEvent;
    const prev = lastTap.current;
    if (prev != null && timestamp - prev.at < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < 40) {
      lastTap.current = null;
      if (pending.current != null) clearTimeout(pending.current);
      pending.current = null;
      const v = viewRef.current;
      apply(
        doubleTapTarget(state.current, { x: x - v.width / 2, y: y - v.height / 2 }, v),
        true,
      );
      return;
    }
    lastTap.current = { at: timestamp, x, y };
    if (pending.current != null) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      lastTap.current = null;
      if (state.current.scale === 1) cb.current.onTap(x);
    }, DOUBLE_TAP_MS);
  };

  return (
    <Animated.View style={{ width, height, overflow: 'hidden' }} {...responder.panHandlers}>
      <Pressable style={{ width, height }} onPress={onPress}>
        <Animated.View
          style={{ width, height, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}
        >
          {children}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
