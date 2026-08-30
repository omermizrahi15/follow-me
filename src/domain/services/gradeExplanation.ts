/**
 * Why a photo scored what it scored — the arithmetic, stated.
 *
 * DUAL RUNTIME, like ./photoSelection, which it explains: import-free and free
 * of platform globals so either runtime can use it.
 *
 * The selection rules produce one number per photo and a post made of the top
 * few. That number is not visible anywhere, so a publisher looking at a
 * suggestion they disagree with has nothing to argue with — the AI is either
 * right or "bad", with no third option and no way to tell which setting caused
 * it. This turns the single score back into the factors it was multiplied from,
 * and names every rule that removed a photo from consideration.
 *
 * It deliberately does NOT reimplement any of those rules. `scoreOf`,
 * `categoryWeight` and `selectBatch` stay the only definition of what goes in a
 * post; this module reads the same inputs and reports the same outputs. A
 * second implementation that drifted would be the worst possible outcome here —
 * a debugging tool that lies is harder to get past than no tool at all.
 */
import {
  categoryWeight,
  DEFAULT_MAX_PER_SCENE,
  publisherWeight,
  scoreOf,
  selectBatch,
  type PhotoFacts,
  type SelectionRules,
} from './photoSelection';

/** One number the score was multiplied from. */
export interface ScoreFactor {
  key: 'quality' | 'category' | 'publisher';
  /** Short name for the row. */
  label: string;
  /** The multiplier itself. The factors' product is the score, exactly. */
  value: number;
  /** Where the number came from, in words. */
  detail: string;
}

/** A rule that took the photo out of the running entirely. */
export interface Blocker {
  key: 'category-off' | 'below-min-quality' | 'not-publisher' | 'already-sent';
  label: string;
  detail: string;
}

/** Everything knowable about how one photo fared under the rules. */
export interface GradeExplanation<T> {
  item: T;
  facts: PhotoFacts;
  /** The same number `scoreOf` produces — not a recomputation of it. */
  score: number;
  /** Multiplied together, these are `score`. */
  factors: ScoreFactor[];
  /**
   * Every rule that excluded this photo, not just the first one found.
   *
   * Reporting one at a time is its own dead end: a publisher raises their
   * quality floor, rescans, and the photo is still missing because the category
   * was off too — with the screen having said nothing about it.
   */
  blockers: Blocker[];
  /** Position in the ranking, 1-based, over everything explained together. */
  rank: number;
  /** Whether `selectBatch` would put this photo in the next post. */
  inBatch: boolean;
  /**
   * Passed over on the first pass because its scene was already full.
   *
   * The only selection rule that is not a property of the photo — it depends on
   * what outranked it — so it cannot be derived from one photo's own numbers,
   * and a photo dropped by it looks inexplicable without this flag. Note that a
   * capped photo can still end up in the post: variety is a preference, and
   * `selectBatch` backfills by score when the cap leaves it short.
   */
  sceneCapped: boolean;
}

const FACTOR_DETAIL = 'What the model scored the photo out of 1';

/** Weight of a photo the publisher is not in, under `prefer` — see photoSelection. */
function publisherFactor(facts: PhotoFacts, rules: SelectionRules): ScoreFactor | null {
  // Under `off` nothing was asked, and under `only` presence is a filter rather
  // than a weight. Showing a face multiplier in either case states a fact the
  // rules never established.
  if (rules.photosOfMe !== 'prefer') return null;
  const present = facts.containsPublisher === true;
  return {
    key: 'publisher',
    label: present ? 'You are in it' : 'You are not in it',
    // The rules' own weight, never a copy of it. A tuning constant restated in
    // the screen that explains it is a screen that can disagree with the post.
    value: publisherWeight(facts, rules.photosOfMe),
    detail: '“Prefer photos of me” is on',
  };
}

function categoryFactor(facts: PhotoFacts, rules: SelectionRules): ScoreFactor {
  const rank = rules.enabledCategories.indexOf(facts.category);
  const total = rules.enabledCategories.length;
  const detail = facts.category === 'other'
    ? 'other — the catch-all, always ranked last'
    : rank < 0
      ? `${facts.category} is not enabled`
      : `${facts.category} — priority ${rank + 1} of ${total}`;
  return {
    key: 'category',
    label: 'Category',
    value: categoryWeight(facts.category, rules.enabledCategories),
    detail,
  };
}

function blockersFor(
  facts: PhotoFacts,
  rules: SelectionRules,
  alreadySent: ReadonlySet<string>,
): Blocker[] {
  const blockers: Blocker[] = [];

  // Checked first and alone: an already-sent photo never reaches the ranking at
  // all, so listing further reasons would describe rules it was never put to.
  if (alreadySent.has(facts.id)) {
    return [{
      key: 'already-sent',
      label: 'Already posted',
      detail: 'This photo has gone out before',
    }];
  }

  if (categoryWeight(facts.category, rules.enabledCategories) === 0) {
    blockers.push({
      key: 'category-off',
      label: 'Category switched off',
      detail: `${facts.category} is not enabled`,
    });
  }

  const minQuality = rules.minQuality ?? 0;
  if (facts.quality < minQuality) {
    blockers.push({
      key: 'below-min-quality',
      label: 'Below quality floor',
      detail: `${facts.quality.toFixed(2)} is under your ${minQuality.toFixed(2)} floor`,
    });
  }

  if (rules.photosOfMe === 'only' && facts.containsPublisher !== true) {
    blockers.push({
      key: 'not-publisher',
      label: 'You are not in it',
      detail: '“Only photos of me” is on',
    });
  }

  return blockers;
}

/**
 * One photo's account of itself, with no knowledge of the others.
 *
 * `rank`, `inBatch` and `sceneCapped` are left at their neutral values here
 * because none of them is answerable about a photo on its own — use
 * {@link explainAll} for those.
 */
export function explainGrade<T>(
  item: T,
  rules: SelectionRules,
  alreadySent: ReadonlySet<string>,
  facts?: (item: T) => PhotoFacts,
): GradeExplanation<T> {
  const f = facts == null ? (item as unknown as PhotoFacts) : facts(item);
  const factors: ScoreFactor[] = [
    { key: 'quality', label: 'Quality', value: f.quality, detail: FACTOR_DETAIL },
    categoryFactor(f, rules),
  ];
  const publisher = publisherFactor(f, rules);
  if (publisher != null) factors.push(publisher);

  return {
    item,
    facts: f,
    // The real thing, not a re-derivation: whatever `scoreOf` says is the score.
    score: scoreOf(f, rules),
    factors,
    blockers: blockersFor(f, rules, alreadySent),
    rank: 0,
    inBatch: false,
    sceneCapped: false,
  };
}

/**
 * Every photo explained and ranked together, best first.
 *
 * The order is `scoreOf`'s, and `inBatch` is `selectBatch`'s own answer rather
 * than a guess at it — the two must agree, because a screen built to catch the
 * ranking misbehaving is worthless if it can misbehave in the same way.
 */
export function explainAll<T>(
  items: readonly T[],
  facts: (item: T) => PhotoFacts,
  rules: SelectionRules,
  alreadySent: ReadonlySet<string>,
): GradeExplanation<T>[] {
  const explained = items
    .map(item => explainGrade(item, rules, alreadySent, facts))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.facts.createdAt !== a.facts.createdAt) return b.facts.createdAt - a.facts.createdAt;
      return a.facts.id < b.facts.id ? -1 : a.facts.id > b.facts.id ? 1 : 0;
    });

  const chosen = new Set(
    selectBatch(items, facts, rules, alreadySent).map(item => facts(item).id),
  );

  // Replays the scene cap over the ranking to find what it passed over. Not a
  // second selection: it decides nothing, it only marks the photos the first
  // pass skipped, which is the one thing `selectBatch`'s output cannot show.
  const maxPerScene = rules.maxPerScene ?? DEFAULT_MAX_PER_SCENE;
  const perScene = new Map<string, number>();
  let room = rules.photosPerPost;

  return explained.map((e, index) => {
    let sceneCapped = false;
    const eligible = e.blockers.length === 0 && e.score > 0;
    const scene = e.facts.scene.trim().toLowerCase();
    if (eligible && room > 0) {
      if (scene === '') {
        room--;
      } else {
        const used = perScene.get(scene) ?? 0;
        if (used >= maxPerScene) sceneCapped = true;
        else {
          perScene.set(scene, used + 1);
          room--;
        }
      }
    }
    return { ...e, rank: index + 1, inBatch: chosen.has(e.facts.id), sceneCapped };
  });
}
