# Claude Code Project Guide

This document captures the conventions, architectural decisions, and development practices for Follow Me.

## Architecture

The app follows strict layered architecture enforced by ESLint:

| Layer | Purpose | Constraints |
|-------|---------|-------------|
| **Domain** | Pure business logic, no I/O | Must not import from any other layer |
| **Application** | Use cases and orchestration | Must not import from infrastructure or UI |
| **Infrastructure** | I/O, SDKs, services | No restrictions on other layers |
| **UI** | Screens, components, hooks | Must not import from infrastructure directly — only through hooks that call use cases |
| **Screens** | Navigation endpoints | Must not import use cases directly — go through a hook |

**Why:** Clean boundaries prevent the UI from growing tangled dependencies and keep business logic testable. The linter (`eslint-import-resolver-typescript@3.6.1`) validates these rules; a silently-failing resolver defeats this. `src/layerBoundaries.test.ts` guards that the resolver is wired correctly — never delete it.

## Development approach

**Test-Driven Development is mandatory.** Write the test first, watch it fail, then implement. Every new behaviour needs a test alongside it — no exceptions. Integration tests that hit the real staging database are skipped automatically if env vars are not set, so `npm test` always works locally.

For code that must run in both React Native (app) and Deno (Edge Functions), see `CONTRIBUTING.md` → "Code that runs in both runtimes."

## Commit messages

This project follows [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <short description>
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`

**Rules:**
- Subject line must be under 72 characters
- Use imperative mood ("add" not "adds" or "added")
- No period at the end
- Branch from `main` with a descriptive name (`feat/whatsapp-notifier`, `fix/subscriber-activation`)

## Key decisions

**No manual deploys:** Every change ships as a PR. There are no hand-deployments to staging or production — everything goes through GitHub.

**Dual-runtime modules:** Some files under `src/` run in two runtimes: React Native (app) and Deno (Edge Functions). These have strict constraints:
- No imports (besides type imports)
- Web standards only (no `node:*`, `expo-*`, or React Native APIs)
- Take runtime differences as arguments

See `CONTRIBUTING.md` → "Code that runs in both runtimes" for the full list and how each runtime uses them.

**One sender per environment:** WhatsApp sender is shared between staging and production (Meta locks it after 30 quiet days). Never delete and re-register a sender — keep it active in both.

**Branch protection:** Main requires:
- App CI to pass (`npm run validate`)
- Services CI to pass (Deno tests for changed functions)
- Integration tests against staging to pass

## Deployment

- **App (JS bundle):** `deploy-app.yml` ships OTA to staging on main merge; promote to production manually via workflow.
- **Database (migrations):** `deploy-db.yml` applies to staging on main merge; production requires manual workflow run.
- **Services (Edge Functions):** `deploy-services.yml` deploys to staging on main merge; production requires manual run.

See `CONTRIBUTING.md` → "CI workflows" for the full table of when each runs and what blocks merges.

## Getting started

1. Read `CONTRIBUTING.md` before writing any code
2. Follow `README.md` → "Getting started" to set up the environment
3. Run `npm install` to set up Husky pre-commit hooks
4. Write tests first: `npm test` (fast), `npm run validate` before pushing
5. For Edge Functions changes, also run `deno task test` and `deno task check`
