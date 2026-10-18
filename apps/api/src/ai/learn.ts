/**
 * "The price database learns new items."
 * Unknown item -> research it -> check the answer in code -> save it with origin 'web' -> use it like any other price.
 * Only search results are ever saved. The tourist's own quote is never an input here.
 */
import { CATEGORIES, cleanText, type PriceItem } from "@fairfare/shared";
import type { DataStore, LearnResult, PriceLearner, PriceResearcher, ResearchedPrice } from "../ports";

export const STALE_DAYS = 30;

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
const today = () => new Date().toISOString().slice(0, 10);

/** A researched price older than 30 days is looked up again. */
export const isStale = (checkedOn?: string, now = Date.now()) => !checkedOn || (now - Date.parse(checkedOn)) / 864e5 > STALE_DAYS;

const isUrl = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
// Gemini's search grounding hands out redirect links on google's own host: they expire and say nothing about the page, so they are never saved
const isRedirect = (u: string) => /vertexaisearch|grounding-api-redirect/i.test(u);

/**
 * A source worth saving: the page itself (a real https link), or just the site's domain ("booking.com").
 * Anything else, above all a vertexaisearch redirect link, is dropped.
 */
export function cleanSource(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s || isRedirect(s)) return undefined;
  if (isUrl(s)) return s;
  const domain = s.toLowerCase().replace(/^www\./, "");
  return DOMAIN.test(domain) ? domain : undefined;
}

const NOISE = /\b(in|at|of|the|a|an|for|per|bali|local|locally|indonesia|hours?|hrs?|minutes?|mins?|days?|nights?|person|people|pax)\b|\b\d+\b/g; // filler, units and counts do not make another item
/** "Surf lesson (2 hours) in Bali" and "surf lesson, local" are the same thing: lowercase, no brackets, no filler words, units or counts. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(NOISE, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** An existing row in the same category whose name is the same once normalized, or one name holds all the words of the other (at least 2). */
export function findSimilar(items: PriceItem[], category: string, name: string): PriceItem | undefined {
  const want = normalizeName(name);
  if (!want) return undefined;
  const words = new Set(want.split(" "));
  return items.find((p) => {
    if (p.category !== category) return false;
    const have = normalizeName(p.name);
    if (have === want) return true;
    const mine = new Set(have.split(" "));
    const shared = [...words].filter((w) => mine.has(w)).length;
    return shared >= 2 && (shared === Math.min(words.size, mine.size) || shared / Math.max(words.size, mine.size) >= 0.75);
  });
}

/**
 * The code-side sanity check. Anything that fails is rejected, and the tourist just sees
 * "We don't have local prices for that yet".
 */
export function validateResearch(r: ResearchedPrice, hint?: string): { ok: true; item: Omit<PriceItem, "city" | "origin" | "checkedOn">; sources: string[] } | { ok: false; reason: string } {
  const { min, max } = r;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min > 0) || !(min < max)) return { ok: false, reason: "range must satisfy 0 < min < max" };
  if (max > 50 * min) return { ok: false, reason: "range is too wide (max over 50x min)" };
  if (r.currency !== "IDR") return { ok: false, reason: `currency ${r.currency} is not IDR` };
  // the fixed list only: the old "sim" reads as essentials. A category Gemini made up is replaced by the one the tourist's sentence suggested, else "other" (never a guess like "shopping")
  const pick = (c?: string) => { const x = c === "sim" ? "essentials" : c; return (CATEGORIES as readonly string[]).includes(x ?? "") ? (x as PriceItem["category"]) : undefined; };
  const category = pick(r.category) ?? pick(hint) ?? "other";
  const sources = [...new Set(r.sources.map(cleanSource).filter((s): s is string => !!s))].slice(0, 3);
  if (!sources.length) return { ok: false, reason: "no usable source (a page link or a site name)" };
  const name = cleanText(r.name, { max: 60 }); // clean, plain words, at most 60 characters
  if (!name) return { ok: false, reason: "name is empty, junk, or over 60 characters" };
  const bargain = r.bargain === "bargain" || r.bargain === "ask" || r.bargain === "fixed" ? r.bargain : undefined; // missing or odd: the category decides later
  // (a tip that fails the cleaning is dropped; the price itself is still fine)
  const id = slugify(r.id || name);
  if (!id) return { ok: false, reason: "no usable slug" };
  return { ok: true, sources, item: { id, category, name, min, max, currency: "IDR", tip: cleanText(r.tip, { max: 200 }) ?? "", source: sources[0], ...(bargain ? { bargain } : {}) } };
}

export function createPriceLearner(data: DataStore, researcher: PriceResearcher): PriceLearner {
  const inFlight = new Map<string, Promise<LearnResult | null>>(); // same item twice at once = one search

  // a saved row's source for the screen: never a redirect link, even if an old row still holds one
  const sourcesOf = (item: PriceItem) => { const c = cleanSource(item.source); return c ? [c] : []; };

  async function run(q: Parameters<PriceLearner["learn"]>[0]): Promise<LearnResult | null> {
    const slug = q.slug ?? slugify(q.item);
    let existing: PriceItem | null = null;
    try {
      existing = slug ? await data.getPrice(q.city, slug) : null;
      // already known (ours, or researched less than 30 days ago): no search at all
      if (existing && !(existing.origin === "web" && isStale(existing.checkedOn))) {
        return { item: existing, sources: sourcesOf(existing), researched: false };
      }
      // the same thing under another name ("Surf lesson (2 hours) in Bali" vs "surf lesson"): reuse that row, never add a twin
      if (!existing && q.category) {
        const twin = findSimilar(await data.listPrices(q.city), q.category, q.item);
        if (twin) return { item: twin, sources: sourcesOf(twin), researched: false };
      }
      const found = await researcher.research({ city: q.city, item: q.item, category: q.category, area: q.area });
      const checked = validateResearch(found, q.category);
      if (!checked.ok) {
        console.error(`[research] ${slug} rejected: ${checked.reason}`);
        return existing ? { item: existing, sources: sourcesOf(existing), researched: false } : null;
      }
      if (!existing) {
        const twin = findSimilar(await data.listPrices(q.city), checked.item.category, checked.item.name);
        if (twin) return { item: twin, sources: sourcesOf(twin), researched: false };
      }
      // a re-research keeps the old id; a new item that turns out to share a slug with a row is reused by the store
      const stored = await data.addPriceItem({ ...checked.item, id: existing?.id ?? checked.item.id, city: q.city, origin: "web", checkedOn: today() });
      const fresh = stored.origin === "web" && stored.checkedOn === today();
      // if the store handed back an existing row (same slug), it keeps its own source, not this search's pages
      return { item: stored, sources: fresh ? checked.sources : sourcesOf(stored), researched: fresh };
    } catch (e) {
      console.error(`[research] ${slug} failed: ${(e as Error).message}`); // the real reason; never the key
      return existing ? { item: existing, sources: sourcesOf(existing), researched: false } : null;
    }
  }

  return {
    learn(q) {
      const key = `${q.city}:${q.slug ?? slugify(q.item)}`;
      const running = inFlight.get(key);
      if (running) return running;
      const p = run(q).finally(() => inFlight.delete(key));
      inFlight.set(key, p);
      return p;
    },
  };
}
