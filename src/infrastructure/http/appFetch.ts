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
 * Server work that is genuinely slow: publishing a batch to every follower,
 * clearing a publisher's uploaded candidates. Long deadline, and never retried
 * — these have side effects, and the caller can decide better than we can.
 *
 * Classification used to share this deadline and no longer does; it is a much
 * heavier request than either of these, and it now has its own (see below).
 */
export const slowFetch = resilientFetch({ timeoutMs: 60_000, retries: 0 });

/**
 * Classification. A deadline of its own because the request is unlike anything
 * else here: it carries up to a dozen downscaled photos — a couple of megabytes
 * of base64 — and the function on the other end spends them over as many
 * sequential model calls as the provider's per-call image limit needs, then
 * falls through to the next provider if the first is out of budget.
 *
 * Sixty seconds (the shared slow deadline it used to borrow) is shorter than
 * that on a weak uplink, and giving up early is not free: the function counts
 * the photos against the publisher's daily budget *before* it calls the model,
 * so an abandoned request is budget nobody got a grade for (issue #174).
 *
 * 150s rather than a rounder guess: that is the wall-clock life of a Supabase
 * Edge Function worker, so a request still unanswered by then is one that
 * nothing on the other side is working on any more.
 *
 * Never retried, for the same reason the deadline is long — a repeat charges
 * the budget a second time for an answer the first attempt may already be
 * producing. The classifier decides what to do with the failure.
 */
export const CLASSIFY_TIMEOUT_MS = 150_000;

/** Exported so tests can exercise the shipped settings against a fake clock. */
export const CLASSIFY_FETCH_OPTIONS: ResilientFetchOptions = {
  timeoutMs: CLASSIFY_TIMEOUT_MS,
  retries: 0,
};

export const classifyFetch = resilientFetch(CLASSIFY_FETCH_OPTIONS);
