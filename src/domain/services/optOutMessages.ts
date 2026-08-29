// Confirmation copy sent to a subscriber at each step of their lifecycle:
// subscribing, opting out (STOP) and opting back in (START). Kept as pure
// functions, alongside composeNotificationBody, so the exact wording is
// unit-tested and shared by every sender.
//
// DUAL RUNTIME — the `subscribe` and `join-webhook` Edge Functions reply with
// these too, and import this exact file. Keep it import-free; see
// CONTRIBUTING.md.

/**
 * The welcome a follower gets the moment they subscribe.
 *
 * `galleryUrl` is the publisher's feed — every post they have shared, not just
 * the ones sent from now on — so a follower who joins today can still see what
 * they missed. Build it with `publisherGalleryUrl`; it is passed in rather than
 * derived here because this file must stay import-free (dual runtime).
 *
 * MIRRORED by the `follow_me_subscriber_welcome_2` WhatsApp template (issue
 * #164): on the production sender the follower has never messaged us — they
 * typed their number on the join page — so there is no 24h session window and
 * this text can only be delivered as a template. `welcomeTemplate.test.ts`
 * pins the two together; re-cut both at once (a body change means another
 * round of Meta approval). The link is the template's `{{2}}` and sits on the
 * second-to-last line on purpose: Meta rejects a body ending in a variable.
 */
export function composeWelcomeMessage(publisherName: string, galleryUrl: string): string {
  return (
    `You're following ${publisherName}.\n` +
    "New photos will arrive right here on WhatsApp.\n" +
    `See everything they've shared so far: ${galleryUrl}\n` +
    'Reply STOP to unsubscribe at any time.'
  );
}

export function composeUnsubscribeConfirmation(publisherName: string): string {
  return `You've been unsubscribed from ${publisherName}. Reply START to re-subscribe.`;
}

export function composeResubscribeConfirmation(publisherName: string): string {
  return `You're following ${publisherName} again. Reply STOP at any time to unsubscribe.`;
}
