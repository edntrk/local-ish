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

## Categories

One fixed list, used for prices, expenses, the AI prompts and the charts: `transport`, `food`, `activities`, `shopping`, `stay`, `essentials`, `other` (labels: Transport, Food & drink, Activities, Shopping, Stay, Essentials, Other). The old value `sim` is still read and means `essentials`. Nobody invents a new category: when unsure, use `other`. Tiger databases are moved to the list automatically when the API starts (`db/schema.sql` has the same steps).

## Bargain modes

Every price check has a `bargainMode`, and the verdict (great / fair / high / tooHigh) is the same in all three. Only the suggested action changes:

| Mode | Where | What the Interface shows |
|---|---|---|
| `bargain` | markets, street stalls, unmetered taxis, surf lessons, scooter rental | plan chips (Start / Aim / Walk away), a Bahasa phrase, the Bargain button |
| `ask` | a warung without a menu, massage, tours | one polite phrase ("Ada diskon?" + English), then Pay / Leave it |
| `fixed` | menu restaurants and cafés, beach clubs, supermarkets, malls, Grab / Gojek, metered taxis | a "Fixed-price place" tag, 2 to 3 tips (check the bill for service and tax, use the app or meter, ask for the menu), and a cheaper alternative with a price range from our data. Never anything about haggling |

How the mode is decided (`resolveBargainMode` in `packages/shared`): the item's usual mode (`price_items.bargain`, with a guess by category when empty) is the start; the situation as read by Gemini (`ParsedAsk.bargainMode`) can override it; and a **fancy** style or a **chain / app / menu** situation (restaurant, café, beach club, hotel, supermarket, mall, Grab, Gojek, meter, Indomaret, Starbucks...) is never `bargain`: it becomes `fixed`.

Additive fields: `PriceItem.bargain`, `ParsedAsk.bargainMode`, `CheckRequest.bargainMode`, `CheckResult.bargainMode`, `CheckResult.tips`, `CheckResult.alternative`. In `fixed` mode the code throws away any advice or tip that talks about haggling and falls back to the template.

## The price database learns new items

When Gemini understands a sentence ("surf lesson in Canggu, 500000") but our list has no matching item, `POST /api/parse` researches it instead of giving up:

1. Gemini with Google Search finds the usual local price range in IDR for that item (2 to 3 source pages). It is **never told the tourist's quote**, and only search results are saved.
2. Code checks the answer: `0 < min < max`, `max <= 50 x min`, currency `IDR`, one of our categories (`other` is stored as `shopping` for now), at least one source URL, name up to 60 characters. Anything that fails is rejected.
3. It is saved in `price_items` with `origin = 'web'`, `source` = the first URL, `checked_on` = today. An existing slug is reused, never duplicated (`seed` rows are never overwritten).
4. The normal flow continues: `/api/check` uses the new item like any other.

Next time the item comes straight from the database. A `web` price older than 30 days is researched again (if that fails, the old numbers stay).

If research fails for any reason (quota, search, bad answer), `/api/parse` answers `200` with `itemId: ""` and the item name and amount. The Interface then shows "We don't have local prices for that yet" and Pay still works. The real reason is logged as `[research] <slug> failed: <reason>`.

Additive fields: `PriceItem.origin` (`"seed"` or `"web"`), `ParsedAsk.item`, `ParsedAsk.researched`, `ParsedAsk.sources`, `CheckResult.source` (`"local"` or `"web"`) and `CheckResult.sources`. `DataStore.addPriceItem(item)` and the optional `DataStore.init()` (adds columns on server start) are new.

## Changing the contract

1. Open a pull request that edits `packages/shared/src/contracts.ts` **only**.
2. Explain who is affected. All three people approve (CODEOWNERS enforces this).
3. Prefer adding an **optional** field over changing an existing one.
4. `npm run check` must pass. The contract tests will tell you what broke.
