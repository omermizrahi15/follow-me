import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { colors, radius } from '../theme/theme';

export type HomeSection = 'me' | 'auto' | 'followers' | 'history';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ITEMS: { key: HomeSection; label: string; active: IconName; inactive: IconName }[] = [
  { key: 'me', label: 'Me', active: 'person', inactive: 'person-outline' },
  // "Auto-posting" spelled out doubles the bar's width for no extra meaning —
  // the section's own heading still says it in full.
  { key: 'auto', label: 'Auto', active: 'time', inactive: 'time-outline' },
  { key: 'followers', label: 'Followers', active: 'people', inactive: 'people-outline' },
  // Only rendered when the publisher actually has travels left to reconstruct
  // — see `showHistory` below (issue #81).
  { key: 'history', label: 'History', active: 'refresh-circle', inactive: 'refresh-circle-outline' },
];

/**
 * A tab's column. Fixed rather than a share of the screen, because the bar is
 * anchored to the left edge and sized by its tabs (issue #159): the capsule
 * ends where the last tab does instead of stretching across the width.
 */
const SLOT_W = 72;
/** The icon's row within a tab. */
const ICON_H = 28;
/** Glass inset around the row of tabs. */
const PAD = 8;
/**
 * Breathing room between the selected chip and the edges of its slot. Small, so
 * the chip reads as a lozenge under the whole tab, not a badge behind the icon.
 */
const PILL_INSET = 3;
/** Caption line box under each icon. */
const LABEL_H = 14;
/** Gap between an icon and its caption. */
const LABEL_GAP = 2;
/**
 * The selected chip wraps the whole tab — icon and caption together — rather
 * than sitting behind the icon alone, which read as a highlight the label had
 * been left out of.
 */
const PILL_H = ICON_H + LABEL_GAP + LABEL_H;

/**
 * The bar's outer height. Derived rather than hardcoded so the screen behind it
 * can pad its content past the bar without the two drifting apart when the
 * padding or the halo changes.
 */
export const SECTION_NAV_HEIGHT = PAD * 2 + PILL_H;

interface Props {
  active: HomeSection;
  onChange: (section: HomeSection) => void;
  /**
   * Whether to offer the History tab. False when the publisher's postings
   * already cover their whole trip, or when they haven't said when it began —
   * a tab that opens onto "nothing to rebuild" is worse than no tab.
   */
  showHistory?: boolean;
}

/**
 * Floating glass tab bar. Unlike a navigator, it doesn't change the page — it
 * only switches which content the bottom sheet shows (Me / Auto-posting /
 * Followers) while the feed stays put behind it.
 *
 * A frosted capsule with a soft shadow, an icon over a small caption per tab.
 * The selection is a solid navy chip with a white icon and caption that slides
 * between tabs as the selection moves; unselected tabs are muted slate, so the
 * active one is unmistakable at a glance (issue #205 — the earlier all-navy,
 * pale-halo treatment was too close to another app's bar).
 *
 * The glass is genuinely frosted (issue #159): the wash over the blur is light
 * enough that the sheet's content passing underneath shows through as colour
 * and shape, which is the whole point of putting a blur here at all.
 *
 * The bar is sized by its tabs and anchored to the left of whatever it is
 * placed in, rather than spanning the screen — a full-width capsule would just
 * be a row of icons with a third of itself left blank.
 */
export function SectionNav({ active, onChange, showHistory = false }: Props): React.JSX.Element {
  const items = ITEMS.filter(item => item.key !== 'history' || showHistory);
  const index = Math.max(0, items.findIndex(item => item.key === active));

  // Fills its slot bar a small inset, so the chip reads as a lozenge under the
  // whole tab rather than a badge tucked behind the icon.
  const pillW = SLOT_W - PILL_INSET * 2;

  // Slides the chip to the selected tab. A transform, so it runs on the UI
  // thread and stays smooth while the sheet behind it is still settling.
  const slide = useRef(new Animated.Value(index * SLOT_W)).current;
  useEffect(() => {
    Animated.spring(slide, {
      toValue: index * SLOT_W,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
    }).start();
  }, [index, slide]);

  return (
    <View style={styles.shadow}>
      <BlurView intensity={64} tint="light" style={styles.bar}>
        <View style={styles.tint} pointerEvents="none" />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            { width: pillW, left: PAD + PILL_INSET, transform: [{ translateX: slide }] },
          ]}
        />
        {items.map(item => {
          const isActive = active === item.key;
          return (
            <Pressable
              key={item.key}
              testID={`section-nav-${item.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
              onPress={() => onChange(item.key)}
            >
              <View style={styles.icon}>
                <Ionicons
                  name={isActive ? item.active : item.inactive}
                  size={24}
                  color={isActive ? colors.onAccent : colors.textSecondary}
                />
              </View>
              <Text
                style={[styles.label, { color: isActive ? colors.onAccent : colors.textSecondary }]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized by the tabs inside it — no `flex`, so the capsule ends where the last
  // tab does and the row can be anchored left. The shadow lives out here
  // because the bar itself clips to its radius.
  shadow: {
    borderRadius: radius.pill,
    shadowColor: '#0B1F2C',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  // The hairline is back, and earns its place now the fill is translucent:
  // frosted glass needs an edge or it dissolves into whatever it floats over.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    overflow: 'hidden',
    padding: PAD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  // Light enough to see through. The blur does the work of keeping the icons
  // legible; this only warms it and lifts the contrast a little, so scrolling
  // content still reads as blurred shapes rather than being washed to white.
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.navGlass },
  // Sits behind the selected tab — icon and caption both — centred in its slot,
  // and slides between them. `left` and `width` are supplied at render time so
  // the geometry stays derived from the slot rather than duplicated here.
  pill: {
    position: 'absolute',
    top: PAD,
    height: PILL_H,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  // A fixed column each: the bar takes its width from the tabs, so they can't
  // in turn take theirs from the bar. Long labels ellipsize inside the column
  // rather than widening it and pushing the row out of square.
  tab: { width: SLOT_W, alignItems: 'center', gap: LABEL_GAP },
  icon: { height: ICON_H, alignItems: 'center', justifyContent: 'center' },
  // Colour is set per tab at render time (white on the chip, slate elsewhere).
  label: {
    fontSize: 11,
    lineHeight: LABEL_H,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
});
