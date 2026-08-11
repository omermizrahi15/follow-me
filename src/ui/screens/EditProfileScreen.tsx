import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import type { RootNavigationProp } from '../navigation/types';
import { saveProfile, storage } from '../../composition/container';
import { PublisherProfile } from '../../domain/entities/PublisherProfile';
import { CalendarPicker } from '../components/CalendarPicker';
import { startOfDay } from '../../domain/services/calendarMonth';
import { ScreenHeader } from '../components/ScreenHeader';
import { usePublisherId } from '../context/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * Edit the full publisher profile — name and photo — opened from Settings.
 * Pre-filled with the saved profile; the same fields onboarding sets up.
 */
/** "2026-06-14" -> local midnight; null when unset or malformed. */
function parseIsoDay(value: string | null): Date | null {
  if (value == null) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (y == null || m == null || d == null) return null;
  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function EditProfileScreen(): React.JSX.Element {
  const navigation = useNavigation<RootNavigationProp>();
  const publisherId = usePublisherId();
  const { profile, loading } = useProfile(publisherId);

  const [name, setName] = useState('');
  /** Either the saved https avatar or a freshly picked local file uri. */
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tripStart, setTripStart] = useState<Date | null>(null);

  // Pinned per mount so the picker's bounds can't shift mid-edit.
  const tripToday = useMemo(() => startOfDay(new Date()), []);
  const tripEarliest = useMemo(
    () => new Date(tripToday.getFullYear() - 5, tripToday.getMonth(), tripToday.getDate()),
    [tripToday],
  );

  // Fill the form once the saved profile arrives; never overwrite edits after.
  useEffect(() => {
    if (loading || hydrated) return;
    setName(profile?.displayName ?? '');
    setAvatarUri(profile?.avatarUrl ?? null);
    setTripStart(parseIsoDay(profile?.tripStartDate ?? null));
    setHydrated(true);
  }, [loading, hydrated, profile]);

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

  function handleSave(): void {
    void (async (): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) {
        setError('Please enter your name so followers recognise you.');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        // A newly picked photo is a local file that needs uploading; the
        // already-saved avatar is an https URL and passes through as-is.
        let avatarUrl = avatarUri;
        if (avatarUri != null && !avatarUri.startsWith('http')) {
          const filename = avatarUri.split('/').pop() ?? 'avatar.jpg';
          avatarUrl = await storage.upload(avatarUri, filename);
        }
        await saveProfile.execute(
          PublisherProfile.create({
            publisherId,
            displayName: trimmed,
            avatarUrl,
            tripStartDate: tripStart,
          }),
        );
        navigation.goBack();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not save your profile. Please try again.');
      } finally {
        setSaving(false);
      }
    })();
  }

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader title="Edit profile" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScreenHeader title="Edit profile" />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={styles.avatarRow}>
            <TouchableOpacity testID="edit-profile-avatar" style={styles.avatar} onPress={handlePickAvatar} activeOpacity={0.8}>
              {avatarUri != null ? (
                <Image
                  source={avatarUri}
                  style={styles.avatarImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={avatarUri}
                />
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
            testID="edit-profile-name"
            style={styles.input}
            placeholder="e.g. Omer Mizrahi"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
            autoCorrect={false}
            returnKeyType="done"
          />

          <Text style={styles.label}>When did your travels start?</Text>
          <Text style={styles.tripHint}>
            Lets the app spot stretches of your trip with no post yet, and offer to rebuild them.
          </Text>
          <CalendarPicker
            value={tripStart}
            onChange={setTripStart}
            minDate={tripEarliest}
            maxDate={tripToday}
          />

          {error != null && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            testID="edit-profile-save"
            style={[styles.primary, saving && styles.disabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.primaryText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
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
  tripHint: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.5 },
});
