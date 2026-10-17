import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPrice } from "@fairfare/shared";
import { GeminiAdvisor } from "./gemini-advice";
import { MockAskParser } from "./mock";
import { MockDataStore } from "../data/mock";
import { SEED_PRICES } from "../data/seed-prices";

const taxi = SEED_PRICES.find((p) => p.id === "taxi-airport")!;
const trip = (await new MockDataStore().getTrip("demo"))!;
const result = checkPrice(trip, taxi, 400000, "local");
const ctx = { city: "bali", amount: 400000, style: "local", situation: "airport, at night" };
const respond = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] })));
afterEach(() => vi.restoreAllMocks());

describe("Gemini advice", () => {
  it("sends only facts, and returns advice, plan and phrase", async () => {
    const spy = respond({ advice: "Too much.", plan: { openWith: 170000, aimFor: 200000, walkAwayAbove: 250000 }, phrase: { local: "Wah! 170 ribu saja", english: "Wow" } });
    const draft = await new GeminiAdvisor("test-key").advise(result, ctx);
    expect(draft.plan?.openWith).toBe(170000);
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    const facts = JSON.parse(body.contents[0].parts[0].text.replace("FACTS: ", ""));
    expect(facts).toMatchObject({ verdict: "tooHigh", usualRange: { min: 150000, max: 250000 }, situation: "airport, at night" });
    expect(body.systemInstruction.parts[0].text).toContain("never change the verdict");
  });
  it("throws on errors and on malformed replies so the route can use the template", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(new GeminiAdvisor("test-key").advise(result, ctx)).rejects.toThrow("429");
    vi.restoreAllMocks();
    respond({ nonsense: true });
    await expect(new GeminiAdvisor("test-key").advise(result, ctx)).rejects.toThrow();
  });
});

describe("mock parser (Bali)", () => {
  const parse = (text: string) => new MockAskParser().parse({ city: "bali", text }, SEED_PRICES);
  it("reads the demo sentences", async () => {
    expect(await parse("Taxi from the airport to Seminyak at night, he wants 400000")).toMatchObject({ itemId: "taxi-airport", amount: 400000, currency: "IDR" });
    expect(await parse("Short Grab ride, 50000")).toMatchObject({ itemId: "taxi-city", amount: 50000 });
    expect(await parse("Iced tea at a fancy beach club, 60k")).toMatchObject({ itemId: "tea", amount: 60000, style: "fancy" });
    expect(await parse("Batik sarong at the market, 300 ribu")).toMatchObject({ itemId: "sarong", amount: 300000 });
    expect(await parse("Nasi goreng at a warung, 15000")).toMatchObject({ itemId: "nasi", amount: 15000 });
  });
  it("does not guess for items it has no price for", async () => {
    await expect(parse("Surf lesson, 500000")).rejects.toThrow("Add what it is");
  });
});
