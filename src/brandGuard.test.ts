/**
 * Keeps another product's name out of our source (issue #205).
 *
 * The app was once described in its own comments as "inspired by" and "shaped
 * like" a named competitor's screens. Whatever the legal merits of the look
 * itself, comments saying "this copies X" are the one piece of evidence nobody
 * has to interpret, and they say nothing a future reader needs. Describe the
 * behaviour, not the lineage.
 *
 * The name is assembled from parts so this file does not trip its own scan.
 */
import fs from 'fs';
import path from 'path';

const COMPETITOR = ['polar', 'steps'].join('');
const SRC = path.join(__dirname);
const SCANNED = /\.(ts|tsx|js|json|md)$/;

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCANNED.test(entry.name)) yield full;
  }
}

describe('brand guard', () => {
  it('never names the competitor whose look we were once compared to', () => {
    const offenders = [...walk(SRC)]
      .filter(file => fs.readFileSync(file, 'utf8').toLowerCase().includes(COMPETITOR))
      .map(file => path.relative(SRC, file));

    expect(offenders).toEqual([]);
  });
});
