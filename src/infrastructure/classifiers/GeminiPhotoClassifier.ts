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
 * - Return null to skip a candidate (e.g. when the local file isn't available).
 */
export type ResolvePayload = (candidate: PhotoCandidate) => Promise<PhotoPayload | null>;

const defaultResolve: ResolvePayload = candidate =>
  Promise.resolve({ id: candidate.id, url: candidate.uri });

interface RawClassification {
  id: string;
  category: PhotoCategory;
  confidence: number;
  quality: number;
  caption: string;
  /** May be omitted by older deployments of the classify function. */
  scene?: string;
}

/**
 * IPhotoClassifier backed by the Supabase `classify-photos` Edge Function (which
 * calls Gemini). Photos are classified in parallel batches of CONCURRENCY so the
 * wall-clock time scales as total/CONCURRENCY rather than total×latency.
 *
 * Each Edge Function call handles exactly one photo (one Gemini call), so no
 * single worker hits memory or CPU limits. The caller gets per-result progress
 * via `onEach` and can abort early via `shouldStop` once the quota is met.
 */
export class GeminiPhotoClassifier implements IPhotoClassifier {
  /**
   * Maximum Edge Function calls in flight at once. Uses a sliding window so a
   * slow photo never blocks other slots — as soon as one finishes, the next
   * starts, keeping CONCURRENCY calls running at all times. Kept moderate:
   * each request uploads a multi-MB base64 body, and too many concurrent
   * uploads saturate a phone connection ("Network request failed").
   */
  private static readonly CONCURRENCY = 4;

  /** Attempts per photo — transient network drops get one retry. */
  private static readonly MAX_ATTEMPTS = 2;

  constructor(
    private readonly functionUrl: string,
    private readonly authKey: string,
    private readonly resolve: ResolvePayload = defaultResolve,
  ) {}

  async classify(
    candidates: PhotoCandidate[],
    onEach?: (result: PhotoClassification, index: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<PhotoClassification[]> {
    if (candidates.length === 0) return [];

    const total = candidates.length;
    const results: PhotoClassification[] = [];

    return new Promise<PhotoClassification[]>(resolve => {
      let nextIdx = 0;
      let inFlight = 0;
      let settled = false;

      const finish = (): void => {
        if (!settled) {
          settled = true;
          resolve(results);
        }
      };

      const startNext = (): void => {
        // Fill all free slots up to CONCURRENCY.
        while (!settled && inFlight < GeminiPhotoClassifier.CONCURRENCY && nextIdx < candidates.length) {
          const candidate = candidates[nextIdx++];
          if (candidate == null) continue;
          inFlight++;

          void this.classifyOne(candidate).then(result => {
            inFlight--;
            if (settled) return;

            if (result != null) {
              results.push(result);
              onEach?.(result, results.length, total);
            }

            if ((shouldStop?.() ?? false) || (inFlight === 0 && nextIdx >= candidates.length)) {
              finish();
            } else {
              startNext();
            }
          });
        }

        // Edge case: all candidates exhausted before all slots fired.
        if (!settled && inFlight === 0 && nextIdx >= candidates.length) finish();
      };

      startNext();
    });
  }

  private async classifyOne(c: PhotoCandidate): Promise<PhotoClassification | null> {
    let payload: PhotoPayload | null = null;
    try {
      payload = await this.resolve(c);
    } catch {
      return null;
    }
    if (payload == null) return null;

    const body = JSON.stringify({ photos: [payload] });

    for (let attempt = 1; attempt <= GeminiPhotoClassifier.MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(this.functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.authKey}`,
            apikey: this.authKey,
          },
          body,
        });

        if (!res.ok) {
          console.warn(`classify-photos failed for ${c.id} (${res.status}): ${await res.text()}`);
          return null;
        }

        const parsed = (await res.json()) as { classifications?: RawClassification[] };
        const raw = parsed.classifications?.[0];
        if (!raw || raw.id !== c.id) return null;

        return {
          candidate: c,
          category: raw.category,
          confidence: raw.confidence,
          quality: raw.quality,
          caption: raw.caption,
          scene: raw.scene ?? '',
        };
      } catch (err) {
        // Network-level failure (upload dropped mid-flight) — retry once.
        if (attempt === GeminiPhotoClassifier.MAX_ATTEMPTS) {
          console.warn(`classify-photos error for ${c.id}:`, err);
        }
      }
    }
    return null;
  }
}
