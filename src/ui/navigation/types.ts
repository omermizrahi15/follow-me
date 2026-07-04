import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeSection } from './SectionNav';
import type { FeedPosting } from '../components/PhotoFeed';

/** Top-level stack: auth gate, the main Me page, and pushed pages. */
export type RootStackParamList = {
  PhoneSignIn: undefined;
  /** Optional `section` deep-links the Me page straight to a sheet section. */
  Home: { section?: HomeSection } | undefined;
  Settings: undefined;
  Upload: undefined;
  /** All media of one feed posting, opened by tapping the post. */
  Posting: { posting: FeedPosting };
};

/** Navigation prop for the root stack. */
export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
