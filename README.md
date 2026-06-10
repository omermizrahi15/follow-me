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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide including the branch/PR workflow, commit message standard, and code rules.

The short version: fork the repo, open a branch, write tests first, then code, then open a PR. CI must be green before a PR can merge.

---

## Project status

Active development. See the [issues board](https://github.com/omermizrahi15/follow-me/issues) for everything planned and in progress.

---

## License

MIT — see [LICENSE](LICENSE) for details.
