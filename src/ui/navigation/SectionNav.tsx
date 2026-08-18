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
const SLOT_W = 56;
/** The pill drawn around the selected icon, and the icon row it sits in. */
const PILL_W = 40;
const PILL_H = 30;
/** Glass inset around the row of tabs. */
const PAD = 6;
/** Breathing room between the selected pill and the edges of its slot. */
const PILL_INSET = 8;

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
 * Shaped like the bottom bars in Instagram and WhatsApp: a big icon over a
 * small caption, and the selected one marked by a filled pill that slides
 * between tabs. It spans the width it is given and the tabs divide that
 * between them, the way those bars do — a row of evenly spaced destinations,
 * not a clump of them sized by their own labels.
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
        intensity={55}
        tint="light"
        style={styles.bar}
        onLayout={e => setBarW(e.nativeEvent.layout.width)}
      >
        <View style={styles.tint} pointerEvents="none" />
        {/* The light glass catches along its top edge. */}
        <View style={styles.gloss} pointerEvents="none" />
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
                  size={22}
                  color={isActive ? colors.accent : colors.navIdle}
                />
              </View>
              <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
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
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.8)',
    padding: PAD,
  },
  // Frosted wash — over the white sheet this is what keeps the bar reading as
  // glass rather than as a flat white pill.
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.6)' },
  gloss: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  // Sits behind the selected icon — centred in its slot — and slides between
  // them. `left` and `width` are supplied at render time from the measured slot.
  pill: {
    position: 'absolute',
    top: PAD,
    height: PILL_H,
    borderRadius: radius.pill,
    backgroundColor: colors.navPill,
  },
  // Equal shares of the bar, however many tabs there are. `minWidth: 0` lets a
  // long label ellipsize rather than push its neighbours out of the row.
  tab: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  icon: { height: PILL_H, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: colors.navIdle,
  },
  labelActive: { fontWeight: '700', color: colors.accent },
});
