/**
 * Supabase Edge Function: POST /suggest-song (issue #54)
 * Body: {
 *   place?: string,          // posting place label ("Lisbon, Portugal")
 *   month?: string,          // "July" — season flavors the suggestion
 *   photoCount?: number,
 *   photos?: [{ base64, mimeType? }],  // downsized post photos (≤3) — Gemini SEES them
 *   exclude?: [{ title, artist }],  // already offered — "try another" rerolls past these
 *   seeds?: [{ title, artist }],    // Phase 2: the publisher's recent listening history
 * }
 * Returns: { candidates: [{ title, artist, reason }] }
 *
 * Asks Gemini (multimodal) for real, well-known songs fitting the posting.
 * When photos are attached the model matches the song to what's actually in
 * them — mood, scenery, energy — not just the place label. The app resolves
 * each candidate against the iTunes Search API for artwork + a 30s preview,
 * so a hallucinated track simply fails to resolve and is skipped. Seeds
 * (when provided) anchor the suggestions to the publisher's actual taste:
 * "these songs, or songs like them".
 *
 * Auth: requires a signed-in user's JWT (anon key alone rejected) — cost posture
 * matches classify-photos, minus the per-photo quota.
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default gemini-2.0-flash),
 *      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPrompt, normalizeCandidates, sanitizePhotos, sanitizeTracks } from './logic.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function authenticatedUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token === '') return null;
  try {
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          artist: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['title', 'artist', 'reason'],
      },
    },
  },
  required: ['candidates'],
};

/** One retry on transient failures (5xx / 429) with a short backoff. */
async function callGemini(body: string): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
  const first = await fetch(url, request);
  if (first.ok || (first.status < 500 && first.status !== 429)) return first;
  await first.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, 800));
  return fetch(url, request);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!GEMINI_API_KEY) return json({ error: 'Server not configured' }, 500);

  const userId = await authenticatedUserId(req);
  if (userId == null) return json({ error: 'Authentication required' }, 401);

  let body: {
    place?: unknown;
    month?: unknown;
    photoCount?: unknown;
    photos?: unknown;
    exclude?: unknown;
    seeds?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const photos = sanitizePhotos(body.photos);
  const prompt = buildPrompt({
    ...(typeof body.place === 'string' && body.place.trim() !== '' ? { place: body.place.trim().slice(0, 120) } : {}),
    ...(typeof body.month === 'string' && body.month.trim() !== '' ? { month: body.month.trim().slice(0, 20) } : {}),
    ...(typeof body.photoCount === 'number' && body.photoCount > 0 ? { photoCount: Math.floor(body.photoCount) } : {}),
    photoAttached: photos.length > 0,
    exclude: sanitizeTracks(body.exclude),
    seeds: sanitizeTracks(body.seeds),
  });

  const res = await callGemini(
    JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          ...photos.map((p) => ({ inlineData: { mimeType: p.mimeType, data: p.base64 } })),
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // Some spread keeps rerolls fresh — unlike classification this WANTS variety.
        temperature: 1.0,
      },
    }),
  );

  if (!res.ok) {
    console.error(`suggest-song Gemini error (${res.status}):`, await res.text());
    return json({ error: 'Suggestion service unavailable' }, 502);
  }

  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    console.error('Gemini returned no content; payload shape:', JSON.stringify(payload)?.slice(0, 500));
    return json({ error: 'Suggestion service unavailable' }, 502);
  }

  let parsed: { candidates?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error('Gemini returned non-JSON:', text.slice(0, 300));
    return json({ error: 'Suggestion service unavailable' }, 502);
  }

  return json({ candidates: normalizeCandidates(parsed.candidates) });
});
