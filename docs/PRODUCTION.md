# Production readiness — keys, RLS, ops & privacy

Status notes for the auto-posting feature (issue #17). Everything here works in
the current **dev** posture; items marked TODO(production) must land before a
public launch.

## Key inventory — what is public vs private

| Key | Where it lives | Exposure |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | app bundle (`EXPO_PUBLIC_`), `docs/gallery.html` | **Public by design** — safety comes from RLS, not secrecy |
| `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` / `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | app bundle | **Public** — unsigned upload preset; scope it to image-only + size caps in the Cloudinary console |
| `EXPO_PUBLIC_CLASSIFY_FN_URL` | app bundle | **Public URL, protected endpoint** — classify-photos rejects the bare anon key: it requires a signed-in user's JWT, caps 3 photos/request, and enforces a 500/day per-user quota (`classify_quota` + `increment_classify_quota()`, migration 20240015) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Edge Function secrets only | **Private** — never in the app |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected into Edge Functions | **Private** — never in the app or repo; verified absent from client env (`.env` carries only `EXPO_PUBLIC_*` Supabase keys) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | Edge Function secrets + local `.env` (integration tests only) | **Private** — WhatsApp sends happen exclusively server-side (`send-post`, `auto-post`); the app calls those functions with the anon key |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | optional Edge Function secrets | **Private** — when set, sends authenticate with this revocable API key instead of the account auth token (preferred; see issue #24 notes) |
| `TWILIO_STATUS_CALLBACK_URL` | optional Edge Function secret | Public URL of the `twilio-status` function; enables delivery tracking |
| `CRON_SECRET` | Edge Function secret + pg_cron header | **Private** — gates `auto-post` invocation |
| `GALLERY_BASE_URL` | optional Edge Function secret | Public URL; override when moving off github.io |

## RLS hardening (issue #9) — applied in migration 20240031

Every table used to carry `dev_allow_*` policies granting the **anon** role
blanket CRUD. Since `EXPO_PUBLIC_SUPABASE_ANON_KEY` ships inside the app bundle
and is trivially extractable, that was the whole security boundary: anyone
holding it could read every publisher's photos, read every follower's phone
number, rewrite anyone's posting config and delete anyone's uploads.

`20240031_rls_owner_only_policies.sql` drops all of them and replaces each with
an owner-only policy for the `authenticated` role:

| Table | Policy |
|---|---|
| `media` | `owner_all` — `auth.uid()::text = owner_id`, all verbs |
| `candidate_photos` | `owner_all` — `auth.uid()::text = publisher_id`, all verbs |
| `publisher_config` | `owner_all` — same shape |
| `subscribers` | `owner_all` — same shape (reads + revokes; subscribing is service-role) |
| `approval_batches` | `owner_all` — same shape |
| `notification_deliveries` | `owner_all` — same shape |
| `publisher_profile` | `public_read` (anon SELECT) + `owner_write` |
| `posts` | unchanged — anon **select only** (20240018); ids are unguessable 20-hex hashes |

Two deliberate anon exceptions, both because the gallery link a follower opens
is an unauthenticated page (`docs/gallery.html`): it reads `posts` for the feed
and `publisher_profile` for the header name/avatar. `publisher_profile` holds
only `(publisher_id, display_name, avatar_url)` — what the publisher chose to
show followers. Writes to it are owner-only.

This depended on issue #115, landed alongside it: the repositories used to build
their own `persistSession: false` clients, so every query ran as `anon` and no
`auth.uid()`-scoped policy could ever have matched. They now share the one
authenticated client in `src/infrastructure/supabase/client.ts`.

Server paths (`auto-post`, `send-post`, `post-batch`, `delete-candidates`,
`join-webhook`, `subscribe`, `twilio-status`) use the service role, which
bypasses RLS, and are unaffected.

`src/infrastructure/supabase/rls.integration.test.ts` is the negative test: it
seeds rows through the service role, then asserts a bare anon client and a
signed-in *other* user both read zero of them, and that anon writes are refused.

**Rollout:** the migration and the app build must ship together. Applying
20240031 while an older build is live blanks the app (its queries are anonymous);
shipping the new build first is harmless (the old policies still permit it).

## Verified in the deployed environment (2026-07-06)

- `auth.admin.getUserById` works from Edge Functions with the service-role key
  (the caption's name/phone come from it — confirmed in live sends).
- `scheduleNotificationAsync({ identifier })` is supported by the installed
  expo-notifications (0.32.x — `NotificationRequestInput.identifier`), and
  re-scheduling with the same id replaces the previous reminder (tested
  on-device). `cancelScheduledNotificationAsync(id)` cancels it.
- Twilio sandbox end-to-end: collage message + gallery link delivered.
- Permissions: the app is iOS-only (`app.json` platforms) — the
  notification-permission flow has been QA'd on device; re-verify if Android
  is ever added (permission API shapes differ).

## WhatsApp delivery hardening (issue #24)

What the code does now:

- **Retry with back-off** — every send (`src/infrastructure/notifiers/twilioClient.ts`,
  used by the app and by `send-post`, `auto-post`, `subscribe`) retries transient Twilio failures
  (429 / 5xx / network) up to 3 times with exponential back-off
  (0.5s → 1s → 2s). Permanent 4xx failures (invalid number, blocked
  recipient, auth) are never retried.
- **Delivery tracking** — each accepted message is recorded in `message_logs`
  (migration `20240017`) keyed by Twilio message SID; the `twilio-status`
  edge function receives Twilio StatusCallback events (signature-verified)
  and updates the row through queued → sent → delivered / failed.
- **Unreachable subscribers** — a permanent send failure, or a delivery
  failure with a number-level error code (21211, 21610, 21614, 63003, 63024),
  marks the subscriber `unreachable`: future sends skip them, the Followers
  list shows them ("N of M followers can't be reached"), and a rejoin or an
  inbound START re-activates them. Batches abort the remaining messages to an
  unreachable number but never stop the fan-out to other subscribers.

Setup:

1. Apply migration `20240017_message_logs.sql`.
2. Deploy `twilio-status` and set the secret
   `TWILIO_STATUS_CALLBACK_URL=https://<project>.functions.supabase.co/twilio-status`
   on `send-post`, `auto-post`, `subscribe` AND `twilio-status` itself (it
   doubles as the signature-verification URL).
3. Recommended: create a Twilio **API key** (Console → Account → API keys) and
   set `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET`; sends then stop using
   the account auth token, which can be rotated independently. Keep
   `TWILIO_AUTH_TOKEN` set regardless — `join-webhook` and `twilio-status`
   verify X-Twilio-Signature with it. Secrets live in
   Supabase's secrets manager (`supabase secrets set ...`), never in the app
   bundle or repo.
4. Production sender: register a WhatsApp Business sender in the Twilio
   console (Messaging → Senders → WhatsApp) and point
   `TWILIO_WHATSAPP_FROM` at the approved number — the sandbox number
   (`+14155238886`) is dev-only (72h joins, low caps).
5. Message templates (required on a production sender): posts are business-
   initiated and land outside WhatsApp's 24h session window, so they must go
   out as **Meta-approved templates**, not free-form text. Two templates are
   registered via the Content API (see below); set their ContentSids as
   secrets and the send functions switch to the template path automatically:
   - `TWILIO_TEMPLATE_POST_LOCATION_SID` — with the "from {place}" clause
     (`follow_me_post_location`)
   - `TWILIO_TEMPLATE_POST_SID` — no place (`follow_me_post`), used by
     auto-post (candidate photos are location-less) and as the fallback
   `send-post` / `auto-post` send via the template only when these are set AND
   a collage + gallery link + publisher phone are present; otherwise they fall
   back to the free-form caption (fine in the sandbox / before approval). Do
   NOT set these secrets until the templates show `approved`, or sends fail
   with 63016. Template bodies mirror `composeAutoPostBody`; the variable order
   is asserted by `postTemplate.test.ts` — re-cut both together.
   The reply link is a whole *variable* value (`{{5}}` / `{{6}}`), not part of
   the approved body text, so issue #143's switch to a pre-filled
   `wa.me/<phone>?text=Re%3A…` needs **no** re-approval — the templates are
   untouched. Keep it that way: put URL changes in the variable, never in the
   body. The invite
   share text (`buildInviteMessage`) is sent from the publisher's own phone via
   the OS share sheet, NOT through Twilio, so it needs no template.

## Error monitoring — Sentry (issue #10)

`@sentry/react-native` is initialised at the top of `App.js` (before the root
component mounts) and captures unhandled JS exceptions, React render errors
(root wrapped with `Sentry.wrap`) and native crashes. Use-case failures are
tagged `operation: share_photo`, `sync_candidate_photos`, … via the `monitored`
wrapper in `src/composition/container.ts`, so Sentry can be filtered by flow.

Local dev and simulator builds NEVER report: monitoring activates only when
`EXPO_PUBLIC_APP_VARIANT` is `staging`/`production` (set by the EAS
preview/production profiles) AND a DSN is present. The `environment` field in
each event mirrors the variant, so staging noise is separable from production.

One-time setup (until done, Sentry is silently off and CI skips the upload):

1. Create a React Native project at sentry.io; note the **org slug**,
   **project slug** and **DSN** (the DSN is public-safe — it can only ingest).
2. Paste the DSN into `EXPO_PUBLIC_SENTRY_DSN` in BOTH `eas.json` build
   profiles (currently `""` = disabled). The OTA workflow reads the same
   profiles, so this covers builds and updates alike.
3. Source maps / debug symbols:
   - EAS env vars for builds: `SENTRY_ORG`, `SENTRY_PROJECT` (plain) and
     `SENTRY_AUTH_TOKEN` (secret) — the `@sentry/react-native/expo` config
     plugin uploads during `eas build`. NOTE: once the plugin is in the app
     config, an EAS build without `SENTRY_AUTH_TOKEN` fails at the upload
     step — set `SENTRY_DISABLE_AUTO_UPLOAD=true` to build without it.
   - GitHub Actions (repo Settings): variables `SENTRY_ORG`,
     `SENTRY_PROJECT` + secret `SENTRY_AUTH_TOKEN` — `deploy-app.yml` uploads
     maps for every OTA update (readable stack traces need the maps of the
     exact update that crashed).
4. Adding the native SDK is a native change: ship a fresh `eas build` (both
   variants) before relying on crash reports; an OTA update alone won't load it.

## Ops checklist before enabling autonomous mode in production

1. Migrations up to `20240017` applied (`supabase db push`).
2. `classify-photos` deployed with `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`).
3. `auto-post` deployed with `CRON_SECRET` + Twilio secrets; `send-post` and
   `twilio-status` deployed (same Twilio secrets +
   `TWILIO_STATUS_CALLBACK_URL`).
4. `pg_cron` + `pg_net` enabled; cron schedule installed (see
   `supabase/cron.example.sql`).
5. RLS hardening above completed.
6. Twilio: production WhatsApp sender approved (sandbox joins expire every
   72h and message caps are low — dev only); sender inbound webhook →
   `join-webhook`; post templates `approved` and their ContentSids set as
   `TWILIO_TEMPLATE_POST_SID` / `TWILIO_TEMPLATE_POST_LOCATION_SID`.
7. Integration tests: `npm run test:integration` (env-gated; see the
   `*.integration.test.ts` headers for required vars).

## Privacy — photo upload consent, retention & deletion

Saving auto-posting settings uploads recent library photos (downscaled to
≤2048px JPEG on-device) so the server can compose and send posts. Controls in
place:

- **Consent**: the save flow asks for explicit confirmation before the first
  upload (stored flag; declining skips the sync).
- **Deletion**: "Delete my uploaded photos" in the Auto-posting section calls
  the `delete-candidates` Edge Function — wipes the caller's
  `candidate_photos` rows and best-effort deletes the Cloudinary assets.
  Cloudinary cleanup requires the optional function secrets
  `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`;
  without them only DB rows are removed (assets must be pruned from the
  Cloudinary console).
- **Retention**: every `auto-post` cron tick garbage-collects
  `candidate_photos` older than 35 days (longest lookback window + slack).

TODO(production):
- reflect the upload/retention behavior in the published privacy policy and
  onboarding;
- allow clearing the stored Expo push token (`publisher_config.expo_push_token`)
  when the user disables reminders.

## iOS extension setup (contributors)

The two notification extensions are **opt-in native additions** — the app
builds and runs fine without them (no push images / photo-grid expanded view).
To add them after a fresh clone or `expo prebuild`:

```bash
npm run setup:ios-extensions
```

Bundle id + dev team are derived from the main target's build settings in
`ios/*.xcodeproj`; override or supply them explicitly with:

```bash
MAIN_BUNDLE_ID=com.you.yourapp DEV_TEAM=ABCDE12345 npm run setup:ios-extensions
```

The scripts are idempotent (re-runs refresh the `native/` sources and skip
existing targets) and fail fast when the values can't be determined.

## Running the integration tests locally

```bash
# .env needs: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
# EXPO_PUBLIC_CLASSIFY_FN_URL, TWILIO_* and WHATSAPP_TEST_RECIPIENT
npm run test:integration
```

Every suite that touches a publisher-owned table now needs a **signed-in**
client, because the RLS policies match `auth.uid()` (see the section above), so
add:

| Var | What it is |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | seeds/cleans rows the way an Edge Function does |
| `AUTH_TEST_PHONE` | a Supabase **test phone number** (Auth → Phone) |
| `AUTH_TEST_OTP` | that number's fixed OTP — no real WhatsApp send |

The test user's `auth.uid()` becomes the `publisher_id` under test; a made-up
publisher string is now rejected by the policy's `WITH CHECK`.

Each `*.integration.test.ts` self-skips when its env vars are absent, so CI
stays green without secrets; `npm run validate` runs typecheck + lint + the
unit suite only.
