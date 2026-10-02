// Daily check that the AI vision models classify-photos depends on still exist
// (issue #202). Fails the run — and files or refreshes a GitHub issue — when a
// provider no longer lists its model, or cannot be checked at all.
//
// It lists the provider's models (free, no photo quota spent) and compares with
// the default named in supabase/functions/classify-photos. A GROQ_MODEL /
// GEMINI_MODEL repo variable overrides the source default, for deployments that
// pin a model through the function secret.
//
//   GROQ_API_KEY, GEMINI_API_KEY   repo secrets (read-only model listing)
//   GITHUB_TOKEN                   workflow token (issues: write)
//   GITHUB_REPOSITORY              provided by Actions
//   DRY_RUN                        "true" => report only, file nothing

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { modelFromSource, geminiModelFromSource, evaluate } = require('./aiProviderCheck.js');

const { GROQ_API_KEY, GEMINI_API_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY, DRY_RUN } = process.env;
const LABEL = 'ai-provider-check';
const TITLE = 'bug(ai): an AI vision provider model is unavailable';

const groqSource = readFileSync('supabase/functions/classify-photos/groq.ts', 'utf8');
const indexSource = readFileSync('supabase/functions/classify-photos/index.ts', 'utf8');

async function listGroq() {
  if (!GROQ_API_KEY) return { error: 'GROQ_API_KEY secret is not set' };
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const body = await res.json();
  return { listed: (body.data ?? []).map(m => m.id) };
}

async function listGemini() {
  if (!GEMINI_API_KEY) return { error: 'GEMINI_API_KEY secret is not set' };
  const listed = [];
  let pageToken = '';
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken}`;
    const res = await fetch(url, { headers: { 'x-goog-api-key': GEMINI_API_KEY } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    listed.push(...(body.models ?? []).map(m => m.name));
    pageToken = body.nextPageToken ? `&pageToken=${encodeURIComponent(body.nextPageToken)}` : '';
  } while (pageToken);
  return { listed };
}

const [groq, gemini] = await Promise.all([listGroq(), listGemini()]);
const findings = evaluate([
  {
    provider: 'groq',
    model: process.env.GROQ_MODEL || modelFromSource(groqSource, 'DEFAULT_GROQ_MODEL'),
    listed: groq.listed ?? [],
    error: groq.error ?? null,
  },
  {
    provider: 'gemini',
    model: process.env.GEMINI_MODEL || geminiModelFromSource(indexSource),
    listed: gemini.listed ?? [],
    error: gemini.error ?? null,
  },
]);

for (const f of findings) console.log(`${f.ok ? 'OK  ' : 'FAIL'} ${f.message}`);
const failures = findings.filter(f => !f.ok);

async function github(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

if (DRY_RUN !== 'true' && GITHUB_TOKEN && GITHUB_REPOSITORY) {
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  const open = await github('GET', `/repos/${owner}/${repo}/issues?labels=${LABEL}&state=open`);
  const existing = open[0];
  if (failures.length > 0) {
    const body = failures.map(f => `- ${f.message}`).join('\n');
    if (existing == null) {
      try {
        await github('POST', `/repos/${owner}/${repo}/labels`, {
          name: LABEL, color: 'B60205', description: 'A vision provider model is retired or unreachable',
        });
      } catch { /* already exists */ }
      await github('POST', `/repos/${owner}/${repo}/issues`, {
        title: TITLE,
        body: `Found by the daily model check.\n\n${body}\n\nUntil fixed, photo grading is running on the fallback provider or not at all.`,
        labels: ['bug', 'ai', LABEL],
      });
    } else {
      await github('POST', `/repos/${owner}/${repo}/issues/${existing.number}/comments`, {
        body: `Still failing:\n\n${body}`,
      });
    }
  } else if (existing != null) {
    await github('POST', `/repos/${owner}/${repo}/issues/${existing.number}/comments`, {
      body: 'Both providers list their models again. Closing.',
    });
    await github('PATCH', `/repos/${owner}/${repo}/issues/${existing.number}`, { state: 'closed' });
  }
}

process.exit(failures.length > 0 ? 1 : 0);
