/**
 * Supabase Edge Function: POST /classify-photos
 * Body: { "photos": [{ "id": string, "url"?: string, "base64"?: string, "mimeType"?: string }] }
 * Returns: { "classifications": [{ id, category, confidence, quality, caption }] }
 *
 * The single place provider specifics live. It holds GEMINI_API_KEY (never shipped
 * in the app) and asks Gemini Flash to classify each photo into one of the rule
 * categories. Photos may be passed as a public URL (the function fetches the bytes)
 * or as base64 (the app reads local library photos this way, avoiding an upload
 * just to classify). Swapping providers means rewriting only this file.
 *
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default gemini-2.0-flash)
 */

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash';

const CATEGORIES = ['selfie_with_view', 'selfie_with_people', 'view_only', 'food', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

const PROMPT = `You classify a single photo for a social "share my travels" app.
Choose exactly one category:
- selfie_with_view: a self-portrait (the photographer is in frame, often arm's length) with a scenic background/landscape.
- selfie_with_people: a self-portrait or close group photo where other people are the focus, no notable scenery.
- view_only: scenery/landscape/landmark with no people prominently in frame.
- food: a dish, drink, or meal is the subject.
- other: anything else (screenshots, documents, receipts, memes, blurry/unusable, pets-only, etc.).

Also rate:
- confidence: 0..1, how sure you are of the category.
- quality: 0..1, photographic quality (sharp, well-exposed, well-composed; low for blurry/dark/cluttered).
- caption: a short, friendly caption (max ~8 words).

Respond with JSON only.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    category: { type: 'STRING', enum: [...CATEGORIES] },
    confidence: { type: 'NUMBER' },
    quality: { type: 'NUMBER' },
    caption: { type: 'STRING' },
  },
  required: ['category', 'confidence', 'quality', 'caption'],
};

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

interface PhotoInput {
  id: string;
  url?: string;
  base64?: string;
  mimeType?: string;
}

interface Classification {
  id: string;
  category: Category;
  confidence: number;
  quality: number;
  caption: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function resolveImage(photo: PhotoInput): Promise<{ data: string; mimeType: string }> {
  if (photo.base64) {
    return { data: photo.base64, mimeType: photo.mimeType ?? 'image/jpeg' };
  }
  if (photo.url) {
    const res = await fetch(photo.url);
    if (!res.ok) throw new Error(`fetch image failed (${res.status})`);
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { data: bytesToBase64(bytes), mimeType };
  }
  throw new Error('photo has neither url nor base64');
}

function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normalizeCategory(c: unknown): Category {
  return CATEGORIES.includes(c as Category) ? (c as Category) : 'other';
}

async function classifyOne(photo: PhotoInput): Promise<Classification> {
  const { data, mimeType } = await resolveImage(photo);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType, data } }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini error (${res.status}): ${await res.text()}`);
  }

  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Gemini returned no content');
  const parsed = JSON.parse(text);

  return {
    id: photo.id,
    category: normalizeCategory(parsed.category),
    confidence: clamp01(parsed.confidence),
    quality: clamp01(parsed.quality),
    caption: typeof parsed.caption === 'string' ? parsed.caption : '',
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!GEMINI_API_KEY) return json({ error: 'Server not configured' }, 500);

  let body: { photos?: PhotoInput[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length === 0) return json({ classifications: [] });

  // Classify concurrently; a single photo failing degrades to `other` (confidence 0)
  // so the whole batch never fails because of one bad image.
  const classifications = await Promise.all(
    photos.map(async (photo): Promise<Classification> => {
      try {
        return await classifyOne(photo);
      } catch (err) {
        console.error(`classify ${photo.id} failed:`, err);
        return { id: photo.id, category: 'other', confidence: 0, quality: 0, caption: '' };
      }
    }),
  );

  return json({ classifications });
});
