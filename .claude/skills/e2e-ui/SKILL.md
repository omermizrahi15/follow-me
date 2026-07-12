---
name: e2e-ui
description: Generate, repair, and run Maestro E2E UI flows for the iOS simulator. Use when asked to add UI test coverage for a screen or user flow, when Maestro flows break after a UI change, or to run the E2E UI suite.
---

# E2E UI testing with Maestro

Flows live in `.maestro/flows/*.yaml`; the workspace config is `.maestro/config.yaml`. Full setup docs: `docs/E2E.md`.

## Running

- Build the app once per native change: `npm run e2e:ui:build` (Release config — no Metro needed; a booted iOS simulator is required).
- Default suite (no API key needed): `npm run e2e:ui -- -e E2E_PHONE=<test phone> -e E2E_OTP=<test otp>`
- Smoke only (no backend at all): `npm run e2e:ui:smoke`
- AI visual assertions (needs `MAESTRO_CLI_AI_KEY`): `npm run e2e:ui:ai`
- `E2E_PHONE`/`E2E_OTP` must be a Supabase **test OTP** pair (Dashboard → Auth → Providers → Phone → Test OTPs) so no real WhatsApp message is sent.

If `maestro` is not installed: `curl -fsSL https://get.maestro.mobile.dev | bash`.

## Conventions

- Selectors: prefer `id:` (React Native `testID`, camel-kebab like `home-add-post`, `signin-phone-input`) over visible text. Add a `testID` to the source component when one is missing — that is part of writing the test, not a workaround.
- Flow files: one user journey per file, `name:` matching the filename, tagged `smoke` (no backend), `auth` (needs the test-OTP sign-in), or `ai` (needs an AI key; excluded from the default suite).
- Ordering: flows run in `executionOrder.flowsOrder` from `config.yaml`. `sign-in` persists a session that later flows reuse via plain `launchApp` (no `clearState`). New signed-in flows go after `sign-in` in that list.
- Waits: use `extendedWaitUntil` with a `timeout` for anything that hits the network; never `waitForAnimationToEnd` loops or sleeps.

## Generating a new flow

1. Read the screen source in `src/ui/screens/` to learn the real UI structure, copy, and existing `testID`s — write assertions from the code, not from guesses.
2. Add missing `testID`s to the interactive elements you need.
3. Write the flow YAML following the conventions above; add it to `flowsOrder`.
4. Run it (`maestro test .maestro/flows/<new>.yaml -e ...`) and iterate until green.

## Repairing a broken flow

1. Reproduce: run the single failing flow file, not the whole suite.
2. Inspect what the simulator actually shows: `maestro hierarchy` dumps the current view tree (ids + text) — diff that against the flow's selectors.
3. Check `git log -p src/ui/` for the UI change that renamed/removed the element, then fix the selector or re-add the lost `testID`.
4. Screenshots on failure land in `~/.maestro/tests/` — read them when the hierarchy is not enough.
