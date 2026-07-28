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

Every workflow is named with a `CI ·` or `CD ·` prefix, so the Actions sidebar groups
checks (run on PRs, verify) apart from deploys (run on merge to `main`, ship). This
table is the full map — what you see under *Actions* is exactly these:

| Workflow (Actions name) | File | When it runs | What it does |
|---|---|---|---|
| **CI · app** | [`ci.yml`](.github/workflows/ci.yml) | every PR touching `src/**` | typecheck + eslint + jest (the `validate` job is the required merge check) |
| **CI · services** | [`ci-services.yml`](.github/workflows/ci-services.yml) | PR touching `supabase/functions/**` | per-changed-function Deno lint + typecheck + test, one matrix job each |
| **CI · integration (staging)** | [`integration.yml`](.github/workflows/integration.yml) | PR touching `src/infrastructure/` or `supabase/` | integration suite against the real staging Supabase |
| **CI · e2e web (join page)** | [`web-e2e.yml`](.github/workflows/web-e2e.yml) | PR touching `docs/join/` or `web-e2e/` | Playwright on the public subscribe page |
| **CI · e2e app (Maestro)** | [`e2e-ui.yml`](.github/workflows/e2e-ui.yml) | after `CI · app` passes on `main`, nightly, or on demand — never on the PR critical path (~15-min simulator build) | Maestro UI flows on the iOS simulator |
| **CI · native rebuild check** | [`native-build-check.yml`](.github/workflows/native-build-check.yml) | PR touching `package.json`/`package-lock.json`/`app.json`/`app.config.js`/`eas.json`/`ios/**` | warns when the change needs `eas build` (can't ship OTA) — diff heuristic, then the real fingerprint-vs-installed-build check; never blocks |
| **CD · app (EAS OTA)** | [`deploy-app.yml`](.github/workflows/deploy-app.yml) | merge to `main` (app paths) | EAS Update (OTA) → staging channel; production via *Run workflow*. Fails red if the update reached no device, and auto-starts the staging rebuild |
| **CD · services (Edge Functions)** | [`deploy-services.yml`](.github/workflows/deploy-services.yml) | merge to `main` (function paths) | per-changed-function `functions deploy` → staging; production via *Run workflow* |
| **CD · database (migrations)** | [`deploy-db.yml`](.github/workflows/deploy-db.yml) | merge to `main` (`supabase/migrations/`) | `db push` → staging; production via *Run workflow* |
| **pages build and deployment** | *(GitHub-managed)* | merge to `main` (`docs/**`) | publishes GitHub Pages — this is the CD for the join page; the name can't be changed |

**Per-service granularity.** `ci-services.yml` and `deploy-services.yml` diff the commit and act **only on the functions that changed** — each in its own matrix job — via [`scripts/changed-functions.sh`](scripts/changed-functions.sh). A change under `supabase/functions/_shared/**` fans out to every function (they all depend on it). Deploys use [`scripts/deploy-functions.sh`](scripts/deploy-functions.sh), the single source of truth for each function's `verify_jwt` setting.

**Promotion model.** Every CD workflow auto-deploys to **staging** on merge to `main` (path-filtered), and deploys to **any environment on demand** via *Actions → Run workflow* (choose `staging`/`production`, and for services an optional list of function names or `all`). Production jobs run under the `production` GitHub Environment, so you can require a reviewer (Settings → Environments).

**Do I need to rebuild the app?** You never have to guess. `runtimeVersion` is the `fingerprint` policy ([`app.config.js`](app.config.js)), so every OTA is tagged with a hash of the native layer and is delivered *only* to builds carrying that same hash — change a native module or the app config and the update publishes fine but reaches nobody. Both CI and CD ask EAS whether an installed build shares the hash ([`ota-rebuild-check.mjs`](.github/scripts/ota-rebuild-check.mjs)):

- **On the PR** — a job summary saying either "OTA is enough" or which native input moved (`added — native module react-native-webview`). Advisory, never blocks.
- **On merge** — if the update reached no device the **CD job goes red** (so GitHub emails you) and, for staging, a fresh `eas build --profile preview` is **started automatically**; the summary links it. Production only reports, so a production build is never spent unasked.

Installing the finished `.ipa` is the one manual step — internal distribution can't push a binary to the phone. To save retyping the build URL there, the summary links **[📱 Scan to install](docs/install/index.html)** ([`docs/install/`](docs/install/index.html) on the Pages site), which shows a QR of the build page. The symbol is encoded by CI and passed in the link's fragment, so that page ships no QR library and makes no network calls; it can't be drawn in the job summary directly, because GitHub's code blocks gap every glyph row (no decoder reads it) and its sanitizer strips the `src` off `data:` images.

**Service tests** live next to the code as Deno `*_test.ts` (e.g. [`supabase/functions/_shared/optOut_test.ts`](supabase/functions/_shared/optOut_test.ts)); run them locally with `deno task test`. Functions without unit tests yet still get lint + typecheck in CI.

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
