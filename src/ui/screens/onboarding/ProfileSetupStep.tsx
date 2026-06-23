import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { saveProfile, storage } from '../../../composition/container';
import { PublisherProfile } from '../../../domain/entities/PublisherProfile';
import { colors, radius, spacing, typography } from '../../theme/theme';

type Props = {
  publisherId: string;
  /** Called once the profile is saved (or the user skips). */
  onDone: () => void;
};

const BIO_MAX = 160;

/**
 * Onboarding profile setup: display name (required), an optional avatar
 * (uploaded to Cloudinary), and an optional short bio. Skippable — the name
 * can be added later, and the Me page renders fine with no photo or bio.
 */
export function ProfileSetupStep({ publisherId, onDone }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePickAvatar(): void {
    void (async (): Promise<void> => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!picked.canceled && picked.assets[0] != null) {
        setAvatarUri(picked.assets[0].uri);
      }
    })();
  }

  function handleContinue(): void {
    void (async (): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) {
        setError('Please enter your name so followers recognise you.');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        let avatarUrl: string | null = null;
        if (avatarUri != null) {
          const filename = avatarUri.split('/').pop() ?? 'avatar.jpg';
          avatarUrl = await storage.upload(avatarUri, filename);
        }
        await saveProfile.execute(
          PublisherProfile.create({
            publisherId,
            displayName: trimmed,
            bio: bio.trim().length > 0 ? bio.trim() : null,
            avatarUrl,
          }),
        );
        onDone();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not save your profile. Please try again.');
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <View style={styles.content}>
      <Text style={styles.title}>Set up your profile</Text>
      <Text style={styles.body}>
        This is what your followers see. You can change it anytime.
      </Text>

      <View style={styles.avatarRow}>
        <TouchableOpacity style={styles.avatar} onPress={handlePickAvatar} activeOpacity={0.8}>
          {avatarUri != null ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <Ionicons name="camera" size={26} color={colors.accent} />
          )}
          <View style={styles.avatarBadge}>
            <Ionicons name={avatarUri != null ? 'pencil' : 'add'} size={13} color={colors.onAccent} />
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarHint}>
          {avatarUri != null ? 'Tap to change photo' : 'Add a photo (optional)'}
        </Text>
      </View>

      <Text style={styles.label}>Your name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Omer Mizrahi"
        placeholderTextColor={colors.textMuted}
        value={name}
        onChangeText={setName}
        autoCorrect={false}
        returnKeyType="next"
      />

      <Text style={styles.label}>About you (optional)</Text>
      <TextInput
        style={[styles.input, styles.bioInput]}
        placeholder="A short line about what you share"
        placeholderTextColor={colors.textMuted}
        value={bio}
        onChangeText={t => setBio(t.slice(0, BIO_MAX))}
        multiline
        maxLength={BIO_MAX}
      />
      <Text style={styles.counter}>{bio.length}/{BIO_MAX}</Text>

      {error != null && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.primary, saving && styles.disabled]}
        onPress={handleContinue}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.primaryText}>Continue</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={onDone} hitSlop={8} disabled={saving} style={styles.skipWrap}>
        <Text style={styles.skip}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  title: { ...typography.largeTitle, fontSize: 28, color: colors.text, marginBottom: spacing.sm },
  body: { ...typography.body, fontSize: 15, color: colors.textSecondary, marginBottom: spacing.xl },
  avatarRow: { alignItems: 'center', marginBottom: spacing.xl, gap: spacing.sm },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: { ...typography.caption, color: colors.textSecondary },
  label: { ...typography.caption, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.lg,
  },
  bioInput: { minHeight: 72, textAlignVertical: 'top', marginBottom: spacing.xs },
  counter: { ...typography.caption, fontSize: 11, color: colors.textMuted, textAlign: 'right', marginBottom: spacing.md },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  primaryText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.5 },
  skipWrap: { alignItems: 'center', marginTop: spacing.lg },
  skip: { color: colors.textSecondary, fontSize: 14, textDecorationLine: 'underline' },
});
