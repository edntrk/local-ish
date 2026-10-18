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

/**
 * The code-side sanity check. Anything that fails is rejected, and the tourist just sees
 * "We don't have local prices for that yet".
 */
export function validateResearch(r: ResearchedPrice): { ok: true; item: Omit<PriceItem, "city" | "origin" | "checkedOn">; sources: string[] } | { ok: false; reason: string } {
  const { min, max } = r;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min > 0) || !(min < max)) return { ok: false, reason: "range must satisfy 0 < min < max" };
  if (max > 50 * min) return { ok: false, reason: "range is too wide (max over 50x min)" };
  if (r.currency !== "IDR") return { ok: false, reason: `currency ${r.currency} is not IDR` };
  // the fixed list only: the old "sim" reads as essentials, and anything the model invents becomes "other" (never a new category)
  const said = r.category === "sim" ? "essentials" : r.category;
  const category = (CATEGORIES as readonly string[]).includes(said) ? (said as PriceItem["category"]) : "other";
  const sources = [...new Set(r.sources.filter(isUrl))].slice(0, 3);
  if (!sources.length) return { ok: false, reason: "no source URL" };
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

  async function run(q: Parameters<PriceLearner["learn"]>[0]): Promise<LearnResult | null> {
    const slug = q.slug ?? slugify(q.item);
    let existing: PriceItem | null = null;
    try {
      existing = slug ? await data.getPrice(q.city, slug) : null;
      // already known (ours, or researched less than 30 days ago): no search at all
      if (existing && !(existing.origin === "web" && isStale(existing.checkedOn))) {
        return { item: existing, sources: existing.source ? [existing.source] : [], researched: false };
      }
      const found = await researcher.research({ city: q.city, item: q.item, category: q.category, area: q.area });
      const checked = validateResearch(found);
      if (!checked.ok) {
        console.error(`[research] ${slug} rejected: ${checked.reason}`);
        return existing ? { item: existing, sources: existing.source ? [existing.source] : [], researched: false } : null;
      }
      // a re-research keeps the old id; a new item that turns out to share a slug with a row is reused by the store
      const stored = await data.addPriceItem({ ...checked.item, id: existing?.id ?? checked.item.id, city: q.city, origin: "web", checkedOn: today() });
      const fresh = stored.origin === "web" && stored.checkedOn === today();
      // if the store handed back an existing row (same slug), it keeps its own source, not this search's pages
      return { item: stored, sources: fresh ? checked.sources : stored.source ? [stored.source] : [], researched: fresh };
    } catch (e) {
      console.error(`[research] ${slug} failed: ${(e as Error).message}`); // the real reason; never the key
      return existing ? { item: existing, sources: existing.source ? [existing.source] : [], researched: false } : null;
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
