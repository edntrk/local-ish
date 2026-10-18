/**
 * The bargaining scenarios, played turn by turn. Gemini is mocked: each `says` is what the coach would have returned
 * (translation, intent); every number and move below is decided by the code in bargain.ts.
 */
import { describe, expect, it } from "vitest";
import { BargainRequest } from "./contracts";
import { decideBargain, openingPlan, softPhrase, type BargainDraft } from "./bargain";
import { lastAmount } from "./money";
import { checkPrice, verdictFor } from "./pricing";
import type { PriceItem, Trip } from "./contracts";

const item = (id: string, category: PriceItem["category"], min: number, max: number): PriceItem => ({ id, city: "bali", category, name: id, min, max, currency: "IDR", tip: "", bargain: "bargain" });
const trip: Trip = { id: "t", city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: 600, start: "2026-10-24", end: "2026-10-30", inviteCode: "BAL", people: [{ id: "me", name: "R", isMe: true, status: "joined" }] };

/** One conversation: keeps my last offer and the round, like the page does. */
function chat(it: PriceItem, quoted: number, base?: { openWith: number; aimFor: number; walkAwayAbove: number }) {
  const range = { min: it.min, max: it.max };
  const result = checkPrice(trip, it, quoted, "local");
  const plan = openingPlan(base ?? result.plan ?? { openWith: it.min, aimFor: result.target, walkAwayAbove: it.max }, quoted, result.verdict);
  let myLast = plan.openWith, round = 0, refusedBefore = 0;
  const history: { who: "me" | "seller"; text: string }[] = [];
  return {
    verdict: result.verdict, plan,
    /** `myLast` lets a scenario say "I countered 60 ribu" */
    setLast(n: number) { myLast = n; },
    says(text: string, draft?: BargainDraft) {
      const r = decideBargain(BargainRequest.parse({
        item: it.name, category: it.category, currency: "IDR", range, plan, myLastOffer: myLast, round: round + 1, refusedBefore, language: "id-ID", bargainMode: "bargain",
        situation: "scenario", history, theirReply: text, ...(lastAmount(text) ? { theirNumber: lastAmount(text) } : {}),
      }), draft);
      history.push({ who: "seller", text });
      if (r.move !== "retry") round++;
      if (r.intent === "refused" && r.theirNumber === undefined) refusedBefore++;
      if (r.move === "counter" && r.myOffer) { myLast = r.myOffer; history.push({ who: "me", text: r.phrase!.local }); }
      return r;
    },
  };
}

describe("1. surfing class in Canggu, 500000", () => {
  const surf = item("surf", "activities", 350000, 600000);
  it("is a fair price that can still be bargained, with a small discount in mind", () => {
    const c = chat(surf, 500000);
    expect(c.verdict).toBe("fair");
    expect(c.plan.openWith).toBeGreaterThanOrEqual(350000);
    expect(c.plan.openWith).toBeLessThanOrEqual(400000); // a counter of about 350 to 400k
    expect(c.plan.aimFor).toBeLessThan(500000);
    expect(c.plan.walkAwayAbove).toBe(500000); // never pay more than they first asked
    const phrase = softPhrase(c.plan.openWith, "IDR");
    expect(phrase.local).toContain(`${c.plan.openWith / 1000} ribu`);
    expect(phrase.english).toContain("Rp350,000");
    expect(phrase.local).not.toMatch(/mahal banget/); // not "that's very expensive" for a fair price
  });
  it("'paling murah 450 ribu' stays on the surf lesson and gets a counter; '400 ribu deh' is accepted and fair", () => {
    const c = chat(surf, 500000);
    const second = c.says("Wah nggak bisa, paling murah 450 ribu", { theirReplyEnglish: "Oh, I can't, 450 thousand is the lowest", intent: "counter", theirNumber: 450000 });
    expect(second).toMatchObject({ move: "counter", intent: "counter", theirNumber: 450000, theirReplyEnglish: "Oh, I can't, 450 thousand is the lowest", final: false });
    expect(second.myOffer).toBeGreaterThan(c.plan.openWith);
    expect(second.myOffer).toBeLessThan(450000);
    expect(second.phrase?.local).toMatch(/ribu/);
    expect(second.phrase?.english).toBeTruthy();
    const c2 = chat(surf, 500000);
    c2.setLast(400000);
    const deal = c2.says("Ya udah 400 ribu deh", { theirReplyEnglish: "Okay, 400 thousand then", intent: "counter", theirNumber: 400000 });
    expect(deal).toMatchObject({ move: "accept", dealPrice: 400000, final: true });
    expect(verdictFor(deal.dealPrice!, { min: 350000, max: 600000 })).toBe("fair");
  });
});

describe("2. sarong at the market, the seller says no without a price", () => {
  const sarong = item("sarong", "shopping", 50000, 150000);
  it("is overpriced, then 'kemurahan' is a refusal about the same sarong and gets a higher counter", () => {
    const c = chat(sarong, 500000);
    expect(c.verdict).toBe("tooHigh");
    c.setLast(60000); // I countered 60 ribu
    const r = c.says("Nggak ah, kemurahan", { theirReplyEnglish: "No, that's too cheap", intent: "refused" });
    expect(r).toMatchObject({ move: "counter", intent: "refused", theirReplyEnglish: "No, that's too cheap", final: false });
    expect(r.theirNumber).toBeUndefined();
    expect(r.myOffer).toBeGreaterThan(60000);
    expect(r.phrase?.local).toMatch(/ribu/);
  });
  it("works with no Gemini at all: 'nggak' is a refusal", () => {
    const c = chat(sarong, 500000);
    c.setLast(60000);
    expect(c.says("Nggak ah, kemurahan")).toMatchObject({ intent: "refused", move: "counter" });
  });
  it("'Gimana kalau 200 ribu?' is a 200k counter-offer for the same sarong", () => {
    const c = chat(sarong, 500000);
    c.setLast(60000);
    c.says("Nggak ah, kemurahan", { theirReplyEnglish: "No, that's too cheap", intent: "refused" });
    const r = c.says("Gimana kalau 200 ribu?", { theirReplyEnglish: "How about 200 thousand?", intent: "counter", theirNumber: 200000 });
    expect(r).toMatchObject({ intent: "counter", theirNumber: 200000, move: "counter" });
    expect(r.myOffer).toBeLessThan(200000);
  });
});

describe("4. bundles and extras", () => {
  const surf = item("surf", "activities", 350000, 600000);
  it("'Kalau 3 kali les, 1.2 juta' is 400k a lesson, and the code says it is a good deal", () => {
    const c = chat(surf, 500000);
    c.setLast(350000);
    const r = c.says("Kalau 3 kali les, 1.2 juta", { theirReplyEnglish: "For 3 lessons, 1.2 million", intent: "counter", theirNumber: 1200000, quantity: 3 });
    expect(r.bundle).toEqual({ quantity: 3, total: 1200000, perUnit: 400000 });
    expect(r.theirNumber).toBe(400000);
    expect(r.advice).toContain("3 for Rp1,200,000 is Rp400,000 each: a good deal");
    expect(r.move).toBe("accept"); // 400k a lesson is under my target
  });
  it("finds the bundle in the words even when Gemini misses it", () => {
    const r = chat(surf, 500000).says("tiga kali les, 1,2 juta");
    expect(r.bundle).toMatchObject({ quantity: 3, perUnit: 400000 });
  });
  it("says so when a bundle is still above the usual price", () => {
    const r = chat(surf, 500000).says("Kalau 2 kali les, 1.5 juta");
    expect(r.bundle?.perUnit).toBe(750000);
    expect(r.advice).toContain("above the usual price");
  });
  it("'Harga sudah termasuk papan' is translated, changes nothing and is not a round", () => {
    const c = chat(surf, 500000);
    c.setLast(400000);
    const withAi = c.says("Harga sudah termasuk papan", { theirReplyEnglish: "The price already includes the board", intent: "info" });
    expect(withAi).toMatchObject({ move: "retry", intent: "info", theirReplyEnglish: "The price already includes the board", final: false, round: 1 });
    expect(withAi.myOffer).toBeUndefined();
    expect(withAi.theirNumber).toBeUndefined();
    expect(c.says("Harga sudah termasuk papan")).toMatchObject({ move: "retry", intent: "info", round: 1 }); // no Gemini: still not "didn't catch that"
  });
});

describe("5. walking away", () => {
  const surf = item("surf", "activities", 350000, 600000);
  it("two refusals end in Leave it, with a polite goodbye in Indonesian and English", () => {
    const c = chat(surf, 900000);
    const first = c.says("Nggak bisa kurang", { theirReplyEnglish: "I can't go lower", intent: "refused" });
    expect(first.move).toBe("counter");
    const second = c.says("Nggak bisa kurang", { theirReplyEnglish: "I can't go lower", intent: "refused" });
    expect(second).toMatchObject({ move: "walk_away", final: true });
    expect(second.alternative).toMatch(/operator/i);
    expect(second.phrase?.local).toContain("Terima kasih");
    expect(second.phrase?.english).toBe("Thank you, maybe next time.");
  });
});
