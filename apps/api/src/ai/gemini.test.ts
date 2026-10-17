import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiAskParser, UnknownItemError } from "./gemini";
import { SEED_PRICES } from "../data/seed-prices";
import { MockAskParser, ParseError } from "./mock";
import { withFallback } from "../fallback";
import type { AskParser } from "../ports";

const answer = { clarification: "", itemId: "taxi-airport", amount: 400000, currency: "IDR", style: "local", situation: "airport", confidence: 0.95 };
function respond(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] })));
}
afterEach(() => vi.restoreAllMocks());
describe("Gemini price conversation", () => {
  it("passes context to Gemini and validates the returned item", async () => {
    const spy = respond(answer);
    const result = await new GeminiAskParser("test-key").parse({ city: "bali", text: "Tourist: airprt taxi\nFairFare: How much?\nTourist: four hundred thousand" }, SEED_PRICES);
    expect(result.amount).toBe(400000);
    expect(result.itemId).toBe("taxi-airport");
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.contents[0].parts[0].text).toContain("four hundred thousand");
    expect(body.systemInstruction.parts[0].text).toContain("Never convert currencies");
  });
  it("returns a specific follow-up without treating placeholders as a real quote", async () => {
    respond({ ...answer, clarification: "How much is the driver asking?", itemId: "", amount: 0, confidence: 0 });
    await expect(new GeminiAskParser("test-key").parse({ city: "bali", text: "airport taxi" }, SEED_PRICES)).rejects.toThrow("How much is the driver asking?");
  });
  it("does not allow an unsupported item or a foreign currency into price checks", async () => {
    respond({ ...answer, itemId: "invented" });
    const parser = new GeminiAskParser("test-key");
    await expect(parser.parse({ city: "bali", text: "carpet 250" }, SEED_PRICES)).rejects.toThrow("What are you buying");
    vi.restoreAllMocks();
    respond({ ...answer, currency: "EUR" });
    await expect(parser.parse({ city: "bali", text: "taxi 250 euros" }, SEED_PRICES)).rejects.toThrow("IDR");
  });
  it("preserves a PNG photo MIME type and strips the data URL prefix", async () => {
    const spy = respond(answer);
    await new GeminiAskParser("test-key").parse({ city: "bali", imageBase64: "data:image/png;base64,YWJj" }, SEED_PRICES);
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: "image/png", data: "YWJj" });
  });
  it("quota, outage and network problems are plain Errors (so the fallback can answer), never ParseErrors", async () => {
    const parser = new GeminiAskParser("test-key");
    const ask = { city: "bali", text: "taxi 250" };
    for (const status of [429, 500, 503, 403]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status }));
      const err = await parser.parse(ask, SEED_PRICES).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ParseError);
      expect(err.message).toBe(`gemini parse ${status}`); // the reason for the server log; it never contains the key
      vi.restoreAllMocks();
    }
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const timeout = await parser.parse(ask, SEED_PRICES).catch((e) => e);
    expect(timeout).not.toBeInstanceOf(ParseError);
    expect(timeout.message).toContain("TimeoutError");
    expect(await new GeminiAskParser("").parse(ask, SEED_PRICES).catch((e) => e)).not.toBeInstanceOf(ParseError);
  });
  it("the parse prompt and schema use the fixed category list, with examples", async () => {
    const spy = respond(answer);
    await new GeminiAskParser("test-key").parse({ city: "bali", text: "taxi airport 400000" }, SEED_PRICES);
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.generationConfig.responseJsonSchema.properties.category.enum).toEqual(["transport", "food", "activities", "shopping", "stay", "essentials", "other"]);
    const prompt = body.systemInstruction.parts[0].text as string;
    expect(prompt).toContain("pick exactly ONE from this fixed list");
    expect(prompt).toContain("never invent a new one");
    expect(prompt).toContain("surf lesson, massage");
    expect(prompt).toContain("stay (hotel, villa, hostel)");
  });
  it("reads bargainMode from the situation and passes it on; the prompt explains the three modes", async () => {
    const spy = respond({ ...answer, itemId: "nasi", amount: 150000, situation: "fancy restaurant with a menu", bargainMode: "fixed" });
    const result = await new GeminiAskParser("test-key").parse({ city: "bali", text: "nasi goreng at a fancy restaurant 150000" }, SEED_PRICES);
    expect(result).toMatchObject({ itemId: "nasi", bargainMode: "fixed", situation: "fancy restaurant with a menu" });
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.generationConfig.responseJsonSchema.properties.bargainMode.enum).toEqual(["bargain", "ask", "fixed"]);
    expect(body.generationConfig.responseJsonSchema.required).not.toContain("bargainMode"); // optional: the item's usual mode applies when the situation says nothing
    const prompt = body.systemInstruction.parts[0].text as string;
    expect(prompt).toContain("bargainMode comes from the SITUATION");
    expect(prompt).toContain("Fancy places and chains are always \"fixed\"");
  });
  it("a reply without bargainMode is fine", async () => {
    respond(answer);
    expect((await new GeminiAskParser("test-key").parse({ city: "bali", text: "taxi airport" }, SEED_PRICES)).bargainMode).toBeUndefined();
  });
  it("a reply with an invented category is not accepted as data", async () => {
    respond({ ...answer, itemId: "", item: "Kite lesson", category: "adventure", amount: 500000 });
    const err = await new GeminiAskParser("test-key").parse({ city: "bali", text: "kite lesson 500000" }, SEED_PRICES).catch((e) => e);
    expect(err).not.toBeInstanceOf(UnknownItemError); // the schema refuses it, so nothing gets researched or saved under a made-up category
  });
  it("a real follow-up question is still a ParseError", async () => {
    respond({ ...answer, clarification: "How much is the driver asking?", itemId: "", amount: 0, confidence: 0 });
    const err = await new GeminiAskParser("test-key").parse({ city: "bali", text: "airport taxi" }, SEED_PRICES).catch((e) => e);
    expect(err).toBeInstanceOf(ParseError);
  });
  it("with the fallback wrapper, a Gemini 429 means the mock parser answers (no 'Gemini is busy' error)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parser = withFallback<AskParser>("ai", new GeminiAskParser("secret-test-key"), new MockAskParser());
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    const result = await parser.parse({ city: "bali", text: "Taxi from the airport to Seminyak, he wants 400000" }, SEED_PRICES);
    expect(result).toMatchObject({ itemId: "taxi-airport", amount: 400000, currency: "IDR" });
    expect(warn.mock.calls[0].join(" ")).toContain("[fallback] ai.parse failed, using mock: gemini parse 429");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("secret-test-key");
    // a real "how much?" answer is NOT replaced by the mock
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ ...answer, clarification: "How much is the driver asking?", itemId: "", amount: 0, confidence: 0 });
    await expect(parser.parse({ city: "bali", text: "airport taxi" }, SEED_PRICES)).rejects.toThrow("How much is the driver asking?");
  });
});

describe("budget drafts independent of reference prices", () => {
  it("allows a hotel expense without inventing a reference or verdict", async () => {
    respond({ ...answer, itemId: "", item: "Hotel, two nights", category: "other", amount: 500000, totalAmount: 1000000 });
    const draft = await new GeminiAskParser("test-key").draft({ city: "bali", text: "hotel 2 nights 500 a night" }, SEED_PRICES);
    expect(draft).toMatchObject({ item: "Hotel, two nights", category: "other", itemId: null, amount: 1000000, unitAmount: 500000 });
  });
  it("keeps the expense total separate from the comparison price", async () => {
    respond({ ...answer, itemId: "tea", item: "Two iced teas", category: "food", amount: 30000, totalAmount: 60000 });
    const draft = await new GeminiAskParser("test-key").draft({ city: "bali", text: "two teas 60 total" }, SEED_PRICES);
    expect(draft.amount).toBe(60000);
    expect(draft.unitAmount).toBe(30000);
  });
});


it("accepts Turkish input and requests English output without changing the amount", async () => {
  const spy = respond({ ...answer, itemId: "", item: "Hotel", category: "other", amount: 600000, totalAmount: 600000 });
  const result = await new GeminiAskParser("test-key").draft({ city: "bali", text: "otele 600 dirhem ödedim" }, SEED_PRICES);
  expect(result).toMatchObject({ item: "Hotel", amount: 600000, currency: "IDR", itemId: null });
  const prompt = JSON.parse(spy.mock.calls[0][1]!.body as string).systemInstruction.parts[0].text;
  expect(prompt).toContain("Accept input in any language");
  expect(prompt).toContain("Translate expense item names and clarification questions into English");
  expect(prompt).not.toContain("Accept English input only");
});
