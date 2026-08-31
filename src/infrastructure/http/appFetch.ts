import { resilientFetch, UPLOAD_TIMEOUT_MS, type ResilientFetchOptions } from './resilientFetch';

/**
 * The three flavours of network call this app actually makes, each with the
 * deadline that suits it. Everything that talks to a server should go through
 * one of them — a bare `fetch` has no deadline at all, and on a phone that has
 * walked out of range it produces a request that never settles and a spinner
 * that never stops (issue #145).
 */

/**
 * Queries and short server calls. Reads (GET/HEAD) get two retries with
 * backoff; anything that changes state is left alone, so a flaky connection
 * cannot turn one write into three.
 *
 * This is also what the Supabase client is built with, which is the cheapest
 * possible coverage: one line, and every table query, auth call and storage
 * request inside the SDK inherits the deadline.
 */
export const appFetch = resilientFetch();

/**
 * Photo uploads. Minutes-long by nature on a phone uplink, so the short
 * deadline would guillotine perfectly healthy transfers.
 *
 * Retried, with POST opted in: a repeat can at worst leave an unused copy in
 * Cloudinary (pruned by the retention job), while giving up strands a photo
 * that the whole posting flow is waiting on.
 *
 * Two retries rather than one, and the second wait is long. Cloudinary's 502s
 * are a gateway wobble measured in seconds, not milliseconds (issue #177), and
 * one retry two seconds later was landing inside the same wobble — close enough
 * to have cost the user their share for a fault that had already passed.
 */
/**
 * Exported so the retry behaviour can be exercised against the same settings
 * the app ships with — building the wrapper at module load leaves nowhere to
 * hand in a test clock.
 */
export const UPLOAD_FETCH_OPTIONS: ResilientFetchOptions = {
  timeoutMs: UPLOAD_TIMEOUT_MS,
  retries: 2,
  backoffMs: [2_000, 8_000],
  retryMethods: ['GET', 'HEAD', 'POST'],
};

export const uploadFetch = resilientFetch(UPLOAD_FETCH_OPTIONS);

/**
 * Server work that is genuinely slow: classifying a photo through Gemini,
 * publishing a batch to every follower. Long deadline, and never retried —
 * these have side effects, and the caller can decide better than we can.
 */
export const slowFetch = resilientFetch({ timeoutMs: 60_000, retries: 0 });
