# Contributing to Follow Me

Thank you for your interest in contributing. Please read this guide before opening a PR.

## Setup

```bash
git clone https://github.com/omermizrahi15/follow-me.git
cd follow-me
npm install
```

`npm install` is required — it sets up Husky, which installs the pre-commit hook that runs validation automatically before every commit.

That is everything the tests need. To get the **app** running, follow [README → Getting started](README.md#getting-started): it walks clone → env → simulator and includes a fully local `supabase start` backend, so you never need credentials for the shared staging or production project.

## Before you write any code

This project is built TDD. Write the test first, watch it fail, then implement. Every new behaviour needs a test alongside it — no exceptions.

Read the architecture section in the README before touching any files. The layers have strict boundaries enforced by ESLint. If the linter complains about an import, the fix is not to disable the rule — it's to rethink the approach.

## Running checks locally

```bash
npm test                  # unit tests only (fast)
npm run typecheck         # TypeScript errors
npm run lint              # ESLint + architecture boundaries
npm run validate          # all three in sequence — run this before pushing
npm run test:integration  # requires env vars (see .env.example)
deno task test            # Deno tests for Supabase Edge Functions
deno task check           # deno check on every function entrypoint
```

The pre-commit hook runs `npm run validate` automatically. If it fails, the commit is blocked. Fix the errors before committing.

**Deno tests:** Supabase Edge Functions live under `supabase/functions/` and test themselves with Deno test files (`*_test.ts`). These are separate from the npm test suite and must pass before deploying any functions. Run both `deno task test` and `deno task check` before pushing changes to Edge Functions.

## Architecture boundaries

The ESLint config enforces these rules and will fail the build if violated:

- **Domain** must not import from any other layer
- **Application** must not import from infrastructure or UI
- **UI** must not import from infrastructure directly — only through hooks that call use cases
- **Screens** must not import use cases directly — go through a hook

Enforcement depends on `eslint-import-resolver-typescript` being wired through `settings['import/resolver']` in `.eslintrc.js`. Without it the `import` plugin cannot resolve `.ts`/`.tsx` paths, every restricted import silently fails to resolve, and the zones match nothing while lint stays green — which is exactly what happened up to #107. `src/layerBoundaries.test.ts` guards that wiring; don't delete it.

There are no `eslint-disable` waivers on these rules, and new ones shouldn't be added. When a screen needs something that lives in `infrastructure/`, there are two honest ways out, and the right one is usually obvious:

- **The thing is pure** — no I/O, no SDK, just a transform over data. It belongs in `domain/`. `displaySizedUri` and `POST_NOW_ACTION` moved there for exactly this reason.
- **The thing is a real capability** — a cache, the photo library, the crash reporter. Bind it in `composition/container.ts` and import it from there, like every use case already is.

If you need to add a new delivery mechanism (email, push notifications, etc.), implement the `INotifier` interface in `infrastructure/notifiers/`. Do not modify any use case.

## Code that runs in both runtimes

The app is not the only thing that runs our business rules. The Supabase Edge Functions post autonomously, answer Twilio's webhooks, and pick photo batches with no device involved — so a handful of modules under `src/` execute in **two runtimes**: React Native (via Metro) and Deno (via `supabase functions deploy`).

**There is one copy of each, and it lives in `src/`.** The Edge Functions import it by relative path:

```ts
// supabase/functions/auto-post/index.ts
import { selectBatch } from '../../../src/domain/services/photoSelection.ts';
```

Until #117 these were hand-maintained Deno mirrors under `supabase/functions/_shared/`, kept in step by a `// KEEP IN SYNC` comment. Six of them, ~2,000 lines, one of which decided which photos a publisher's followers actually receive. Don't bring that back: `src/dualRuntime.test.ts` fails on any file under `supabase/functions/` carrying a mirror marker.

What lives there now:

| Module | Runs the |
|---|---|
| `domain/services/photoSelection.ts` | batch selection, app-side and in `auto-post` |
| `domain/services/autoPostSchedule.ts` | cadence check |
| `domain/services/postingLocation.ts` | GPS clustering and place naming |
| `domain/services/notificationBody.ts` | message copy |
| `domain/services/inboundCommand.ts`, `optOutMessages.ts` | STOP/START/JOIN handling |
| `infrastructure/notifiers/twilioClient.ts`, `twilioSignature.ts` | WhatsApp sends, webhook verification |
| `infrastructure/geocoding/bigDataCloud.ts` | reverse-geocode endpoint and parsing |

### Three rules for a dual-runtime module

1. **It imports nothing.** Deno resolves relative specifiers as URLs, so it cannot follow the extensionless imports the rest of the app is written in. One `import type { Foo } from '../entities/Foo'` and every Edge Function stops resolving. A module that needs a type must declare it and let the barrel re-export it — that's why `Coordinate` is defined in `postingLocation.ts` and re-exported from `domain/interfaces`. `src/dualRuntime.test.ts` enforces this on every module the functions import.
2. **Web standards only.** `fetch`, `crypto.subtle`, `btoa`, `URLSearchParams` — yes. `node:crypto`, `__DEV__`, `expo-*`, anything from `react-native` — no. Where a runtime genuinely differs, keep the pure part shared and the platform part separate: `bigDataCloud.ts` holds the endpoint and the parsing, while each runtime keeps its own fetch because only the app has `__DEV__` logging.
3. **Take the runtime's differences as arguments.** `resolveBatchPlace` takes a lookup function, `credsFromEnv` takes the environment object, `selectBatch` takes a projection so each side keeps its own row type. Nothing reaches for a global.

### How each runtime consumes it

- **App** — a normal import; Metro and `ts-jest` resolve it like any other module. Jest suites sit beside the code as `*.test.ts`.
- **Deno** — imported with the `.ts` extension. The Deno-side suites live in `supabase/functions/_shared/*_test.ts`, run by `deno task test`, and exist to prove the module still compiles and behaves under Deno; the exhaustive behavioural coverage stays in Jest.
- **Deploys** — `scripts/deploy-functions.sh` passes `--use-api`, which is required: the default Docker bundler cannot follow an import out of `supabase/`.
- **CI** — `scripts/changed-functions.sh` derives the dual-runtime file list from the imports themselves, so editing one of these fans out to every service's test and deploy job. Editing anything else under `src/` doesn't.

Run both before pushing:

```bash
npm run validate     # typecheck + lint + jest
deno task test       # the Deno side
deno task check      # deno check on every function entrypoint
```

## Signing in locally

The app uses phone OTP over WhatsApp for authentication. There's no manual verification needed — `SupabaseAuthService.ts` handles the auth flow, and `PhoneSignInScreen.tsx` collects the phone number. The E2E test suite (`e2e-ui` skill) uses a test OTP via `supabase start` (see [README → Getting started](README.md#getting-started) for the test account setup).

## The subscriber join flow (web page → DB)

A follower subscribes through a **static web page** plus one **Supabase Edge
Function** — no Twilio, no WhatsApp round-trip:

1. **The page** — `docs/join/index.html`, hosted on **GitHub Pages**. The app's
   invite link is `https://<user>.github.io/follow-me/join/?p=<publisherId>`. It
   asks for the follower's WhatsApp number and POSTs it to the `subscribe`
   function. (It's a static HTML file because Supabase Edge Functions can't serve
   HTML — they force every response to `text/plain`.)
2. **`subscribe`** (`supabase/functions/subscribe`) — `POST /subscribe` with
   `{ publisherId, contactHandle }`. Validates both, then inserts/reactivates the
   subscriber using the **service-role key** (bypasses RLS — no public write
   policy needed, and numbers are never exposed to the anon role). Returns JSON.

Twilio is only needed later, to *deliver* photos to subscribers (see #24/#31) —
not to subscribe.

> The `join` and `join-webhook` functions are an **alternative** WhatsApp-native
> flow (tap → send a prefilled WhatsApp message → webhook subscribes you). It
> avoids typing a number but requires an approved WhatsApp Business sender, so
> it's parked behind #31 and not the active path.

### Deploying

```bash
# one-time
supabase login
supabase link --project-ref <your-project-ref>

# deploy / redeploy — rerun after editing the function.
# --no-verify-jwt is REQUIRED: the page calls this anonymously (no auth token),
# so without it every request 401s. Run from a checkout where
# `ls supabase/functions` shows `subscribe`, or you'll get "Entrypoint path does
# not exist".
supabase functions deploy subscribe --no-verify-jwt
```

Verify it's live (a bad number should come back as a JSON validation error, which
proves it deployed and runs):

```bash
curl -s -X POST "https://<your-project-ref>.supabase.co/functions/v1/subscribe" \
  -H 'content-type: application/json' -d '{"publisherId":"x","contactHandle":"nope"}'
# expect JSON like: {"ok":false,"error":"This invite link is invalid or has expired."}
```

### Hosting the page (GitHub Pages)

The page lives in `docs/join/` so GitHub Pages can serve it from the default
branch. Enable it once: **repo Settings → Pages → Build and deployment → Deploy
from a branch → `main` / `/docs`**. (It must be on `main`, so this goes live when
the change merges.)

- Apply the `subscribers` migration (`supabase/migrations/`) if you haven't.
- If you fork/rename the repo, update `JOIN_BASE_URL` in
  `src/ui/hooks/useInviteLink.ts` and `SUBSCRIBE_URL` in
  `docs/join/index.html`.

## CI workflows

A required check on main that fails blocks all merges. Here's what runs and when:

| Workflow | Trigger | Blocks merge? | Purpose |
|---|---|---|---|
| `ci.yml` (app) | app code, config, or package changes on main or any PR | Yes | Lint, typecheck, unit tests (`npm run validate`) |
| `ci-services.yml` (functions) | Edge Function code changes on main or any PR | Yes | Deno tests for changed functions (`deno task test`) |
| `integration.yml` | on main merge only | Yes | Hit the staging Supabase project with integration tests |
| `native-build-check.yml` | any PR | No (informational) | Warns if you need a native rebuild (`eas build`) |
| `deploy-app.yml` (OTA) | app merge to main | No (informational) | Ship JS bundle to staging EAS channel; promote to prod manually |
| `deploy-db.yml` (migrations) | migration merge to main | Yes (staging only) | Apply pending migrations to staging; production requires manual workflow run |
| `deploy-services.yml` (functions) | function merge to main | No (informational) | Deploy changed Edge Functions to staging; production requires manual run |
| `e2e-ui.yml` | manual workflow run only | No | Build native iOS binary + run Maestro E2E suite |
| `sentry-to-issue.yml` | runs every 6 hours | No | File GitHub bugs for critical Sentry crashes |
| `web-e2e.yml` | web pages (docs/join/, docs/gallery.html) change | No | Playwright tests on the subscribe page and post gallery |

## Environment variables

```bash
cp .env.example .env
```

`.env.example` is split into three sections: the five variables the app refuses to boot without, the optional ones (each says what degrades if you leave it unset), and the ones the app never reads at all — Edge Function secrets and integration-test inputs. [README → Getting started](README.md#getting-started) says where each value comes from.

Integration tests are skipped automatically if the relevant env vars are not set — so `npm test` always works without any setup.

Start the app with something missing and you get a "Setup needed" screen listing every missing variable at once, rather than a blank app. The check lives in [`src/infrastructure/env.ts`](src/infrastructure/env.ts); adding a newly-required variable means adding it to `REQUIRED` there, not a fresh `throw` at the point of use.

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <short description>
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`

The subject line must be under 72 characters, imperative mood, no period at the end.

## Opening a PR

- Branch from `main` with a descriptive name (`feat/whatsapp-notifier`, `fix/subscriber-activation`)
- Every PR must include tests for the changed behaviour
- Run `npm run validate` and confirm it passes before opening the PR
- Fill in the PR template — it will appear automatically on GitHub
- At least one of [@urishiber](https://github.com/urishiber) or [@omermizrahi15](https://github.com/omermizrahi15) must approve before merging