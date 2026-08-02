import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
// eslint-disable-next-line import/no-restricted-paths -- pre-existing violation (#107): the card renders an application DTO directly instead of a UI view model. Waived until a view model exists.
import type { MediaDto } from '../../application/dtos';
import { colors, radius, spacing, shadow } from '../theme/theme';

interface Props {
  photo: MediaDto;
}

export function PhotoCard({ photo }: Props): React.JSX.Element {
  const date = new Date(photo.createdAt).toLocaleDateString();
  return (
    <View style={styles.card}>
      <Image source={{ uri: photo.url }} style={styles.image} resizeMode="cover" />
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
