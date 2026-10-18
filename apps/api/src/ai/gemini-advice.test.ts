import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPrice } from "@fairfare/shared";
import { GeminiAdvisor } from "./gemini-advice";
import { MockAskParser, lastAmount } from "./mock";
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
  it("for a fixed-price place the facts say so and the prompt forbids haggling", async () => {
    const fixed = checkPrice(trip, taxi, 400000, "local", { bargainMode: "fixed", alternative: { name: "Nasi goreng at a warung", min: 25000, max: 50000, currency: "IDR" } });
    const spy = respond({ advice: "Check the bill.", tips: ["Check the bill for service and tax.", "Ask for the menu first."] });
    const draft = await new GeminiAdvisor("test-key").advise(fixed, ctx);
    expect(draft.tips).toHaveLength(2);
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    const facts = JSON.parse(body.contents[0].parts[0].text.replace("FACTS: ", ""));
    expect(facts).toMatchObject({ bargainMode: "fixed", alternative: { min: 25000, max: 50000 } });
    const rules = body.systemInstruction.parts[0].text as string;
    expect(rules).toContain("NEVER suggest haggling, bargaining or negotiating");
    expect(rules).toContain('Write "tips": 2 to 3 short tips');
    expect(rules).toContain('bargainMode "ask"');
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
  it("reads the price, not the people, times or sizes around it", async () => {
    // coconut isn't a price item yet, so the mock has no item to match; the amount it would read is still right
    expect(lastAmount("Coconut on Kuta beach, 50000, I'm with 3 friends")).toBe(50000);
    expect(await parse("Fresh juice on Kuta beach, 50000, I'm with 3 friends")).toMatchObject({ itemId: "oj", amount: 50000 });
    expect(await parse("taxi airport 400.000")).toMatchObject({ itemId: "taxi-airport", amount: 400000 });
    expect(await parse("taxi airport Rp 400,000")).toMatchObject({ itemId: "taxi-airport", amount: 400000 });
    expect(await parse("taxi at 3am from airport 280k")).toMatchObject({ itemId: "taxi-airport", amount: 280000 });
    expect(await parse("1.5L water 10k")).toMatchObject({ itemId: "water", amount: 10000 });
  });
  it("lastAmount: thousands, decimals, juta, and the 'marked as money' rule", () => {
    expect(lastAmount("400.000")).toBe(400000);
    expect(lastAmount("400,000")).toBe(400000);
    expect(lastAmount("1.234.567")).toBe(1234567);
    expect(lastAmount("1.5k")).toBe(1500);
    expect(lastAmount("25.5k")).toBe(25500);
    expect(lastAmount("1.5jt")).toBe(1500000);
    expect(lastAmount("1,5 juta")).toBe(1500000);
    expect(lastAmount("300 ribu")).toBe(300000);
    expect(lastAmount("50 rb")).toBe(50000);
    expect(lastAmount("IDR 75000 for 2 people")).toBe(75000);
    expect(lastAmount("5 nights 30 km 2 hrs 7pm")).toBeNull();
    expect(lastAmount("scooter 80000 for 2 days, 150k deposit")).toBe(150000); // k-marked beats the plain number
    expect(lastAmount("tea 15000 and a snack 40000")).toBe(40000); // no marks: the largest, not the last-listed
    expect(lastAmount("hello")).toBeNull();
  });
  it("does not guess an item it has no price for, but keeps the price the tourist gave", async () => {
    await expect(parse("Scuba dive, 500000")).rejects.toMatchObject({ item: "Scuba dive", ask: { amount: 500000, currency: "IDR" } });
    await expect(parse("scuba dive")).rejects.toThrow("Add what it is"); // no price at all: still asks
  });
});
