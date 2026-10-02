import { suggestionSteps } from './suggestionProgress';
import type { SuggestionStep, SuggestionStepsInput } from './suggestionProgress';

const base: SuggestionStepsInput = {
  phase: 'loading',
  found: 0,
  unique: 0,
  classified: 0,
  total: 0,
  grading: false,
  fromCache: false,
};

const states = (input: Partial<SuggestionStepsInput>): string[] =>
  suggestionSteps({ ...base, ...input }).map(s => s.state);

const step = (input: Partial<SuggestionStepsInput>, key: string): SuggestionStep =>
  suggestionSteps({ ...base, ...input }).find(s => s.key === key)!;

describe('suggestionSteps', () => {
  it('names the four stages a run goes through, in order', () => {
    expect(suggestionSteps(base).map(s => s.key)).toEqual([
      'scan',
      'dedupe',
      'grade',
      'preview',
    ]);
  });

  it('has nothing started while the config is still loading', () => {
    expect(states({ phase: 'loading' })).toEqual(['pending', 'pending', 'pending', 'pending']);
  });

  it('walks scanning, then duplicates, then grading', () => {
    expect(states({ phase: 'scanning' })).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(states({ phase: 'deduping', found: 183, unique: 72 })).toEqual([
      'done', 'active', 'pending', 'pending',
    ]);
    expect(states({ phase: 'classifying', classified: 4, total: 72 })).toEqual([
      'done', 'done', 'active', 'pending',
    ]);
  });

  // The bug this exists for: the batch becomes previewable at 2x photosPerPost
  // and the screen flips to `done`, but the rest of the window is still being
  // graded. Marking grading complete there is what made the AI look like it
  // skipped the step entirely.
  it('keeps grading active while the rest of the window is still being graded', () => {
    expect(states({ phase: 'done', grading: true, classified: 20, total: 72 })).toEqual([
      'done', 'done', 'active', 'active',
    ]);
  });

  it('finishes every step once grading has actually stopped', () => {
    expect(states({ phase: 'done', grading: false, classified: 72, total: 72 })).toEqual([
      'done', 'done', 'done', 'done',
    ]);
  });

  it('reports a cached batch as a finished run that graded nothing now', () => {
    const cached = suggestionSteps({ ...base, phase: 'done', fromCache: true });
    expect(cached.map(s => s.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(step({ phase: 'done', fromCache: true }, 'grade').detail).toBe('from an earlier scan');
  });

  // Grades are remembered per photo between runs, so rescanning a window that
  // has already been graded costs no AI at all. Showing a blank grading step
  // there reads as "it skipped it" — the same complaint, different cause.
  it('says a run graded nothing because it already had every grade', () => {
    expect(step({ phase: 'done', found: 183, unique: 72, total: 0 }, 'grade').detail).toBe(
      'already graded',
    );
  });

  it('counts photos, moments and grades as each stage learns them', () => {
    const input = { phase: 'classifying' as const, found: 183, unique: 72, classified: 9, total: 72 };
    expect(step(input, 'scan').detail).toBe('183 photos');
    expect(step(input, 'dedupe').detail).toBe('72 moments');
    expect(step(input, 'grade').detail).toBe('9 of 72');
  });

  it('says nothing it has not measured yet', () => {
    expect(step({ phase: 'scanning' }, 'scan').detail).toBeNull();
    expect(step({ phase: 'scanning' }, 'grade').detail).toBeNull();
  });

  it('reports grading progress as a fraction, and nothing when there is none to grade', () => {
    expect(suggestionSteps({ ...base, phase: 'classifying', classified: 18, total: 72 }).find(s => s.key === 'grade')!.progress).toBeCloseTo(0.25);
    expect(step({ phase: 'classifying', classified: 0, total: 0 }, 'grade').progress).toBeNull();
  });

  it('leaves every step alone on an error — the run stopped where it stopped', () => {
    expect(states({ phase: 'error', classified: 4, total: 72 })).toEqual([
      'done', 'done', 'active', 'pending',
    ]);
  });
});
