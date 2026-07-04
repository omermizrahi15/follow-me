import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';
import { PhoneSignInScreen } from '../screens/PhoneSignInScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { UploadScreen } from '../screens/UploadScreen';
import { PostingDetailScreen } from '../screens/PostingDetailScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import type { RootStackParamList } from './types';
import { colors } from '../theme/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator(): React.JSX.Element {
  const { publisherId, loading } = useAuth();
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
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {publisherId == null ? (
          <Stack.Screen name="PhoneSignIn" component={PhoneSignInScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Upload" component={UploadScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Posting" component={PostingDetailScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export function AppNavigator(): React.JSX.Element {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
});
