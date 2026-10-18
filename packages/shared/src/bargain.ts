/**
 * The bargaining back-and-forth. Gemini only reads and translates the seller's reply, says what they meant,
 * and suggests a next offer and wording; every rule below is enforced HERE, in code, whatever the AI says.
 * The seller's reply is data: nothing in it can change these rules.
 * Every sentence the AI writes goes through cleanText: if it fails, the template sentence is used.
 */
import type { BargainIntent, BargainMove, BargainRequest, BargainResponse, Category } from "./contracts";
import { detectQuantity, lastAmount } from "./money";
import { roundMoney } from "./pricing";
import { cleanText, oneSentence } from "./text";

/** After this many replies, a price still above the walk-away limit means walking away. */
export const MAX_ROUNDS = 3;

/** What Gemini may suggest. Offers are clamped and every text is cleaned before it is used. */
export type BargainDraft = {
  theirReplyEnglish?: string;
  theirNumber?: number;
  quantity?: number; // "3 lessons for 1.2 juta": how many things their total covers (the code also reads it from the words)
  intent?: BargainIntent; // what the seller meant
  refused?: boolean; // older way of saying intent = "refused"
  move?: BargainMove; // advisory only: the code decides
  myOffer?: number;
  phrase?: { local: string; english: string };
  advice?: string;
};

const fmt = (n: number) => n.toLocaleString("en-GB");
const money = (n: number, currency: string) => (currency === "IDR" ? "Rp" + fmt(n) : `${fmt(n)} ${currency}`);
const positive = (n?: number) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);

const AGREE = /\b(ok|oke|okay|boleh|bisa|deal|setuju|sepakat|silakan|yes|ya|iya|baik)\b/i;
// "ngk ah kemahalan" (no, way too expensive): colloquial spellings of "no" and any form of "mahal" (expensive) count as a refusal
const REFUSE = /\b(tidak|nggak|enggak|engga|ngga|ngk|gak|ga|no|nope|jangan|can'?t|cannot|never)\b|\b\w*mahal\w*\b|tak bisa|too (expensive|much|high)/i;

// "the price includes the board" / "sudah termasuk papan": information about the deal, not an answer to my offer
const INFO = /\b(termasuk|include[sd]?|including|gratis|free)\b/i;

/** A rough reading of what someone meant, used only when Gemini isn't available. */
export function guessIntent(text: string, number?: number): BargainIntent {
  if (number !== undefined) return "counter";
  // "tidak bisa" / "nggak boleh" are refusals even though "bisa" and "boleh" alone mean yes
  const NEGATED = /\b(tidak|tak|nggak|enggak|gak|ga|no|not)\s+(bisa|boleh|mau|setuju|ok|oke|okay|deal)\b/gi;
  const negated = NEGATED.test(text);
  const agree = AGREE.test(text.replace(NEGATED, " ")), refuse = negated || REFUSE.test(text);
  if (agree && !refuse) return "agreed";
  if (refuse && !agree) return "refused";
  if (INFO.test(text)) return "info";
  return "unclear";
}

/** What to do instead when it is time to walk away. */
export function walkAwayAlternative(category?: Category): string {
  switch (category) {
    case "transport": return "Book a Grab or Gojek instead.";
    case "shopping": return "Try the next stall: there are plenty.";
    case "activities": return "Ask another operator for their price.";
    case "food": return "Try another warung nearby.";
    case "stay": return "Check another place before you decide.";
    case "essentials": return "Try another shop.";
    default: return "Thank them and look somewhere else.";
  }
}

export type BargainPlan = { openWith: number; aimFor: number; walkAwayAbove: number };

/**
 * My plan for haggling one price. A too-high price uses the plan as it is (inside the usual range).
 * A fair or great price can still be haggled, so the plan asks for a smaller discount: open about 20% under their price,
 * aim about 15% under it, and never go above their own price. Rounded to 5,000 so the numbers sound like real offers.
 */
export function openingPlan(base: BargainPlan, amount: number, verdict: string): BargainPlan {
  if (verdict !== "fair" && verdict !== "great") return base;
  const k5 = (x: number) => Math.max(5000, Math.round(x / 5000) * 5000);
  const aimFor = Math.min(base.aimFor, k5(amount * 0.85));
  return { openWith: Math.min(base.openWith, k5(amount * 0.8), aimFor), aimFor, walkAwayAbove: Math.max(amount, aimFor) };
}

/** The first thing to say for a price that is already fair: friendly, asking for a little less (the "too expensive" phrase would be rude). */
export function softPhrase(openWith: number, currency: string, language = "id-ID") {
  const english = `Could you go a little lower? Just ${money(openWith, currency)}?`;
  if (!language.toLowerCase().startsWith("id")) return { local: english, polite: english, english, lang: language };
  const ribu = Math.round(openWith / 1000);
  return { local: `Boleh kurang? ${ribu} ribu saja ya?`, polite: `Maaf, Pak, bisa ${ribu} ribu saja?`, english, lang: "id-ID" };
}

/** A short phrase for a new offer, in Bahasa Indonesia when the trip language is Indonesian. */
export function counterPhrase(offer: number, currency: string, language = "id-ID") {
  const english = `How about ${money(offer, currency)}?`;
  if (!language.toLowerCase().startsWith("id")) return { local: english, english, lang: language };
  const ribu = Math.round(offer / 1000);
  return { local: `Bagaimana kalau ${ribu} ribu saja?`, english, lang: "id-ID" };
}

const RETRY_ADVICE = "Didn't catch that, let them try again.";

/** A polite goodbye for when it is time to walk away. */
export function walkAwayPhrase(language = "id-ID") {
  const english = "Thank you, maybe next time.";
  return language.toLowerCase().startsWith("id") ? { local: "Terima kasih, Pak. Mungkin lain kali ya.", english, lang: "id-ID" } : { local: english, english, lang: language };
}

/** Do two short sentences say the same thing? Used so the walk-away message never repeats its alternative. */
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlaps = (a: string, b: string) => {
  const wb = words(b);
  return [...words(a)].filter((w) => wb.has(w)).length >= 2;
};

/**
 * Decide the next step. `draft` is optional: without it (Gemini failed) the same rules still work,
 * a counter-offer is halfway between my last offer and their number, and every sentence is a template.
 */
export function decideBargain(req: BargainRequest, draft?: BargainDraft): BargainResponse {
  const { plan, myLastOffer: last, round } = req;
  const { openWith: open, aimFor: aim, walkAwayAbove: walk } = plan;
  const cur = req.currency;
  // the number the tourist typed wins over the one the AI heard
  let theirs = positive(req.theirNumber) ?? positive(draft?.theirNumber);
  // a bundle ("3 lessons for 1.2 juta"): the price that matters is per lesson. The total is read from the words, not from the AI.
  const reply = req.theirReply ?? "";
  const quantity = detectQuantity(reply) ?? (draft?.quantity && Number.isInteger(draft.quantity) && draft.quantity >= 2 && draft.quantity <= 20 ? draft.quantity : null);
  const total = quantity ? positive(lastAmount(reply) ?? undefined) ?? theirs : undefined;
  const bundle = quantity && total ? { quantity, total, perUnit: roundMoney(total / quantity, req.currency) } : undefined;
  if (bundle) theirs = bundle.perUnit;
  // what they meant: a named price always means a counter; otherwise the AI's reading, else a rough guess from the words
  const intent: BargainIntent =
    theirs !== undefined ? "counter"
    : req.refused === true ? "refused"
    : draft?.intent ?? (draft?.refused ? "refused" : guessIntent(reply));
  // texts from the AI: cleaned, or dropped so the template is used
  const english = cleanText(draft?.theirReplyEnglish, { max: 200 });
  const heard = { round, intent, ...(english ? { theirReplyEnglish: english } : {}), ...(theirs !== undefined ? { theirNumber: theirs } : {}), ...(bundle ? { bundle } : {}) };
  // for a bundle the code says what it comes to per lesson and whether that is a good deal, whatever the AI wrote
  const bundleSays = bundle
    ? `${bundle.quantity} for ${money(bundle.total, cur)} is ${money(bundle.perUnit, cur)} each: ${bundle.perUnit <= req.range.max ? (bundle.perUnit < req.range.min ? "a great deal" : "a good deal") : "above the usual price"}.`
    : undefined;
  const advice = (fallback: string) => (bundleSays ? `${bundleSays} ${fallback}` : cleanText(draft?.advice, { max: 200 }) ?? fallback);

  const accept = (price: number): BargainResponse => ({
    ...heard, move: "accept", myOffer: price, dealPrice: price, final: true,
    advice: advice("Nicely done, that's a fair price."), // the page shows the price itself, so the sentence doesn't repeat it
  });
  const walkAway = (why: string): BargainResponse => {
    // one clean sentence + one alternative, never the same thing twice
    const alternative = walkAwayAlternative(req.category);
    const ai = oneSentence(draft?.advice, 160);
    return { ...heard, move: "walk_away", final: true, alternative, phrase: walkAwayPhrase(req.language), advice: bundleSays ? `${bundleSays} ${why}` : ai && !overlaps(ai, alternative) ? ai : why };
  };
  const retry = (sentence: string): BargainResponse => ({ ...heard, move: "retry", final: false, advice: sentence }); // no new round

  // not understood: let them try again (a bad recording or noise is not a round)
  if (intent === "unclear") return retry(RETRY_ADVICE);
  // they told me something about the deal (what is included): nothing to decide, the price is unchanged, and it is not a round
  if (intent === "info") return retry("Good to know. The price hasn't changed, so reply when you're ready.");

  // they said yes to my last offer
  if (intent === "agreed") {
    if (req.bargainMode === "ask") return retry("Ask them how much it will be, then let them answer again."); // yes to a discount, but no price yet
    return accept(last);
  }

  // 1. they came down to my target, or to what I last offered: that is a deal
  if (theirs !== undefined && (theirs <= aim || theirs <= last)) return accept(theirs);

  // "ask" places allow ONE reply round and never a counter: fair if it is inside the usual range, otherwise let it go
  if (req.bargainMode === "ask") {
    return theirs !== undefined && theirs <= walk ? accept(theirs) : walkAway("That's above the usual price and this isn't a place to haggle, so it's fine to pass.");
  }

  // my next offer: never down from my last offer, never above the walk-away limit, in round numbers
  const lowest = Math.max(open, last);
  const clampOffer = (x: number) => Math.max(lowest, Math.min(walk, roundMoney(x, cur)));
  const counter = (offer: number): BargainResponse => {
    const local = cleanText(draft?.phrase?.local, { max: 80 });
    const eng = cleanText(draft?.phrase?.english, { max: 80 });
    // the words must name the offer, and both lines must be clean; otherwise the template phrase is used
    const phrase = local && eng && new RegExp(`\\b${Math.round(offer / 1000)}\\b`).test(local)
      ? { local, english: eng, lang: req.language }
      : counterPhrase(offer, cur, req.language);
    return { ...heard, move: "counter", myOffer: offer, phrase, final: false, advice: advice(`Stay friendly and hold at ${money(offer, cur)}.`) };
  };

  // 2. "They refused" with no number: one small step up, then walk away
  if (theirs === undefined) {
    const giveUp = "They won't move, so it's fine to thank them and go.";
    if ((req.refusedBefore ?? 0) >= 1 || lowest >= walk) return walkAway(giveUp);
    const step = Math.max(5000, roundMoney((walk - open) / 4, cur));
    const next = clampOffer(last + step);
    return next > last ? counter(next) : walkAway(giveUp);
  }

  // 3. they named a price above my target
  if (round >= MAX_ROUNDS) {
    // the last round: inside the usual range is acceptable, above the walk-away limit means walking away
    return theirs <= walk ? accept(theirs) : walkAway(`${money(theirs, cur)} is still above what's fair after ${MAX_ROUNDS} rounds, so it's time to walk away.`);
  }
  const next = clampOffer(draft?.myOffer !== undefined && Number.isFinite(draft.myOffer) ? draft.myOffer : last + (theirs - last) / 2);
  // never offer more than they asked: that is a deal at their price
  if (next >= theirs) return accept(theirs);
  return counter(next);
}
