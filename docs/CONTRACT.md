# API contract

All types live in `packages/shared/src/contracts.ts`. This page shows the same thing with examples.
Base URL in development: `http://localhost:8787` (the web app reaches it as `/api/...`).
Every error looks like `{ "error": "A sentence a tourist understands" }`.
Money is always in the trip's **local currency** (MAD).

| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/api/health` | all | → `{ ok, modes: { data, voice, ai } }` |
| GET | `/api/prices?city=marrakech` | Data | → `PriceItem[]` |
| POST | `/api/trips` | Data | `Trip` without `id`, `inviteCode` → `Trip` |
| GET | `/api/trips/:id` | Data | → `Trip` |
| POST | `/api/trips/join` | Data | `{ code, name, email? }` → `Trip` |
| GET | `/api/trips/:id/expenses` | Data | → `Expense[]` |
| POST | `/api/trips/:id/expenses` | Data | `{ item, category, amount, paidBy, shares }` → `Expense` |
| GET | `/api/trips/:id/summary` | Data | → `Summary` |
| POST | `/api/parse` | AI | `{ city, text? , imageBase64? }` → `ParsedAsk` (422 if not understood) |
| POST | `/api/check` | shared logic | `{ tripId, itemId, amount, style }` → `CheckResult` |
| POST | `/api/voice/stt` | Voice | raw audio (`content-type: audio/webm`) → `{ text }` |
| POST | `/api/voice/tts` | Voice | `{ text, lang }` → mp3 audio, or **204** + `x-fairfare-mock: 1` (use the phone's voice) |

A demo trip with id **`demo`** always exists in mock mode (Renata, Bella, Dewi, budget £600).

## The main flow

```
"taxi from the airport at night, he wants 250"
   │  POST /api/parse
   ▼
{ "itemId": "taxi-airport", "amount": 250, "currency": "MAD", "style": "local", "confidence": 0.7 }
   │  POST /api/check  { tripId: "demo", itemId, amount, style }
   ▼
{
  "verdict": "tooHigh",
  "range": { "min": 100, "max": 150 },
  "target": 125,
  "budget": { "dailyAllowance": 1071, "myShareIfSplit": 83.33, "pctOfDaily": 8 },
  "phrase": { "local": "Ghali bzaf! 125 dirham, safi?", "localLang": "ar-MA", "french": "...", "english": "..." },
  "item": { ...PriceItem }, "currency": "MAD"
}
   │  user taps Pay, ticks who to split with
   ▼
POST /api/trips/demo/expenses
{ "item": "Taxi: airport to Medina", "category": "transport", "amount": 125, "paidBy": "me",
  "shares": { "me": 41.67, "bella": 41.67, "dewi": 41.66 } }      ← must add up to amount
```

Verdicts: `great` (below the usual range) · `fair` (inside it) · `high` (up to 30% over) · `tooHigh` (more than 30% over).
Style multiplies the range: `local` ×1, `mid` ×1.8, `fancy` ×3.5.

## Changing the contract

1. Open a pull request that edits `packages/shared/src/contracts.ts` **only**.
2. Explain who is affected. All three people approve (CODEOWNERS enforces this).
3. Prefer adding an **optional** field over changing an existing one.
4. `npm run check` must pass. The contract tests will tell you what broke.
