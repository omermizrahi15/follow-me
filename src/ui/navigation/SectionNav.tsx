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

/** One tab column. Fixed, so the highlight can be placed by index. */
const SLOT_W = 56;
/** The pill drawn around the selected icon, and the icon row it sits in. */
const PILL_W = 40;
const PILL_H = 30;
/** Glass inset around the row of tabs. */
const PAD = 6;

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
 * between tabs. The captions are small and the labels short on purpose — that
 * is what lets the bar stay a compact floating capsule instead of a strip
 * across the whole screen, so it covers as little of the feed as it can.
 */
export function SectionNav({ active, onChange, showHistory = false }: Props): React.JSX.Element {
  const items = ITEMS.filter(item => item.key !== 'history' || showHistory);
  const index = Math.max(0, items.findIndex(item => item.key === active));

  // Slides the pill to the selected tab. A transform, so it runs on the UI
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
      <BlurView intensity={55} tint="light" style={styles.bar}>
        <View style={styles.tint} pointerEvents="none" />
        {/* The light glass catches along its top edge. */}
        <View style={styles.gloss} pointerEvents="none" />
        <Animated.View
          pointerEvents="none"
          style={[styles.pill, { transform: [{ translateX: slide }] }]}
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
  // Sized by its content — a floating capsule rather than a full-width strip.
  // The shadow lives out here because the bar itself clips to its radius.
  shadow: {
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
  // Sits behind the selected icon — centred in its slot — and slides between them.
  pill: {
    position: 'absolute',
    left: PAD + (SLOT_W - PILL_W) / 2,
    top: PAD,
    width: PILL_W,
    height: PILL_H,
    borderRadius: radius.pill,
    backgroundColor: colors.navPill,
  },
  tab: { width: SLOT_W, alignItems: 'center', gap: 2 },
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
