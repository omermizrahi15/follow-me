/**
 * Supabase Edge Function: GET/POST /join/:publisherId
 *
 * GET  – renders the opt-in web page (publisher name + phone field)
 * POST – subscribes the phone number and sends a WhatsApp confirmation
 *
 * Environment variables expected:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase automatically)
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
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
    input{width:100%;padding:.75rem 1rem;border:1.5px solid #d0d0d0;border-radius:.5rem;font-size:1rem;margin-bottom:1rem}
    input:focus{outline:none;border-color:#25D366}
    button{width:100%;padding:.75rem;background:#25D366;color:#fff;border:none;border-radius:.5rem;font-size:1rem;cursor:pointer;font-weight:600}
    button:hover{background:#1ebe5d}
    .error{color:#c0392b;margin-bottom:1rem}
    .success{color:#27ae60;font-size:1.1rem}
  </style>
</head>
<body><div class="card">${body}</div></body>
</html>`,
    { headers: { 'content-type': 'text/html;charset=utf-8' } },
  );
}

async function lookupPublisher(publisherId: string): Promise<{ name: string } | null> {
  const { data } = await supabase.auth.admin.getUserById(publisherId);
  if (!data.user) return null;
  const name: string =
    (data.user.user_metadata as Record<string, string>)?.display_name ??
    data.user.email?.split('@')[0] ??
    'your publisher';
  return { name };
}

async function sendWhatsAppConfirmation(to: string, publisherName: string): Promise<void> {
  const body = `You're now following ${publisherName}. Reply STOP at any time to unsubscribe.`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM}`,
    To: `whatsapp:${to}`,
    Body: body,
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Twilio error (${resp.status}): ${text}`);
  }
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

  const publisher = await lookupPublisher(publisherId);
  if (!publisher) {
    return html(
      'Not found',
      '<h1>Publisher not found</h1><p>This join link is invalid or has expired.</p>',
    );
  }

  // -------------------------------------------------------------------------
  // GET – render the opt-in form
  // -------------------------------------------------------------------------
  if (req.method === 'GET') {
    return html(
      `Follow ${publisher.name} on WhatsApp`,
      `<h1>Follow ${publisher.name}</h1>
       <p>Enter your WhatsApp number to receive their photos directly in WhatsApp.</p>
       <form method="POST">
         <input
           type="tel"
           name="phone"
           placeholder="+1 555 000 0000"
           required
           autocomplete="tel"
         />
         <button type="submit">Subscribe via WhatsApp</button>
       </form>`,
    );
  }

  // -------------------------------------------------------------------------
  // POST – subscribe the phone number
  // -------------------------------------------------------------------------
  if (req.method === 'POST') {
    const formData = await req.formData();
    const phone = (formData.get('phone') as string | null)?.trim() ?? '';

    if (!phone) {
      return html(
        `Follow ${publisher.name}`,
        `<h1>Follow ${publisher.name}</h1>
         <p class="error">Please enter a valid WhatsApp number.</p>
         <form method="POST">
           <input type="tel" name="phone" placeholder="+1 555 000 0000" required autocomplete="tel" />
           <button type="submit">Subscribe via WhatsApp</button>
         </form>`,
      );
    }

    // Upsert subscriber (handles both new and revoked)
    const { error } = await supabase.from('subscribers').upsert(
      {
        publisher_id: publisherId,
        contact_handle: phone,
        status: 'active',
      },
      { onConflict: 'publisher_id,contact_handle' },
    );

    if (error) {
      console.error('DB upsert failed:', error.message);
      return html(
        'Error',
        '<h1>Something went wrong</h1><p>Please try again later.</p>',
      );
    }

    // Send WhatsApp confirmation (best-effort — don't fail the page on error)
    try {
      await sendWhatsAppConfirmation(phone, publisher.name);
    } catch (err) {
      console.error('WhatsApp confirmation failed:', err);
    }

    return html(
      `You're subscribed!`,
      `<h1>🎉 You're subscribed!</h1>
       <p class="success">You'll now receive photos from <strong>${publisher.name}</strong> on WhatsApp.</p>
       <p>Reply <strong>STOP</strong> at any time to unsubscribe.</p>`,
    );
  }

  return new Response('Method not allowed', { status: 405 });
});
