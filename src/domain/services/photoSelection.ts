/**
 * Which photos make the next post — the pure core of the product.
 *
 * DUAL RUNTIME. This module is the single implementation of the selection
 * rules: the React Native app reaches it through `PhotoSelectionService`, and
 * the Deno `auto-post` Edge Function imports this exact file. It must therefore
 * stay import-free and free of platform globals — see CONTRIBUTING.md.
 *
 * The two runtimes hold a classified photo in different shapes (the app has a
 * `PhotoClassification` with a nested candidate and a `Date`; the server has a
 * flat database row with epoch millis), so rather than convert either one,
 * callers pass a `facts` projection and get their own objects back.
 *
 * Selection is ONE ranking, not a sequence of passes:
 *
 *     score = quality × categoryWeight(category) × publisherWeight(containsPublisher)
 *
 * Quality dominates and the two preferences tilt. That ordering is deliberate:
 * a top-quality photo in the publisher's *last* category still outranks a
 * merely-good one in their first, so priority settles near-ties instead of
 * overruling the grade (see LAST_WEIGHT for why the spread is narrow).
 *
 * This replaced a round-robin that dealt one photo per category in turn. The
 * round-robin was diversity-first by construction, which meant a 0.9 sunset
 * could lose its slot to a 0.4 plate of food purely because it was food's turn
 * — and no amount of grading could fix it, because the grade was never what
 * decided. It also needed three fallback passes to avoid returning an empty
 * post. Ranking needs none: `other` simply carries a low weight and sinks to
 * the bottom on its own, so it is reached only when nothing better exists.
 */

/** Everything the selection rules need to know about one photo. */
export interface PhotoFacts {
  /** Stable asset id — what `alreadySent` is keyed on. */
  id: string;
  category: string;
  /** Aesthetic/technical quality, 0..1. */
  quality: number;
  /** When the photo was taken, epoch millis. */
  createdAt: number;
  /**
   * 2-4 word slug identifying the scene or subject ("beach-sunset"). Photos of
   * the same moment share a slug so they can be deduplicated. Empty when the
   * classifier didn't produce one, which opts the photo out of scene capping.
   */
  scene: string;
  /**
   * Whether the publisher themselves is in the photo (issue #137).
   *
   * Only meaningful when the rules ask for it: it is false both for "they are
   * not in this one" and for "nobody asked", because the classifier is only
   * sent a reference image when the preference is on. Read exclusively under a
   * non-`off` {@link SelectionRules.photosOfMe}, where the two cases coincide.
   */
  containsPublisher?: boolean;
}

/** See PhotosOfMe on PublisherConfig — restated here to keep this module import-free. */
export type PhotosOfMeMode = 'off' | 'prefer' | 'only';

export interface SelectionRules {
  /** Categories to draw from, in priority order (earlier = weighted higher). */
  enabledCategories: readonly string[];
  photosPerPost: number;
  /**
   * Quality floor, 0..1. A photo below it is never put in a post.
   *
   * The publisher sets this, so it is honoured strictly — a window with
   * nothing above the floor yields a short post, and the review screen says
   * so, rather than quietly padding with photos they told us they didn't want.
   * (This field existed on PublisherConfig for a long time and was read by
   * nothing at all; the floor was purely decorative.)
   */
  minQuality?: number;
  /** Most photos allowed to share one scene slug. Default {@link DEFAULT_MAX_PER_SCENE}. */
  maxPerScene?: number;
  /**
   * How much the publisher's own presence counts for. Default `off`, which is
   * exactly the behaviour every caller had before issue #137.
   */
  photosOfMe?: PhotosOfMeMode;
}

/**
 * The classifier's catch-all: screenshots, receipts, blurry shots, and every
 * ordinary photo that isn't travel-shaped.
 */
const FALLBACK_CATEGORY = 'other';

/** Weight of the publisher's highest-priority category. */
const TOP_WEIGHT = 1;
/**
 * Weight of their lowest-priority one.
 *
 * Kept close to TOP_WEIGHT on purpose, and the exact value matters more than it
 * looks. A photo in the last category has to clear `q × TOP/LAST` to beat one in
 * the first, so the spread sets how much better it must be. At 0.6 that ratio is
 * 1.67 — above 0.6 quality a first-category photo becomes literally unbeatable,
 * because no score can exceed 1.0. That is category order wearing a grade's
 * clothes, which is the exact behaviour the round-robin was removed for.
 *
 * At 0.85 the ratio is 1.18: a top-quality photo in the last category beats
 * anything below 0.85 in the first, so priority settles near-ties and modest
 * gaps while a clearly better photo always wins on its own merit.
 */
const LAST_WEIGHT = 0.85;
/**
 * Weight of `other`. Low enough that a screenshot loses to any real photo above
 * ~0.25 quality, so in practice these surface only when the window is genuinely
 * thin — which is exactly when a post of *something* beats a post of nothing.
 *
 * Deliberately not zero. Excluding `other` outright is what made the swap list
 * lie: photos were graded, paid for, held in the pool, and then hidden, so the
 * publisher was told "nothing else worth posting in those days" about a library
 * that still had plenty in it.
 */
const FALLBACK_WEIGHT = 0.15;

/**
 * Default cap on photos sharing one scene slug.
 *
 * The classifier is told to prefer generic location terms "so similar shots
 * collide", which makes the slug coarse — a whole afternoon in one market can
 * share one. A hard cap of 1 therefore used to strand posts at a couple of
 * photos, which is why the old code needed a bypass pass. Two keeps a post from
 * being ten near-identical frames without pretending a one-location day is a
 * one-photo day.
 */
export const DEFAULT_MAX_PER_SCENE = 2;

/**
 * Weight of a photo the publisher is NOT in, under `prefer` (issue #137).
 *
 * Sized by the same reasoning as LAST_WEIGHT, and deliberately a wider spread.
 * At 0.7 the ratio is 1.43: a photo of the publisher at 0.6 quality beats
 * anything below 0.857 without them, so the preference decides every near-tie
 * and most modest gaps — which is the point, since "am I in it?" is a stronger
 * signal about what belongs in a post than which category it landed in. It is
 * still short of a filter: a genuinely excellent shot of the coastline (0.9)
 * out-scores a mediocre one with the publisher in it (0.6), so `prefer` cannot
 * quietly become `only`. A publisher who wants the filter has `only`.
 *
 * Applied only under `prefer`. Under `off` nothing is asked and every photo
 * weighs 1; under `only` the fact is a filter, not a tilt.
 */
const PUBLISHER_ABSENT_WEIGHT = 0.7;

/**
 * How much the publisher's presence (or absence) counts for, 0..1.
 *
 * Exported for ./gradeExplanation, which shows a publisher the factors their
 * score was multiplied from. It restated this weight as a literal until the
 * duplication was obvious: two copies of a tuning constant, one of them in the
 * screen built to explain the other. The `only` gate that `isSuggestablePhoto`
 * needs is still a boolean, not a weight, and reads `containsPublisher` direct.
 */
export function publisherWeight(facts: PhotoFacts, mode: PhotosOfMeMode | undefined): number {
  if (mode !== 'prefer') return TOP_WEIGHT;
  return facts.containsPublisher === true ? TOP_WEIGHT : PUBLISHER_ABSENT_WEIGHT;
}

/**
 * How much a category counts for, 0..1.
 *
 * Zero means "the publisher switched this off": those photos are never put in a
 * post. They are still ranked for the *pool*, so the swap list can offer them
 * last rather than pretending they don't exist.
 */
export function categoryWeight(category: string, enabledCategories: readonly string[]): number {
  if (category === FALLBACK_CATEGORY) return FALLBACK_WEIGHT;
  const rank = enabledCategories.indexOf(category);
  if (rank < 0) return 0;
  if (enabledCategories.length === 1) return TOP_WEIGHT;
  return TOP_WEIGHT - (TOP_WEIGHT - LAST_WEIGHT) * (rank / (enabledCategories.length - 1));
}

/**
 * Set size at which the set's own distribution is trusted completely.
 *
 * Below it the spread is blended back towards the raw quality, in proportion.
 * A standard deviation over two photos describes nothing, and normalising
 * against it turns "0.85 and 0.80" into "the best and the worst photo there
 * has ever been" — which is exactly how a 0.05 gap came to overrule the
 * publisher's own "photos of me" preference.
 */
const FULL_TRUST_SET_SIZE = 20;

/**
 * How far above and below the middle a fully-trusted spread reaches. The map is
 * onto (0, 1) with the set's mean at 0.5.
 */
const SPREAD_HALF_WIDTH = 0.5;

/**
 * Smallest denominator the spread will divide by, as a floor under 2σ.
 *
 * Without it a set whose photos genuinely agree — five shots of the same wall,
 * all honestly mediocre — divides by nearly nothing and manufactures a ranking
 * out of rounding noise.
 */
const MIN_SPREAD_RANGE = 0.05;

/**
 * Each distinct raw quality in a set, mapped to where it sits within that set.
 *
 * The model does not use the scale it is given. Measured on staging: 132 graded
 * photos, mean 0.696, standard deviation 0.042, everything between 0.60 and
 * 0.76 with 37 of them on exactly 0.70. About a sixth of the range, which is
 * the normal behaviour of an unanchored 0..1 holistic ask and not something a
 * prompt can be relied on to fix on its own.
 *
 * That is fatal rather than untidy, because `scoreOf` multiplies quality by the
 * category weight and the category weight spans 1.0 down to 0.6 — five times
 * the spread quality actually had. The ranking therefore degenerated into
 * "category rank, then recency", and which photo was better stopped counting.
 *
 * The map is a z-score: distance from the set's mean in units of 2σ, centred on
 * 0.5. Two properties make it safe to multiply the tuned weights by:
 *
 *  - It is blended back towards the RAW quality when the set is small (see
 *    FULL_TRUST_SET_SIZE). A distribution over two photos is not a
 *    distribution, and the `prefer`/category weights were tuned against real
 *    0..1 quality — a normaliser that turns every pair into 0-and-1 silently
 *    re-tunes all of them.
 *  - It never reorders. Photos the model could not separate keep identical
 *    values rather than being split by an accident of iteration.
 *
 * Deliberately NOT what `minQuality` is judged on. That is an absolute standard
 * — "do not post anything below this" — and restating it in relative terms
 * would drop the bottom of every scan however good the whole scan was.
 */
export function spreadQuality(qualities: readonly number[]): Map<number, number> {
  const spread = new Map<number, number>();
  if (qualities.length === 0) return spread;

  const n = qualities.length;
  const mean = qualities.reduce((sum, q) => sum + q, 0) / n;
  const variance = qualities.reduce((sum, q) => sum + (q - mean) ** 2, 0) / n;
  const range = Math.max(MIN_SPREAD_RANGE, 2 * Math.sqrt(variance));
  // How much this set is allowed to speak for itself.
  const trust = Math.min(1, n / FULL_TRUST_SET_SIZE);

  for (const quality of new Set(qualities)) {
    const z = 0.5 + ((quality - mean) / range) * SPREAD_HALF_WIDTH;
    const normalised = Math.min(1, Math.max(0, z));
    spread.set(quality, quality * (1 - trust) + normalised * trust);
  }
  return spread;
}

/**
 * The single number every ordering in the app is based on.
 *
 * `spread` is the set-relative quality from {@link spreadQuality}, for the set
 * being ranked. Absent — a caller scoring one photo out of context — falls back
 * to the raw quality, which is the behaviour every caller had before spreading
 * existed.
 */
export function scoreOf(
  facts: PhotoFacts,
  rules: SelectionRules,
  spread?: ReadonlyMap<number, number>,
): number {
  return (
    (spread?.get(facts.quality) ?? facts.quality) *
    categoryWeight(facts.category, rules.enabledCategories) *
    publisherWeight(facts, rules.photosOfMe)
  );
}

interface Entry<T> {
  item: T;
  facts: PhotoFacts;
  score: number;
}

/** Best first: score, then recency, then id so the order is total. */
function byScore<T>(a: Entry<T>, b: Entry<T>): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.facts.createdAt !== a.facts.createdAt) return b.facts.createdAt - a.facts.createdAt;
  return a.facts.id < b.facts.id ? -1 : a.facts.id > b.facts.id ? 1 : 0;
}

function sceneKey(facts: PhotoFacts): string {
  return facts.scene.trim().toLowerCase();
}

/**
 * Everything worth offering, best first — the batch is just the head of this.
 *
 * Exported so the pool is ordered by the same rule as the post. When the two
 * disagreed, "swap this photo" could hand back something the ranking had
 * already judged worse than what it replaced.
 */
export function rankAll<T>(
  classifications: readonly T[],
  facts: (item: T) => PhotoFacts,
  rules: SelectionRules,
  alreadySent: ReadonlySet<string>,
): T[] {
  return entriesFor(classifications, facts, rules, alreadySent).map(e => e.item);
}

function entriesFor<T>(
  classifications: readonly T[],
  facts: (item: T) => PhotoFacts,
  rules: SelectionRules,
  alreadySent: ReadonlySet<string>,
): Entry<T>[] {
  const entries: Entry<T>[] = [];
  const projected: PhotoFacts[] = [];
  for (const item of classifications) {
    // Projected once — `facts` may be doing real work per photo.
    const f = facts(item);
    if (alreadySent.has(f.id)) continue;
    projected.push(f);
    entries.push({ item, facts: f, score: 0 });
  }

  // Scored against THIS set, after every photo in it is known. Quality is
  // spread across the set before it is multiplied by the category weight —
  // without that the model's 0.60-to-0.76 huddle is worth a fifth of what the
  // category ranking is worth, and the better photo loses to the earlier one.
  // See spreadQuality.
  const spread = spreadQuality(projected.map(f => f.quality));
  for (const entry of entries) entry.score = scoreOf(entry.facts, rules, spread);

  return entries.sort(byScore);
}

export function selectBatch<T>(
  classifications: readonly T[],
  facts: (item: T) => PhotoFacts,
  rules: SelectionRules,
  alreadySent: ReadonlySet<string>,
): T[] {
  const quota = rules.photosPerPost;
  if (quota <= 0) return [];
  const minQuality = rules.minQuality ?? 0;
  const maxPerScene = rules.maxPerScene ?? DEFAULT_MAX_PER_SCENE;

  // A post may only draw from categories the publisher left on, from photos
  // above their quality floor, and — under `only` — from photos they are
  // actually in. All three are explicit settings, so none is relaxed below: a
  // short post is the honest answer, and the review screen says so.
  //
  // `only` is deliberately a hard filter rather than the "never leave a post
  // empty" fallback issue #137 sketched. There is no such fallback left to
  // reuse: the three fallback passes were removed with the round-robin (see the
  // module comment), and every filter that survived — categories, minQuality —
  // is strict. More to the point, quietly relaxing this one produces exactly
  // the post the issue was filed about: a batch of waiters, crowds and other
  // people's children, sent under a setting that says only photos of me.
  const eligible = entriesFor(classifications, facts, rules, alreadySent).filter(
    e =>
      e.score > 0 &&
      e.facts.quality >= minQuality &&
      (rules.photosOfMe !== 'only' || e.facts.containsPublisher === true),
  );

  const selected: Entry<T>[] = [];
  const taken = new Set<string>();
  const perScene = new Map<string, number>();

  for (const entry of eligible) {
    if (selected.length >= quota) break;
    const scene = sceneKey(entry.facts);
    if (scene !== '') {
      const used = perScene.get(scene) ?? 0;
      if (used >= maxPerScene) continue;
      perScene.set(scene, used + 1);
    }
    selected.push(entry);
    taken.add(entry.facts.id);
  }

  // Variety is a preference, not a quota. If the scene cap left the post short
  // — a single-location day, where the coarse slug lumps everything together —
  // keep filling by score. Handing back two photos when ten good ones exist is
  // not restraint, it's a bug the publisher can't diagnose.
  if (selected.length < quota) {
    for (const entry of eligible) {
      if (selected.length >= quota) break;
      if (taken.has(entry.facts.id)) continue;
      selected.push(entry);
      taken.add(entry.facts.id);
    }
  }

  return selected.map(e => e.item);
}
