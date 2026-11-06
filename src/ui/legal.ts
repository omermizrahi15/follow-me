import { Alert, Linking } from 'react-native';
import { siteUrls } from '../domain/services/siteUrls';

/**
 * The hosted legal documents (issue #7).
 *
 * They live in `docs/` and are served by GitHub Pages from main, so the URL is
 * stable across app releases — which is what App Store Connect requires, and
 * why the policy is a web page rather than a screen bundled with the app: a
 * correction ships by merging a PR, not by waiting for review.
 */
// The host comes from EXPO_PUBLIC_SITE_URL (see siteUrls) so a custom domain is a build var, not a code change.
const SITE = siteUrls(process.env.EXPO_PUBLIC_SITE_URL as string | undefined);
export const PRIVACY_POLICY_URL = SITE.privacy;
export const TERMS_OF_SERVICE_URL = SITE.terms;

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
