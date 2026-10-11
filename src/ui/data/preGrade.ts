import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadConfig, preGradePhotos, reportError } from '../../composition/container';
import { singleFlight } from '../../application/services/singleFlight';
import { isPhotoSyncEnabled } from './photoSyncConsent';

/**
 * Grades the publisher's recent photos while they are not looking, so the review
 * screen opens onto a finished post instead of a progress bar.
 *
 * Triggered from the same places as the cloud sync — launch, foreground, and
 * iOS's periodic background task — but throttled harder, because this one spends
 * AI budget rather than bandwidth:
 *  - at most one run per `MIN_INTERVAL_MS`;
 *  - after hitting the daily quota or a provider's rate wall, a longer rest —
 *    asking again an hour later only finds the same closed door;
 *  - a run that never started (a live scan had the classifier) costs nothing.
 *
 * Gated on the same consent as the cloud sync: the publisher agreed to their
 * photos being processed, and background work must not widen that.
 */
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
const WALLED_INTERVAL_MS = 6 * 60 * 60 * 1000;
const NEXT_RUN_KEY = 'pre-grade-next-run-v1';

async function once(publisherId: string): Promise<void> {
  if (!(await isPhotoSyncEnabled())) return;
  const notBefore = Number(await AsyncStorage.getItem(NEXT_RUN_KEY)) || 0;
  if (Date.now() < notBefore) return;

  const config = await loadConfig.execute(publisherId);
  const outcome = await preGradePhotos.execute(config);
  if (outcome === 'busy') return;
  const rest = outcome === 'walled' ? WALLED_INTERVAL_MS : MIN_INTERVAL_MS;
  await AsyncStorage.setItem(NEXT_RUN_KEY, String(Date.now() + rest));
}

const runOnce = singleFlight(once);

/**
 * Never rejects: grading ahead is an optimisation, and a failure costs the
 * publisher nothing they did not already have — the live scan does the work as
 * it always did. It is reported rather than swallowed so a pre-grade that never
 * works is visible. A failure leaves no stamp, so the next trigger retries.
 */
export async function runPreGradeQuietly(publisherId: string, operation: string): Promise<void> {
  try {
    await runOnce(publisherId);
  } catch (err) {
    reportError(err, operation);
  }
}
