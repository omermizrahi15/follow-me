import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoCategory, PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IPhotoClassifier } from '../../domain/interfaces';

/** Wire shape sent to the classify-photos Edge Function for one photo. */
export interface PhotoPayload {
  id: string;
  url?: string;
  base64?: string;
  mimeType?: string;
}

/**
 * Maps a candidate to the bytes/reference the function should classify.
 * - In React Native, inject a reader that loads base64 from the local `uri`.
 * - The default passes `uri` through as a public URL (used by the integration
 *   test against hosted sample images).
 */
export type ResolvePayload = (candidate: PhotoCandidate) => Promise<PhotoPayload>;

const defaultResolve: ResolvePayload = candidate =>
  Promise.resolve({ id: candidate.id, url: candidate.uri });

interface RawClassification {
  id: string;
  category: PhotoCategory;
  confidence: number;
  quality: number;
  caption: string;
}

/**
 * IPhotoClassifier backed by the Supabase `classify-photos` Edge Function (which
 * calls Gemini). This class is pure transport: no provider SDK, no API key — the
 * key lives only in the function. Swapping the AI provider never touches this file.
 */
export class GeminiPhotoClassifier implements IPhotoClassifier {
  constructor(
    private readonly functionUrl: string,
    private readonly authKey: string,
    private readonly resolve: ResolvePayload = defaultResolve,
  ) {}

  async classify(candidates: PhotoCandidate[]): Promise<PhotoClassification[]> {
    if (candidates.length === 0) return [];

    const byId = new Map(candidates.map(c => [c.id, c]));
    const photos = await Promise.all(candidates.map(c => this.resolve(c)));

    const res = await fetch(this.functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authKey}`,
        apikey: this.authKey,
      },
      body: JSON.stringify({ photos }),
    });

    if (!res.ok) {
      throw new Error(`classify-photos failed (${res.status}): ${await res.text()}`);
    }

    const body = (await res.json()) as { classifications?: RawClassification[] };
    const raw = body.classifications ?? [];

    return raw
      .map((r): PhotoClassification | null => {
        const candidate = byId.get(r.id);
        if (candidate == null) return null;
        return {
          candidate,
          category: r.category,
          confidence: r.confidence,
          quality: r.quality,
          caption: r.caption,
        };
      })
      .filter((c): c is PhotoClassification => c !== null);
  }
}
