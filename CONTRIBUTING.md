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