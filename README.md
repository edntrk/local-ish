# Local-ish 🏷️

**Know before you pay.**

Local-ish helps travellers understand unfamiliar prices, bargain in the local language, record expenses, and split costs with friends.

Type or say a price, such as “taxi from the airport to Seminyak, 400k”, compare it with local price data, and hear a bargaining phrase out loud.

Built for the **IKU Womxn in STEM Hackathon** by **Renata · Deniz · Ranyn**.

📍 **Demo city:** Bali, Indonesia (IDR)

🎥 [Watch the demo](https://youtu.be/6d32qQo5ZUo?feature=shared) · 🌐 [Try Local-ish](https://local-ish.biz)

---

## Screenshots

## Screenshots

<p align="center">
  <img src="https://github.com/user-attachments/assets/551292ae-acf4-41ca-b720-9d7d4f992efe" width="300" height="300" alt="Local-ish screenshot 1">
  <img src="https://github.com/user-attachments/assets/98e37aac-d6f5-4fa6-ab8f-04e7e878d30b" width="300" height="300" alt="Local-ish screenshot 2">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/42c42606-f50b-4ac7-8fca-2d15aed8d895" width="300" height="300" alt="Local-ish screenshot 3">
  <img src="https://github.com/user-attachments/assets/8c75adb7-d99b-44d6-9e6d-978531b2550a" width="300" height="300" alt="Local-ish screenshot 4">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/17a58747-8aa8-41f9-bfcb-6ba1ea277a98" width="300" height="300" alt="Local-ish screenshot 5">
  <img src="https://github.com/user-attachments/assets/369fcebb-09af-4dcf-b707-2c1a6c9cc508" width="300" height="300" alt="Local-ish screenshot 6">
</p>

---

## What it does

1. **Check a price.** Type or say what you’re being charged.
2. **Get a verdict.** Great deal · Fair · A bit high · Too high, based on local price ranges stored in Tiger Data.
3. **Bargain.** Get a suggested offer and hear the phrase in Bahasa Indonesia.
4. **Keep the conversation going.** Type or record the seller’s reply. Local-ish suggests your next move or tells you when to walk away.
5. **Pay and track.** Log what you paid and see how much of your budget is left.
6. **Split with friends.** See who owes whom.

If an item isn’t in the database yet, Gemini researches the local price using Google Search. The result is validated and saved to Tiger Data with its source.

---

## How we use AI, voice and data

- **Tiger Data:** Stores local price ranges, trips, budgets and expenses. Researched prices are saved with their sources, so the database grows with each check.
- **Gemini:** Understands informal and multilingual text and photo inputs, extracts the item, amount and currency, generates short advice and a bargaining plan, and interprets the seller’s replies. Reference data supplies price comparisons; the AI does not invent market averages or verdicts.
- **ElevenLabs:** Transcribes recordings with Scribe v2 and generates spoken bargaining phrases with Multilingual v2.
- **Validation:** Checks structured responses, recording formats, timeouts and API errors. Each service has a mock fallback.

---

## How it’s built

The interface in `apps/web` communicates with the API in `apps/api` through `src/api.ts`. Shared contracts in `packages/shared` define the data exchanged between them.

The API connects to three services:

| Service | Mock implementation | Real integration |
| --- | --- | --- |
| `DataStore` | Mock data | Tiger Data |
| `VoiceService` | Mock voice service | ElevenLabs |
| `AskParser` | Mock parser | Gemini |

The codebase follows four principles:

1. **One contract.** `packages/shared/src/contracts.ts` defines the data passed between components.
2. **Every part has a mock.** Components can be built and tested independently.
3. **Switches, not rewrites.** `.env` selects mock or real services through `DATA_MODE`, `VOICE_MODE` and `AI_MODE`.
4. **Contract tests.** `npm run check` runs TypeScript checks and automated tests for shared logic, API contracts, bargaining and AI adapters.

---

## What’s next

- More cities and currencies, starting with Southeast Asia.
- Group trip invitations, so friends can log and split costs from their own phones.
- Traveller-submitted price confirmations to help keep ranges fresh.
- An instant price-check flow for photos of price tags and menus.

---

## Start in 5 minutes

You need **Node.js 20+** and an editor such as VS Code.

```bash
git clone https://github.com/edntrk/local-ish.git
cd local-ish
npm install
cp .env.example .env
npm run dev
```

On Windows, use `copy .env.example .env` instead of `cp .env.example .env`.

Open **http://localhost:5173**.

The default mock services run without API keys. Real Tiger Data, Gemini and ElevenLabs features require the configuration below.

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

Run the database setup once, then restart the app:

```bash
npm run db:setup
```

Keep credentials private. **Never commit `.env`.**

---

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app and API together |
| `npm run check` | Runs TypeScript checks and tests |
| `npm run db:setup` | Creates tables and loads Bali price data |

---

## More docs

- [AI flow](docs/AI_FLOW.md): How a sentence becomes a verdict, advice and a spoken phrase.
- [API contract](docs/CONTRACT.md): Every API endpoint with examples.
- [Development workflow](docs/WORKFLOW.md): Git, branches and pull requests.

## 🏆 Hackathon achievements

- **4th place out of 40 teams** in the WISE main track at the IKU Womxn in STEM Hackathon.
- **Best Use of ElevenLabs** award.
