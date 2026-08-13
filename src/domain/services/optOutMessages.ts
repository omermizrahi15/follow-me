// Confirmation copy sent back to a subscriber after they opt out (STOP) or opt
// back in (START). Kept as pure functions, alongside composeNotificationBody,
// so the exact wording is unit-tested and shared by every sender.
//
// DUAL RUNTIME — the `join-webhook` Edge Function replies with these too, and
// imports this exact file. Keep it import-free; see CONTRIBUTING.md.

export function composeUnsubscribeConfirmation(publisherName: string): string {
  return `You've been unsubscribed from ${publisherName}. Reply START to re-subscribe.`;
}

export function composeResubscribeConfirmation(publisherName: string): string {
  return `You're following ${publisherName} again. Reply STOP at any time to unsubscribe.`;
}
