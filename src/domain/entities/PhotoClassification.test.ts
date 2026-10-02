import { normaliseCategory, SELECTABLE_CATEGORIES } from './PhotoClassification';

describe('retired categories', () => {
  // `cultural` was retired: museums, temples and historic sites are buildings,
  // and a category that mostly duplicated `architecture` only gave the model
  // another way to split photos that belong together.
  //
  // Grades already bought carry it, though — thousands of them, in the device
  // cache and in `candidate_photos` — and a stored `cultural` reaching the
  // selection rules would match no enabled category and quietly drop a photo
  // the publisher had asked to see.
  it('folds cultural into architecture', () => {
    expect(normaliseCategory('cultural')).toBe('architecture');
  });

  it('leaves a live category exactly as it is', () => {
    expect(normaliseCategory('architecture')).toBe('architecture');
    expect(normaliseCategory('food')).toBe('food');
    expect(normaliseCategory('other')).toBe('other');
  });

  // `other` is the honest home for something we cannot place: it is excluded
  // from suggestions, so an unreadable grade sinks rather than being offered
  // as a confident one.
  it('treats anything unrecognised as other', () => {
    expect(normaliseCategory('interpretive_dance')).toBe('other');
    expect(normaliseCategory('')).toBe('other');
    expect(normaliseCategory(undefined)).toBe('other');
  });

  it('no longer offers cultural as a category a publisher can enable', () => {
    expect(SELECTABLE_CATEGORIES).not.toContain('cultural');
  });
});
