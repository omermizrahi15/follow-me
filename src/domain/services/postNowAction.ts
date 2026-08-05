/**
 * What the "Post now" notification action should do with a given notification.
 *
 * The action no longer opens the app — iOS launches it in the background just
 * to deliver the response, and the handler has seconds to act. Deciding *what*
 * to do is a pure function of the notification's payload, so it lives here and
 * the effects (HTTP call, dedupe, fallback notification) stay in the UI layer.
 */

/**
 * The action identifier iOS reports when the "Post now" button is pressed.
 *
 * Owned here, not by the notifier that registers the category: it is the shared
 * vocabulary between the code that *declares* the button and the code that
 * *reacts* to it, and the reacting side lives in the UI layer, which must not
 * reach into infrastructure to learn it (#107).
 */
export const POST_NOW_ACTION = 'POST_NOW';

/** The payload fields the decision depends on. */
export interface PostNowNotification {
  /** Which button was pressed, or the tap-the-body identifier. */
  actionIdentifier: string;
  data: { batchId?: unknown } | undefined;
}

export type PostNowRequest =
  /** Not the "Post now" button — route it as a normal notification. */
  | { kind: 'ignore' }
  /** A server-computed batch: publishable without touching the device. */
  | { kind: 'publish'; batchId: string }
  /** "Post now" on a notification with no server batch behind it. */
  | { kind: 'needs-app' };

/**
 * Classify a notification response.
 *
 * Posting in the background only works when the server already holds the batch
 * (the photos are in the cloud and `approval_batches` names them). The locally
 * scheduled reminder — and any push predating the batchId indirection of issue
 * #71 — carries no batch, so its photos would still have to be picked on the
 * device: that case asks for the app rather than failing silently.
 */
export function postNowRequest(
  notification: PostNowNotification | null,
  postNowActionId: string,
): PostNowRequest {
  if (notification?.actionIdentifier !== postNowActionId) return { kind: 'ignore' };
  const batchId = notification.data?.batchId;
  if (typeof batchId === 'string' && batchId !== '') return { kind: 'publish', batchId };
  return { kind: 'needs-app' };
}
