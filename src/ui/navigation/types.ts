import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/** Top-level stack: auth gate, the main Me page, and pushed pages. */
export type RootStackParamList = {
  PhoneSignIn: undefined;
  Home: undefined;
  Settings: undefined;
  Upload: undefined;
  ReviewSuggestion: undefined;
};

/** Navigation prop for the root stack. */
export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
