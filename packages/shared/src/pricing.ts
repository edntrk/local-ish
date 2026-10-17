/**
 * Pure price-check logic. No network, no database, so it is easy to test.
 * Used by the API. The Interface can also use it for instant offline answers.
 */
import type { CheckResult, Expense, PriceItem, Style, Summary, Trip, Verdict } from "./contracts";

type Plan = NonNullable<CheckResult["plan"]>;
type Phrase = NonNullable<CheckResult["phrase"]>;

export const STYLE_MULTIPLIER: Record<Style, number> = { local: 1, mid: 1.8, fancy: 3.5 };

const round5 = (x: number) => (x > 20 ? Math.round(x / 5) * 5 : Math.round(x));

export function rangeFor(item: PriceItem, style: Style) {
  const m = STYLE_MULTIPLIER[style];
  return { min: round5(item.min * m), max: round5(item.max * m) };
}

export function verdictFor(amount: number, range: { min: number; max: number }): Verdict {
  if (amount <= range.max) return amount < range.min ? "great" : "fair";
  if (amount <= range.max * 1.3) return "high";
  return "tooHigh";
}

export function tripDays(trip: Pick<Trip, "start" | "end">): number {
  const d = Math.round((Date.parse(trip.end) - Date.parse(trip.start)) / 864e5) + 1;
  return Number.isFinite(d) && d > 0 ? d : 1;
}

/** The budget box holds the whole group's budget; each person's share is that split by head count (me included). */
export function perPersonBudget(groupBudget: number, headCount: number): number {
  return headCount > 0 ? Math.round((groupBudget / headCount) * 100) / 100 : groupBudget;
}

export function budgetLocal(trip: Trip): number {
  return trip.budgetHome * trip.rateToLocal;
}

/** Rupiah amounts are quoted in round numbers: 5,000 steps. Other currencies keep the small-step rounding. */
export const roundMoney = (x: number, currency: string) => (currency === "IDR" ? Math.round(x / 5000) * 5000 : round5(x));

const fmt = (n: number) => n.toLocaleString("en-GB");

/** The no-AI plan: open at the bottom of the usual range, aim for the target, walk away above the top. */
export function templatePlan(range: { min: number; max: number }, target: number): Plan {
  return { openWith: range.min, aimFor: target, walkAwayAbove: range.max };
}

/** Whatever the AI suggests, keep every number inside the usual range, in order. */
export function clampPlan(plan: Plan, range: { min: number; max: number }, currency: string): Plan {
  const inRange = (x: number) => Math.min(range.max, Math.max(range.min, roundMoney(Number.isFinite(x) ? x : range.min, currency)));
  const openWith = inRange(plan.openWith);
  const aimFor = Math.max(openWith, inRange(plan.aimFor));
  return { openWith, aimFor, walkAwayAbove: Math.max(aimFor, inRange(plan.walkAwayAbove)) };
}

/** Default phrase in Bahasa Indonesia. It always opens with the plan's first offer, in round thousands. */
export function templatePhrase(openWith: number, currency: string): Phrase {
  const offer = roundMoney(openWith, currency);
  const ribu = Math.round(offer / 1000);
  return {
    local: `Wah, mahal banget! ${ribu} ribu saja, boleh?`,
    polite: `Maaf, bisa ${ribu} ribu saja, Pak?`,
    english: `Wow, that's very expensive! Just ${fmt(offer)}, okay?`,
    lang: "id-ID",
    localLang: "id-ID",
  };
}

const TEMPLATE_ADVICE: Record<Verdict, string> = {
  great: "Good deal, go for it.",
  fair: "That's normal here.",
  high: "A bit high, try to bargain.",
  tooHigh: "Way above normal, bargain or walk away.",
};

/** What Gemini may add on top of a checked result. The numbers and the verdict stay as checkPrice made them. */
export type AdviceDraft = { advice: string; plan?: Plan; phrase?: { local: string; polite?: string; english: string } };

export function applyAdvice(base: CheckResult, draft: AdviceDraft): CheckResult {
  const out: CheckResult = { ...base, advice: draft.advice.trim() || base.advice };
  if (!base.plan) return out; // great / fair: advice only
  const plan = draft.plan ? clampPlan(draft.plan, base.range, base.currency) : base.plan;
  out.plan = plan;
  // the phrase must say the same number as the plan; otherwise use the template so words and numbers agree
  const ribu = String(Math.round(plan.openWith / 1000));
  out.phrase = draft.phrase && new RegExp(`\\b${ribu}\\b`).test(draft.phrase.local)
    ? { ...draft.phrase, lang: "id-ID", localLang: "id-ID" }
    : templatePhrase(plan.openWith, base.currency);
  return out;
}

export function checkPrice(trip: Trip, item: PriceItem, amount: number, style: Style): CheckResult {
  const range = rangeFor(item, style);
  const verdict = verdictFor(amount, range);
  const target = roundMoney((range.min + range.max) / 2, item.currency);
  const daily = budgetLocal(trip) / tripDays(trip);
  const share = amount / trip.people.length;
  return {
    verdict,
    item,
    range,
    target,
    currency: item.currency,
    budget: {
      dailyAllowance: Math.round(daily),
      myShareIfSplit: Math.round(share * 100) / 100,
      pctOfDaily: daily > 0 ? Math.round((share / daily) * 100) : 0,
    },
    advice: TEMPLATE_ADVICE[verdict],
    // a plan and a phrase only make sense when the price is high
    ...(verdict === "high" || verdict === "tooHigh"
      ? (() => {
          const plan = templatePlan(range, target);
          return { plan, phrase: templatePhrase(plan.openWith, item.currency) };
        })()
      : {}),
  };
}

export function equalShares(amount: number, personIds: string[]): Record<string, number> {
  const each = Math.floor((amount / personIds.length) * 100) / 100;
  const shares: Record<string, number> = {};
  personIds.forEach((id) => (shares[id] = each));
  // put the leftover cents on the first person so the total is exact
  const rest = Math.round((amount - each * personIds.length) * 100) / 100;
  if (personIds.length) shares[personIds[0]] = Math.round((shares[personIds[0]] + rest) * 100) / 100;
  return shares;
}

export function summarise(trip: Trip, expenses: Expense[]): Summary {
  const me = trip.people.find((p) => p.isMe)!;
  const cats = { transport: 0, food: 0, sim: 0, shopping: 0 };
  const byCategoryMine = { ...cats };
  const byCategoryGroup = { ...cats };
  let mySpent = 0;
  let groupSpent = 0;
  const owed: Record<string, number> = {};
  for (const e of expenses) {
    const mine = e.shares[me.id] ?? 0;
    mySpent += mine;
    byCategoryMine[e.category] += mine;
    const shared = Object.entries(e.shares).some(([id, v]) => id !== me.id && v > 0);
    if (shared) {
      groupSpent += e.amount;
      byCategoryGroup[e.category] += e.amount;
    }
    // if I paid, everyone else owes me their share
    if (e.paidBy === me.id) {
      for (const [id, v] of Object.entries(e.shares)) if (id !== me.id) owed[id] = (owed[id] ?? 0) + v;
    }
  }
  const budget = budgetLocal(trip);
  return {
    tripId: trip.id,
    currency: trip.currency,
    budget,
    mySpent,
    myLeft: budget - mySpent,
    dailyAllowance: budget / tripDays(trip),
    groupSpent,
    byCategoryMine,
    byCategoryGroup,
    owes: trip.people
      .filter((p) => !p.isMe)
      .map((p) => ({ personId: p.id, name: p.name, amount: Math.round((owed[p.id] ?? 0) * 100) / 100 })),
  };
}
