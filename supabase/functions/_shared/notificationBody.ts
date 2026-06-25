// Deno mirror of composeNotificationBody (src/domain/services/notificationBody.ts),
// trimmed for the autonomous path: candidate photos are images with no location,
// so the body is the photos headline (+ optional chat link).

export function composeAutoPostBody(publisherName: string, publisherPhone?: string): string {
  const headline = `Checkout ${publisherName} latest photos 📸`;
  if (publisherPhone == null || publisherPhone === '') return headline;
  const waPhone = publisherPhone.replace(/^\+/, '');
  return `${headline}\nChat with ${publisherName}: https://wa.me/${waPhone}`;
}
