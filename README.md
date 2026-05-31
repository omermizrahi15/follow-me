# Follow Me

An open-source iOS app that lets you automatically share photos from your library with people who subscribe to you.

Built with React Native + Expo, clean architecture, and TDD from day one.

---

## What it does

- Select photos from your device library and share them with your subscribers
- Subscribers opt in and receive new photos automatically
- Delivery mechanism is pluggable — WhatsApp bot in the MVP, push notifications planned next

---

## Architecture

Follow Me is built on clean architecture principles with strict separation of concerns. Every layer communicates through interfaces, so implementations can be swapped without touching business logic.

The codebase is split into four layers:

- **Domain** — pure TypeScript entities and interfaces. No framework dependencies, no I/O, no side effects. This is the heart of the app and never changes when infrastructure does.
- **Application** — use cases that orchestrate the domain. Each use case has a single responsibility and talks only to interfaces, never to concrete implementations.
- **Infrastructure** — implementations of those interfaces: database clients, storage adapters, notification senders. Swappable without touching any use case.
- **UI** — React Native screens and hooks. Treated as just another delivery mechanism, the same way the WhatsApp notifier is. It calls use cases and knows nothing about the domain internals.

The composition root is the single place that wires interfaces to their implementations. Switching the notification delivery from WhatsApp to push notifications, for example, is a one-line change there — nothing else in the codebase needs to know.

---

## Tech stack

| Layer | Technology |
|---|---|
| Mobile app | React Native + Expo |
| Language | TypeScript |
| Backend API | Node.js + Express |
| Database | Supabase |
| Photo storage | Cloudinary |
| Notifications (MVP) | WhatsApp bot |
| Notifications (planned) | Expo Push Notifications |
| Testing | Jest + ts-jest |

---

## Getting started

### Prerequisites

- Node.js 18+
- npm 9+
- Expo CLI (`npm install -g expo-cli`)

### Install

```bash
git clone https://github.com/your-username/follow-me.git
cd follow-me
npm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required for | Description |
|---|---|---|
| `WHATSAPP_API_TOKEN` | Integration tests | Your WhatsApp API token |
| `WHATSAPP_TEST_RECIPIENT` | Integration tests | Phone number to send test messages to |
| `SUPABASE_URL` | Infrastructure | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Infrastructure | Your Supabase anon key |
| `CLOUDINARY_URL` | Infrastructure | Your Cloudinary connection string |

### Run tests

```bash
npm test                   # unit tests — fast, no network required
npm run test:watch         # unit tests in watch mode
npm run test:integration   # integration tests — requires env vars above
npm run test:all           # everything
```

---

## Testing strategy

Every piece of logic has a test that lives right next to the code it covers. There are three levels:

**Unit tests** run on every `npm test` call. They are fast and require no network or database. Use cases are tested by injecting in-memory implementations of all interfaces — no mocking library, no stubs, just simple in-memory classes that behave correctly.

**Integration tests** run against real external services (database, storage, notification APIs). They are skipped automatically unless the relevant environment variables are set, so they never break a local `npm test` run.

**End-to-end tests** cover full user flows through the entire stack. These are kept minimal — one or two per critical path.

---

## Contributing

Contributions are welcome. Every pull request must meet the standards below before it will be reviewed.

### Before you open a PR

1. **Fork the repo** and create a branch from `main` with a descriptive name (`feat/whatsapp-notifier`, `fix/subscriber-activation`)
2. **Write tests first** — this project is built TDD. Every new behaviour needs a test that fails before you write the implementation
3. **Make all unit tests pass** — run `npm test` and confirm everything is green
4. **Keep commits focused** — one logical change per commit, with a clear message in the imperative mood (`Add WhatsApp notifier`, not `added whatsapp stuff`)
5. **Document your intent** — the PR description should explain *why* the change is needed, not just what changed

### Code standards

- The domain layer must stay pure — no framework imports, no network calls, no file I/O
- Use cases must only depend on interfaces, never on concrete infrastructure classes
- Tests must live next to the file they cover, not in a separate test folder
- New delivery mechanisms must implement the `INotifier` interface — use cases must not be modified to accommodate them
- TypeScript strict mode is on — no `any`, no type assertions unless absolutely justified with a comment

### Adding a new delivery mechanism

The architecture is designed so that adding a new way to deliver photos to subscribers (email, SMS, push, etc.) requires no changes to any use case or domain logic. You only need to:

1. Create a new class that implements the `INotifier` interface
2. Write an integration test alongside it
3. Plug it in at the composition root

That's it. If you find yourself touching a use case to support a new delivery method, stop — something is wrong with the approach.

### PR approval

All pull requests require approval from at least one of the core maintainers before merging:

- [@urishiber](https://github.com/urishiber)
- [@omermizrahi15](https://github.com/omermizrahi15)

PRs without tests, or that break existing tests, will not be approved regardless of the feature. This is not negotiable — the test suite is the contract.

### Reporting bugs

Open an issue with the `bug` label and include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your Node.js version and OS

### Suggesting features

Open an issue with the `enhancement` label. Describe the use case you're trying to solve, not just the feature you want — it helps us understand the problem before proposing a solution.

---

## Project status

This is an early-stage MVP. The architecture and test infrastructure are in place. Active work is ongoing on:

- [ ] WhatsApp notifier implementation
- [ ] Database repository implementations
- [ ] Photo storage implementation
- [ ] React Native UI screens
- [ ] Expo push notification support

---

## License

MIT — see [LICENSE](LICENSE) for details.