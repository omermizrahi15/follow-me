# E2E UI testing

Real-UI tests that drive the app on the iOS simulator with [Maestro](https://docs.maestro.dev) — declarative YAML flows, no native test code. Flows live in [`.maestro/flows/`](../.maestro/flows). This complements the jest suites (`npm test`, `test:integration`, `test:e2e`), which never render the UI.

## One-time setup

1. **Install Maestro** (the CLI needs Java 17+)
   ```sh
   brew install openjdk@17          # skip if you already have a JDK
   curl -fsSL https://get.maestro.mobile.dev | bash
   ```
   Make sure both are on your PATH, e.g. in `~/.zshrc`:
   ```sh
   export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH:$HOME/.maestro/bin"
   ```
2. **Configure a Supabase test OTP** so sign-in works without a real WhatsApp message:
   Supabase Dashboard → Authentication → Providers → Phone → **Test OTPs**. Add a fake number and a fixed code, e.g. `+15005550006` → `123456`. Verifying that pair creates a real session against your project without sending anything.
3. **Build the app for the simulator** (Release config, so the JS bundle is embedded and Metro isn't needed). `.env` must exist in the checkout — the `EXPO_PUBLIC_*` values are baked into the bundle at build time.
   ```sh
   npm run e2e:ui:build
   ```
   Rebuild after any change you want to test — JS included, since there is no Metro at test time.

## Running

```sh
# Everything except AI assertions (recommended default)
npm run e2e:ui -- -e E2E_PHONE=+15005550006 -e E2E_OTP=123456

# Smoke flows only — no backend, no env vars
npm run e2e:ui:smoke

# AI visual assertions (needs MAESTRO_CLI_AI_KEY, OpenAI or Anthropic)
npm run e2e:ui:ai
```

A booted iOS simulator with the app installed is required (`xcrun simctl boot "iPhone 16"` or just run the build script, which boots one).

## Flow inventory

| Flow | Tag | Covers |
| --- | --- | --- |
| `onboarding` | `smoke` | Fresh install → intro step → Get started → sign-in screen |
| `sign-in` | `auth` | Phone + test OTP → lands on the Me page |
| `navigation` | `auth` | Settings, Edit profile open, Upload modal, section nav |
| `edit-profile` | `auth` | Edit name → Save → new name shows on the Me page |
| `add-post` | `auth` | Me → Add post → New-post modal + picker entry point → close |
| `auto-posting` | `auth` | Configure frequency / reminder day+time / photos-per-post → Save |
| `remove-cloud-photos` | `auth`, `quarantine` | "Remove my photos from the cloud" → confirm → warning clears (regression for [#58](https://github.com/omermizrahi15/follow-me/issues/58); quarantined until the fix lands) |
| `followers` | `auth` | Followers section list/empty state + invite entry point |
| `sign-out` | `auth` | Settings → Sign out → back to the phone sign-in screen |
| `ai-visual-check` | `ai` | Fuzzy "does this screen look right" assertions via `assertWithAI` |

Flows run in the order defined in `.maestro/config.yaml`. `sign-in` persists a session the other `auth` flows reuse; `sign-out` runs last because it tears that session down. The `auth` flows are skipped in CI until the test-OTP secrets are set (`sign-in` can't establish the session without them).

Deliberately **not** automated end-to-end (they depend on the iOS system UI or seeded backend data, which aren't deterministic on a CI simulator): completing a photo upload past the system picker, sharing the invite via the system share sheet, and the data-dependent suggestion-review screen. The flows above stop at the app boundary for these.

## AI-maintained tests

The heavy lifting is meant to be done by Claude Code via the [`e2e-ui` skill](../.claude/skills/e2e-ui/SKILL.md):

- **"add an E2E flow for X"** — Claude reads the screen source, adds missing `testID`s, writes the flow, runs it until green.
- **"the E2E flows are failing"** — Claude reproduces the single failing flow, diffs `maestro hierarchy` output against the selectors, and repairs flow or `testID`.

Conventions (also enforced by the skill): select by `testID` (`id:` in Maestro), one journey per file, tag `smoke`/`auth`/`ai`, `extendedWaitUntil` for network waits. A flow that encodes the *expected* behavior of a known open bug additionally gets the `quarantine` tag, which the default `e2e:ui` script excludes — remove the tag (and its exclude in `package.json` if it's the last quarantined flow) together with the bug fix.

## CI

A GitHub Actions job runs the flows on a macOS runner so nobody has to run them by hand — see [`.github/workflows/e2e-ui.yml`](../.github/workflows/e2e-ui.yml). It builds the Release app, boots a simulator, runs the smoke flows, and runs the auth flows when the test-OTP secrets are present.

Building the native iOS app takes ~15 min, so E2E is **never on the PR critical path** — PRs are gated only by the fast Ubuntu `CI` workflow (typecheck/lint/tests, ~1 min). E2E runs:

- **After `CI` passes on `main`** (`workflow_run`) — an async, post-merge regression signal that blocks nothing. This is the primary trigger.
- **On demand** — Actions tab → *E2E UI (Maestro)* → *Run workflow*.
- **Nightly** — 06:00 UTC, as a safety net.

Note: `workflow_run` only fires once this workflow is on the default branch, and it runs against `main` — so it validates merged code, not the PR diff. That's the intended trade-off: keep PRs fast, catch regressions right after merge. A ~1-min run isn't possible here — the cost is the native build, not the flows.

### Required repo secrets

| Secret | Needed for | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | all flows | Baked into the bundle; without it the app white-screens and even smoke fails |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | all flows | Same |
| `E2E_PHONE` | auth flows | Supabase **test OTP** number; auth flows are skipped if unset |
| `E2E_OTP` | auth flows | The fixed code paired with `E2E_PHONE` |
| `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` | optional | `container.ts` requires it at startup or the app white-screens; CI falls back to a placeholder (fine for UI flows). Set the real value only if a flow exercises photo upload. |
| `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | optional | Same as above |
| `EXPO_PUBLIC_CLASSIFY_FN_URL` | optional | Same as above (AI photo suggestions) |

## Web E2E — the follower-facing pages

The subscribe page (`docs/join/index.html`) and the post gallery (`docs/gallery.html`) are static browser pages, not part of the iOS app, so Maestro can't reach them. They're covered separately with **Playwright**; every backend call is intercepted, so the tests are deterministic and touch no real data.

- [`web-e2e/subscribe.spec.ts`](../web-e2e/subscribe.spec.ts) — render the form, successful subscribe → confirmation, the exact `{publisherId, contactHandle}` payload sent to the `subscribe` edge function, server-error and network-error handling.
- [`web-e2e/gallery.spec.ts`](../web-e2e/gallery.spec.ts) — the two-view flow a follower gets from the WhatsApp link: `?id=` opens that post, back (browser button or in-page) lands on the publisher's whole feed, a card opens its post, and back out of a photo returns to the post rather than the feed.

```sh
npm run e2e:web          # headless chromium, ~6s; serves docs/ on :8080
npx playwright test --ui # interactive
```

Runs on Ubuntu in ~1-2 min, so — unlike the simulator suite — it gates **every** push/PR ([`.github/workflows/web-e2e.yml`](../.github/workflows/web-e2e.yml)). Needs `python3` (present on the runner) to serve `docs/`.

## Not covered (yet)

- Photo picking/upload past the system photo picker (Maestro can tap into it, but the flow stops at the modal for now).
- The subscribe page's real backend round-trip (the edge function itself) — the Playwright tests mock it; the function has its own server-side tests.
