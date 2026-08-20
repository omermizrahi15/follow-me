import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoCategory, PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { FaceReference, IPhotoClassifier } from '../../domain/interfaces';

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

/**
 * Why classify-photos answered 429.
 *
 * `rate_limited` is Gemini's per-minute cap on the shared API key and clears in
 * seconds; `daily_quota` is our own per-user ceiling and lasts until tomorrow.
 * They shared a bare 429 with nothing to tell them apart, which is what made a
 * half-minute pause read as "come back tomorrow" on the first scan of the day.
 */
interface Refusal {
  reason: 'rate_limited' | 'daily_quota';
  retryAfterSeconds: number;
}

/**
 * Reads the reason off a 429.
 *
 * Falls back to `daily_quota` when the body says nothing — an older deployment
 * of the function, which only ever sent the bare daily-quota 429. Guessing
 * `rate_limited` there would make the app wait and retry against a wall that
 * genuinely lasts until tomorrow.
 */
async function readRefusal(res: Response): Promise<Refusal> {
  const body = (await res.json().catch(() => null)) as {
    reason?: unknown;
    retry_after_seconds?: unknown;
  } | null;
  const seconds = Number(body?.retry_after_seconds);
  return {
    reason: body?.reason === 'rate_limited' ? 'rate_limited' : 'daily_quota',
    // Zero is a real answer ("the window is open again"), so it must survive
    // the fallback — only a missing or nonsensical value gets the default.
    retryAfterSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : 30,
  };
}

interface RawClassification {
  id: string;
  category: PhotoCategory;
  confidence: number;
  quality: number;
  caption: string;
  /** May be omitted by older deployments of the classify function. */
  scene?: string;
  /**
   * Both omitted by any deployment that predates issue #137, and by every
   * request that carried no reference. Absent reads as "not known to contain
   * the publisher", which is the same thing the selection rules do with false.
   */
  contains_reference_person?: boolean;
  reference_confidence?: number;
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
   * How many times one photo will sit out a rate-limit window before the run
   * gives up on it. Three waits covers the ordinary case — a burst trips the
   * per-minute cap, the window reopens, the scan finishes — without leaving a
   * publisher staring at a progress bar for minutes because the key is
   * genuinely saturated.
   */
  private static readonly MAX_RATE_LIMIT_WAITS = 3;

  /** Longest single wait honoured, whatever the server asks for. */
  private static readonly MAX_RATE_LIMIT_WAIT_MS = 60_000;

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

  /**
   * Set when the run gave up waiting on Gemini's per-minute cap. Distinct from
   * `hitQuota`: this one says "busy, try again shortly", not "come back
   * tomorrow", and conflating the two is the whole of issue #141.
   */
  private hitRateLimit = false;

  /**
   * When the next request may go out, as an epoch ms. Shared by every in-flight
   * worker so a tripped rate limit pauses the whole run rather than the one
   * photo that happened to hit it.
   */
  private rateLimitedUntil = 0;

  quotaExhausted(): boolean {
    return this.hitQuota;
  }

  rateLimited(): boolean {
    return this.hitRateLimit;
  }

  /**
   * Whether the run has hit a wall that every remaining photo would hit too.
   * Once either is set, further requests are wasted round trips — stop feeding
   * the queue and keep what has already been graded.
   */
  private stopped(): boolean {
    return this.hitQuota || this.hitRateLimit;
  }

  /** Hold every worker back until `seconds` from now. */
  private pauseFor(seconds: number): void {
    const wait = Math.min(seconds * 1000, GeminiPhotoClassifier.MAX_RATE_LIMIT_WAIT_MS);
    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + wait);
  }

  /** Resolves once the current rate-limit window (if any) has passed. */
  private async awaitRateLimitWindow(): Promise<void> {
    const remaining = this.rateLimitedUntil - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }

  async classify(
    candidates: PhotoCandidate[],
    onEach?: (result: PhotoClassification, index: number, total: number) => void,
    shouldStop?: () => boolean,
    reference?: FaceReference | null,
  ): Promise<PhotoClassification[]> {
    this.hitQuota = false;
    this.hitRateLimit = false;
    this.rateLimitedUntil = 0;
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
          !this.stopped() &&
          inFlight() < GeminiPhotoClassifier.CONCURRENCY &&
          nextIdx < total
        ) {
          const candidate = candidates[nextIdx++];
          if (candidate == null) {
            // Impossible for a dense array, but keeps the completed invariant.
            completed++;
            continue;
          }

          void this.classifyOne(candidate, reference ?? null).then(result => {
            completed++;
            if (settled) return;

            if (result != null) {
              results.push(result);
              onEach?.(result, results.length, total);
            }

            if ((shouldStop?.() ?? false) || completed >= total || this.stopped()) {
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
  private async classifyOne(
    c: PhotoCandidate,
    reference: FaceReference | null,
  ): Promise<PhotoClassification | null> {
    let payload: PhotoPayload | null = null;
    try {
      payload = await this.resolve(c);
    } catch {
      // Unreadable, not a classifier failure — the caller counts it and moves on.
      return null;
    }
    if (payload == null) return null;

    // The reference travels as a URL, never as bytes: the profile photo is
    // already hosted (it is what followers see on the gallery), so there is
    // nothing to upload and nothing extra leaves the device.
    const body = JSON.stringify({
      photos: [payload],
      ...(reference != null ? { reference: { url: reference.url } } : {}),
    });
    const userToken = (await this.getAccessToken?.().catch(() => null)) ?? null;
    const bearer = userToken ?? this.authKey;

    let lastNetworkError: unknown;
    let networkAttempts = 0;
    let rateLimitWaits = 0;

    while (networkAttempts < GeminiPhotoClassifier.MAX_ATTEMPTS) {
      // Every worker sits out a rate-limit window, not only the one that hit it:
      // with four photos in flight against a five-per-minute ceiling, letting
      // the others keep firing just spends the next window before it opens.
      await this.awaitRateLimitWindow();

      networkAttempts++;
      let res: Response;
      try {
        res = await fetch(this.functionUrl, {
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
        continue;
      }

      if (res.status === 429) {
        const refusal = await readRefusal(res);

        // Gemini's per-minute cap, which clears on its own in seconds. This is
        // the overwhelmingly common 429 and it used to be indistinguishable
        // from the daily ceiling, so the app told publishers to come back
        // tomorrow on the first scan of the day — while the very next request
        // would have succeeded. Wait the window out and try the same photo again.
        if (refusal.reason === 'rate_limited' && rateLimitWaits < GeminiPhotoClassifier.MAX_RATE_LIMIT_WAITS) {
          rateLimitWaits++;
          // A throttled request never reached the model, so it must not spend
          // one of the two attempts reserved for genuine network trouble.
          networkAttempts--;
          this.pauseFor(refusal.retryAfterSeconds);
          continue;
        }

        // Still throttled after waiting as long as we're willing to. Soft-stop
        // the run like the quota wall — the grades in hand are real — but say
        // "busy", because tomorrow has nothing to do with it.
        if (refusal.reason === 'rate_limited') {
          this.hitRateLimit = true;
          console.warn(`classify-photos still rate limited for ${c.id} after ${rateLimitWaits} waits`);
          return null;
        }

        // The daily quota: our own per-user ceiling. The grades already in hand
        // are real and worth keeping, and the caller reports the wall in its own
        // words ("today's AI limit ran out after N photos"). Soft on purpose.
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
        containsPublisher: raw.contains_reference_person === true,
        publisherConfidence: raw.reference_confidence ?? 0,
      };
    }

    throw new ClassificationFailedError(
      c.id,
      `classify-photos unreachable after ${GeminiPhotoClassifier.MAX_ATTEMPTS} attempts`,
      lastNetworkError,
    );
  }
}
