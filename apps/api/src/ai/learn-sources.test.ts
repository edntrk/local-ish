/** Price learning: real sources only, no duplicates, and a real category every time. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PriceResearcher, ResearchedPrice } from "../ports";
import { MockDataStore } from "../data/mock";
import { GeminiResearcher, realUrl, sourceOf } from "./gemini-research";
import { cleanSource, createPriceLearner, findSimilar, normalizeName, validateResearch } from "./learn";

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf123";
const base: ResearchedPrice = { id: "villa-night", name: "Villa per night", category: "stay", min: 500000, max: 1500000, currency: "IDR", tip: "Check the cleaning fee.", bargain: "ask", sources: ["https://www.booking.com/villa-canggu"] };
const researcherOf = (found: ResearchedPrice) => ({ research: vi.fn(async () => found) }) satisfies PriceResearcher;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("sources", () => {
  it("never keeps a vertexaisearch link, keeps real pages, and turns a bare site name into a domain", () => {
    expect(cleanSource(REDIRECT)).toBeUndefined();
    expect(cleanSource("https://vertexaisearch.cloud.google.com/anything")).toBeUndefined();
    expect(cleanSource("https://www.booking.com/villa")).toBe("https://www.booking.com/villa");
    expect(cleanSource("Booking.com")).toBe("booking.com");
    expect(cleanSource("www.tripadvisor.com")).toBe("tripadvisor.com");
    expect(cleanSource("some random words")).toBeUndefined();
    expect(cleanSource(undefined)).toBeUndefined();
  });
  it("research with only a redirect link is rejected; with a domain next to it, the domain is saved", () => {
    expect(validateResearch({ ...base, sources: [REDIRECT] }).ok).toBe(false);
    const v = validateResearch({ ...base, sources: [REDIRECT, "booking.com"] });
    expect(v.ok && v.item.source).toBe("booking.com");
    expect(v.ok && v.sources).toEqual(["booking.com"]);
  });
  it("a redirect is followed to the real page (max 3 hops)", async () => {
    const hops = [`${"https://vertexaisearch.cloud.google.com/step2"}`, "https://www.booking.com/villa-canggu"];
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { location: hops.shift()! } }));
    expect(await realUrl(REDIRECT)).toBe("https://www.booking.com/villa-canggu");
  });
  it("a redirect that can't be resolved gives nothing, and the site name from the title is used instead", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("timeout"); });
    expect(await realUrl(REDIRECT)).toBeUndefined();
    expect(await sourceOf({ web: { uri: REDIRECT, title: "booking.com" } })).toBe("booking.com");
    expect(await sourceOf({ web: { uri: REDIRECT, title: "Best villas in Canggu - a long page title" } })).toBeUndefined();
  });
  it("a redirect that never ends is not saved", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { location: REDIRECT } }));
    expect(await realUrl(REDIRECT)).toBeUndefined();
  });
  it("end to end: the Gemini researcher saves the real page or the domain, never the redirect", async () => {
    const reply = { candidates: [{
      content: { parts: [{ text: JSON.stringify({ ...base, sources: [] }) }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: REDIRECT, title: "booking.com" } }, { web: { uri: REDIRECT + "2", title: "tripadvisor.com" } }] },
    }] };
    vi.stubGlobal("fetch", async (url: string) => String(url).includes("generativelanguage")
      ? new Response(JSON.stringify(reply))
      : String(url).endsWith("2") ? new Response(null, { status: 302, headers: { location: "https://www.tripadvisor.com/villas" } }) : (() => { throw new Error("offline"); })());
    const got = await new GeminiResearcher("k").research({ city: "bali", item: "villa" });
    expect(got.sources).toEqual(["booking.com", "https://www.tripadvisor.com/villas"]);
    expect(got.sources.join(" ")).not.toMatch(/vertexaisearch/);
  });
  it("an old row that still holds a redirect link never reaches the screen", async () => {
    const data = new MockDataStore();
    await data.addPriceItem({ id: "villa-night", city: "bali", category: "stay", name: "Villa per night", min: 500000, max: 1500000, currency: "IDR", tip: "", source: REDIRECT, checkedOn: new Date().toISOString().slice(0, 10), origin: "web" });
    const got = await createPriceLearner(data, researcherOf(base)).learn({ city: "bali", item: "villa night", slug: "villa-night" });
    expect(got?.sources).toEqual([]);
  });
});

describe("duplicates", () => {
  it("names are compared without 'in Bali', 'local', brackets and filler words", () => {
    expect(normalizeName("Surf Lesson (2 hours) in Bali")).toBe("surf lesson");
    expect(normalizeName("Local surf lesson")).toBe("surf lesson");
    expect(normalizeName("Villa, per night [Canggu]")).toBe("villa");
    expect(normalizeName("Surf lesson, 2 hours")).toBe("surf lesson");
  });
  it("finds the same item under another name in the same category only", () => {
    const rows = [{ id: "surf", city: "bali", category: "activities", name: "Surf lesson, 2 hours", min: 1, max: 2, currency: "IDR", tip: "" }] as never[];
    expect(findSimilar(rows, "activities", "Surf lesson (2 hours) in Bali")?.id).toBe("surf");
    expect(findSimilar(rows, "activities", "Local surf lesson")?.id).toBe("surf");
    expect(findSimilar(rows, "stay", "Surf lesson")).toBeUndefined(); // another category
    expect(findSimilar(rows, "activities", "Scuba dive")).toBeUndefined();
  });
  it("reuses a similar row instead of researching and inserting a twin", async () => {
    const data = new MockDataStore(); // the seed already has "Surf lesson, 2 hours" under activities
    const r = researcherOf({ ...base, id: "surf-class-canggu", name: "Surf class (beginner) in Bali", category: "activities" });
    const got = await createPriceLearner(data, r).learn({ city: "bali", item: "Surf lesson in Bali", category: "activities" });
    expect(got).toMatchObject({ researched: false, item: { id: "surf" } });
    expect(r.research).not.toHaveBeenCalled(); // found before any search
    expect((await data.listPrices("bali")).filter((p) => /surf/i.test(p.name))).toHaveLength(1);
  });
  it("also catches a twin that only shows up in the researched name", async () => {
    const data = new MockDataStore();
    const r = researcherOf({ ...base, id: "surfing-lesson-new", name: "Local surf lesson", category: "activities" });
    const got = await createPriceLearner(data, r).learn({ city: "bali", item: "surfing in canggu" });
    expect(r.research).toHaveBeenCalledTimes(1);
    expect(got?.item.id).toBe("surf");
    expect((await data.listPrices("bali")).filter((p) => /surf/i.test(p.name))).toHaveLength(1);
  });
});

describe("category", () => {
  it("every real category is kept", () => {
    for (const c of ["transport", "food", "activities", "shopping", "stay", "essentials", "other"]) {
      const v = validateResearch({ ...base, category: c });
      expect(v.ok && v.item.category).toBe(c);
    }
  });
  it("an invented category falls back to the one the sentence suggested, else 'other', never 'shopping'", () => {
    const invented = { ...base, category: "wellness" };
    expect((validateResearch(invented, "activities") as { item: { category: string } }).item.category).toBe("activities");
    expect((validateResearch(invented) as { item: { category: string } }).item.category).toBe("other");
    expect((validateResearch({ ...base, category: "" }, "nonsense") as { item: { category: string } }).item.category).toBe("other");
  });
});
