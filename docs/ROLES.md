# Roles

Three people, three folders, one contract. Stay in your folder. If you need something from someone else's part, ask them (or open an issue), don't edit their files.

---

## Interface

**Who:** Renata · **Folder:** `apps/web/`

**You own:** every screen the tourist sees, the flow, the copy, and the demo/pitch.

**What you have now:** `apps/web/index.html` is the clickable prototype. Its logic is fake (prices and parsing are hard-coded in the page). Your job is to swap the fake parts for real calls, one at a time.

**Your only door to the backend:** `apps/web/src/api.ts`

| Prototype does this | Replace with |
|---|---|
| `parseAsk(text)` (keyword guessing) | `api.parse({ city, text })` |
| photo → fake slippers | `api.parse({ city, imageBase64 })` |
| mic → fake sentence | record audio → `api.speechToText(blob)` → `api.parse(...)` |
| `verdictOf` / `rng` / hard-coded `PRICES` | `api.check({ tripId, itemId, amount, style })` |
| Play Darija/French button | `api.speak(text, lang)` (uses ElevenLabs when on, phone voice otherwise) |
| `S.expenses.push(...)` | `api.addExpense(tripId, {...})` then `api.summary(tripId)` |
| onboarding "Start my trip" | `api.createTrip({...})` |
| invite link | `/join/<inviteCode>` → `api.joinTrip(code, name)` |

**Good first prompt for Claude Code:**
> I'm the Interface role. Read CLAUDE.md and docs/ROLES.md. Move the script in apps/web/index.html into apps/web/src/main.ts, then replace the fake price check with api.parse and api.check. Keep the design exactly the same.

---

## Data

**Who:** Friend 1 · **Folders:** `apps/api/src/data/`, `db/`, `scripts/db-setup.mjs`

**You own:** the Tiger Data (PostgreSQL) database, trips, people, invites, expenses, splits, and **the real price list**.

**Your plug:** the `DataStore` interface in `apps/api/src/ports.ts`. `mock.ts` already works in memory. `tiger.ts` is a draft of the real one.

**First steps**
1. Create a free Tiger Data service and copy its connection string.
2. In `.env`: `DATABASE_URL=...` and `DATA_MODE=tiger`.
3. `npm run db:setup` to create the tables and load sample prices.
4. `npm run dev` → open http://localhost:8787/api/health and check it says `"data":"tiger"`.
5. Try the app. Fix `tiger.ts` until it behaves exactly like `mock.ts`.

**The most important job:** replace the sample prices in `db/seed.sql` with **real, sourced Marrakech prices** (15–20 items), filling `source` and `checked_on`. If judges ask "where do the prices come from?", this is the answer.

**Bonus for the Tiger Data prize:** keep a log of every price check (item, quoted price, verdict, time) and show "what tourists were quoted today" on a chart.

**Good first prompt for Claude Code:**
> I'm the Data role. Read CLAUDE.md and docs/ROLES.md. Make apps/api/src/data/tiger.ts pass the same behaviour as mock.ts against my DATABASE_URL. Only edit files in apps/api/src/data and db.

---

## Voice & AI

**Who:** Friend 2 · **Folders:** `apps/api/src/voice/`, `apps/api/src/ai/`

**You own:** understanding the tourist (typed text, voice, photo → item + price) and speaking the bargain phrase.

**Your plugs** (in `apps/api/src/ports.ts`):
- `VoiceService`: `speechToText(audio)` and `textToSpeech(text, lang)`, drafted with ElevenLabs in `voice/elevenlabs.ts`
- `AskParser`: `parse({ text | imageBase64 })` → `{ itemId, amount, style, ... }`, drafted with Gemini in `ai/gemini.ts`

**First steps**
1. Get an ElevenLabs API key and pick a voice that sounds good in Arabic/French. Copy its voice id.
2. Get a Gemini API key (Google AI Studio).
3. In `.env`: set both keys, `VOICE_MODE=elevenlabs`, `AI_MODE=gemini`.
4. `npm run dev` → `/api/health` should show both switched on.
5. Test with the three demo sentences in the app, plus a real photo of a price tag.

**Built-in safety:** if your service errors, the API falls back to the mock and logs `[fallback]`. Watch the terminal for that line.

**Good first prompt for Claude Code:**
> I'm the Voice & AI role. Read CLAUDE.md and docs/ROLES.md. Check apps/api/src/voice/elevenlabs.ts and apps/api/src/ai/gemini.ts against the current ElevenLabs and Gemini docs and make them work with my keys. Only edit files in apps/api/src/voice and apps/api/src/ai.

---

## Shared (everyone)

- `packages/shared/` is **the contract**. Changes need all three of you to approve.
- Before every push: `npm run check`.
- Demo day: everyone knows how to run `npm run dev` and flip everything back to `mock` if Wi-Fi dies.
