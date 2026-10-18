# Local-ish 🏷️

**Know before you pay.** Local-ish helps travellers understand unfamiliar prices, record expenses, and split costs with friends. Type or say a price, such as "taxi from the airport to Seminyak, 400000", compare it with available local reference data, and hear a bargaining phrase.

The codebase uses the internal package name `fairfare`.

Built for the IKU Womxn in STEM Hackathon. Demo city: Bali (Indonesia). Prices are in IDR and bargaining phrases are in Bahasa Indonesia.

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

Open **http://localhost:5173**. The default mock services run without API keys. Real Gemini and ElevenLabs features require the configuration below.

In VS Code you can also press `Ctrl/Cmd + Shift + P` → **Run Task** → **FairFare: run app + API**.

---

## Who does what

| Role | Person | Folder |
|---|---|---|
| 🎨 Interface | Renata | `apps/web/` |
| 🗄️ Data | Ranyn | `apps/api/src/data/`, `db/` |
| 🎙️ Voice & AI | Deniz | `apps/api/src/voice/`, `apps/api/src/ai/` |

---

## Voice & AI — implemented by Deniz

- **Gemini:** understands informal and multilingual text and photo inputs, extracts the item, amount and currency, and provides short English descriptions or clarification questions. Reference data supplies price comparisons; the AI does not invent market averages.
- **ElevenLabs:** transcribes recordings with Scribe v2 and generates spoken bargaining phrases with Multilingual v2. Speech generation and transcription have passed a live round-trip test.
- **Validation:** structured responses, recording formats, timeouts and API errors are checked. The current Voice & AI test suite and existing project checks pass together.

The Voice & AI adapters are available in [pull request #1](https://github.com/edntrk/local-ish/pull/1). Frontend recording, editable transcripts and budget connections are separate integration changes; check the branch being used before expecting the complete flow.

### Enable the real services

Add your credentials to your local `.env` file:

```dotenv
AI_MODE=gemini
GEMINI_API_KEY=your_google_gemini_key
GEMINI_MODEL=gemini-3.8-flash

VOICE_MODE=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_selected_voice_id
```

Restart the app after changing `.env`. Keep credentials private; never commit `.env`. Gemini and ElevenLabs have separate usage limits. A successful voice transcript can still be followed by a Gemini quota error during expense interpretation.

## How the team works together

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
4. **Clear service errors.** Voice & AI adapters report invalid input, connection failures and quota limits in plain language. Mock services remain available for development; a mock response is not proof of a successful live API call.
5. **Contract tests.** `npm run check` runs TypeScript checks and automated tests for the shared logic, API contracts and AI adapters. GitHub runs the checks on pull requests.
6. **Pull request workflow.** Work on a separate branch and request review before merging into `main`.

---

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | App + API together |
| `npm run check` | Typecheck + tests. Run before every push. |
| `npm run db:setup` | Data role: create tables + sample prices |

## More docs

- [docs/CONTRACT.md](docs/CONTRACT.md): every API endpoint with examples
- [docs/AI_FLOW.md](docs/AI_FLOW.md): how the AI works, and what the code never lets it change
- [CLAUDE.md](CLAUDE.md): rules Claude Code follows in this project
