/**
 * What a suggestion run is doing, as the four stages a publisher can see:
 * scan the window, group the bursts, grade what's there, preview the post.
 *
 * Pure, and here rather than in the screen for the same reason `aiUsage` is:
 * the rule this encodes is not a layout question, and it is exactly the sort of
 * thing that goes wrong silently. The step bar used to derive itself from the
 * run's `phase` alone, and `phase` turns `done` the moment there are enough
 * grades to render a post — which is roughly a fifth of the way through a
 * window. Grading then ran on in the background with the bar showing a green
 * tick over it, so the app appeared to skip the step it spends the most time on.
 *
 * `grading` is what fixes that: it stays true until the classifier actually
 * stops, whatever `phase` says.
 */

/** The run's coarse state, mirroring the hook's `SuggestPhase`. */
export type SuggestionPhase = 'loading' | 'scanning' | 'deduping' | 'classifying' | 'done' | 'error';

export type StepState = 'pending' | 'active' | 'done';

export type SuggestionStepKey = 'scan' | 'dedupe' | 'grade' | 'preview';

export interface SuggestionStep {
  key: SuggestionStepKey;
  label: string;
  state: StepState;
  /** The count this stage has to show, or null before it has measured one. */
  detail: string | null;
  /** 0..1 for a stage with a bar, null for one without. */
  progress: number | null;
}

export interface SuggestionStepsInput {
  phase: SuggestionPhase;
  /** Photos the library returned for the window. */
  found: number;
  /** Distinct moments those photos cover — bursts counted once. */
  unique: number;
  /** Grades in hand so far. */
  classified: number;
  /** Photos this run set out to grade. */
  total: number;
  /** The classifier is still working, whatever `phase` says. */
  grading: boolean;
  /** The batch came from an earlier run's cache, so nothing was graded now. */
  fromCache: boolean;
}

/** Where the run has got to, as an index into the four stages. */
function reached(input: SuggestionStepsInput): number {
  switch (input.phase) {
    case 'loading':
      return -1;
    case 'scanning':
      return 0;
    case 'deduping':
      return 1;
    case 'classifying':
      return 2;
    // A stopped run is left showing the stage it stopped on rather than being
    // rolled forward: "it failed while grading" is the useful thing to see.
    case 'error':
      return 2;
    case 'done':
      // The whole point — a previewable batch does not mean grading finished.
      return input.grading ? 2 : 3;
  }
}

function stateFor(index: number, reachedIndex: number, complete: boolean): StepState {
  if (complete) return 'done';
  if (index < reachedIndex) return 'done';
  if (index === reachedIndex) return 'active';
  return 'pending';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function suggestionSteps(input: SuggestionStepsInput): SuggestionStep[] {
  const reachedIndex = reached(input);
  // A finished run and a cached batch are both "all four done". A cached batch
  // never ran a scan at all, which the grade stage says in words rather than
  // by pretending to a photo count it does not have.
  const complete = input.phase === 'done' && !input.grading;
  const progress =
    input.total > 0 ? Math.min(1, Math.max(0, input.classified / input.total)) : null;

  const gradeDetail = input.fromCache
    ? 'from an earlier scan'
    : input.total > 0
      ? `${input.classified} of ${input.total}`
      : // Nothing to grade and the run is over: every photo in the window was
        // already graded by an earlier run and the grades were remembered. That
        // is a stage that ran and cost nothing, not a stage that was skipped.
        complete
        ? 'already graded'
        : null;

  return [
    {
      key: 'scan',
      label: 'Scanning',
      state: stateFor(0, reachedIndex, complete),
      detail: input.found > 0 ? plural(input.found, 'photo') : null,
      progress: null,
    },
    {
      key: 'dedupe',
      label: 'Duplicates',
      state: stateFor(1, reachedIndex, complete),
      detail: input.unique > 0 ? plural(input.unique, 'moment') : null,
      progress: null,
    },
    {
      key: 'grade',
      label: 'Grading',
      // Grading is the one stage that stays active into the preview: the post
      // is on screen while the rest of the window is still being looked at.
      state:
        !complete && input.phase === 'done' && input.grading
          ? 'active'
          : stateFor(2, reachedIndex, complete),
      detail: gradeDetail,
      progress,
    },
    {
      key: 'preview',
      label: 'Preview',
      // Active — not pending — once a post is on screen, even with grading
      // still running behind it. Both things are true at once and the bar
      // should say so.
      state:
        !complete && input.phase === 'done' ? 'active' : stateFor(3, reachedIndex, complete),
      detail: null,
      progress: null,
    },
  ];
}
