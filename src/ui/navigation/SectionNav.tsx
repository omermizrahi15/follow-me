import React, { useEffect, useRef, useState } from 'react';
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
 * Fallback tab width, used only for the very first frame before the bar has
 * been measured. It used to be the real width: every tab was pinned to it, so
 * the bar was `SLOT_W × tabs + padding` wide no matter the screen — about 180pt
 * of a 402pt phone on three tabs, which read as a bar squeezed into the middle
 * rather than a deliberate capsule. The tabs share the real width now.
 */
const SLOT_W = 72;
/** Narrowest the selected halo may get, however tight its slot is. */
const PILL_W = 48;
/** The icon's row within a tab. */
const ICON_H = 28;
/** Glass inset around the row of tabs. */
const PAD = 8;
/**
 * Breathing room between the selected halo and the edges of its slot. Small,
 * because on the bar this copies the halo all but fills its column — a wide
 * lozenge under the whole tab, not a badge tucked behind the icon.
 */
const PILL_INSET = 3;
/** Caption line box under each icon. */
const LABEL_H = 14;
/** Gap between an icon and its caption. */
const LABEL_GAP = 2;
/**
 * The selected halo wraps the whole tab — icon and caption together — rather
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
 * Shaped like the Polarsteps bar: a plain white capsule with a soft shadow, a
 * big icon over a small caption, and every tab in the same deep navy — the
 * selected one is marked only by a pale grey lozenge that fills its column and
 * slides between tabs as the selection moves. Deliberately *not* a two-colour
 * bar: dimming the unselected tabs was what made this read as a generic glass
 * widget rather than that bar.
 *
 * It spans the width it is given and the tabs divide that between them — a row
 * of evenly spaced destinations, not a clump sized by their own labels.
 */
export function SectionNav({ active, onChange, showHistory = false }: Props): React.JSX.Element {
  const items = ITEMS.filter(item => item.key !== 'history' || showHistory);
  const index = Math.max(0, items.findIndex(item => item.key === active));

  // A tab's share of the bar. Measured rather than assumed, because the bar now
  // stretches to whatever the screen gives it — the pill is placed by index, so
  // it has to know the real slot width or it drifts away from the icon it is
  // meant to sit behind.
  const [barW, setBarW] = useState(0);
  const slotW = barW > 0 ? (barW - PAD * 2) / items.length : SLOT_W;
  // Fills its slot bar a small inset, so the highlight scales with the bar
  // instead of staying a 40pt lozenge adrift in a 96pt column.
  const pillW = Math.max(PILL_W, slotW - PILL_INSET * 2);

  // Slides the pill to the selected tab. A transform, so it runs on the UI
  // thread and stays smooth while the sheet behind it is still settling.
  const slide = useRef(new Animated.Value(index * slotW)).current;
  useEffect(() => {
    Animated.spring(slide, {
      toValue: index * slotW,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
    }).start();
    // `slotW` is a dependency because the first real measurement lands after
    // mount: without it the pill would keep the placeholder geometry forever.
  }, [index, slotW, slide]);

  return (
    <View style={styles.shadow}>
      <BlurView
        intensity={40}
        tint="light"
        style={styles.bar}
        onLayout={e => setBarW(e.nativeEvent.layout.width)}
      >
        <View style={styles.tint} pointerEvents="none" />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            { width: pillW, left: PAD + (slotW - pillW) / 2, transform: [{ translateX: slide }] },
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
                  color={colors.ink}
                />
              </View>
              <Text style={styles.label} numberOfLines={1}>
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
  // Fills whatever the parent gives it, so the tabs below can divide that width
  // between them instead of sitting in a clump sized by their own labels. The
  // shadow lives out here because the bar itself clips to its radius.
  shadow: {
    flex: 1,
    borderRadius: radius.pill,
    shadowColor: '#0B1F2C',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // No border and no gloss line: the bar this copies is a plain white capsule,
  // and the highlight edge was the tell that ours was a glass widget imitating
  // one.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    overflow: 'hidden',
    padding: PAD,
  },
  // Nearly opaque white — the blur underneath only softens whatever the bar is
  // floating over, it isn't meant to show through as a tint.
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.88)' },
  // Sits behind the selected tab — icon and caption both — centred in its slot,
  // and slides between them. `left` and `width` are supplied at render time
  // from the measured slot.
  pill: {
    position: 'absolute',
    top: PAD,
    height: PILL_H,
    borderRadius: radius.pill,
    backgroundColor: colors.navPill,
  },
  // Equal shares of the bar, however many tabs there are. `minWidth: 0` lets a
  // long label ellipsize rather than push its neighbours out of the row.
  tab: { flex: 1, minWidth: 0, alignItems: 'center', gap: LABEL_GAP },
  icon: { height: ICON_H, alignItems: 'center', justifyContent: 'center' },
  // Same weight and colour selected or not — the lozenge behind the tab is what
  // marks the selection, exactly as on the bar this copies.
  label: {
    fontSize: 11,
    lineHeight: LABEL_H,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: colors.ink,
  },
});
