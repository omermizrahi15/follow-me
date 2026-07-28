import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Coordinate, PlaceSuggestion } from '../../domain/interfaces';
import { placeSearch } from '../../composition/container';
import { colors, radius, spacing } from '../theme/theme';

interface Props {
  /** Current place text. */
  value: string;
  /** Called when the text changes or a suggestion is chosen. */
  onChange: (label: string, coordinate?: Coordinate) => void;
  /** True while the GPS-based place is still resolving. */
  loading?: boolean;
  /**
   * Whether the batch already has a coordinate from photo GPS. When it does the
   * field is just a label the publisher may edit; when it does not, picking a
   * suggestion is the only way the posting gets onto the map, so the picker
   * explains itself.
   */
  hasGps: boolean;
}

/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 350;
/** Shorter than this and every result is noise. */
const MIN_QUERY = 2;

/**
 * The posting's place. Normally filled from the photos' GPS and left alone; when
 * a batch carries no GPS the publisher searches for a place, and the chosen
 * suggestion brings a real coordinate with it.
 *
 * That coordinate is the point: a typed label alone cannot be plotted, and
 * geocoding free text after the fact lands pins on country centres.
 */
export function PlaceField({ value, onChange, loading = false, hasGps }: Props): React.JSX.Element {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  // Set when the user picks a suggestion; cleared as soon as they type again,
  // because the text no longer describes the coordinate we hold.
  const [picked, setPicked] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Only search when the publisher is choosing a place — with GPS the label is
  // already correct and a dropdown would just be in the way.
  const searchable = !hasGps && !picked && value.trim().length >= MIN_QUERY;

  useEffect(() => {
    if (!searchable) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setSearching(true);

    const timer = setTimeout(() => {
      void placeSearch
        .search(value, controller.signal)
        .then(results => {
          if (!controller.signal.aborted) setSuggestions(results);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, searchable]);

  function handleType(text: string): void {
    setPicked(false);
    onChange(text);
  }

  function handlePick(suggestion: PlaceSuggestion): void {
    setPicked(true);
    setSuggestions([]);
    onChange(suggestion.label, suggestion.coordinate);
  }

  return (
    <View>
      <View style={styles.row}>
        <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
        <TextInput
          testID="place-input"
          style={styles.input}
          value={value}
          onChangeText={handleType}
          placeholder={loading ? 'Finding the place…' : 'Where was this?'}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Posting place"
          autoCorrect={false}
        />
        {(loading || searching) && <ActivityIndicator size="small" color={colors.textMuted} />}
        {picked && !loading && !searching && (
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        )}
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map(suggestion => (
            <TouchableOpacity
              key={suggestion.id}
              testID={`place-suggestion-${suggestion.id}`}
              style={styles.suggestion}
              onPress={() => handlePick(suggestion)}
              activeOpacity={0.7}
            >
              <Ionicons name="location" size={14} color={colors.accent} />
              <Text style={styles.suggestionText} numberOfLines={1}>
                {suggestion.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!hasGps && !picked && value.trim() !== '' && suggestions.length === 0 && !searching && (
        <Text style={styles.hint}>
          Pick a place from the list so this post can appear on your map.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 2 },
  suggestions: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestionText: { flex: 1, color: colors.text, fontSize: 14 },
  hint: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
});
