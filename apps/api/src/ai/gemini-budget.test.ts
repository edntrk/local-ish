import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiBudgetExplainer } from "./gemini-budget";

const facts = { city: "bali", status: "notEnough", currency: "IDR", days: 7, style: "local", perDay: 139000, typicalPerDay: 200500, shortfall: 61500 } as const;
const respond = (body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] })));
afterEach(() => vi.restoreAllMocks());

describe("Gemini budget words", () => {
  it("sends only the status and setting, and forbids numbers", async () => {
    const spy = respond({ summary: "A bit short.", tip: "Try a warung." });
    expect(await new GeminiBudgetExplainer("test-key").explain(facts)).toEqual({ summary: "A bit short.", tip: "Try a warung." });
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    const sent = body.contents[0].parts[0].text as string;
    expect(JSON.parse(sent.replace("FACTS: ", ""))).toEqual({ city: "bali", status: "notEnough", days: 7, style: "local" });
    expect(sent).not.toMatch(/139000|200500|61500/);
    expect(body.systemInstruction.parts[0].text).toContain("NEVER write any number");
  });
  it("throws on errors and malformed replies so the route can use the template", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(new GeminiBudgetExplainer("k").explain(facts)).rejects.toThrow(/429/);
    vi.restoreAllMocks();
    respond({ summary: "only one field" });
    await expect(new GeminiBudgetExplainer("k").explain(facts)).rejects.toThrow();
  });
});
