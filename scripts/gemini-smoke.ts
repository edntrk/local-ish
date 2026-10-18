// Optional live check: node --import tsx scripts/gemini-smoke.ts
import { config } from "../apps/api/src/config";
import { GeminiAskParser } from "../apps/api/src/ai/gemini";
import { SEED_PRICES } from "../apps/api/src/data/seed-prices";
import { ParseError } from "../apps/api/src/ai/mock";
if (!config.geminiKey) throw new Error("Set GEMINI_API_KEY in the root .env first.");
const parser = new GeminiAskParser(config.geminiKey);
const cases = [
  { text: "heyy airprt taxi guy wants two hundred fifty thousand rupiah is that ok??", id: "taxi-airport", amount: 250000 },
  { text: "havaalanından Seminyak'e taksi 250000 rupi istiyor normal mi", id: "taxi-airport", amount: 250000 },
  { text: "Tourist: airport taxi\nFairFare: How much is the driver asking?\nTourist: 250000", id: "taxi-airport", amount: 250000 },
  { text: "hi can u help me", clarification: true },
  { text: "two iced teas for sixty thousand rupiah total", id: "tea", amount: 30000 },
];
for (const c of cases) {
  try {
    const result = await parser.parse({ city: "marrakech", text: c.text }, SEED_PRICES);
    if (c.clarification || result.itemId !== c.id || result.amount !== c.amount) throw new Error("Unexpected interpretation");
    console.log("PASS", c.text, "=>", result.itemId, result.amount);
  } catch (error) {
    if (c.clarification && error instanceof ParseError && !/Gemini|quota|response/i.test(error.message)) console.log("PASS clarification:", error.message);
    else { console.error("FAIL", c.text, error instanceof Error ? error.message : "Request failed"); process.exitCode = 1; }
  }
}
