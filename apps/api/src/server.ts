import { config } from "./config";
import { createApp } from "./app";
import { withFallback } from "./fallback";
import { MockDataStore } from "./data/mock";
import { TigerDataStore } from "./data/tiger";
import { MockVoice } from "./voice/mock";
import { ElevenLabsVoice } from "./voice/elevenlabs";
import { MockAskParser } from "./ai/mock";
import { GeminiAskParser } from "./ai/gemini";
import { GeminiAdvisor } from "./ai/gemini-advice";
import { GeminiResearcher } from "./ai/gemini-research";
import { createPriceLearner } from "./ai/learn";
import { GeminiBargainCoach } from "./ai/gemini-bargain";
import { GeminiBudgetExplainer } from "./ai/gemini-budget";
import type { AdviceWriter, AskParser, BargainCoach, BudgetExplainer, DataStore, PriceLearner, VoiceService } from "./ports";

const warn = (m: string) => console.warn("⚠️  " + m);

let data: DataStore = new MockDataStore();
let dataMode: string = "mock";
if (config.dataMode === "tiger") {
  if (config.databaseUrl) { data = new TigerDataStore(config.databaseUrl); dataMode = "tiger"; }
  else warn("DATA_MODE=tiger but DATABASE_URL is empty. Using mock data.");
}

let voice = new MockVoice() as VoiceService;
let voiceMode = "mock";
if (config.voiceMode === "elevenlabs") {
  if (config.elevenLabsKey && config.elevenLabsVoiceId) {
    voice = withFallback<VoiceService>("voice", new ElevenLabsVoice(config.elevenLabsKey, config.elevenLabsVoiceId), new MockVoice());
    voiceMode = "elevenlabs (falls back to mock)";
  } else warn("VOICE_MODE=elevenlabs but the key or voice id is empty. Using mock voice.");
}

let ai = new MockAskParser() as AskParser;
let coach: BargainCoach | undefined; // no coach = the code-only rules answer
let learner: PriceLearner | undefined; // no learner = unknown items just get the "no local prices yet" answer
let budgetExplainer: BudgetExplainer | undefined; // no explainer = the template words
let advisor: AdviceWriter | undefined; // no advisor = the template advice from checkPrice
let aiMode = "mock";
if (config.aiMode === "gemini") {
  if (config.geminiKey) { ai = withFallback<AskParser>("ai", new GeminiAskParser(config.geminiKey), new MockAskParser()); aiMode = "gemini (falls back to mock)"; advisor = new GeminiAdvisor(config.geminiKey); learner = createPriceLearner(data, new GeminiResearcher(config.geminiKey)); coach = new GeminiBargainCoach(config.geminiKey); budgetExplainer = new GeminiBudgetExplainer(config.geminiKey); }
  else warn("AI_MODE=gemini but GEMINI_API_KEY is empty. Using mock AI.");
}

void data.init?.().catch((e) => console.warn("[data] setup failed:", (e as Error).message)); // e.g. add new columns; safe to re-run
createApp({ data, voice, ai, advisor, learner, coach, budgetExplainer, modes: { data: dataMode, voice: voiceMode, ai: aiMode }, corsOrigins: config.corsOrigins }).listen(config.port, () => {
  console.log(`FairFare API on http://localhost:${config.port}  ·  data=${dataMode}  voice=${voiceMode}  ai=${aiMode}`);
});
