import { summarizeAiUsage, aiUsageCopy, LOW_BUDGET_FRACTION } from './aiUsage';

const day = '2026-08-28';

describe('summarizeAiUsage', () => {
  it('reports the spent share of the day’s budget', () => {
    const summary = summarizeAiUsage({ used: 125, limit: 500, day });

    expect(summary.remaining).toBe(375);
    expect(summary.usedFraction).toBeCloseTo(0.25);
    expect(summary.usedPercent).toBe(25);
    expect(summary.level).toBe('ok');
  });

  it('keeps the day it was counted for', () => {
    expect(summarizeAiUsage({ used: 1, limit: 500, day }).day).toBe(day);
  });

  it('calls the budget low once most of it is gone', () => {
    expect(summarizeAiUsage({ used: 400, limit: 500, day }).level).toBe('low');
    expect(summarizeAiUsage({ used: 399, limit: 500, day }).level).toBe('ok');
    expect(LOW_BUDGET_FRACTION).toBe(0.8);
  });

  it('calls it exhausted only when nothing is left', () => {
    expect(summarizeAiUsage({ used: 499, limit: 500, day }).level).toBe('low');
    expect(summarizeAiUsage({ used: 500, limit: 500, day }).level).toBe('exhausted');
  });

  it('clamps an overshoot rather than reporting a negative balance', () => {
    // A request is counted before it is refused, so the stored count routinely
    // ends the day a few photos past the ceiling. "-7 left" and a bar wider
    // than its track are both wrong ways to show a budget that is simply gone.
    const summary = summarizeAiUsage({ used: 507, limit: 500, day });

    expect(summary.used).toBe(507);
    expect(summary.remaining).toBe(0);
    expect(summary.usedFraction).toBe(1);
    expect(summary.usedPercent).toBe(100);
    expect(summary.level).toBe('exhausted');
  });

  it('treats a zero or missing limit as nothing available', () => {
    // CLASSIFY_DAILY_QUOTA set to 0 disables classification outright. Dividing
    // by it would render NaN% and a bar of no width — which reads as "plenty
    // left", the opposite of the truth.
    const summary = summarizeAiUsage({ used: 0, limit: 0, day });

    expect(summary.remaining).toBe(0);
    expect(summary.usedFraction).toBe(1);
    expect(summary.usedPercent).toBe(100);
    expect(summary.level).toBe('exhausted');
  });

  it('never shows a fresh budget as partly spent', () => {
    const summary = summarizeAiUsage({ used: 0, limit: 500, day });

    expect(summary.usedFraction).toBe(0);
    expect(summary.usedPercent).toBe(0);
    expect(summary.level).toBe('ok');
  });

  it('rounds the percent but keeps a started budget off zero', () => {
    // One photo of 500 is 0.2%. Rounding it to "0%" says the day is untouched
    // while the bar already has ink in it.
    expect(summarizeAiUsage({ used: 1, limit: 500, day }).usedPercent).toBe(1);
    expect(summarizeAiUsage({ used: 137, limit: 500, day }).usedPercent).toBe(27);
  });
});

describe('aiUsageCopy', () => {
  it('says what is left, in the unit the budget is counted in', () => {
    const copy = aiUsageCopy(summarizeAiUsage({ used: 137, limit: 500, day }));

    expect(copy.headline).toBe('27% used');
    expect(copy.detail).toBe('137 of 500 photos today · 363 left');
  });

  it('says the budget is gone rather than "0 left"', () => {
    const copy = aiUsageCopy(summarizeAiUsage({ used: 507, limit: 500, day }));

    expect(copy.headline).toBe('100% used');
    expect(copy.detail).toBe('507 of 500 photos today · resets tomorrow');
  });

  it('says nothing has been spent yet', () => {
    expect(aiUsageCopy(summarizeAiUsage({ used: 0, limit: 500, day })).detail).toBe(
      '0 of 500 photos today · 500 left',
    );
  });
});
