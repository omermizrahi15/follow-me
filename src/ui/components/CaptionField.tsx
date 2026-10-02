import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { MAX_CAPTION_LENGTH } from '../../domain/services/caption';
import { colors, radius, spacing } from '../theme/theme';

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Disables editing while the post is being sent. */
  disabled?: boolean;
}

/** Show the counter only once the publisher is getting close to the cap. */
const COUNTER_FROM = MAX_CAPTION_LENGTH - 60;

/**
 * The optional caption on a post (issue #220): a sentence from the publisher
 * that goes to followers with the photos. Trimming and the final cap are the
 * domain's job (`normalizeCaption`); `maxLength` here only stops typing at the
 * cap so the publisher is never surprised by silent truncation.
 */
export function CaptionField({ value, onChange, disabled = false }: Props): React.JSX.Element {
  return (
    <View>
      <View style={styles.row}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textSecondary} style={styles.icon} />
        <TextInput
          testID="caption-input"
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="Add a caption (optional)"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Post caption"
          accessibilityHint="Sent to your followers with the photos"
          maxLength={MAX_CAPTION_LENGTH}
          multiline
          editable={!disabled}
        />
      </View>
      {value.length >= COUNTER_FROM && (
        <Text style={styles.counter}>
          {value.length}/{MAX_CAPTION_LENGTH}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  icon: { marginTop: 3 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 2, maxHeight: 96 },
  counter: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'right',
    marginTop: spacing.xs,
    marginRight: spacing.xs,
  },
});
