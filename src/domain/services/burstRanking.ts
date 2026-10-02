import type { PhotoCandidate } from '../entities/PhotoCandidate';

/**
 * Which frame of a burst is the keeper — decided from device metadata alone,
 * with no AI and no pixels.
 *
 * Grading is the scarcest resource this app has (Groq's free tier allows about
 * eight photos a minute), so the one photo per moment that gets graded first
 * had better be the good one. It was not: `gradingOrder` made the EARLIEST
 * frame of each burst the leader, which is close to the worst possible choice —
 * the first frame of a held shutter is the one taken while the phone was still
 * coming up. The AI then spent its budget grading the clumsiest frame of every
 * moment, and the keeper sat in the ungraded tail.
 *
 * Nothing here costs a model call, and nothing here deletes anything. The
 * ranking decides ORDER; every frame stays reachable, which is the lesson from
 * the dedup this replaced — it deleted the rest of each burst, so a trip shot
 * on a held shutter came back as ten photos and a flat "that's all".
 *
 * The signals, strongest first:
 *
 *  1. `isFavorite` — the publisher hearted it. Nothing beats being told.
 *  2. `editedAt` — they cropped or adjusted it. Also being told, less loudly.
 *  3. Bytes per megapixel — the no-AI sharpness proxy. A JPEG stores detail, so
 *     at the same resolution and the same scene a motion-blurred frame
 *     compresses smaller, often by a third. A poor absolute measure of
 *     sharpness and a good relative one, which is all that is asked of it here:
 *     it only ever orders frames of ONE moment, where subject, camera and
 *     lighting are held constant.
 *  4. Recency within the burst — the settled frame at the end beats the one
 *     from while the phone was still moving.
 *
 * The human signals are deliberately unreachable by the proxy: no file, however
 * dense, outranks a photo its owner hearted.
 */

/** Points for a photo the publisher hearted. Above everything else combined. */
const FAVOURITE = 1000;
/** Points for a photo the publisher edited. Above any proxy, below a heart. */
const EDITED = 100;
/**
 * Most a density comparison can be worth.
 *
 * Capped on purpose. Density is a guess about sharpness derived from a
 * compressor's behaviour, and a guess must not be able to outvote the publisher
 * saying "this one" — an unusually noisy frame compresses large for a reason
 * that has nothing to do with being good.
 */
const MAX_DENSITY = 10;
/**
 * Bytes per megapixel treated as "as good as it gets".
 *
 * A modern phone JPEG runs roughly 0.5–2.5 MB per megapixel depending on
 * detail; 2.5 is the top of that range, so anything at or above it earns the
 * full density score and the interesting comparisons happen below it.
 */
const DENSE_BYTES_PER_MP = 2_500_000;

/** Megapixels, or null when the library reported no dimensions. */
function megapixels(photo: PhotoCandidate): number | null {
  const { width, height } = photo;
  if (width == null || height == null) return null;
  if (width <= 0 || height <= 0) return null;
  return (width * height) / 1_000_000;
}

/**
 * How good this frame looks from metadata alone. Higher is better; the number
 * means nothing on its own and is only ever compared within one burst.
 */
export function burstScore(photo: PhotoCandidate): number {
  let score = 0;
  if (photo.isFavorite === true) score += FAVOURITE;
  if (photo.editedAt != null) score += EDITED;

  const mp = megapixels(photo);
  // No size, or no dimensions to divide it by: the proxy has nothing to say,
  // and saying nothing is not the same as scoring zero — a photo the library
  // was quiet about must not be ranked below one it described.
  if (photo.byteSize != null && photo.byteSize > 0 && mp != null && mp > 0) {
    const density = photo.byteSize / mp;
    score += Math.min(MAX_DENSITY, (density / DENSE_BYTES_PER_MP) * MAX_DENSITY);
  }

  return score;
}

/**
 * One burst's frames, best first. Total order, so the also-rans are ranked too
 * — a swap then offers the next best frame of the moment rather than the next
 * oldest.
 */
export function bestFirst(burst: readonly PhotoCandidate[]): PhotoCandidate[] {
  return [...burst].sort((a, b) => {
    const byScore = burstScore(b) - burstScore(a);
    if (byScore !== 0) return byScore;
    // The settled frame at the end of a held shutter, not the one from while
    // the phone was still moving.
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
