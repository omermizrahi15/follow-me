import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
// eslint-disable-next-line import/no-restricted-paths -- pre-existing violation (#107): POST_NOW_ACTION is a shared constant that belongs in domain, not in the notifier. Waived until it moves.
import { POST_NOW_ACTION } from '../../infrastructure/notifiers/NotificationCategories';
import { postNowRequest as decidePostNow, type PostNowRequest } from '../../domain/services/postNowAction';
import { publishApprovalBatch } from '../../composition/container';

/**
 * The "Post now" notification action, handled without opening the app.
 *
 * The button is registered with `opensAppToForeground: false`, so iOS launches
 * the app in the background purely to deliver the response. Everything here has
 * to survive that: no navigation, no React, no media-library access, and only a
 * few seconds of runtime. It works because the batch's photos are already in
 * the cloud — the whole job is one call to /post-batch, and the server sends
 * the "Posted ✅" push when the fan-out lands.
 */

/** Keyed per batch so a redelivered response is dropped, not re-posted. */
const HANDLED_PREFIX = 'post-now-handled:';

/** What a notification response asks of the background handler (see the domain rule). */
export function postNowRequest(response: Notifications.NotificationResponse | null): PostNowRequest {
  if (response == null) return { kind: 'ignore' };
  return decidePostNow(
    {
      actionIdentifier: response.actionIdentifier,
      data: response.notification.request.content.data as { batchId?: unknown } | undefined,
    },
    POST_NOW_ACTION,
  );
}

async function alreadyHandled(batchId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(`${HANDLED_PREFIX}${batchId}`)) != null;
  } catch {
    // The server is idempotent on its own; a storage miss just means we make a
    // call that turns into a no-op there.
    return false;
  }
}

async function markHandled(batchId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${HANDLED_PREFIX}${batchId}`, String(Date.now()));
  } catch {
    /* see alreadyHandled — the server latch is the real guard */
  }
}

/** Local nudge for the case the background path can't serve (no server batch). */
async function askToOpenApp(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Almost there',
      body: 'These photos need to be picked on your phone — tap to review and post.',
      data: { screen: 'ReviewSuggestion' },
    },
    trigger: null,
  });
}

/**
 * Run the "Post now" action for a response. Returns true when it consumed the
 * response, so callers know not to route it as a normal notification tap.
 *
 * Never throws: this runs in a background launch where an unhandled rejection
 * is invisible. A failed publish is reported to the publisher by the server's
 * own failure push.
 */
export async function handlePostNowResponse(
  response: Notifications.NotificationResponse | null,
): Promise<boolean> {
  const request = postNowRequest(response);
  if (request.kind === 'ignore') return false;

  if (request.kind === 'needs-app') {
    await askToOpenApp().catch(() => undefined);
    return true;
  }

  if (await alreadyHandled(request.batchId)) return true;
  // Marked before the call, not after: a background launch can be suspended
  // mid-request, and a duplicate send is worse than a missed retry (the server
  // latch makes a genuine retry harmless anyway).
  await markHandled(request.batchId);

  try {
    await publishApprovalBatch(request.batchId);
  } catch (err) {
    if (__DEV__) console.warn('[post-now] publish failed', err);
  }
  return true;
}
