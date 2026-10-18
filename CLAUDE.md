# Local-ish: notes for Claude Code

Local-ish helps tourists check if a price is fair before they pay, bargain in the local language, track their budget, and split costs with friends. Hackathon project (IKU Womxn in STEM). Demo city: **Bali, currency IDR**, phrases in **Bahasa Indonesia**. The internal package name is `fairfare`.

## How the project is built

```
packages/shared/   THE CONTRACT: types + zod schemas (contracts.ts) and pure logic (pricing, bargain, budget, text)
apps/api/          Express API. Talks to "ports" (src/ports.ts):
  src/data/        DataStore     (mock.ts, tiger.ts = PostgreSQL / Tiger Data)
  src/voice/       VoiceService  (mock.ts, elevenlabs.ts)
  src/ai/          AskParser, AdviceWriter, PriceResearcher, bargaining (mock + Gemini)
  src/app.ts       routes, src/server.ts picks mock or real from .env, src/fallback.ts
apps/web/          Interface. src/api.ts = the only backend client.
db/                schema.sql + seed.sql
docs/              CONTRACT (endpoints), AI_FLOW (how the AI works)
```

## Rules (please follow them)

1. **Never break the contract.** Do not rename or remove anything in `packages/shared/src/contracts.ts`. Adding optional fields is fine. If a bigger change is needed, say so first and explain what it affects.
2. **The database decides the numbers, the AI explains them.** Verdicts, ranges, plans and budget numbers come from code and data. Gemini never invents a price or changes a verdict. Clamp AI numbers to the real range.
3. **Mocks must keep working.** The app must run with `DATA_MODE=mock VOICE_MODE=mock AI_MODE=mock` and no keys. Never delete a mock.
4. **The API only talks to ports.** Routes in `app.ts` call the ports, never a vendor SDK directly.
5. **The Interface only talks to `apps/web/src/api.ts`.** No `fetch` calls elsewhere in the web app.
6. **Errors are plain sentences** a tourist understands, returned as `{ "error": "..." }`.
7. **No secrets.** Keys live only in `.env` (gitignored). Never print keys or `DATABASE_URL`, never put real values in `.env.example`.
8. **Change only what was asked.** Don't restyle or remove other parts of the UI on the way.
9. Before saying a task is done, run `npm run check` (typecheck + tests) and make sure it passes.

## Commands

- `npm install` once
- `npm run dev` runs app (http://localhost:5173) + API (http://localhost:8787)
- `npm run check` typecheck + tests
- `npm run db:setup` creates tables and Bali prices in `DATABASE_URL`

## Style

- TypeScript, strict. Small functions. Comments explain *why*.
- UI copy: short, plain, from the tourist's side ("Too high", "Split equally").
- Brand colour is lime. No green for verdicts: use lime / amber / red. Check layouts at 390px wide.
- Prices are always in the trip's local currency (IDR) inside the system; convert to home currency only for display.