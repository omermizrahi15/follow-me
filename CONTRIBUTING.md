# Contributing to Follow Me

Thank you for your interest in contributing. Please read this guide before opening a PR.

## Setup

```bash
git clone https://github.com/omermizrahi15/follow-me.git
cd follow-me
npm install
```

`npm install` is required — it sets up Husky, which installs the pre-commit hook that runs validation automatically before every commit.

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

If you need to add a new delivery mechanism (email, push notifications, etc.), implement the `INotifier` interface in `infrastructure/notifiers/`. Do not modify any use case.

## Verifying the auth deep link manually

The magic-link redirect (`followme://auth#access_token=...`) can't be unit tested end-to-end — `subscribeToAuthDeepLinks` (`src/infrastructure/auth/deepLinkSubscription.ts`) has full unit coverage for the JS-side wiring, but whether iOS actually hands the URL to the app depends on native config that only a simulator/device can confirm.

With the app running on a booted simulator (`npx expo run:ios`), fire a fake redirect at it:

```bash
xcrun simctl openurl booted "followme://auth#access_token=fake&refresh_token=fake&type=magiclink"
```

The app should come to the foreground without crashing (a fake token still gets rejected by Supabase, but the deep link itself must reach the JS layer). If nothing happens, check `ios/FollowMe/Info.plist` for `CFBundleURLSchemes` containing `followme` — `expo prebuild` regenerates this from `app.json`'s `scheme` field.

If the *real* email magic link doesn't redirect into the app (but this manual check above passes), the cause is almost always the Supabase project's **Authentication → URL Configuration → Redirect URLs** allow-list missing `followme://auth` — Supabase silently falls back to the Site URL instead of erroring when the redirect target isn't allow-listed.

## The subscriber join flow (web → WhatsApp)

The invite link is served by two **Supabase Edge Functions**
(`supabase/functions/`), not the React Native app. The app builds the link from
`EXPO_PUBLIC_SUPABASE_URL` as `…/functions/v1/join/:publisherId` — no separate
domain needed.

1. **`join`** — `GET /join/:publisherId` **302-redirects** straight to WhatsApp
   (`wa.me/<twilio-number>?text=JOIN <publisherId>`). It does *not* render an HTML
   page: Supabase Edge Functions force every response to `text/plain`, so a
   browser would show raw markup — the redirect sidesteps that and is one tap
   fewer for the follower.
2. **`join-webhook`** — Twilio calls `POST /join-webhook` when the follower sends
   that message. It reads their number from WhatsApp's `From` field and upserts
   the subscriber using the **service-role key** (which bypasses RLS — so no
   public write policy on `subscribers` is needed, and contact numbers are never
   exposed to the anon role).

This is why the follower never types their number: it comes from the WhatsApp
message they send.

### Deploying / redeploying

These functions run on Supabase, not in this repo's test suite. Deploy (and
redeploy after any change to a function) with the
[Supabase CLI](https://supabase.com/docs/guides/cli).

> Run from a checkout that actually contains the functions — `ls
> supabase/functions` must show `join` and `join-webhook`. A branch that predates
> them (or the main checkout if it's on an old branch) will fail with
> `Entrypoint path does not exist`.

```bash
# one-time
supabase login
supabase link --project-ref <your-project-ref>

# deploy / redeploy — rerun the exact same command after editing a function.
# --no-verify-jwt is REQUIRED: the callers (anonymous browsers, Twilio) have no
# Supabase auth token, so without it every request 401s.
supabase functions deploy join --no-verify-jwt
supabase functions deploy join-webhook --no-verify-jwt

# Secrets the functions read (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
# injected automatically; set the Twilio ones):
supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_WHATSAPP_FROM=+14155238886
```

A redeploy takes effect within a few seconds. Verify it picked up your change:

```bash
curl -sI "https://<your-project-ref>.supabase.co/functions/v1/join/<a-real-publisher-id>"
# expect: HTTP/2 302  +  location: https://wa.me/...JOIN...
```

Then, to make the flow work end to end:

- In the Twilio console, set the WhatsApp sandbox/number's **"When a message
  comes in"** webhook to the deployed `join-webhook` URL.
- Apply the `subscribers` migration (`supabase/migrations/`) so the upsert's
  `ON CONFLICT (publisher_id, contact_handle)` target exists.

## Environment variables

Copy `.env.example` to `.env` and fill in the values you need for local development.

```bash
cp .env.example .env
```

Integration tests are skipped automatically if the relevant env vars are not set — so `npm test` always works without any setup.

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