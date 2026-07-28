import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeSection } from './SectionNav';
import type { FeedPosting } from '../data/feed';

/** Top-level stack: auth gate, the main Me page, and pushed pages. */
export type RootStackParamList = {
  PhoneSignIn: undefined;
  /** Optional `section` deep-links the Me page straight to a sheet section. */
  Home: { section?: HomeSection } | undefined;
  Settings: undefined;
  /** Edit the full publisher profile (name, photo, bio), from Settings. */
  EditProfile: undefined;
  Upload: undefined;
  ReviewSuggestion: undefined;
  /**
   * All media of one feed posting. The feed passes the posting it already has;
   * the "Posted ✅" push only knows the id it just created, so that form is
   * resolved against the feed on mount.
   */
  Posting: { posting: FeedPosting } | { postingId: string };
};

/** Navigation prop for the root stack. */
export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
