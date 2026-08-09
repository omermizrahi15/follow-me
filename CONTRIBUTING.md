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
```

The pre-commit hook runs `npm run validate` automatically. If it fails, the commit is blocked. Fix the errors before committing.

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

## Verifying the auth deep link manually

The magic-link redirect (`followme://auth#access_token=...`) can't be unit tested end-to-end — `subscribeToAuthDeepLinks` (`src/infrastructure/auth/deepLinkSubscription.ts`) has full unit coverage for the JS-side wiring, but whether iOS actually hands the URL to the app depends on native config that only a simulator/device can confirm.

With the app running on a booted simulator (`npx expo run:ios`), fire a fake redirect at it:

```bash
xcrun simctl openurl booted "followme://auth#access_token=fake&refresh_token=fake&type=magiclink"
```

The app should come to the foreground without crashing (a fake token still gets rejected by Supabase, but the deep link itself must reach the JS layer). If nothing happens, check `ios/FollowMe/Info.plist` for `CFBundleURLSchemes` containing `followme` — `expo prebuild` regenerates this from `app.json`'s `scheme` field.

If the *real* email magic link doesn't redirect into the app (but this manual check above passes), the cause is almost always the Supabase project's **Authentication → URL Configuration → Redirect URLs** allow-list missing `followme://auth` — Supabase silently falls back to the Site URL instead of erroring when the redirect target isn't allow-listed.

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
  `src/ui/screens/SubscribersScreen.tsx` and `SUBSCRIBE_URL` in
  `docs/join/index.html`.

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