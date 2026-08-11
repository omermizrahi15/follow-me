import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { colors, radius, shadow } from '../theme/theme';

export type HomeSection = 'me' | 'auto' | 'followers' | 'history';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ITEMS: { key: HomeSection; label: string; active: IconName; inactive: IconName }[] = [
  { key: 'me', label: 'Me', active: 'person-circle', inactive: 'person-circle-outline' },
  { key: 'auto', label: 'Auto-posting', active: 'time', inactive: 'time-outline' },
  { key: 'followers', label: 'Followers', active: 'people', inactive: 'people-outline' },
  // Only rendered when the publisher actually has travels left to reconstruct
  // — see `showHistory` below (issue #81).
  { key: 'history', label: 'History', active: 'refresh-circle', inactive: 'refresh-circle-outline' },
];

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
 * Floating glass segmented control. Unlike a navigator, it doesn't change the
 * page — it only switches which content the bottom sheet shows (Me / Auto-posting
 * / Followers) while the feed stays put behind it.
 */
export function SectionNav({ active, onChange, showHistory = false }: Props): React.JSX.Element {
  const items = ITEMS.filter(item => item.key !== 'history' || showHistory);
  // Four tabs need to share the same pill width as three did.
  const tabStyle = items.length > 3 ? styles.tabNarrow : styles.tab;
  return (
    <View style={styles.shadow}>
      <BlurView intensity={65} tint="light" style={styles.pill}>
        <View style={styles.tint} pointerEvents="none" />
        {items.map(item => {
          const isActive = active === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              testID={`section-nav-${item.key}`}
              accessibilityRole="button"
              accessibilityState={isActive ? { selected: true } : {}}
              accessibilityLabel={item.label}
              activeOpacity={0.7}
              style={[tabStyle, isActive && styles.tabActive]}
              onPress={() => onChange(item.key)}
            >
              <Ionicons name={isActive ? item.active : item.inactive} size={20} color={colors.ink} />
              <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: radius.pill, ...shadow.raised },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 5,
    paddingHorizontal: 5,
    gap: 2,
  },
  // Subtle frosted wash — over the white sheet this keeps the pill reading as glass.
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.4)' },
  tab: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    gap: 2,
  },
  tabNarrow: {
    width: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: radius.pill,
    gap: 2,
  },
  tabActive: { backgroundColor: colors.accentSoft },
  label: { fontSize: 11, fontWeight: '600', color: colors.ink },
  labelActive: { fontWeight: '700' },
});
