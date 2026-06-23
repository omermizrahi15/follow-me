import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/** Top-level stack: auth gate, the main tabbed experience, and pushed pages. */
export type RootStackParamList = {
  PhoneSignIn: undefined;
  Main: undefined;
  Settings: undefined;
  Upload: undefined;
};

/** Bottom tabs shown once the publisher is authenticated: Me / Auto-posting / Followers. */
export type MainTabParamList = {
  Home: undefined;
  Config: undefined;
  Followers: undefined;
};

/** Navigation prop available to any screen rendered inside the tab navigator. */
export type TabNavigationProp = BottomTabNavigationProp<MainTabParamList>;

/** Navigation prop for the root stack (pushed pages like Settings / Upload). */
export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
