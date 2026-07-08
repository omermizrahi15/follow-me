# Follow Me

Open-source iOS app that lets publishers share photos and videos with their subscribers — delivered automatically via WhatsApp.

Built with React Native + Expo, clean architecture, and TDD from day one.

---

## What it does

- Publisher selects photos or videos and shares them in one tap
- Every active subscriber receives a WhatsApp notification with the full batch
- Delivery mechanism is pluggable — WhatsApp is the MVP channel, more planned

---

## Architecture

Strict clean architecture with four layers: **Domain → Application → Infrastructure → UI**. Layer boundaries are enforced by ESLint at lint time and block commits via the pre-commit hook.

The composition root ([`src/composition/container.ts`](src/composition/container.ts)) is the only place that wires interfaces to implementations. Swapping a delivery channel or storage provider is a one-line change there — nothing else needs to know.

For a full walkthrough of the structure and the reasoning behind each file, browse [`src/`](src/).

---

## Tech stack

| Layer | Technology |
|---|---|
| Mobile app | React Native + Expo |
| Language | TypeScript (strict) |
| Database | Supabase (PostgreSQL) |
| Media storage | Cloudinary |
| Notifications | Twilio WhatsApp |
| Testing | Jest + ts-jest |

---

## Getting started

```bash
git clone https://github.com/omermizrahi15/follow-me.git
cd follow-me
npm install
```

Copy `.env.example` to `.env` and fill in your credentials — the file documents every variable and which service it belongs to.

```bash
cp .env.example .env
npm test                  # unit tests — fast, no network required
npm run test:integration  # requires real credentials in .env
```

---

## Environments

Two Supabase projects back the app — same schema, same RLS policies (both are built from [`supabase/migrations/`](supabase/migrations)):

| | Production | Staging |
|---|---|---|
| Supabase project | `follow-me` (`eigvoazyrimzbzcjlscp`) | `follow-me-staging` (`xszvrvnxduwpymyabvcg`) |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://eigvoazyrimzbzcjlscp.supabase.co` | `https://xszvrvnxduwpymyabvcg.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | production anon key | staging anon key (see `eas.json` → `preview.env`) |
| `EXPO_PUBLIC_CLASSIFY_FN_URL` | production functions URL | staging functions URL |
| `EXPO_PUBLIC_CLOUDINARY_FOLDER` | unset (assets land in the root) | `staging` — isolates test uploads in one folder |
| EAS build profile | `production` | `preview` |
| App name on device | Follow Me | Follow Me (Staging) |
| iOS bundle id | `com.urishiber.followme` | `com.urishiber.followme.staging` |

The anon keys and URLs are public by design (they ship inside the app binary; RLS is the security boundary), which is why both environments' values live directly in `eas.json` (`production.env` and `preview.env`). `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` / `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET` are shared between environments and come from your local `.env` (or EAS project env vars) — the staging `folder` param keeps the uploads apart.

To point a local dev build at staging, set the four staging values above in your `.env`. `eas build --profile preview` bakes them in automatically.

### Standalone builds (run the app without a laptop)

The backend (Supabase + deployed Edge Functions + cron) runs 24/7 in the cloud, so the only thing tying the app to your machine is Metro during development. A standalone EAS build embeds the JS bundle, points at a cloud backend via the profile's `env`, and installs on your phone to open anytime.

The two variants install as **separate apps and coexist on one device** — [`app.config.js`](app.config.js) switches the name, bundle id, and URL scheme off the `APP_VARIANT` env var each profile sets ([`app.json`](app.json) holds everything else; `app.config.js` layers on top).

```bash
# Production app → live prod backend → TestFlight (permanent install, reinstall anytime)
eas build   --profile production --platform ios
eas submit  --profile production --platform ios   # → TestFlight

# Staging app → staging backend → TestFlight or internal (ad-hoc) distribution
eas build   --profile preview    --platform ios
```

The first iOS build per bundle id prompts once to set up Apple credentials (App ID + provisioning) against your Apple Developer account; EAS stores them for subsequent builds. Each variant also needs its own App Store Connect app record (one per bundle id) before `eas submit`.

Keeping staging in sync after adding a migration:

```bash
supabase db push --db-url "$STAGING_DB_URL"   # session-pooler connection string of follow-me-staging
```

Edge Functions are deployed per environment with `supabase functions deploy --project-ref <ref>`; their secrets (Twilio, Gemini) are set per project via `supabase secrets set --project-ref <ref>`.

CI runs the integration suite against **staging** on every PR that touches `src/infrastructure/` or `supabase/` (see [`.github/workflows/integration.yml`](.github/workflows/integration.yml)) — production credentials never appear in CI.

### CI/CD — separated by concern

Three independent concerns, each with its own path-triggered CI and CD. Touch one and only its pipeline runs; deploy one without touching the others.

| Concern | Runtime | CI (on touch) | CD |
|---|---|---|---|
| **App** (JS bundle) | Node / Jest | [`ci.yml`](.github/workflows/ci.yml) — typecheck + lint + test | [`deploy-app.yml`](.github/workflows/deploy-app.yml) — EAS Update (OTA) |
| **Services** (each Edge Function) | Deno | [`ci-services.yml`](.github/workflows/ci-services.yml) — per-service lint + typecheck + test | [`deploy-services.yml`](.github/workflows/deploy-services.yml) — per-service `functions deploy` |
| **Database** (migrations) | — | (applied by CD) | [`deploy-db.yml`](.github/workflows/deploy-db.yml) — `db push` |

**Per-service granularity.** `ci-services.yml` and `deploy-services.yml` diff the commit and act **only on the functions that changed** — each in its own matrix job — via [`scripts/changed-functions.sh`](scripts/changed-functions.sh). A change under `supabase/functions/_shared/**` fans out to every function (they all depend on it). Deploys use [`scripts/deploy-functions.sh`](scripts/deploy-functions.sh), the single source of truth for each function's `verify_jwt` setting.

**Promotion model.** Every CD workflow auto-deploys to **staging** on merge to `main` (path-filtered), and deploys to **any environment on demand** via *Actions → Run workflow* (choose `staging`/`production`, and for services an optional list of function names or `all`). Production jobs run under the `production` GitHub Environment, so you can require a reviewer (Settings → Environments).

**Service tests** live next to the code as Deno `*_test.ts` (e.g. [`supabase/functions/_shared/optOut_test.ts`](supabase/functions/_shared/optOut_test.ts)); run them locally with `deno task test`. Functions without unit tests yet still get lint + typecheck in CI. OTA app updates cover JS-only changes; native/dependency changes still need a fresh `eas build` (bump the app `version` so `runtimeVersion` advances).

**Required GitHub secrets** (Settings → Secrets and variables → Actions):

| Secret | Used by | How to get it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | service deploys | Supabase → Account → Access Tokens (prefer a dedicated CI token) |
| `STAGING_DB_URL` | db deploy (staging) | ✅ already set — staging session-pooler connection string |
| `PROD_DB_URL` | db deploy (production) | Supabase → follow-me → Connect → **Session pooler** string (includes the DB password) |
| `EXPO_TOKEN` | app deploys (EAS Update) | expo.dev → Account → Access Tokens |

---

## Running on iOS

You'll need Xcode (from the App Store) and CocoaPods installed once per machine:

```bash
xcode-select -p   # should print .../Xcode.app/Contents/Developer
# if it instead points at CommandLineTools, fix it:
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

brew install cocoapods   # if `pod --version` fails
```

Then, from the project root, with `.env` already filled in:

```bash
npx expo prebuild --platform ios   # generates the native ios/ project
cd ios && pod install && cd ..
npx expo run:ios                   # builds, boots a simulator, and launches the app
```

Re-run `expo prebuild --clean` (then `pod install` again) whenever `app.json` or a native dependency in `package.json` changes — the generated `ios/` folder doesn't auto-update otherwise.

To work in Xcode directly, open `ios/FollowMe.xcworkspace` (not the `.xcodeproj`) after `pod install`, pick a simulator from the scheme toolbar, and hit Run. Metro needs to be running for this to work — `npx expo start` in another terminal, or just use `npx expo run:ios` instead, which starts it for you.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide including the branch/PR workflow, commit message standard, and code rules.

The short version: fork the repo, open a branch, write tests first, then code, then open a PR. CI must be green before a PR can merge.

---

## Project status

Active development. See the [issues board](https://github.com/omermizrahi15/follow-me/issues) for everything planned and in progress.

---

## License

MIT — see [LICENSE](LICENSE) for details.
