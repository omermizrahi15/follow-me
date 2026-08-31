import {
  summarizeAiUsage,
  aiUsageCopy,
  providerChainCopy,
  providerLimitCopy,
  LOW_BUDGET_FRACTION,
} from './aiUsage';
import type { ProviderLimits } from '../entities/AiUsage';

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

describe('summarizeAiUsage — when we impose no ceiling of our own', () => {
  it('reports the spend without inventing a limit to measure it against', () => {
    // The 500 that used to sit here was ours, not the provider's, and it was
    // the only "AI limit" the app could show. Unset now means unset: a count
    // with no denominator, rather than a bar filled against a made-up one.
    const s = summarizeAiUsage({ used: 137, limit: null, day: '2026-08-29' });

    expect(s.limit).toBeNull();
    expect(s.remaining).toBeNull();
    expect(s.usedFraction).toBeNull();
    expect(s.usedPercent).toBeNull();
    expect(s.level).toBe('ok');
  });

  it('still treats a deliberate zero as the kill switch it is', () => {
    // Distinct from "no ceiling": zero means classification is switched off.
    const s = summarizeAiUsage({ used: 0, limit: 0, day: '2026-08-29' });
    expect(s.level).toBe('exhausted');
    expect(s.usedFraction).toBe(1);
  });
});

describe('aiUsageCopy — with no ceiling of ours', () => {
  it('says what was spent and stops there', () => {
    const copy = aiUsageCopy(summarizeAiUsage({ used: 137, limit: null, day: '2026-08-29' }));

    expect(copy.headline).toBe('137 photos');
    expect(copy.detail).toBe('graded today · no limit of ours');
  });
});

describe('providerLimitCopy', () => {
  it('turns a per-minute token ceiling into the number of photos it buys', () => {
    // Tokens are the ceiling a vision workload actually hits, and "2450
    // tokens" means nothing to anyone. Photos are the unit the whole app is
    // spent in, so the arithmetic is done here rather than in the reader's head.
    const copy = providerLimitCopy({
      provider: 'groq',
      model: 'qwen/qwen3.6-27b',
      requests: { limit: 1000, remaining: 994, resetSeconds: 86_400 },
      tokens: { limit: 8000, remaining: 2450, resetSeconds: 42 },
      observedAt: 0,
    });

    expect(copy?.headline).toBe('groq · qwen/qwen3.6-27b');
    expect(copy?.lines).toEqual([
      'Requests: 994 of 1000 today · resets in 24h',
      'Tokens: 2450 of 8000 this minute · resets in 42s',
      '≈ 2 more photos before the token window refills',
    ]);
  });

  it('says nothing about photos when no token ceiling was reported', () => {
    // Gemini names a request quota and never a token one. Estimating photos
    // from a request count would be a different, wronger sum.
    const copy = providerLimitCopy({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      requests: { limit: 20, remaining: 0, resetSeconds: 38 },
      tokens: null,
      observedAt: 0,
    });

    expect(copy?.lines).toEqual(['Requests: 0 of 20 left · resets in 38s']);
  });

  it('has nothing to say when the provider has never been heard from', () => {
    expect(providerLimitCopy(null)).toBeNull();
  });
});

describe('providerLimitCopy — the window each number belongs to', () => {
  const groq = (over: Partial<ProviderLimits> = {}): ProviderLimits => ({
    provider: 'groq',
    model: 'qwen/qwen3.6-27b',
    requests: { limit: 1000, remaining: 999, resetSeconds: 87 },
    tokens: { limit: 8000, remaining: 5283, resetSeconds: 21 },
    observedAt: 0,
    ...over,
  });

  // Groq documents that `x-ratelimit-limit-requests` ALWAYS means per-day and
  // `x-ratelimit-limit-tokens` ALWAYS means per-minute. The reset seconds do
  // not say so — the daily request window reported a reset of 87 seconds —
  // so reading the period off the reset is how "1000 requests a day" came to
  // look like a ceiling that clears in under two minutes.
  it('labels Groq requests per day and tokens per minute', () => {
    const copy = providerLimitCopy(groq())!;
    expect(copy.lines[0]).toContain('999 of 1000 today');
    expect(copy.lines[1]).toContain('5283 of 8000 this minute');
  });

  it('says nothing about the period for a provider whose windows we do not know', () => {
    const copy = providerLimitCopy(groq({ provider: 'gemini', model: 'gemini-3.5-flash' }))!;
    expect(copy.lines[0]).not.toContain('today');
    expect(copy.lines[0]).toContain('999 of 1000 left');
  });

  it('converts the token window into photos, which is the unit a scan is spent in', () => {
    const copy = providerLimitCopy(groq())!;
    expect(copy.lines.some(l => l.includes('5 more photos'))).toBe(true);
  });

  it('names the provider and model so the chain is legible', () => {
    expect(providerLimitCopy(groq())!.headline).toBe('groq · qwen/qwen3.6-27b');
  });

  it('has nothing to say about a provider that has never answered', () => {
    expect(providerLimitCopy(null)).toBeNull();
  });
});

describe('providerChainCopy — every provider, not just the last to speak', () => {
  const limits = (provider: string, remaining: number): ProviderLimits => ({
    provider,
    model: `${provider}-model`,
    requests: { limit: 20, remaining, resetSeconds: null },
    tokens: null,
    observedAt: 0,
  });

  // The bar showed whoever answered LAST, which is the fallback whenever the
  // leader is spent — so "we grade on Groq" and a bar reading "gemini" were
  // both true at once and impossible to reconcile from the screen.
  it('keeps every provider it was given, in order', () => {
    const copy = providerChainCopy([limits('groq', 5), limits('gemini', 0)]);
    expect(copy.map(c => c.headline)).toEqual(['groq · groq-model', 'gemini · gemini-model']);
  });

  it('is empty when no provider has ever answered', () => {
    expect(providerChainCopy([])).toEqual([]);
    expect(providerChainCopy(null)).toEqual([]);
  });

  it('drops nothing for a provider with no windows to report', () => {
    const bare: ProviderLimits = {
      provider: 'groq', model: 'm', requests: null, tokens: null, observedAt: 0,
    };
    expect(providerChainCopy([bare])).toHaveLength(1);
  });
});
