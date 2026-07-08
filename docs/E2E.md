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
| `navigation` | `auth` | Settings, Edit profile, Upload modal, section nav (reuses the session from `sign-in`) |
| `ai-visual-check` | `ai` | Fuzzy "does this screen look right" assertions via `assertWithAI` |

Flows run in the order defined in `.maestro/config.yaml`; `sign-in` must precede any flow that assumes a session.

## AI-maintained tests

The heavy lifting is meant to be done by Claude Code via the [`e2e-ui` skill](../.claude/skills/e2e-ui/SKILL.md):

- **"add an E2E flow for X"** — Claude reads the screen source, adds missing `testID`s, writes the flow, runs it until green.
- **"the E2E flows are failing"** — Claude reproduces the single failing flow, diffs `maestro hierarchy` output against the selectors, and repairs flow or `testID`.

Conventions (also enforced by the skill): select by `testID` (`id:` in Maestro), one journey per file, tag `smoke`/`auth`/`ai`, `extendedWaitUntil` for network waits.

## CI

A GitHub Actions job runs the flows on a macOS runner so nobody has to run them by hand — see [`.github/workflows/e2e-ui.yml`](../.github/workflows/e2e-ui.yml). It builds the Release app, boots a simulator, runs the smoke flows, and runs the auth flows when the test-OTP secrets are present.

Simulator E2E is slow and costs ~10x macOS-runner minutes, so it is **not** wired to every push/PR. It runs:

- **On demand** — Actions tab → *E2E UI (Maestro)* → *Run workflow*.
- **Nightly** — 06:00 UTC, to catch regressions.

To also gate PRs on it, uncomment the `pull_request` trigger in the workflow.

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

## Not covered (yet)

- Photo picking/upload past the system photo picker (Maestro can tap into it, but the flow stops at the modal for now).
