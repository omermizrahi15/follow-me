import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Photo } from './Photo';
import { colors, radius, spacing, shadow } from '../theme/theme';

/**
 * Only what the card actually renders — deliberately structural rather than
 * `MediaDto`, so a presentational component carries no dependency on the
 * application layer (#107). Any DTO with these two fields still satisfies it.
 */
interface CardPhoto {
  url: string;
  /** ISO string. */
  createdAt: string;
}

interface Props {
  photo: CardPhoto;
}

export function PhotoCard({ photo }: Props): React.JSX.Element {
  const date = new Date(photo.createdAt).toLocaleDateString();
  return (
    <View style={styles.card}>
      <Photo uri={photo.url} style={styles.image} recyclingKey={photo.url} transition={120} />
      <Text style={styles.date}>{date}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  image: { width: '100%', height: 280 },
  date: { color: colors.textSecondary, fontSize: 12, padding: spacing.md },
});
