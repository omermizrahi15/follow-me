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
 *     score = quality × categoryWeight(category)
 *
 * Quality dominates and category priority tilts. That ordering is deliberate:
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
}

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

/** The single number every ordering in the app is based on. */
export function scoreOf(facts: PhotoFacts, enabledCategories: readonly string[]): number {
  return facts.quality * categoryWeight(facts.category, enabledCategories);
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
  for (const item of classifications) {
    // Projected once — `facts` may be doing real work per photo.
    const f = facts(item);
    if (alreadySent.has(f.id)) continue;
    entries.push({ item, facts: f, score: scoreOf(f, rules.enabledCategories) });
  }
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

  // A post may only draw from categories the publisher left on, and only from
  // photos above their quality floor. Both are explicit settings, so neither is
  // relaxed below — a short post is the honest answer.
  const eligible = entriesFor(classifications, facts, rules, alreadySent).filter(
    e => e.score > 0 && e.facts.quality >= minQuality,
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
