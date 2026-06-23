import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from './types';
import { colors, radius, shadow, spacing } from '../theme/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<keyof MainTabParamList, { active: IconName; inactive: IconName }> = {
  Home: { active: 'person-circle', inactive: 'person-circle-outline' },
  Config: { active: 'time', inactive: 'time-outline' },
  Followers: { active: 'people', inactive: 'people-outline' },
};

const LABELS: Record<keyof MainTabParamList, string> = {
  Home: 'Me',
  Config: 'Auto-posting',
  Followers: 'Followers',
};

/** Strength of the glass blur (0–100). */
const BLUR_INTENSITY = 65;

/**
 * Floating, Polarsteps-style bottom navigation: a frosted-glass rounded pill
 * (expo-blur) holding the Me / Auto-posting / Followers tabs. The active tab
 * gets a lighter highlight + filled icon; dark navy ink throughout.
 */
export function FloatingTabBar({ state, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const activeName = state.routes[state.index]?.name;

  function go(routeName: string, isFocused: boolean, key: string): void {
    const event = navigation.emit({ type: 'tabPress', target: key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(routeName);
    }
  }

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
      <View style={styles.pillShadow}>
        <BlurView intensity={BLUR_INTENSITY} tint="light" style={styles.pill}>
          <View style={styles.tint} pointerEvents="none" />
          {state.routes.map(route => {
            const name = route.name as keyof MainTabParamList;
            const isFocused = activeName === route.name;
            const icon = ICONS[name];
            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={LABELS[name]}
                activeOpacity={0.7}
                style={[styles.tab, isFocused && styles.tabActive]}
                onPress={() => go(route.name, isFocused, route.key)}
              >
                <Ionicons name={isFocused ? icon.active : icon.inactive} size={20} color={colors.ink} />
                <Text style={[styles.label, isFocused && styles.labelActive]}>{LABELS[name]}</Text>
              </TouchableOpacity>
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pillShadow: {
    borderRadius: radius.pill,
    ...shadow.raised,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    paddingVertical: 5,
    paddingHorizontal: 5,
    gap: 2,
  },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(245,243,239,0.35)' },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    gap: 2,
  },
  tabActive: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.ink,
  },
  labelActive: {
    fontWeight: '700',
  },
});
