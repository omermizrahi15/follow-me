import type { Media } from '../entities/Media';

export function composeNotificationBody(publisherName: string, media: Media[], publisherPhone?: string): string {
  const locationClause = formatLocationClause(selectTopLocations(media));
  const locationPart = locationClause != null ? ` from ${locationClause}` : '';
  const headline = `Checkout ${publisherName} latest photos${locationPart} 📸`;
  if (publisherPhone == null) return headline;
  const waPhone = publisherPhone.replace(/^\+/, '');
  return `${headline}\nChat with ${publisherName}: https://wa.me/${waPhone}`;
}

export function selectTopLocations(media: Media[]): string[] {
  const counts = new Map<string, number>();
  for (const m of media) {
    if (m.location != null) {
      counts.set(m.location, (counts.get(m.location) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([location]) => location);
}

export function formatLocationClause(locations: string[]): string | null {
  const [first, second, ...rest] = locations;
  if (first == null) return null;
  if (second == null) return first;
  if (rest.length === 0) return `${first} & ${second}`;
  return `${first}, ${second} and more`;
}
