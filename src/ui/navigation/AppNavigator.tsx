import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { cacheBatchFromNotification, type ReviewNotificationData } from '../notifications/cacheApprovalBatch';
import { POST_NOW_ACTION } from '../../infrastructure/notifiers/NotificationCategories';
import { HomeScreen } from '../screens/HomeScreen';
import { PhoneSignInScreen } from '../screens/PhoneSignInScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { UploadScreen } from '../screens/UploadScreen';
import { ReviewSuggestionScreen } from '../screens/ReviewSuggestionScreen';
import { HistoryBackfillScreen } from '../screens/HistoryBackfillScreen';
import { PostingDetailScreen } from '../screens/PostingDetailScreen';
import { EditProfileScreen } from '../screens/EditProfileScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { useAutoSync } from '../hooks/useAutoSync';
import { useOnboarding } from '../hooks/useOnboarding';
import type { RootStackParamList } from './types';
import { colors } from '../theme/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Route a notification carries in its `data.screen`. Kept in sync with the
 * scheduler's REMINDER_TARGET_SCREEN (infra can't import UI, so the literal is
 * shared by contract, not import).
 */
const REVIEW_ROUTE: keyof RootStackParamList = 'ReviewSuggestion';

/** Navigate to the review screen if a notification response targets it. */
async function routeFromNotification(response: Notifications.NotificationResponse | null): Promise<void> {
  const data = response?.notification.request.content.data as ReviewNotificationData | undefined;
  if (data == null) return;

  // Resolve the batch into the cache BEFORE navigating so the review screen's
  // cache-first load picks it up instead of kicking off a device scan.
  await cacheBatchFromNotification(data);

  if (data.screen === REVIEW_ROUTE && navigationRef.isReady()) {
    const autoConfirm = response?.actionIdentifier === POST_NOW_ACTION;
    navigationRef.navigate('ReviewSuggestion', autoConfirm ? { autoConfirm: true } : undefined);
  }
}

/** Opens the suggestion review screen when the publisher taps the reminder. */
function useNotificationRouting(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    // Cold start: app launched by tapping the notification.
    void Notifications.getLastNotificationResponseAsync().then(routeFromNotification);
    // Warm: tapped while the app was running/backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener(r => void routeFromNotification(r));
    return () => sub.remove();
  }, [enabled]);
}

function RootNavigator(): React.JSX.Element {
  const { publisherId, loading } = useAuth();
  useNotificationRouting(publisherId != null);
  useAutoSync(publisherId);
  const { completed: onboardingDone, loading: onboardingLoading, complete } = useOnboarding();

  if (loading || onboardingLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!onboardingDone) {
    return <OnboardingScreen onDone={() => void complete()} />;
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {publisherId == null ? (
          <Stack.Screen name="PhoneSignIn" component={PhoneSignInScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="Upload" component={UploadScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen
              name="ReviewSuggestion"
              component={ReviewSuggestionScreen}
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen
              name="HistoryBackfill"
              component={HistoryBackfillScreen}
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen name="Posting" component={PostingDetailScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export function AppNavigator(): React.JSX.Element {
  return (
    // Screens can render outside the NavigationContainer (splash, onboarding),
    // so the safe-area provider must sit above everything — the container only
    // provides insets to screens inside it.
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
});
