/**
 * The daily model check (issue #202). Groq retired qwen3.6-27b, every Groq call
 * failed for 2.5 weeks, and the Gemini fallback hid it. These guard the parts of
 * the check that decide whether anyone is told.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { modelFromSource, geminiModelFromSource, isListed, evaluate } = require('./aiProviderCheck.js') as {
  modelFromSource: (s: string, name: string) => string | null;
  geminiModelFromSource: (s: string) => string | null;
  isListed: (m: string, ids: string[]) => boolean;
  evaluate: (c: unknown[]) => Array<{ provider: string; ok: boolean; message: string }>;
};

describe('model discovery from source', () => {
  it('reads the Groq default constant', () => {
    expect(modelFromSource("const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';", 'DEFAULT_GROQ_MODEL')).toBe(
      'qwen/qwen3.8-27b',
    );
  });

  it('reads the Gemini default', () => {
    expect(geminiModelFromSource("const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash';")).toBe(
      'gemini-3.5-flash',
    );
  });

  it('returns null rather than guessing when the pattern is gone', () => {
    expect(modelFromSource('nothing here', 'DEFAULT_GROQ_MODEL')).toBeNull();
  });
});

describe('isListed', () => {
  it('matches Gemini ids with or without the models/ prefix', () => {
    expect(isListed('gemini-3.5-flash', ['models/gemini-3.5-flash'])).toBe(true);
  });
  it('does not match a retired model', () => {
    expect(isListed('qwen/qwen3.6-27b', ['qwen/qwen3.8-27b'])).toBe(false);
  });
});

describe('evaluate', () => {
  it('passes a model the provider still lists', () => {
    const [r] = evaluate([{ provider: 'groq', model: 'm', listed: ['m'], error: null }]);
    expect(r?.ok).toBe(true);
  });

  it('fails a retired model and says so', () => {
    const [r] = evaluate([{ provider: 'groq', model: 'old', listed: ['new'], error: null }]);
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/retired/);
  });

  it('fails when the provider could not be checked — a silent skip is the original bug', () => {
    const [r] = evaluate([{ provider: 'groq', model: 'm', listed: [], error: 'HTTP 401' }]);
    expect(r?.ok).toBe(false);
    expect(r?.message).toContain('401');
  });

  it('fails when the source no longer names a default', () => {
    const [r] = evaluate([{ provider: 'groq', model: null, listed: [], error: null }]);
    expect(r?.ok).toBe(false);
  });
});
