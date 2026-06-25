/**
 * Integration test for the real AI photo classification — run on demand with
 * `npm run test:integration`. It sends real sample images through the deployed
 * `classify-photos` Edge Function (Gemini) and asserts each lands in the expected
 * category. This is the "activate and check the results" harness for the app's
 * core business logic.
 *
 * To activate:
 *   1. Drop sample photos into `__fixtures__/` (one clear example per rule).
 *   2. List them in `__fixtures__/manifest.json` (see manifest.example.json):
 *        [{ "file": "food.jpg", "expected": "food" }, ...]
 *   3. Export the function URL + key, then run the suite:
 *        export CLASSIFY_FN_URL="https://<project>.functions.supabase.co/classify-photos"
 *        export CLASSIFY_FN_KEY="<supabase anon key>"
 *        npm run test:integration
 *
 * It auto-skips (so CI stays green) when the env vars or fixtures are absent.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GeminiPhotoClassifier } from './GeminiPhotoClassifier';
import type { ResolvePayload } from './GeminiPhotoClassifier';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoCategory } from '../../domain/entities/PhotoClassification';

interface Fixture {
  file: string;
  expected: PhotoCategory;
}

const FIXTURES_DIR = join(__dirname, '__fixtures__');
const MANIFEST = join(FIXTURES_DIR, 'manifest.json');

function loadFixtures(): Fixture[] {
  if (!existsSync(MANIFEST)) return [];
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Fixture[];
    return parsed.filter(f => existsSync(join(FIXTURES_DIR, f.file)));
  } catch {
    return [];
  }
}

function mimeFor(file: string): string {
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

const FN_URL = process.env['CLASSIFY_FN_URL'] as string | undefined;
const FN_KEY = process.env['CLASSIFY_FN_KEY'] as string | undefined;
const fixtures = loadFixtures();
const ENABLED = Boolean(FN_URL && FN_KEY) && fixtures.length > 0;

const describeMaybe = ENABLED ? describe : describe.skip;

if (!ENABLED) {
  // eslint-disable-next-line no-console
  console.warn(
    '[GeminiPhotoClassifier.integration] skipped — set CLASSIFY_FN_URL, CLASSIFY_FN_KEY and add __fixtures__/manifest.json to activate.',
  );
}

describeMaybe('GeminiPhotoClassifier (integration)', () => {
  jest.setTimeout(60_000);

  const resolveFromDisk: ResolvePayload = candidate =>
    Promise.resolve({
      id: candidate.id,
      base64: readFileSync(join(FIXTURES_DIR, candidate.id)).toString('base64'),
      mimeType: mimeFor(candidate.id),
    });

  const classifier = new GeminiPhotoClassifier(FN_URL!, FN_KEY!, resolveFromDisk);

  it('classifies every sample image into its expected category', async () => {
    const candidates: PhotoCandidate[] = fixtures.map(f => ({
      id: f.file,
      uri: f.file,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    }));

    const results = await classifier.classify(candidates);
    const byId = new Map(results.map(r => [r.candidate.id, r]));

    for (const f of fixtures) {
      const result = byId.get(f.file);
      // Surface what the model actually said — this is meant to be eyeballed.
      // eslint-disable-next-line no-console
      console.log(
        `${f.file}: expected=${f.expected} got=${result?.category} ` +
          `confidence=${result?.confidence} quality=${result?.quality} caption="${result?.caption}"`,
      );
      expect(result).toBeDefined();
      expect(result!.category).toBe(f.expected);
      expect(result!.confidence).toBeGreaterThanOrEqual(0);
      expect(result!.confidence).toBeLessThanOrEqual(1);
      expect(result!.quality).toBeGreaterThanOrEqual(0);
      expect(result!.quality).toBeLessThanOrEqual(1);
    }
  });
});
