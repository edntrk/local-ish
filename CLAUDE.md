# FairFare: notes for Claude Code

FairFare helps tourists check if a price is fair before they pay, bargain in the local language, and split costs with friends. Hackathon project (IKU Womxn in STEM). Demo city: Marrakech, currency MAD.

## How the project is built

```
packages/shared/   THE CONTRACT: types + zod schemas (contracts.ts) and pure logic (pricing.ts)
apps/api/          Express API. Talks to three "ports" (src/ports.ts):
  src/data/        Data role      -> DataStore    (mock.ts, tiger.ts = PostgreSQL / Tiger Data)
  src/voice/       Voice role     -> VoiceService (mock.ts, elevenlabs.ts)
  src/ai/          AI role        -> AskParser    (mock.ts, gemini.ts)
  src/app.ts       routes, src/server.ts picks mock or real from .env, src/fallback.ts
apps/web/          Interface. index.html = the clickable prototype. src/api.ts = the only backend client.
db/                schema.sql + seed.sql
docs/              ROLES, CONTRACT (endpoints), WORKFLOW (git), BOARD (tasks)
```

## Rules (please follow them)

1. **Never break the contract.** Do not rename or remove anything in `packages/shared/src/contracts.ts`. Adding optional fields is fine. If a change is needed, say so and explain who it affects.
2. **Stay in your folder.** Work only in the folder of the role the person says they have (see `docs/ROLES.md`). If something outside it must change, tell the person instead of editing it.
3. **Mocks must keep working.** The app must run with `DATA_MODE=mock VOICE_MODE=mock AI_MODE=mock` and no keys. Never delete a mock.
4. **The API only talks to ports.** Routes in `app.ts` call `DataStore`, `VoiceService`, `AskParser`, never a vendor SDK directly.
5. **The Interface only talks to `apps/web/src/api.ts`.** No `fetch` calls elsewhere in the web app.
6. **Errors are plain sentences** a tourist understands, returned as `{ "error": "..." }`.
7. **No secrets in code.** Keys live in `.env` (copied from `.env.example`), which git ignores.
8. Before saying a task is done, run `npm run check` (typecheck + tests) and make sure it passes.

## Commands

- `npm install` once
- `npm run dev` runs app (http://localhost:5173) + API (http://localhost:8787)
- `npm run check` typecheck + contract tests
- `npm run db:setup` creates tables and sample prices in `DATABASE_URL`

## Style

- TypeScript, strict. Small functions. Comments explain *why*.
- UI copy: short, plain, from the tourist's side ("Too high", "Split equally").
- Prices are always in the trip's local currency (MAD) inside the system; convert to home currency only for display.
