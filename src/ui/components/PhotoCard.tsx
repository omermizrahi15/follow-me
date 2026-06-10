import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import type { MediaDto } from '../../application/dtos';

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
  card: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#1a1a1a', marginBottom: 16 },
  image: { width: '100%', height: 280 },
  date: { color: '#888', fontSize: 12, padding: 10 },
});
