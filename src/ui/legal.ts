import { Alert, Linking } from 'react-native';

/**
 * The hosted legal documents (issue #7).
 *
 * They live in `docs/` and are served by GitHub Pages from main, so the URL is
 * stable across app releases — which is what App Store Connect requires, and
 * why the policy is a web page rather than a screen bundled with the app: a
 * correction ships by merging a PR, not by waiting for review.
 */
export const PRIVACY_POLICY_URL = 'https://omermizrahi15.github.io/follow-me/privacy/';
export const TERMS_OF_SERVICE_URL = 'https://omermizrahi15.github.io/follow-me/terms/';

/**
 * Opens a legal document in the system browser.
 *
 * Failing silently is not an option here: a publisher who taps "Privacy Policy"
 * and gets nothing has been denied something they are entitled to read, so the
 * URL is shown so it can be opened by hand.
 */
export async function openLegalDocument(title: string, url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(title, `Couldn't open the browser. You can read it at:\n\n${url}`);
  }
}
