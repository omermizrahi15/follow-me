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
2. Apply the policies below (and drop every `dev_allow_*` policy).
3. `posts` keeps anon **select only** (the public gallery page reads it); ids
   are unguessable 20-hex-char hashes.
4. Server paths (`auto-post`, `send-post`, `delete-candidates`) use the
   service role and are unaffected.

Exact SQL to apply (once step 1 lands):

```sql
-- candidate_photos: owner-only, all verbs
drop policy if exists dev_allow_select on candidate_photos;
drop policy if exists dev_allow_insert on candidate_photos;
drop policy if exists dev_allow_update on candidate_photos;
drop policy if exists dev_allow_delete on candidate_photos;
create policy owner_all on candidate_photos
  for all to authenticated
  using (auth.uid() = publisher_id)
  with check (auth.uid() = publisher_id);

-- publisher_config: owner-only, all verbs (same shape)
create policy owner_all on publisher_config
  for all to authenticated
  using (auth.uid() = publisher_id)
  with check (auth.uid() = publisher_id);

-- media: owner writes; keep read open only if the feed must work signed-out
create policy owner_write on media
  for insert to authenticated
  with check (auth.uid() = owner_id);

-- posts: public gallery needs anon SELECT only — no anon writes
-- (the existing "anon can read posts" select policy stays; writes are
-- service-role only because no other policy exists.)
```

Add an RLS test pass (a small integration test signing in as two users and
asserting cross-user reads/writes fail) before flipping these on.

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

1. Migrations up to `20240015` applied (`supabase db push`).
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

Each `*.integration.test.ts` self-skips when its env vars are absent, so CI
stays green without secrets; `npm run validate` runs typecheck + lint + the
unit suite only.
