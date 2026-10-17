# FairFare 🏷️

**Know before you pay.** A tourist types, says or snaps a price ("taxi to Medina, 250"). FairFare says if it's fair compared with what locals pay, gives a phrase to bargain with (spoken out loud), and tracks the money, split between friends.

Built for the IKU Womxn in STEM Hackathon. Demo city: Marrakech.

---

## Start in 5 minutes

You need **Node 20+** and **VS Code** (with the Claude Code extension).

```bash
git clone <your-repo-url> fairfare
cd fairfare
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev
```

Open **http://localhost:5173**. That's it. No keys are needed: every part runs on a fake (mock) version until you switch it on.

In VS Code you can also press `Ctrl/Cmd + Shift + P` → **Run Task** → **FairFare: run app + API**.

---

## Who does what

| Role | Person | Your folder | Read first |
|---|---|---|---|
| 🎨 Interface | Renata | `apps/web/` | [docs/ROLES.md](docs/ROLES.md#interface) |
| 🗄️ Data | Friend 1 | `apps/api/src/data/`, `db/` | [docs/ROLES.md](docs/ROLES.md#data) |
| 🎙️ Voice & AI | Friend 2 | `apps/api/src/voice/`, `apps/api/src/ai/` | [docs/ROLES.md](docs/ROLES.md#voice--ai) |

The task list is in **[docs/BOARD.md](docs/BOARD.md)**.

---

## Why nothing breaks when three people code at once

```
  Interface (apps/web)
        │  only through src/api.ts
        ▼
  API (apps/api) ──── checks everything against ──── THE CONTRACT (packages/shared)
        │
        ├── DataStore     → mock  |  Tiger Data        (Data)
        ├── VoiceService  → mock  |  ElevenLabs        (Voice & AI)
        └── AskParser     → mock  |  Gemini            (Voice & AI)
```

1. **One contract.** `packages/shared/src/contracts.ts` defines every piece of data passed between parts. Everyone builds against it.
2. **Every part has a mock.** You can build your screens before your friends finish, and they can test without your screens.
3. **Switches, not rewrites.** `.env` decides mock or real (`DATA_MODE`, `VOICE_MODE`, `AI_MODE`).
4. **Automatic fallback.** If ElevenLabs or Gemini fails during the demo, the API quietly uses the mock so the app keeps working.
5. **Contract tests.** `npm run check` proves every endpoint still returns what the contract promises. GitHub runs it on every pull request.
6. **Protected main branch.** Nobody pushes straight to `main`. See [docs/WORKFLOW.md](docs/WORKFLOW.md).

---

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | App + API together |
| `npm run check` | Typecheck + tests. Run before every push. |
| `npm run db:setup` | Data role: create tables + sample prices |

## More docs

- [docs/ROLES.md](docs/ROLES.md): each person's job and first steps
- [docs/CONTRACT.md](docs/CONTRACT.md): every API endpoint with examples
- [docs/WORKFLOW.md](docs/WORKFLOW.md): git, branches, pull requests, using Claude Code together
- [docs/BOARD.md](docs/BOARD.md): the task board
- [CLAUDE.md](CLAUDE.md): rules Claude Code follows in this project
