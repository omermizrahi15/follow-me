import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PhotoCategory, PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IClassificationStore } from '../../domain/interfaces';

/**
 * One remembered grade. Stores the candidate's own fields too, so a hit can be
 * turned back into a full PhotoClassification without re-reading the library.
 */
interface StoredGrade {
  uri: string;
  createdAt: number; // epoch ms
  category: PhotoCategory;
  confidence: number;
  quality: number;
  caption: string;
  scene: string;
  gradedAt: number; // epoch ms
}

type Store = Record<string, StoredGrade>;

/**
 * Bumped to v2 to abandon the v1 blob wholesale.
 *
 * Until the classify function stopped inventing grades, every failed call was
 * remembered here as a real `other`/quality-0 verdict. Those entries are
 * indistinguishable from genuine ones, they are excluded from the swap pool,
 * and the 120-day TTL means a single bad afternoon retired those photos until
 * well into the next season — no rescan would ever look at them again, because
 * a remembered grade is never re-bought. A new key is the only way to let them
 * be graded again; the cost is one re-grade of the genuinely-graded photos,
 * which is exactly what the old key was silently charging anyway.
 */
const STORAGE_KEY = 'photo_grades:v2';

/**
 * Grades older than this are dropped. Long enough to cover the widest posting
 * window (monthly) several times over, short enough that the blob cannot grow
 * without bound on a device that has been posting for a year.
 */
const TTL_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Hard ceiling on remembered grades, newest kept. A grade is ~150 bytes of
 * JSON, so this caps the blob near 1MB — comfortably inside AsyncStorage's
 * per-key limits while still holding far more photos than any single window.
 */
const MAX_ENTRIES = 5_000;

function toClassification(id: string, g: StoredGrade): PhotoClassification {
  return {
    candidate: { id, uri: g.uri, createdAt: new Date(g.createdAt) },
    category: g.category,
    confidence: g.confidence,
    quality: g.quality,
    caption: g.caption,
    scene: g.scene,
  };
}

async function readAll(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) return {};
    // A half-written or hand-edited blob must not take the scan down with it.
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/** Drops expired entries, then the oldest ones if still over the ceiling. */
function prune(store: Store, now: number): Store {
  const live = Object.entries(store).filter(([, g]) => now - g.gradedAt <= TTL_MS);
  if (live.length <= MAX_ENTRIES) return Object.fromEntries(live);
  live.sort((a, b) => b[1].gradedAt - a[1].gradedAt);
  return Object.fromEntries(live.slice(0, MAX_ENTRIES));
}

/**
 * AsyncStorage-backed {@link IClassificationStore}.
 *
 * Deliberately keyed by asset id alone, not by publisher: what the AI thinks of
 * a photo does not depend on who is posting it, and the device only ever has
 * one publisher signed in at a time.
 *
 * Reads and writes the whole blob rather than one key per photo. A window is
 * hundreds of photos, and multiGet/multiSet of hundreds of tiny keys is slower
 * on the bridge than a single ~1MB round-trip.
 */
export const ClassificationCache: IClassificationStore = {
  async load(assetIds: readonly string[]): Promise<Map<string, PhotoClassification>> {
    const found = new Map<string, PhotoClassification>();
    if (assetIds.length === 0) return found;

    const store = await readAll();
    const now = Date.now();
    for (const id of assetIds) {
      const grade = store[id];
      // Expired entries are ignored here and swept on the next save, so a read
      // never has to pay for a write.
      if (grade != null && now - grade.gradedAt <= TTL_MS) {
        found.set(id, toClassification(id, grade));
      }
    }
    return found;
  },

  async save(classifications: readonly PhotoClassification[]): Promise<void> {
    if (classifications.length === 0) return;
    try {
      const now = Date.now();
      const store = await readAll();
      for (const c of classifications) {
        store[c.candidate.id] = {
          uri: c.candidate.uri,
          createdAt: c.candidate.createdAt.getTime(),
          category: c.category,
          confidence: c.confidence,
          quality: c.quality,
          caption: c.caption,
          scene: c.scene,
          gradedAt: now,
        };
      }
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prune(store, now)));
    } catch {
      // Losing a write costs one re-classification next scan, which is strictly
      // better than failing a scan the publisher is waiting on.
    }
  },
};

/** Forgets every remembered grade. Exposed for tests and a future "re-grade" action. */
export async function clearClassificationCache(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
