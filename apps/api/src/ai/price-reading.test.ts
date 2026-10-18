/** "Hotel is 400,000" and "The hotel was four hundred" must never lose the price, with or without Gemini. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiAskParser, UnknownItemError } from "./gemini";
import { MockAskParser, ParseError } from "./mock";
import { SEED_PRICES } from "../data/seed-prices";

const answer = { clarification: "", item: "Hotel", category: "stay", totalAmount: 400000, itemId: "", amount: 400000, currency: "IDR", style: "local", situation: "", confidence: 0.9 };
const respond = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] })));
const gemini = (text: string) => new GeminiAskParser("test-key").parse({ city: "bali", text }, SEED_PRICES);
const unknownItem = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof UnknownItemError) return e; throw e; } throw new Error("expected UnknownItemError"); };
afterEach(() => vi.restoreAllMocks());

describe("mock parser keeps the price when there is no reference item", () => {
  const mock = (text: string) => unknownItem(new MockAskParser().parse({ city: "bali", text }, SEED_PRICES));
  it.each([
    ["Hotel is 400,000", 400000], ["Hotel is 400.000", 400000], ["hotel 400k", 400000], ["hotel 400 ribu", 400000],
    ["The hotel was four hundred", 400000], ["hotel empat ratus ribu", 400000], ["hotel four hundred thousand", 400000],
  ])("%s -> %i", async (text, amount) => {
    const e = await mock(text);
    expect(e.ask.amount).toBe(amount);
    expect(e.item.toLowerCase()).toContain("hotel");
  });
  it("still asks when there is no price at all", async () => {
    await expect(new MockAskParser().parse({ city: "bali", text: "the hotel" }, SEED_PRICES)).rejects.toThrow("Add what it is");
  });
  it("matches known items from number words too", async () => {
    expect(await new MockAskParser().parse({ city: "bali", text: "airport taxi, four hundred thousand" }, SEED_PRICES)).toMatchObject({ itemId: "taxi-airport", amount: 400000 });
  });
});

describe("Gemini: where the price used to get lost", () => {
  it("the prompt teaches commas, k, number words and 'no currency means rupiah'", async () => {
    const spy = respond(answer);
    await unknownItem(gemini("Hotel is 400,000"));
    const rules = JSON.parse(spy.mock.calls[0][1]!.body as string).systemInstruction.parts[0].text as string;
    for (const part of ["400,000 and 400.000 are 400000", "400k, 400rb and 400 ribu", "empat ratus ribu", "below 1,000", "do not ask which currency", "Never ask how many nights"]) expect(rules).toContain(part);
  });
  it("a follow-up question (per night? which currency?) no longer throws the price away", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    respond({ ...answer, clarification: "Is this 400,000 IDR per night, and for how many nights?" });
    const e = await unknownItem(gemini("Hotel is 400,000"));
    expect(e.ask.amount).toBe(400000);
    respond({ ...answer, clarification: "Is the price 400,000 IDR, or in another currency like USD?", currency: "" });
    expect((await unknownItem(gemini("The hotel was four hundred"))).ask).toMatchObject({ amount: 400000, currency: "IDR" });
  });
  it("amount 0, or '400,000' read as 400, is fixed from the text", async () => {
    respond({ ...answer, amount: 0, totalAmount: 0 });
    expect((await unknownItem(gemini("Hotel is 400,000"))).ask.amount).toBe(400000);
    respond({ ...answer, amount: 400 });
    expect((await unknownItem(gemini("Hotel is 400,000"))).ask.amount).toBe(400000);
  });
  it("a unit price Gemini worked out from a total is left alone", async () => {
    respond({ ...answer, itemId: "tea", amount: 30000, totalAmount: 60000 });
    expect(await gemini("two iced teas for sixty thousand total")).toMatchObject({ itemId: "tea", amount: 30000 });
  });
  it("still asks when the item or the price is really missing, and when the tourist names another currency", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    respond({ ...answer, item: "", itemId: "", amount: 0, confidence: 0, clarification: "What are you buying?" });
    await expect(gemini("how much")).rejects.toThrow("What are you buying?");
    respond({ ...answer, currency: "USD" });
    await expect(gemini("hotel is 40 dollars")).rejects.toThrow("quoted price in IDR");
  });
  it("logs the raw Gemini reply with console.error whenever it rejects one", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    respond({ ...answer, item: "", itemId: "", amount: 0, confidence: 0, clarification: "What are you buying?" });
    await expect(gemini("how much")).rejects.toBeInstanceOf(ParseError);
    const line = err.mock.calls.flat().join(" ");
    expect(line).toContain("[gemini parse] rejected: clarification");
    expect(line).toContain("What are you buying?"); // the raw reply
    expect(line).not.toContain("test-key");
  });
});
