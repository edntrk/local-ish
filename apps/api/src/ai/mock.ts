import { NUMBER_WORDS, inferThousands, lastAmount, rupiahAmount, type ParsedAsk, type ParseRequest, type PriceItem } from "@fairfare/shared";
import type { AskParser } from "../ports";

const KEYS: [string, RegExp][] = [
  ["taxi-airport", /airport/], ["scooter", /scooter|motorbike|moped/], ["taxi-city", /taxi|taksi|cab|ride|grab|gojek/],
  ["surf", /surf|selancar/], ["tea", /\btea|\bteh/], ["oj", /juice/], ["water", /water/],
  ["nasi", /nasi|warung|dinner|lunch|meal|food|restaurant/], ["sim", /\bsim\b|data/], ["sarong", /sarong|batik/], ["carving", /carving|wood/], ["massage", /massage|spa\b|pijat/],
];
const STYLE: [ParsedAsk["style"], RegExp][] = [["fancy", /fancy|rooftop|hotel|luxury|resort|beach club/], ["mid", /mid|nice|sit.?down|caf[eé]/]];

export { lastAmount };

/** Keyword matcher. Good enough for the demo examples, no key needed. Photos always read as a sarong for 300,000. */
export class MockAskParser implements AskParser {
  async parse(req: ParseRequest, prices: PriceItem[]): Promise<ParsedAsk> {
    const currency = prices[0]?.currency ?? "IDR";
    if (!req.text && req.imageBase64) return { itemId: "sarong", amount: 300000, currency, style: "local", situation: "market", confidence: 0.5 };
    const t = (req.text ?? "").toLowerCase();
    const amount = rupiahAmount(t); // 400,000 / 400.000 / 400k / 400 ribu / four hundred: all read as a price
    if (amount === null || amount <= 0) throw new ParseError('Add what it is and the price, like "iced tea at the beach, 30000".');
    const key = KEYS.find(([id, re]) => re.test(t) && prices.some((p) => p.id === id));
    const style = STYLE.find(([, re]) => re.test(t))?.[0] ?? "local";
    // a price with no reference item (a hotel, a surf lesson): hand it on as "unknown item" so the price the tourist gave is never lost
    if (!key) throw new UnknownItemError(itemName(t), undefined, { amount, currency, style, situation: t.trim().slice(0, 120), confidence: 0.5 });
    // the sentence itself is the situation, so words like "supermarket" or "Grab app" can make it a fixed-price place
    const ref = prices.find((p) => p.id === key[0])!;
    return { itemId: key[0], amount: inferThousands(amount, { range: ref }), currency, style, situation: t.trim().slice(0, 120), confidence: 0.7 };
  }
}

export class ParseError extends Error {}

/**
 * Understood what it is and what was quoted, but we have no reference price for it yet.
 * It is a ParseError on purpose (the fallback must not hide it); the route catches it and researches the item.
 */
export class UnknownItemError extends ParseError {
  constructor(public item: string, public category: string | undefined, public ask: Omit<ParsedAsk, "itemId">) {
    super("We don't have local prices for that yet.");
  }
}

const FILLER = new Set(["is", "was", "were", "the", "a", "an", "for", "at", "to", "of", "i", "paid", "pay", "it", "cost", "costs", "only", "about", "around", "idr", "rp", "rupiah", "k", "rb", "jt", "he", "she", "they", "wants", "want", "asking", "asked", "total", "per", "my", "our", "just"]);
/** A short name for the item, from the words that are not numbers or filler: "The hotel was four hundred" -> "Hotel". */
function itemName(t: string): string {
  const words = (t.match(/[a-z]+/g) ?? []).filter((w) => !FILLER.has(w) && !NUMBER_WORDS.has(w)).slice(0, 4).join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Your purchase";
}
