// Deno mirror of composeNotificationBody (src/domain/services/notificationBody.ts),
// trimmed for the autonomous path: candidate photos are images with no location,
// so the body is the photos headline (+ optional chat link).

export interface GalleryLink {
  url: string;
  photoCount: number;
}

export function composeAutoPostBody(
  publisherName: string,
  publisherPhone?: string,
  gallery?: GalleryLink | null,
  place?: string | null,
): string {
  const headline = place != null && place.trim() !== ''
    ? `Check out ${publisherName}'s latest photos from ${place.trim()} 📸`
    : `Check out ${publisherName}'s latest photos 📸`;
  const lines = [headline];
  if (gallery != null) {
    lines.push(`See all ${gallery.photoCount} photos: ${gallery.url}`);
  }
  if (publisherPhone != null && publisherPhone !== '') {
    const waPhone = publisherPhone.replace(/^\+/, '');
    lines.push(`Hit the link to reply to ${publisherName}: https://wa.me/${waPhone}`);
  }
  return lines.join('\n');
}
