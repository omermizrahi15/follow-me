import React, { useMemo, useState } from 'react';
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
import { saveProfile, storage } from '../../../composition/container';
import { invalidateProfile } from '../../data/queries';
import { PublisherProfile } from '../../../domain/entities/PublisherProfile';
import { OnboardingHeader } from './OnboardingHeader';
import { CalendarPicker } from '../../components/CalendarPicker';
import { startOfDay } from '../../../domain/services/calendarMonth';
import { colors, radius, spacing, typography } from '../../theme/theme';

type Props = {
  publisherId: string;
  /** 1-based index of this step, for the progress dots. */
  step: number;
  totalSteps: number;
  /** Called once the profile is saved (or the user skips). */
  onDone: () => void;
};

/** How far back the trip-start picker reaches. */
const TRIP_YEARS_BACK = 5;

/**
 * Onboarding profile setup: display name and travel start date (both
 * required) plus an optional avatar (uploaded to Cloudinary). Not skippable —
 * the start date is the baseline the History feature measures against. The
 * Me page renders fine with no photo.
 *
 * Self-contained screen: the action buttons sit in a footer outside the
 * ScrollView so the keyboard-avoiding view lifts them above the keyboard.
 */
export function ProfileSetupStep({ publisherId, step, totalSteps, onDone }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tripStart, setTripStart] = useState<Date | null>(null);

  // Pinned per mount so the picker's bounds can't shift mid-onboarding.
  const tripToday = useMemo(() => startOfDay(new Date()), []);
  const tripEarliest = useMemo(
    () => new Date(tripToday.getFullYear() - TRIP_YEARS_BACK, tripToday.getMonth(), tripToday.getDate()),
    [tripToday],
  );

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
      // Required, not a nicety: this date is the baseline the app measures
      // posting coverage against. Without it there is no way to tell a trip
      // that is fully posted from one with months missing, so the History
      // feature simply cannot be offered (issue #81).
      if (tripStart == null) {
        setError('Pick the day your travels started — we use it to spot the stretches you haven’t posted yet.');
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
            avatarUrl,
            tripStartDate: tripStart,
          }),
        );
        // The invite card on the next step reads the profile for its avatar.
        invalidateProfile(publisherId);
        onDone();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not save your profile. Please try again.');
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <OnboardingHeader current={step} total={totalSteps} />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text style={styles.title}>Set up your profile</Text>
          <Text style={styles.body}>
            This is what your followers see. Your name and travel start date are
            needed to get going — everything here can be changed anytime.
          </Text>

          <View style={styles.avatarRow}>
            <TouchableOpacity style={styles.avatar} onPress={handlePickAvatar} activeOpacity={0.8}>
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
            Already on the road? We’ll spot the stretches you haven’t posted yet and
            offer to rebuild them.
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
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
  tripHint: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
    alignItems: 'center',
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
