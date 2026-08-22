import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { connectivityCopy } from '../../domain/services/connectivityCopy';
import { recheckConnection, useConnectionStatus } from '../data/connectivity';
import { colors, radius, shadow, spacing, typography } from '../theme/theme';

/**
 * The app's one offline banner (issue #145).
 *
 * Mounted once at the root rather than per screen, because the alternative —
 * every screen inventing its own — is how you end up with six different ways of
 * saying the same thing and three screens that forgot. It floats above whatever
 * is showing, so a screen mid-scroll or a modal mid-edit is not interrupted.
 *
 * The copy comes from `domain/services/connectivityCopy`, which is where it can
 * be tested; this file is layout, animation and one button.
 */

const SLIDE_MS = 220;

export function OfflineBanner(): React.ReactElement | null {
  const status = useConnectionStatus();
  const insets = useSafeAreaInsets();
  const copy = connectivityCopy(status);
  const slide = useRef(new Animated.Value(0)).current;
  const shown = copy != null;
  // Kept mounted for the duration of the slide-out, so leaving doesn't snap.
  const [visible, setVisible] = useState(shown);

  useEffect(() => {
    if (shown) setVisible(true);
    const animation = Animated.timing(slide, {
      toValue: shown ? 1 : 0,
      duration: SLIDE_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !shown) setVisible(false);
    });
    return () => animation.stop();
    // Only the appearing/disappearing matters here: offline becoming
    // unreachable swaps the copy in place rather than replaying the slide.
  }, [shown, slide]);

  if (!visible || copy == null) return null;

  return (
    <Animated.View
      testID="offline-banner"
      accessibilityRole="alert"
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + spacing.sm,
          opacity: slide,
          transform: [
            {
              translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }),
            },
          ],
        },
      ]}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.onAccent} />
          <Text style={styles.title} testID="offline-banner-title">
            {copy.title}
          </Text>
          {copy.action != null && (
            <TouchableOpacity
              testID="offline-banner-action"
              onPress={() => void recheckConnection()}
              hitSlop={8}
            >
              <Text style={styles.action}>{copy.action}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.hint}>{copy.hint}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
  },
  card: {
    // Deliberately the accent rather than `danger`: the connection being down
    // is not the user having done something wrong, and a red bar over the whole
    // app for the length of a train tunnel reads like an error they must fix.
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    ...shadow.raised,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.onAccent,
    flex: 1,
  },
  action: {
    ...typography.button,
    color: colors.onAccent,
    textDecorationLine: 'underline',
  },
  hint: {
    ...typography.caption,
    color: colors.onAccent,
    opacity: 0.85,
  },
});
