# Production readiness — keys, RLS, ops & privacy

Status notes for the auto-posting feature (issue #17). Everything here works in
the current **dev** posture; items marked TODO(production) must land before a
public launch.

## Key inventory — what is public vs private

| Key | Where it lives | Exposure |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | app bundle (`EXPO_PUBLIC_`), `docs/gallery.html` | **Public by design** — safety comes from RLS, not secrecy |
| `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` / `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | app bundle | **Public** — unsigned upload preset; scope it to image-only + size caps in the Cloudinary console |
| `EXPO_PUBLIC_CLASSIFY_FN_URL` | app bundle | **Public** — the classify-photos function is callable with the anon key on purpose (the app classifies on-device photos pre-upload). Gemini quota abuse is the risk; TODO(production): require an authenticated user JWT instead of the bare anon key |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Edge Function secrets only | **Private** — never in the app |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected into Edge Functions | **Private** — never in the app or repo; verified absent from client env (`.env` carries only `EXPO_PUBLIC_*` Supabase keys) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | Edge Function secrets + local `.env` (integration tests only) | **Private** — WhatsApp sends happen exclusively server-side (`send-post`, `auto-post`); the app calls those functions with the anon key |
| `CRON_SECRET` | Edge Function secret + pg_cron header | **Private** — gates `auto-post` invocation |
| `GALLERY_BASE_URL` | optional Edge Function secret | Public URL; override when moving off github.io |

## RLS hardening — TODO(production)

Current dev posture: `candidate_photos`, `publisher_config`, `subscribers`,
`posts` (select) allow the **anon** role. Anyone with the anon key can read and
(for some tables) write rows. Acceptable for a closed dev instance, unsafe for
production.

Plan:
1. App clients authenticate today (Supabase phone auth) but the repositories
   construct **separate anon clients**. Refactor the repositories to share the
   authed client from `SupabaseAuthService` so `auth.uid()` is available to RLS.
2. Replace every `dev_allow_*` policy with `to authenticated using
   (auth.uid() = publisher_id) with check (auth.uid() = publisher_id)`.
3. `posts` keeps anon **select only** (the public gallery page reads it); ids
   are unguessable 20-hex-char hashes.
4. Server paths (`auto-post`, `send-post`) use the service role and are
   unaffected.

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

## Ops checklist before enabling autonomous mode in production

1. Migrations up to `20240014` applied (`supabase db push`).
2. `classify-photos` deployed with `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`).
3. `auto-post` deployed with `CRON_SECRET` + Twilio secrets; `send-post`
   deployed (same Twilio secrets).
4. `pg_cron` + `pg_net` enabled; cron schedule installed (see
   `supabase/cron.example.sql`).
5. RLS hardening above completed.
6. Twilio: production WhatsApp sender approved (sandbox joins expire every
   72h and message caps are low — dev only).
7. Integration tests: `npm run test:integration` (env-gated; see the
   `*.integration.test.ts` headers for required vars).

## Privacy — photo upload consent

Saving auto-posting settings uploads recent library photos (bounded by the
lookback window, downscaled by Cloudinary on delivery) so the server can
compose and send posts. In-app, the section's copy states this and the save
flow asks for explicit confirmation the first time. TODO(production):
- reflect this in the published privacy policy / onboarding;
- expose "delete my uploaded photos" (a `candidate_photos` wipe +
  Cloudinary cleanup) in Settings;
- allow clearing the stored Expo push token (`publisher_config.expo_push_token`)
  when the user disables reminders.
