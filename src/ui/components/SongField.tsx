import React, { useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Modal, SafeAreaView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Song } from '../../domain/entities/Song';
import { useSongSearch } from '../hooks/useSongSearch';
import { colors, radius, spacing, typography } from '../theme/theme';

interface Props {
  song: Song | null;
  onChange: (song: Song | null) => void;
  testID?: string;
}

function Art({ song, size }: { song: Song; size: number }): React.JSX.Element {
  return song.artworkUrl != null ? (
    <Image source={{ uri: song.artworkUrl }} style={{ width: size, height: size, borderRadius: radius.sm }} />
  ) : (
    <Ionicons name="musical-notes" size={size * 0.6} color={colors.accent} />
  );
}

function SearchSheet({ onSelect, onClose }: { onSelect: (s: Song) => void; onClose: () => void }): React.JSX.Element {
  const { term, setTerm, results, searching } = useSongSearch();
  return (
    <SafeAreaView style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title}>Add music</Text>
        <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          style={styles.input}
          value={term}
          onChangeText={setTerm}
          placeholder="Song or artist"
          placeholderTextColor={colors.textMuted}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search songs"
        />
        {searching && <ActivityIndicator size="small" color={colors.accent} />}
      </View>
      <FlatList
        data={results}
        keyExtractor={(s, i) => `${s.title}-${s.artist}-${i}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => onSelect(item)} accessibilityLabel={`${item.title} by ${item.artist}`}>
            <Art song={item} size={44} />
            <View style={styles.names}>
              <Text style={styles.songTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.songArtist} numberOfLines={1}>{item.artist}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          term.trim() !== '' && !searching ? <Text style={styles.empty}>No songs found</Text> : null
        }
      />
    </SafeAreaView>
  );
}

/** The composer's optional "Add music" row; opens a song search sheet. */
export function SongField({ song, onChange, testID }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity testID={testID} style={styles.row} onPress={() => setOpen(true)} accessibilityLabel={song == null ? 'Add music' : 'Change song'}>
        {song == null ? (
          <Ionicons name="musical-notes-outline" size={16} color={colors.textSecondary} />
        ) : (
          <Art song={song} size={24} />
        )}
        <Text style={[styles.rowText, song == null && styles.placeholder]} numberOfLines={1}>
          {song == null ? 'Add music (optional)' : `${song.title} — ${song.artist}`}
        </Text>
        {song == null ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        ) : (
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={8} accessibilityLabel="Remove song">
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        {open && (
          <SearchSheet
            onSelect={s => { onChange(s); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  rowText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  sheet: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
  },
  title: { ...typography.title, fontSize: 17, color: colors.text },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingHorizontal: spacing.md, marginHorizontal: spacing.xl, marginBottom: spacing.md,
  },
  input: { flex: 1, paddingVertical: spacing.md, fontSize: 14, color: colors.text },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  names: { flex: 1 },
  songTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  songArtist: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  empty: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
});
