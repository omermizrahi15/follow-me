import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoCategory, PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IPhotoClassifier } from '../../domain/interfaces';
import { slowFetch } from '../http/appFetch';
import { sleep } from '../timers';

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

/**
 * The AI could not grade a photo, and no grade should be invented for it.
 *
 * Distinct from a photo that simply could not be *read* — an iCloud original
 * that never came down is a property of that one photo, and skipping it costs
 * one suggestion. This error means the classifier itself is not working, so
 * every remaining photo would fail the same way. It aborts the scan rather
 * than letting a half-graded window be presented as a finished post.
 */
export class ClassificationFailedError extends Error {
  constructor(
    readonly candidateId: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ClassificationFailedError';
  }
}

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

  /**
   * Wait before the retry. The old loop went straight back out on the failed
   * connection, which on a phone that has just lost signal is two failures in
   * the time of one — and on a rate-limited quota, two rejections (issue #145).
   */
  private static readonly RETRY_DELAY_MS = 800;

  constructor(
    private readonly functionUrl: string,
    private readonly authKey: string,
    private readonly resolve: ResolvePayload = defaultResolve,
    /**
     * Supplies the signed-in user's JWT — the classify function rejects the
     * bare anon key (quota/cost-sensitive endpoint). Falls back to authKey
     * when absent (tests / integration harness).
     */
    private readonly getAccessToken?: () => Promise<string | null>,
    /**
     * Called once per run when the daily quota rejects a request. Injected
     * rather than imported: hard-wiring the monitoring SDK in here would drag
     * @sentry/react-native — which ships ESM — into every test that touches
     * this class, and the composition root is where implementations get chosen.
     */
    private readonly onQuotaExhausted?: (photosInRun: number) => void,
  ) {}

  /**
   * Set when the function answers 429 (per-user daily quota, migration
   * 20240015). Reset per classify() call so it always describes the latest run.
   */
  private hitQuota = false;

  /** Photos the current classify() run started with — reported alongside a quota hit. */
  private runSize = 0;

  quotaExhausted(): boolean {
    return this.hitQuota;
  }

  async classify(
    candidates: PhotoCandidate[],
    onEach?: (result: PhotoClassification, index: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<PhotoClassification[]> {
    this.hitQuota = false;
    this.runSize = candidates.length;
    if (candidates.length === 0) return [];

    const total = candidates.length;
    const results: PhotoClassification[] = [];

    return new Promise<PhotoClassification[]>((resolve, reject) => {
      let nextIdx = 0;
      // Every candidate ends in exactly one `completed++`, so the promise
      // provably settles when completed reaches total (or on early stop).
      let completed = 0;
      let settled = false;

      const finish = (): void => {
        if (!settled) {
          settled = true;
          resolve(results);
        }
      };

      // A classifier that is erroring will error on every remaining photo, so
      // the first failure ends the run. Workers already in flight keep running
      // but their results are dropped by the `settled` guard.
      const fail = (err: unknown): void => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const inFlight = (): number => nextIdx - completed;

      const launch = (): void => {
        while (
          !settled &&
          // Once the day's budget is gone every further request is a wasted
          // round trip that answers 429 — stop feeding the queue.
          !this.hitQuota &&
          inFlight() < GeminiPhotoClassifier.CONCURRENCY &&
          nextIdx < total
        ) {
          const candidate = candidates[nextIdx++];
          if (candidate == null) {
            // Impossible for a dense array, but keeps the completed invariant.
            completed++;
            continue;
          }

          void this.classifyOne(candidate).then(result => {
            completed++;
            if (settled) return;

            if (result != null) {
              results.push(result);
              onEach?.(result, results.length, total);
            }

            if ((shouldStop?.() ?? false) || completed >= total || this.hitQuota) {
              finish();
            } else {
              launch();
            }
          }, fail);
        }

        if (!settled && completed >= total) finish();
      };

      launch();
    });
  }

  /**
   * Grades one photo.
   *
   * Returns null only for the two soft cases — a photo whose bytes could not
   * be read at all, and a run that has hit the daily quota. Everything else
   * throws: a classifier that is answering with errors must not be smoothed
   * over into "this photo isn't very good".
   */
  private async classifyOne(c: PhotoCandidate): Promise<PhotoClassification | null> {
    let payload: PhotoPayload | null = null;
    try {
      payload = await this.resolve(c);
    } catch {
      // Unreadable, not a classifier failure — the caller counts it and moves on.
      return null;
    }
    if (payload == null) return null;

    const body = JSON.stringify({ photos: [payload] });
    const userToken = (await this.getAccessToken?.().catch(() => null)) ?? null;
    const bearer = userToken ?? this.authKey;

    let lastNetworkError: unknown;
    for (let attempt = 1; attempt <= GeminiPhotoClassifier.MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await slowFetch(this.functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bearer}`,
            apikey: this.authKey,
          },
          body,
        });
      } catch (err) {
        // Network-level failure (upload dropped mid-flight) — retry once, then
        // give up and let it surface.
        lastNetworkError = err;
        if (attempt < GeminiPhotoClassifier.MAX_ATTEMPTS) {
          await sleep(GeminiPhotoClassifier.RETRY_DELAY_MS);
        }
        continue;
      }

      // 429 is the daily quota, not a broken classifier: the grades already in
      // hand are real and worth keeping, and the caller reports the wall in its
      // own words ("today's AI limit ran out after N photos"). Soft on purpose.
      if (res.status === 429) {
        if (!this.hitQuota) {
          this.hitQuota = true;
          // Reported once per run, not once per photo: a quota wall trips
          // every in-flight request, and N identical events per scan would
          // drown the signal we actually want — how often real publishers
          // hit the ceiling, which nothing throws and no stack trace shows.
          this.onQuotaExhausted?.(this.runSize);
        }
        console.warn(`classify-photos quota reached for ${c.id}`);
        return null;
      }

      if (!res.ok) {
        throw new ClassificationFailedError(
          c.id,
          `classify-photos returned ${res.status}: ${await res.text().catch(() => '<unreadable body>')}`,
        );
      }

      let parsed: { classifications?: RawClassification[] };
      try {
        parsed = (await res.json()) as { classifications?: RawClassification[] };
      } catch (err) {
        // A 200 we cannot parse is a broken contract, not a flaky upload — a
        // retry would just produce the same unusable body.
        throw new ClassificationFailedError(c.id, 'classify-photos returned an unreadable body', err);
      }

      const raw = parsed.classifications?.[0];
      if (!raw || raw.id !== c.id) {
        throw new ClassificationFailedError(c.id, 'classify-photos returned no grade for this photo');
      }

      return {
        candidate: c,
        category: raw.category,
        confidence: raw.confidence,
        quality: raw.quality,
        caption: raw.caption,
        scene: raw.scene ?? '',
      };
    }

    throw new ClassificationFailedError(
      c.id,
      `classify-photos unreachable after ${GeminiPhotoClassifier.MAX_ATTEMPTS} attempts`,
      lastNetworkError,
    );
  }
}
