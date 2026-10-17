import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiAskParser } from "./gemini";
import { SEED_PRICES } from "../data/seed-prices";

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
  it("explains quota errors without returning a fake result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(new GeminiAskParser("test-key").parse({ city: "bali", text: "taxi 250" }, SEED_PRICES)).rejects.toThrow("quota");
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
