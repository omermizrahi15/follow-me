// Pure logic for the daily AI-provider model check (issue #202), kept apart from
// the script so it is testable without network access. CommonJS for the same
// reason as otaBuildOutcome.js: the .mjs script imports it, jest requires it.
//
// Why this exists: Groq retired the model classify-photos asked for and every
// request to it failed for two and a half weeks. The function fell back to
// Gemini and kept answering, so nothing alerted anyone. Vendors retire models on
// a schedule; this notices the day it happens.

/** The default model named in a source file, or null when the pattern is absent. */
function modelFromSource(source, constantName) {
  const match = new RegExp(`${constantName}\\s*=\\s*'([^']+)'`).exec(source);
  return match ? match[1] : null;
}

/** The Gemini default is inline: `Deno.env.get('GEMINI_MODEL') ?? 'gemini-…'`. */
function geminiModelFromSource(source) {
  const match = /Deno\.env\.get\('GEMINI_MODEL'\)\s*\?\?\s*'([^']+)'/.exec(source);
  return match ? match[1] : null;
}

/**
 * Whether `model` is among the ids a provider lists.
 * Gemini prefixes ids with `models/`; Groq does not.
 */
function isListed(model, listedIds) {
  const wanted = model.replace(/^models\//, '');
  return listedIds.some(id => String(id).replace(/^models\//, '') === wanted);
}

/**
 * One finding per provider. A provider we could not check is a failure, not a
 * pass: a silent skip is exactly how the original outage stayed invisible.
 */
function evaluate(checks) {
  return checks.map(({ provider, model, listed, error }) => {
    if (model == null) {
      return { provider, ok: false, message: `could not find the default ${provider} model in the source` };
    }
    if (error != null) {
      return { provider, ok: false, message: `could not check ${provider}: ${error}` };
    }
    if (!isListed(model, listed)) {
      return {
        provider,
        ok: false,
        message: `${provider} no longer lists model \`${model}\` — it has probably been retired. See the provider's deprecations page and update the default (or set the ${provider.toUpperCase()}_MODEL secret).`,
      };
    }
    return { provider, ok: true, message: `${provider} lists \`${model}\`` };
  });
}

module.exports = { modelFromSource, geminiModelFromSource, isListed, evaluate };
