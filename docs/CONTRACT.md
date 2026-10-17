# API contract

All types live in `packages/shared/src/contracts.ts`. This page shows the same thing with examples.
Base URL in development: `http://localhost:8787` (the web app reaches it as `/api/...`).
Every error looks like `{ "error": "A sentence a tourist understands" }`.
Money is always in the trip's **local currency** (MAD).

| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/api/health` | all | → `{ ok, modes: { data, voice, ai } }` |
| GET | `/api/prices?city=bali` | Data | → `PriceItem[]` |
| POST | `/api/trips` | Data | `Trip` without `id`, `inviteCode` → `Trip`. `budgetHome` = one person's share, optional `groupBudgetHome` = the total. The server makes every person id; the creator is the person with `isMe: true`. |
| GET | `/api/trips/:id` | Data | → `Trip` |
| POST | `/api/invite-codes` | Data | → `{ code }`. Hands out an invite code before the trip exists, so the invite link can be shown while the creator is still in setup. Pass it as `inviteCode` to `POST /api/trips`. |
| GET | `/api/trips/by-code/:code` | Data | → `TripByCode` `{ tripId, ownerName, city, start, end, people: [names], perPersonBudgetHome, homeCurrency? }`. 404 with a plain error for a bad code. Used by the join screen. |
| POST | `/api/trips/join` | Data | `{ code, name, email? }` → `JoinResult` (`Trip` + `personId`). A person who is still `invited` with the same name (any capitals) is **claimed**, not duplicated. |
| GET | `/api/trips/:id/expenses` | Data | → `Expense[]` |
| POST | `/api/trips/:id/expenses` | Data | `{ item, category, amount, paidBy, shares }` → `Expense` |
| GET | `/api/trips/:id/summary?personId=<id>` | Data | → `Summary` worked out for **that person**: `myBudget` (group ÷ people), `mySpent`, `myLeft`, `groupSpent`, `groupLeft`, `net`, and `transfers` (fewest payments to settle up). No `personId` = the trip creator. |
| POST | `/api/parse` | AI | `{ city, text? , imageBase64? }` → `ParsedAsk` (422 if not understood) |
| POST | `/api/check` | shared logic | `{ tripId, itemId, amount, style }` → `CheckResult` |
| POST | `/api/voice/stt` | Voice | raw audio (`content-type: audio/webm`) → `{ text }` |
| POST | `/api/voice/tts` | Voice | `{ text, lang }` → mp3 audio, or **204** + `x-fairfare-mock: 1` (use the phone's voice) |

A demo trip with id **`demo`** always exists in mock mode (Renata, Bella, Dewi, budget £600).

**People are always ids.** `paidBy` and the keys of `shares` are person ids (never names). The API refuses an id that isn't on the trip.
**Balances:** `net = what I paid − what I owe`. A positive `net` means others owe me.

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
