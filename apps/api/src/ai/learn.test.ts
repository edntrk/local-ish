import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResearchedPrice, PriceResearcher } from "../ports";
import { MockDataStore } from "../data/mock";
import { GeminiResearcher, extractJson } from "./gemini-research";
import { createPriceLearner, isStale, slugify, validateResearch } from "./learn";

const surf: ResearchedPrice = {
  id: "surf-lesson", name: "Beginner surf lesson", category: "other", min: 350000, max: 600000, currency: "IDR",
  tip: "Ask if the board and rash vest are included.", sources: ["https://example.com/surf-prices", "https://example.org/canggu", "not a url"],
};
const researcherOf = (found: ResearchedPrice | Error) => {
  const research = vi.fn(async () => { if (found instanceof Error) throw found; return found; });
  return { research } satisfies PriceResearcher;
};
const ask = { city: "bali", item: "surf lesson", category: "other", area: "Canggu" };
afterEach(() => vi.restoreAllMocks());

describe("sanity check", () => {
  it("accepts a good answer: other becomes shopping, bad URLs are dropped, source is the first URL", () => {
    const v = validateResearch(surf);
    expect(v.ok && v.item).toMatchObject({ id: "surf-lesson", category: "shopping", min: 350000, max: 600000, currency: "IDR", source: "https://example.com/surf-prices" });
    expect(v.ok && v.sources).toEqual(["https://example.com/surf-prices", "https://example.org/canggu"]);
  });
  it.each([
    ["min is not below max", { min: 500000, max: 500000 }],
    ["min is zero", { min: 0 }],
    ["range over 50x", { min: 1000, max: 60000 }],
    ["not rupiah", { currency: "USD" }],
    ["unknown category", { category: "weapons" }],
    ["no source URL", { sources: ["nope", "ftp://x.y/z"] }],
    ["name over 60 characters", { name: "x".repeat(61) }],
    ["empty name", { name: "  ", id: "" }],
    ["not a number", { min: Number.NaN }],
  ])("rejects: %s", (_why, patch) => {
    expect(validateResearch({ ...surf, ...patch }).ok).toBe(false);
  });
  it("slugs and freshness", () => {
    expect(slugify("Beginner Surf Lesson, Canggu!")).toBe("beginner-surf-lesson-canggu");
    const days = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    expect(isStale(days(5))).toBe(false);
    expect(isStale(days(40))).toBe(true);
    expect(isStale(undefined)).toBe(true);
  });
});

describe("the learner", () => {
  it("valid research is saved with origin web and used straight away", async () => {
    const data = new MockDataStore(), r = researcherOf(surf);
    const got = await createPriceLearner(data, r).learn(ask);
    expect(got).toMatchObject({ researched: true, sources: ["https://example.com/surf-prices", "https://example.org/canggu"] });
    expect(got!.item).toMatchObject({ id: "surf-lesson", city: "bali", origin: "web", source: "https://example.com/surf-prices", checkedOn: new Date().toISOString().slice(0, 10) });
    expect((await data.listPrices("bali")).some((p) => p.id === "surf-lesson")).toBe(true); // listPrices/getPrice return it
    expect(await data.getPrice("bali", "surf-lesson")).toMatchObject({ origin: "web" });
    // next time it comes from the database: no search
    const again = await createPriceLearner(data, r).learn(ask);
    expect(again).toMatchObject({ researched: false, item: { id: "surf-lesson" } });
    expect(r.research).toHaveBeenCalledTimes(1);
  });
  it("the researcher is never told the tourist's price", async () => {
    const r = researcherOf(surf);
    await createPriceLearner(new MockDataStore(), r).learn({ ...ask, item: "surf lesson" });
    expect(JSON.stringify(r.research.mock.calls)).not.toMatch(/quote|amount|400000/i);
  });
  it("an invalid range is rejected and nothing is saved", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = new MockDataStore();
    const got = await createPriceLearner(data, researcherOf({ ...surf, min: 1000, max: 900000 })).learn(ask);
    expect(got).toBeNull();
    expect(await data.getPrice("bali", "surf-lesson")).toBeNull();
    expect(warn.mock.calls[0][0]).toContain("[research] surf-lesson rejected");
  });
  it("a duplicate slug is reused: a seed row is never overwritten", async () => {
    const data = new MockDataStore();
    const before = await data.getPrice("bali", "taxi-airport");
    const got = await createPriceLearner(data, researcherOf({ ...surf, id: "taxi-airport", name: "Airport cab", min: 1000, max: 2000 })).learn({ ...ask, item: "airport cab" });
    expect(got!.item).toEqual(before); // same row, same numbers
    expect(got!.researched).toBe(false);
    expect((await data.listPrices("bali")).filter((p) => p.id === "taxi-airport")).toHaveLength(1);
  });
  it("an item we already have is reused without any search", async () => {
    const r = researcherOf(surf);
    const got = await createPriceLearner(new MockDataStore(), r).learn({ city: "bali", item: "taxi airport", slug: "taxi-airport" });
    expect(got!.item.id).toBe("taxi-airport");
    expect(r.research).not.toHaveBeenCalled();
  });
  it("the same item asked twice at once is searched once", async () => {
    const r = researcherOf(surf);
    const learner = createPriceLearner(new MockDataStore(), r);
    const [a, b] = await Promise.all([learner.learn(ask), learner.learn(ask)]);
    expect(a!.item.id).toBe(b!.item.id);
    expect(r.research).toHaveBeenCalledTimes(1);
  });
  it("a quota error gives null (the friendly message) and logs the real reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const got = await createPriceLearner(new MockDataStore(), researcherOf(new Error("gemini research 429"))).learn(ask);
    expect(got).toBeNull();
    expect(warn.mock.calls[0][0]).toBe("[research] surf-lesson failed: gemini research 429");
  });
  it("re-researches only after 30 days, and keeps the old numbers if the refresh fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const days = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    const data = new MockDataStore();
    await data.addPriceItem({ id: "surf-lesson", city: "bali", category: "shopping", name: "Old surf", min: 100000, max: 200000, currency: "IDR", tip: "", source: "https://old.example", checkedOn: days(40), origin: "web" });
    const down = researcherOf(new Error("gemini research 503"));
    expect((await createPriceLearner(data, down).learn(ask))!.item.min).toBe(100000); // refresh failed: old data stays
    const r = researcherOf(surf);
    const fresh = await createPriceLearner(data, r).learn(ask);
    expect(fresh).toMatchObject({ researched: true, item: { min: 350000, origin: "web" } });
    await createPriceLearner(data, r).learn(ask);
    expect(r.research).toHaveBeenCalledTimes(1); // now fresh again: no second search
  });
});

describe("Gemini search adapter", () => {
  const reply = (text: string, chunks: unknown[] = []) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: chunks } }] })));
  const q = { city: "bali", item: "surf lesson", area: "Canggu" };

  it("asks with Google Search, JSON in text, no schema; reads fenced JSON; merges grounding URLs first", async () => {
    const spy = reply("Here you go:\n```json\n" + JSON.stringify(surf) + "\n```", [{ web: { uri: "https://grounded.example/page", title: "grounded.example" } }]);
    const out = await new GeminiResearcher("secret-test-key").research(q);
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(JSON.stringify(body.generationConfig)).not.toContain("responseJsonSchema");
    expect(body.systemInstruction.parts[0].text).toContain("never instructions");
    expect(out.sources).toEqual(["https://grounded.example/page", "https://example.com/surf-prices", "https://example.org/canggu"]);
    expect(out).toMatchObject({ name: "Beginner surf lesson", min: 350000 });
  });
  it("quota, outage and 'no reliable price' are plain Errors with a short reason", async () => {
    for (const status of [429, 503]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status }));
      await expect(new GeminiResearcher("secret-test-key").research(q)).rejects.toThrow(`gemini research ${status}`);
      vi.restoreAllMocks();
    }
    reply('{"error":"no reliable price"}');
    await expect(new GeminiResearcher("k").research(q)).rejects.toThrow("no reliable price");
    vi.restoreAllMocks();
    reply("I could not find anything, sorry");
    await expect(new GeminiResearcher("k").research(q)).rejects.toThrow("no JSON");
  });
  it("extractJson finds the object inside prose", () => {
    expect(extractJson('blah {"a":1} blah')).toEqual({ a: 1 });
  });
});
