import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle, type ImageStyle } from 'react-native';
import { Image, type ImageContentFit } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../theme/theme';

/**
 * A remote photo, with one answer for "it isn't here" used everywhere
 * (issue #145).
 *
 * Every photo in this app comes down a phone connection, so every one of them
 * can fail — and each place that drew one used to fail differently. A feed card
 * went blank, a thumbnail showed an empty grey box, and the story viewer kept
 * the *previous* photo on screen because the view was recycled and nothing
 * replaced its contents. Three behaviours, none of them telling the user
 * anything, and one of them actively lying about which photo they were looking
 * at.
 *
 * So: while it loads, the surface tint; if it fails, a muted cloud on that same
 * tint. Never blank, never stale, and identical on every screen.
 */

interface Props {
  /** Remote or local uri. `undefined` renders the placeholder outright. */
  uri: string | undefined;
  style: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
  /** Distinguishes this photo when the view is recycled by a list. */
  recyclingKey?: string | undefined;
  /** Icon size for the placeholder. */
  iconSize?: number;
  /** Placeholder background, for surfaces that are not the app background. */
  placeholderStyle?: StyleProp<ViewStyle>;
  /** Bump to retry a photo that failed. */
  reloadKey?: number;
  transition?: number;
}

export function Photo({
  uri,
  style,
  contentFit = 'cover',
  cachePolicy = 'memory-disk',
  recyclingKey,
  iconSize = 22,
  placeholderStyle,
  reloadKey = 0,
  transition,
}: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  // A different photo — or a retry — starts from "not failed" again. Without
  // this a recycled row would inherit the last one's failure.
  useEffect(() => setFailed(false), [uri, reloadKey]);

  if (uri == null || failed) {
    return (
      <View style={[style, styles.placeholder, placeholderStyle]}>
        <Ionicons
          name={uri == null ? 'image-outline' : 'cloud-offline-outline'}
          size={iconSize}
          color={colors.textMuted}
        />
      </View>
    );
  }

  return (
    <Image
      key={`${uri}-${reloadKey}`}
      source={uri}
      style={style}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      onError={() => setFailed(true)}
      {...(recyclingKey != null ? { recyclingKey } : {})}
      {...(transition != null ? { transition } : {})}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
});
