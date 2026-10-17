import type { ParsedAsk, ParseRequest, PriceItem } from "@fairfare/shared";
import type { AskParser } from "../ports";

const KEYS: [string, RegExp][] = [
  ["taxi-airport", /airport/], ["scooter", /scooter|motorbike|moped/], ["taxi-city", /taxi|cab|ride|grab|gojek/],
  ["tea", /tea/], ["oj", /juice/], ["water", /water/],
  ["nasi", /nasi|warung|dinner|lunch|meal|food|restaurant/], ["sim", /\bsim\b|data/], ["sarong", /sarong|batik/], ["carving", /carving|wood/], ["massage", /massage|spa\b/],
];
const STYLE: [ParsedAsk["style"], RegExp][] = [["fancy", /fancy|rooftop|hotel|luxury|resort|beach club/], ["mid", /mid|nice|sit.?down|caf[eé]/]];

// A number followed by one of these is a count, a time or a size, never a price: "3 friends", "3am", "1.5L".
const NOT_A_PRICE = /^(people|person|persons|friends?|pax|guests?|days?|nights?|km|hours?|hrs?|hr|am|pm|l|ml|kg)$/i;
const MULTIPLIER: Record<string, number> = { k: 1e3, rb: 1e3, ribu: 1e3, jt: 1e6, juta: 1e6 };

/** "400.000" and "400,000" are 400000 (a dot or comma followed by exactly 3 digits is thousands); "1.5k", "1,5 juta" are decimals. */
function numberValue(raw: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  return Number(raw.replace(",", "."));
}

/**
 * The price in a sentence. Counts, times and sizes are skipped; a number marked as money
 * (k / rb / ribu / jt / juta / Rp / IDR) wins; otherwise the largest remaining number, not just the last one.
 */
export function lastAmount(text: string): number | null {
  const marked: number[] = [], plain: number[] = [];
  for (const m of text.matchAll(/(rp\.?\s*|idr\s*)?(\d+(?:[.,]\d+)*)(?:\s*([a-z]+))?/gi)) {
    const word = m[3]?.toLowerCase();
    if (word && NOT_A_PRICE.test(word)) continue;
    const factor = word ? MULTIPLIER[word] : undefined;
    const value = numberValue(m[2]) * (factor ?? 1);
    if (!Number.isFinite(value)) continue;
    (m[1] || factor ? marked : plain).push(value);
  }
  const pool = marked.length ? marked : plain;
  return pool.length ? Math.max(...pool) : null;
}

/** Keyword matcher. Good enough for the demo examples, no key needed. Photos always read as a sarong for 300,000. */
export class MockAskParser implements AskParser {
  async parse(req: ParseRequest, prices: PriceItem[]): Promise<ParsedAsk> {
    const currency = prices[0]?.currency ?? "IDR";
    if (!req.text && req.imageBase64) return { itemId: "sarong", amount: 300000, currency, style: "local", situation: "market", confidence: 0.5 };
    const t = (req.text ?? "").toLowerCase();
    const amount = lastAmount(t);
    const key = KEYS.find(([id, re]) => re.test(t) && prices.some((p) => p.id === id));
    if (amount === null || !key) throw new ParseError('Add what it is and the price, like "iced tea at the beach, 30000".');
    const style = STYLE.find(([, re]) => re.test(t))?.[0] ?? "local";
    // the sentence itself is the situation, so words like "supermarket" or "Grab app" can make it a fixed-price place
    return { itemId: key[0], amount, currency, style, situation: t.trim().slice(0, 120), confidence: 0.7 };
  }
}

export class ParseError extends Error {}
