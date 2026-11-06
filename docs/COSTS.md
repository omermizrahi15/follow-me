# Costs — inventory and cuts (issue #236)

Goal: run the product for a few dollars a month. **Monthly $ columns are blank on
purpose** — fill them from each provider's billing page; this file only records
what drives each bill and the first cut to try. Nothing here is a quoted price.

| Service | Used for | Cost driver | Monthly $ | First cut |
|---|---|---|---|---|
| Twilio / WhatsApp | Post + welcome + keepalive messages | Per template message sent; scales with followers × posts | | Push-first; WhatsApp only for opted-in followers; one message per batch (never per photo); cap sends per publisher/day |
| Groq | Photo grading (primary) | Tokens per minute/day; ~8 photos/min | | Grade newest window only; reuse the persistent grade cache; downscale images before grading |
| Gemini | Photo grading (fallback) | Free tier is tiny (20 req/day); billed beyond | | Keep as last-resort fallback; do not raise quota; fail soft to a reminder |
| Supabase (prod + staging) | DB, auth, Edge Functions, storage, pg_cron | Plan tier, egress, function invocations | | Pause/teardown staging when idle; enforce candidate-photo retention; thumbnails over originals |
| Cloudinary | Uploaded photo hosting | Storage + bandwidth + transforms | | Smaller uploads, auto-expire candidates, cache-friendly URLs |
| MapTiler | Globe/map tiles | Tile requests | | Stay on free tier; cache tiles; no tiles on non-globe screens |
| EAS | Builds, OTA | Build minutes/plan | | OTA over rebuilds (see fingerprint check); build only when fingerprint changes |
| Sentry | Error monitoring | Event volume | | Sample rates; drop noisy network errors (#178, #179) |
| GitHub Actions | CI, E2E, native build checks | Minutes (macOS runners are 10×) | | Path filters, cancel superseded runs, E2E on label/nightly |
| Apple Developer | Distribution | Fixed $99/yr | | none |
| Domain | Website | ~$10–15/yr | | Buy once name is cleared (#236 §1) |

## Guards already in code
- `classify-photos`: per-user daily quota via `CLASSIFY_DAILY_QUOTA` (unset = no cap).

## Guards still to build
- Per-publisher daily cap on WhatsApp sends.
- Monthly spend alert per provider (budget + email).
- Retention check that candidate photos really expire.
