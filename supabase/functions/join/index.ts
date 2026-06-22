/**
 * Supabase Edge Function: GET /join/:publisherId
 *
 * Renders a landing page with a WhatsApp deep-link button.
 * The subscriber taps the button, WhatsApp opens with a pre-filled
 * "JOIN {publisherId}" message addressed to the Twilio number.
 * When they send it, the join-webhook function handles the subscription.
 *
 * Environment variables expected:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase automatically)
 *   TWILIO_WHATSAPP_FROM  (E.164 format, e.g. +14155238886)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function html(title: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f9f9f9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
    .card{background:#fff;border-radius:1rem;box-shadow:0 2px 12px rgba(0,0,0,.1);padding:2rem;width:100%;max-width:380px;text-align:center}
    h1{font-size:1.4rem;margin-bottom:.5rem}
    p{color:#555;margin-bottom:1.5rem;line-height:1.5}
    .logo{font-size:3rem;margin-bottom:1rem}
    a.btn{display:block;padding:.85rem;background:#25D366;color:#fff;border-radius:.5rem;font-size:1rem;font-weight:600;text-decoration:none;margin-bottom:.75rem}
    a.btn:hover{background:#1ebe5d}
    .hint{font-size:.8rem;color:#aaa;margin-bottom:0}
  </style>
</head>
<body><div class="card">${body}</div></body>
</html>`,
    // Use a Headers object + explicit status so the runtime serves this as
    // HTML. An object-literal content-type was coming back as text/plain, so
    // browsers rendered the raw markup instead of the page.
    { status: 200, headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }) },
  );
}

async function lookupPublisher(publisherId: string): Promise<{ name: string } | null> {
  const { data } = await supabase.auth.admin.getUserById(publisherId);
  if (!data.user) return null;
  // `||` (not `??`) so an empty display_name falls through. Phone-auth users
  // have no email, so this lands on 'your publisher' — never the raw phone,
  // which must not be shown on a public page.
  const name: string =
    (data.user.user_metadata as Record<string, string>)?.display_name ||
    data.user.email?.split('@')[0] ||
    'your publisher';
  return { name };
}

// wa.me expects the number without the leading '+'
function waLink(publisherId: string): string {
  const number = TWILIO_FROM.replace(/^\+/, '');
  const text = encodeURIComponent(`JOIN ${publisherId}`);
  return `https://wa.me/${number}?text=${text}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Path: /join/<publisherId>
  const publisherId = url.pathname.split('/').filter(Boolean).at(-1) ?? '';

  if (!publisherId) {
    return html('Error', '<h1>Invalid link</h1><p>This link is not valid.</p>');
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const publisher = await lookupPublisher(publisherId);
  if (!publisher) {
    return html(
      'Not found',
      '<h1>Publisher not found</h1><p>This join link is invalid or has expired.</p>',
    );
  }

  return html(
    `Follow ${publisher.name} on WhatsApp`,
    `<div class="logo">📲</div>
     <h1>Follow ${publisher.name}</h1>
     <p>Tap below to subscribe. WhatsApp will open with a message ready to send — just hit send and you're in.</p>
     <a class="btn" href="${waLink(publisherId)}">Subscribe on WhatsApp</a>
     <p class="hint">You'll receive photos directly in WhatsApp. Reply STOP at any time to unsubscribe.</p>`,
  );
});
