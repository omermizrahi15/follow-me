import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { colors, radius, shadow } from '../theme/theme';

export type HomeSection = 'me' | 'auto' | 'followers';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ITEMS: { key: HomeSection; label: string; active: IconName; inactive: IconName }[] = [
  { key: 'me', label: 'Me', active: 'person-circle', inactive: 'person-circle-outline' },
  { key: 'auto', label: 'Auto-posting', active: 'time', inactive: 'time-outline' },
  { key: 'followers', label: 'Followers', active: 'people', inactive: 'people-outline' },
];

interface Props {
  active: HomeSection;
  onChange: (section: HomeSection) => void;
}

/**
 * Floating glass segmented control. Unlike a navigator, it doesn't change the
 * page — it only switches which content the bottom sheet shows (Me / Auto-posting
 * / Followers) while the feed stays put behind it.
 */
export function SectionNav({ active, onChange }: Props): React.JSX.Element {
  return (
    <View style={styles.shadow}>
      <BlurView intensity={65} tint="light" style={styles.pill}>
        <View style={styles.tint} pointerEvents="none" />
        {ITEMS.map(item => {
          const isActive = active === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              accessibilityRole="button"
              accessibilityState={isActive ? { selected: true } : {}}
              accessibilityLabel={item.label}
              activeOpacity={0.7}
              style={[styles.tab, isActive && styles.tabActive]}
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
  tabActive: { backgroundColor: colors.accentSoft },
  label: { fontSize: 11, fontWeight: '600', color: colors.ink },
  labelActive: { fontWeight: '700' },
});
