import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeSection } from './SectionNav';

/** Top-level stack: auth gate, the main Me page, and pushed pages. */
export type RootStackParamList = {
  PhoneSignIn: undefined;
  /** Optional `section` deep-links the Me page straight to a sheet section. */
  Home: { section?: HomeSection } | undefined;
  Settings: undefined;
  Upload: undefined;
  ReviewSuggestion: undefined;
};

/** Navigation prop for the root stack. */
export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
