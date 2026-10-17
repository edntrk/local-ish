import { lastAmount, type ParsedAsk, type ParseRequest, type PriceItem } from "@fairfare/shared";
import type { AskParser } from "../ports";

const KEYS: [string, RegExp][] = [
  ["taxi-airport", /airport/], ["scooter", /scooter|motorbike|moped/], ["taxi-city", /taxi|cab|ride|grab|gojek/],
  ["tea", /tea/], ["oj", /juice/], ["water", /water/],
  ["nasi", /nasi|warung|dinner|lunch|meal|food|restaurant/], ["sim", /\bsim\b|data/], ["sarong", /sarong|batik/], ["carving", /carving|wood/], ["massage", /massage|spa\b/],
];
const STYLE: [ParsedAsk["style"], RegExp][] = [["fancy", /fancy|rooftop|hotel|luxury|resort|beach club/], ["mid", /mid|nice|sit.?down|caf[eé]/]];

export { lastAmount };

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
