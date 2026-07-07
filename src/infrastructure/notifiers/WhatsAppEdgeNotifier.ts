import type { INotifier } from '../../domain/interfaces';
import type { Media } from '../../domain/entities/Media';
import type { Subscriber } from '../../domain/entities/Subscriber';

/**
 * INotifier that delegates WhatsApp delivery to the `send-post` Edge Function,
 * keeping Twilio credentials server-side (issue #24). One call per subscriber —
 * the server composes the caption and sends the media batch.
 */
export class WhatsAppEdgeNotifier implements INotifier {
  constructor(
    private readonly functionUrl: string,
    private readonly authKey: string,
  ) {}

  async notify(subscriber: Subscriber, media: Media[]): Promise<void> {
    const first = media[0];
    if (first == null) return;
    const res = await fetch(this.functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authKey}`,
        apikey: this.authKey,
      },
      body: JSON.stringify({
        publisherId: first.ownerId,
        to: subscriber.contactHandle,
        mediaUrls: media.map(m => m.url),
        // The posting's place — the server weaves it into the caption
        // ("Check out X's latest photos from Lisbon, Portugal 📸").
        ...(first.location != null ? { place: first.location } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`send-post failed (${res.status}): ${await res.text()}`);
    }
  }
}
