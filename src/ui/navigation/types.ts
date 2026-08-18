import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeSection } from './SectionNav';
import type { FeedPosting } from '../data/feed';

/** Top-level stack: auth gate, the main Me page, and pushed pages. */
export type RootStackParamList = {
  PhoneSignIn: undefined;
  /**
   * Optional `section` deep-links the Me page straight to a sheet section.
   *
   * `suggestionRequest` opens the suggested-post sheet — it is how the reminder
   * notification gets there, now that the review screen has one mount path
   * (inline in the sheet) rather than also being a modal route. It carries a
   * nonce rather than a boolean so a second tap, after the publisher has
   * already closed the sheet once, opens it again instead of matching the
   * param that is still set.
   */
  Home: { section?: HomeSection; suggestionRequest?: number } | undefined;
  Settings: undefined;
  /** Edit the full publisher profile (name, photo), from Settings. */
  EditProfile: undefined;
  /** Deleted posts, restorable one by one — from Settings. */
  Trash: undefined;
  Upload: undefined;
  /**
   * All media of one feed posting. The feed passes the posting it already has;
   * the "Posted ✅" push only knows the id it just created, so that form is
   * resolved against the feed on mount.
   */
  Posting: { posting: FeedPosting } | { postingId: string };
};

/** Navigation prop for the root stack. */
export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;
