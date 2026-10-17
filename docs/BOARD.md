# Task board

Tick tasks as you finish them (edit this file in your pull request). Order inside each column = priority.

**Goal for demo:** type / say / snap a price → verdict → bargain phrase spoken out loud → pay → split → budget updates. All real.

## 🎨 Interface (Renata)

- [ ] Move the prototype's script from `apps/web/index.html` into `apps/web/src/main.ts`
- [ ] Price check: use `api.parse` + `api.check` instead of the fake logic
- [ ] Play button: use `api.speak`
- [ ] Pay + split: save with `api.addExpense`, refresh money with `api.summary`
- [ ] Onboarding: `api.createTrip`; invite link `/join/<code>` → `api.joinTrip`
- [ ] Mic: record audio in the browser → `api.speechToText`
- [ ] Photo: read the file as base64 → `api.parse({ imageBase64 })`
- [ ] Loading + error states for every call ("Checking…", plain error text)
- [ ] Pitch: problem, 60-second demo script, why it's different, what's next

## 🗄️ Data (Friend 1)

- [ ] Tiger Data service created, `DATABASE_URL` in `.env`
- [ ] `npm run db:setup` works
- [ ] `tiger.ts` behaves the same as `mock.ts` (trips, join, expenses, summary)
- [ ] **Real Marrakech prices:** 15–20 items with `source` and `checked_on`
- [ ] Contract tests also run against Tiger Data when `DATABASE_URL` is set
- [ ] Bonus: log every price check, chart "what tourists are quoted today"

## 🎙️ Voice & AI (Friend 2)

- [ ] ElevenLabs key + voice id that sounds right in Arabic/French
- [ ] `textToSpeech` works (Play button speaks the Darija phrase)
- [ ] `speechToText` works with a browser recording (webm)
- [ ] Gemini key; `gemini.ts` turns the three demo sentences into the right item + price
- [ ] Gemini reads a real photo of a price tag
- [ ] Unknown items: return a clear "Couldn't understand" message (422)
- [ ] Bonus: bargain practice role-play (ElevenLabs conversational voice)

## 🤝 Together

- [ ] Repo on GitHub, friends invited, CODEOWNERS usernames filled, `main` protected
- [ ] Domain from GoDaddy Registry (e.g. fairfare.xyz)
- [ ] Full demo run-through the night before
- [ ] DEV post after the hackathon
