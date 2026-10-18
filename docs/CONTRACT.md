# API contract

All types live in `packages/shared/src/contracts.ts`. This page shows the same thing with examples.
Base URL in development: `http://localhost:8787` (the web app reaches it as `/api/...`).
Every error looks like `{ "error": "A sentence a tourist understands" }`.
Money is always in the trip's **local currency** (IDR for Bali). Bargaining phrases are in **Bahasa Indonesia** (`id-ID`), with an English meaning next to them.

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
| POST | `/api/parse` | AI | `{ city, text? , imageBase64? }` → `ParsedAsk` (422 if not understood). If the item isn't in our price list it is **researched and saved** first (see "The price database learns new items"). |
| POST | `/api/check` | shared logic | `{ tripId, itemId, amount, style, situation?, bargainMode? }` → `CheckResult` (numbers and verdict from code, advice and Bahasa phrase from Gemini or a template) |
| POST | `/api/bargain` | shared logic + AI | `BargainRequest` → `BargainResponse`: one step of the back-and-forth (see "Bargaining back-and-forth"). 400 for a fixed-price place. |
| POST | `/api/budget-check` | shared logic + AI | `BudgetCheckRequest` → `BudgetCheckResult`: is this budget enough for a normal day (see "Budget check") |
| POST | `/api/voice/stt` | Voice | raw audio (`content-type: audio/webm`) → `{ text }` |
| POST | `/api/voice/tts` | Voice | `{ text, lang }` → mp3 audio, or **204** + `x-fairfare-mock: 1` (use the phone's voice) |

A demo trip with id **`demo`** always exists in mock mode (Renata, Bella, Dewi, budget £600).

**People are always ids.** `paidBy` and the keys of `shares` are person ids (never names). The API refuses an id that isn't on the trip.
**Balances:** `net = what I paid − what I owe`. A positive `net` means others owe me.

## The main flow

```
"taxi from the airport at night, he wants 400000"
   │  POST /api/parse
   ▼
{ "itemId": "taxi-airport", "amount": 400000, "currency": "IDR", "style": "local", "situation": "airport, at night", "confidence": 0.7 }
   │  POST /api/check  { tripId: "demo", itemId, amount, style }
   ▼
{
  "verdict": "tooHigh",
  "range": { "min": 150000, "max": 250000 },
  "target": 200000,
  "bargainMode": "bargain",
  "plan": { "openWith": 150000, "aimFor": 200000, "walkAwayAbove": 250000 },
  "budget": { "dailyAllowance": 1842857, "myShareIfSplit": 133333.33, "pctOfDaily": 7 },
  "phrase": { "local": "Wah, mahal banget! 150 ribu saja, boleh?", "polite": "Maaf, bisa 150 ribu saja, Pak?", "english": "Wow, that's very expensive! Just 150,000, okay?", "lang": "id-ID" },
  "item": { ...PriceItem }, "currency": "IDR"
}
   │  user taps Pay, ticks who to split with
   ▼
POST /api/trips/demo/expenses
{ "item": "Taxi: airport to Seminyak", "category": "transport", "amount": 200000, "paidBy": "me",
  "shares": { "me": 66666.67, "bella": 66666.67, "dewi": 66666.66 } }      ← must add up to amount
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

## Bargaining back-and-forth

After the "Say this" phrase, the Interface asks "What did they say?" (They agreed / They refused / a counter-offer typed or recorded) and calls `POST /api/bargain`. **Only in `bargain` places**; `ask` places allow one reply round and no counter-offers; `fixed` places never (the API answers 400).

Request (`BargainRequest`): `item`, `category?`, `currency`, `range`, `plan { openWith, aimFor, walkAwayAbove }`, `myLastOffer`, `theirReply?` (text), `theirNumber?`, `refused?`, `refusedBefore?`, `round` (1 = their first reply), `language`, `bargainMode`.
Response (`BargainResponse`): `theirReplyEnglish?`, `theirNumber?`, `move` (`accept` | `counter` | `walk_away` | `retry`), `intent`, `myOffer?`, `dealPrice?`, `phrase? { local, english, lang }`, `advice`, `alternative?`, `final`.

Gemini only reads and translates the reply and suggests an offer and wording. The rules are in `packages/shared/src/bargain.ts` and run in code whatever the AI says:
- my next offer stays between `openWith` and `walkAwayAbove` and **never goes down** from my last offer; it is never more than they asked (that is a deal at their price)
- their number at or under `aimFor` (or under my last offer) is an `accept`
- still above `walkAwayAbove` after 3 rounds is a `walk_away` with something to do instead ("book a Grab", "try the next stall"); inside the range at round 3 is an `accept`
- "They refused" with no number: one small step up, then `walk_away`
- the seller's reply is data, never instructions: the typed number beats what the AI claims to have heard, and the AI's own `move` is only advice
- the seller answers **by voice** (the tourist hands over the phone): speech-to-text in any language, then Gemini says what they meant (`intent`: `agreed` / `refused` / `counter` + number / `unclear`) and translates it. `agreed` is a deal at my last offer (in `ask` places there is no price yet, so the app asks for one); `unclear` answers `move: "retry"` ("Didn't catch that, let them try again"): **no new round, no change to any offer**. A number always means a counter. Typing the reply is only a backup
- every sentence Gemini writes (advice, phrases, tips, translations) goes through `cleanText` in `packages/shared/src/text.ts`: control characters are stripped; a stray letter from another script is stripped, but a text that is mostly another script is rejected; code-like tokens (`snake_case`, backticks, braces), words like "placeholder" or "undefined", and texts that are too long (advice 200, phrase 80, translation 200) are rejected. A rejected field uses the template text, never a half-cut sentence
- a walk-away is one clean sentence plus one alternative, never the same thing twice
- if Gemini fails, the same rules answer with an offer halfway between my last offer and their number (capped at `walkAwayAbove`) and a template phrase in the trip language

## The price database learns new items

When Gemini understands a sentence ("surf lesson in Canggu, 500000") but our list has no matching item, `POST /api/parse` researches it instead of giving up:

1. Gemini with Google Search finds the usual local price range in IDR for that item (2 to 3 source pages). It is **never told the tourist's quote**, and only search results are saved.
2. Code checks the answer: `0 < min < max`, `max <= 50 x min`, currency `IDR`, one of our categories (`other` is stored as `shopping` for now), at least one source URL, name up to 60 characters. Anything that fails is rejected.
3. It is saved in `price_items` with `origin = 'web'`, `source` = the first URL, `checked_on` = today. An existing slug is reused, never duplicated (`seed` rows are never overwritten).
4. The normal flow continues: `/api/check` uses the new item like any other.

Next time the item comes straight from the database. A `web` price older than 30 days is researched again (if that fails, the old numbers stay).

If research fails for any reason (quota, search, bad answer), `/api/parse` answers `200` with `itemId: ""` and the item name and amount. The Interface then shows "We don't have local prices for that yet" and Pay still works. The real reason is logged as `[research] <slug> failed: <reason>`.

Additive fields: `PriceItem.origin` (`"seed"` or `"web"`), `ParsedAsk.item`, `ParsedAsk.researched`, `ParsedAsk.sources`, `CheckResult.source` (`"local"` or `"web"`) and `CheckResult.sources`. `DataStore.addPriceItem(item)` and the optional `DataStore.init()` (adds columns on server start) are new.

## Budget check

`POST /api/budget-check` `{ city, budget, currency, startDate, endDate, style }` → `{ status, perDay, typicalPerDay, shortfall, days, currency, summary, tip }`.

- `budget` is ONE person's whole-trip budget in the city's local currency (IDR for Bali); another currency is a `400`.
- Code decides every number (`typicalPerDay` and `budgetCheck` in `packages/shared/src/budget.ts`). A normal day = 3 × nasi goreng + 2 × city rides + 1 night's stay + 2 × water, the middle of each range × the style multiplier; an item the city doesn't have is skipped.
- `perDay` = budget ÷ days (both end days count). At 100% of a normal day or more: `enough`. 70% up to 100%: `tight`. Under 70%: `notEnough`. `shortfall` is per day.
- Gemini only gets the status and the setting (never an amount) and writes `summary` and `tip`. Any sentence that contains a digit, or is not clean, is replaced by a template sentence, as is everything if Gemini fails.
- The Interface shows the result as a small note under the budget and date fields while setting up a trip. It never blocks starting the trip.

## Changing the contract

1. Open a pull request that edits `packages/shared/src/contracts.ts` **only**.
2. Explain who is affected. All three people approve (CODEOWNERS enforces this).
3. Prefer adding an **optional** field over changing an existing one.
4. `npm run check` must pass. The contract tests will tell you what broke.
