# Local-ish 🏷️

**Know before you pay.** Local-ish helps travellers understand unfamiliar prices, bargain in the local language, record expenses, and split costs with friends. Type or say a price, such as "taxi from the airport to Seminyak, 400k", compare it with local price data, and hear a bargaining phrase out loud.

Built for the IKU Womxn in STEM Hackathon by **Renata · Deniz · Ranyn**. Demo city: **Bali (IDR)**.

🎥 **Demo video:** _add link_ · 🌐 **Live:** _add domain_

---

## What it does

1. **Check a price.** Type or say what you're being charged.
2. **Get a verdict.** Great deal · Fair · A bit high · Too high, based on real local price ranges in Tiger Data.
3. **Bargain.** Get what to offer, and hear the phrase in Bahasa Indonesia.
4. **Back and forth.** Type or record the seller's reply; Local-ish suggests your next move, or tells you to walk away.
5. **Pay and track.** Log what you paid and see how much of your budget is left.
6. **Split with friends.** See who owes who.

If an item isn't in the database yet, Gemini researches the local price with Google Search, and the result is validated and saved to Tiger Data with its source.

---

## How we use AI, voice and data

- **Tiger Data:** stores local price ranges, trips, budgets and expenses. Researched prices are saved with their source, so the database grows with each check.
- **Gemini:** understands informal and multilingual text and photo inputs, extracts the item, amount and currency, writes short advice and a bargaining plan, and understands the seller's replies. Reference data supplies price comparisons; the AI does not invent market averages or verdicts.
- **ElevenLabs:** transcribes recordings with Scribe v2 and generates spoken bargaining phrases with Multilingual v2.
- **Validation:** structured responses, recording formats, timeouts and API errors are checked, and every service falls back to a mock if it fails.

---

## How it's built

```
  Interface (apps/web)
        │  only through src/api.ts
        ▼
  API (apps/api) ──── checks everything against ──── THE CONTRACT (packages/shared)
        │
        ├── DataStore     → mock  |  Tiger Data
        ├── VoiceService  → mock  |  ElevenLabs
        └── AskParser     → mock  |  Gemini
```

1. **One contract.** `packages/shared/src/contracts.ts` defines every piece of data passed between parts.
2. **Every part has a mock.** Each part can be built and tested on its own.
3. **Switches, not rewrites.** `.env` decides mock or real (`DATA_MODE`, `VOICE_MODE`, `AI_MODE`).
4. **Contract tests.** `npm run check` runs TypeScript checks and automated tests for the shared logic, API contracts, bargaining and AI adapters.

---

## What's next

- More cities and currencies, starting with Southeast Asia
- Real group trips: invite friends with a link, so everyone logs and splits costs from their own phone
- Travellers confirming prices they paid, so ranges stay fresh
- Photo of a price tag or menu → instant check

---

## Start in 5 minutes

You need **Node.js 20+** and an editor such as VS Code.

```bash
git clone https://github.com/edntrk/local-ish.git
cd local-ish
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev
```

Open **http://localhost:5173**. The default mock services run without API keys. Real Tiger Data, Gemini and ElevenLabs features require the configuration below.

The codebase uses the internal package name `fairfare`.

### Enable the real services

Add your credentials to your local `.env` file:

```dotenv
DATA_MODE=tiger
DATABASE_URL=postgres://...?uselibpqcompat=true&sslmode=require

AI_MODE=gemini
GEMINI_API_KEY=your_google_gemini_key
GEMINI_MODEL=gemini-3.5-flash

VOICE_MODE=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_selected_voice_id
```

Run `npm run db:setup` once, then restart the app. Keep credentials private; never commit `.env`.

---

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | App + API together |
| `npm run check` | Typecheck + tests. Run before every push. |
| `npm run db:setup` | Create tables + load Bali prices |

## More docs

- [docs/AI_FLOW.md](docs/AI_FLOW.md): how a sentence becomes a verdict, advice and a spoken phrase
- [docs/CONTRACT.md](docs/CONTRACT.md): every API endpoint with examples
- [docs/WORKFLOW.md](docs/WORKFLOW.md): git, branches, pull requests