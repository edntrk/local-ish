import type { ParsedAsk, ParseRequest, PriceItem } from "@fairfare/shared";
import type { AskParser } from "../ports";

const KEYS: [string, RegExp][] = [
  ["taxi-airport", /airport/], ["taxi-city", /taxi|cab|ride/], ["tea", /tea/], ["oj", /juice/], ["water", /water/],
  ["tagine", /tagine|dinner|lunch|meal|food|restaurant/], ["sim", /sim|data/], ["babouche", /babouche|slipper|shoe/], ["argan", /argan|oil/],
];
const STYLE: [ParsedAsk["style"], RegExp][] = [["fancy", /fancy|rooftop|hotel|luxury|riad/], ["mid", /mid|nice|sit.?down/]];

/** Keyword matcher. Good enough for the demo examples, no key needed. Photos always read as slippers for 300. */
export class MockAskParser implements AskParser {
  async parse(req: ParseRequest, prices: PriceItem[]): Promise<ParsedAsk> {
    const currency = prices[0]?.currency ?? "MAD";
    if (!req.text && req.imageBase64) return { itemId: "babouche", amount: 300, currency, style: "local", situation: "souk", confidence: 0.5 };
    const t = (req.text ?? "").toLowerCase();
    const nums = t.match(/\d+(\.\d+)?/g);
    const key = KEYS.find(([id, re]) => re.test(t) && prices.some((p) => p.id === id));
    if (!nums || !key) throw new ParseError('Add what it is and the price, like "mint tea in the souk, 30".');
    const style = STYLE.find(([, re]) => re.test(t))?.[0] ?? "local";
    return { itemId: key[0], amount: Number(nums[nums.length - 1]), currency, style, confidence: 0.7 };
  }
}

export class ParseError extends Error {}
