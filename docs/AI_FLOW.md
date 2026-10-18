# How the AI works

**The data and the code decide the numbers. Gemini explains them.** Verdicts, price ranges, bargaining plans and budget numbers always come from our price list and the pure functions in `packages/shared`. Gemini reads messy human input and writes friendly sentences, but it never invents a price and never changes a verdict. Everything it writes is cleaned and checked before a tourist sees it, and every Gemini step has a template or a mock to fall back on, so the app works without any key.

Demo city: **Bali**, money in **IDR**, phrases in **Bahasa Indonesia** (`id-ID`) with the English meaning beside them.

## The flow

```
type / say / photo ──► 1 Understand ──► 2 Research (only if unknown) ──► 3 Check ──► 4 Mode ──► 5 Advice ──► 6 Speak
                                                                                                   │
                                                                              7 Bargain back-and-forth (optional)
```

| Step | Who does it | What happens | Endpoint |
|---|---|---|---|
| **1. Understand** | Gemini (`apps/api/src/ai/gemini.ts`) | Turns a sentence in any language, a typo-filled message or a photo of a price tag into `{ itemId, amount, currency, style, situation, bargainMode? }`. It may only match items from our price list. If something is missing it asks ONE short question (a 422 with that sentence). Voice is transcribed first by ElevenLabs Scribe (`speechToText`). | `POST /api/parse`, `POST /api/voice/stt` |
| **2. Research** | Gemini + Google Search (`gemini-research.ts`, `learn.ts`) | Only when step 1 understood the item but we have no price. Finds a normal local range in IDR. It is never told what the tourist was quoted. Code checks the answer (`0 < min < max`, `max <= 50 x min`, IDR, a known category, a source URL) and saves it in `price_items` with `origin = 'web'`. A `web` price older than 30 days is researched again. Failure is not an error: the app says "We don't have local prices for that yet" and Pay still works. | inside `POST /api/parse` |
| **3. Check** | Code (`checkPrice` in `pricing.ts`) | Range × style (`local` ×1, `mid` ×1.8, `fancy` ×3.5), verdict (`great` / `fair` / `high` / `tooHigh`), target price, share of the daily budget. | `POST /api/check` |
| **4. Mode** | Code (`resolveBargainMode`) | `bargain`, `ask` or `fixed`. The item's usual mode is the start, the situation can change it, and a fancy place or a chain / app / menu is always `fixed`. | `POST /api/check` |
| **5. Advice** | Gemini explains, code keeps control (`gemini-advice.ts`, `applyAdvice`) | One or two friendly sentences. In `bargain` places also a plan (open / aim / walk away) and a Bahasa phrase; in `ask` places one polite phrase ("Ada diskon?"); in `fixed` places 2 to 3 tips and never any haggling. The plan is clamped into the real range, and the phrase must say the same number as the plan. | `POST /api/check` |
| **6. Speak** | ElevenLabs (`elevenlabs.ts`) | Reads the Bahasa phrase out loud. In mock mode the endpoint answers 204 and the phone's own voice is used. | `POST /api/voice/tts` |
| **7. Bargain** | Gemini reads, code decides (`gemini-bargain.ts`, `bargain.ts`) | After "Say this", the tourist reports what the seller said (typed or by voice). Gemini translates it and says what they meant (`agreed` / `refused` / `counter` / `unclear`). The rules in code decide the move (`accept`, `counter`, `walk_away`, `retry`): offers never go down, never leave the range, and three rounds above the walk-away price end in a polite exit with something else to do. | `POST /api/bargain` |

## Budget check

Used while setting up a trip. Code decides the numbers (`typicalPerDay`, `budgetCheck` in `packages/shared/src/budget.ts`): a normal day is 3 meals, 2 rides, 1 night's stay and a little water from our own prices, compared with the budget per day (`enough` from 100%, `tight` from 70%, `notEnough` below). Gemini is only told the status and the setting, never an amount, and writes one sentence and one practical Bali tip. A sentence that contains any digit is thrown away and replaced by a template. `POST /api/budget-check`.

## What the code never lets the AI change

- **Verdicts, ranges and budget numbers** are computed in code. The AI's wording sits next to them.
- **Plans** from Gemini are clamped into the usual range and kept in order.
- **Phrases** must contain the plan's first offer ("150 ribu"), otherwise the template phrase is used.
- **Fixed-price places** drop any advice or tip that talks about haggling.
- **Every sentence** passes `cleanText` (`packages/shared/src/text.ts`): control characters and stray scripts are stripped, code-like text, words such as "placeholder" or "undefined", and over-long text are rejected. A rejected field uses its template text, never a half-cut sentence.
- **User text, seller replies and photo text** are data, never instructions to the model.
- **Researched prices** are saved only after the code checks pass, and a `seed` row is never overwritten.

## When something fails

`withFallback` (`apps/api/src/fallback.ts`) switches a failing real service to its mock for parsing and voice. For advice, bargaining and the budget note the route catches the error and uses the template or the rules-only answer, and logs the reason (`[fallback] ...`). The tourist always gets a plain sentence, never a stack trace.

## Mock or real

| Setting | `mock` (no keys) | real |
|---|---|---|
| `AI_MODE` | keyword matcher, template advice | `gemini`: steps 1, 2, 5, 7 and the budget words |
| `VOICE_MODE` | phone voice, canned transcript | `elevenlabs`: speech to text and text to speech |
| `DATA_MODE` | in-memory trips and the Bali price list | `tiger`: PostgreSQL (Tiger Data) |

Keys live in `.env` only (`GEMINI_API_KEY`, `GEMINI_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `DATABASE_URL`).
