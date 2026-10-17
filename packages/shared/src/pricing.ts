/**
 * Pure price-check logic. No network, no database, so it is easy to test.
 * Used by the API. The Interface can also use it for instant offline answers.
 */
import type { CheckResult, Expense, Person, PriceItem, Style, Summary, Transfer, Trip, Verdict } from "./contracts";

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

/** The whole group's budget in local currency. Trips made before groupBudgetHome existed only know a per-person budget. */
export function groupBudgetLocal(trip: Trip): number {
  return (trip.groupBudgetHome ?? trip.budgetHome * trip.people.length) * trip.rateToLocal;
}

/** One person's budget in local currency: the group budget split by head count (joined and invited). */
export function budgetLocal(trip: Trip): number {
  return trip.groupBudgetHome != null ? groupBudgetLocal(trip) / Math.max(1, trip.people.length) : trip.budgetHome * trip.rateToLocal;
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
    source: item.origin === "web" ? "web" : "local",
    ...(item.origin === "web" && item.source ? { sources: [item.source] } : {}),
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

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The person whose point of view we take. No id (or an unknown one) means the trip creator, so old callers keep working. */
export function viewerOf(trip: Trip, personId?: string): Person {
  return trip.people.find((p) => p.id === personId) ?? trip.people.find((p) => p.isMe) ?? trip.people[0];
}

/** net = what a person paid minus what they owe. Above 0: others owe them. Below 0: they owe others. */
export function balances(trip: Trip, expenses: Expense[]): Record<string, number> {
  const net: Record<string, number> = Object.fromEntries(trip.people.map((p) => [p.id, 0]));
  for (const e of expenses) {
    net[e.paidBy] = (net[e.paidBy] ?? 0) + e.amount;
    for (const [id, v] of Object.entries(e.shares)) net[id] = (net[id] ?? 0) - v;
  }
  for (const id of Object.keys(net)) net[id] = round2(net[id]);
  return net;
}

/** The fewest payments that settle everyone: repeatedly match the biggest debtor with the biggest creditor. */
export function settleUp(trip: Trip, expenses: Expense[]): Transfer[] {
  const net = balances(trip, expenses);
  const name = (id: string) => trip.people.find((p) => p.id === id)?.name ?? "Someone";
  const side = (sign: 1 | -1) =>
    Object.entries(net).filter(([, v]) => v * sign > 0.005).map(([id, v]) => ({ id, left: Math.abs(v) })).sort((a, b) => b.left - a.left);
  const creditors = side(1), debtors = side(-1);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = round2(Math.min(debtors[i].left, creditors[j].left));
    if (amount > 0) out.push({ fromId: debtors[i].id, fromName: name(debtors[i].id), toId: creditors[j].id, toName: name(creditors[j].id), amount });
    debtors[i].left = round2(debtors[i].left - amount);
    creditors[j].left = round2(creditors[j].left - amount);
    if (debtors[i].left < 0.005) i++;
    if (creditors[j].left < 0.005) j++;
  }
  return out;
}

/** An expense counts as "group money" when at least two people carry a share of it. */
const isShared = (e: Expense) => Object.values(e.shares).filter((v) => v > 0).length >= 2;

export function summarise(trip: Trip, expenses: Expense[], personId?: string): Summary {
  const me = viewerOf(trip, personId);
  const byCategoryMine = { transport: 0, food: 0, sim: 0, shopping: 0 };
  const byCategoryGroup = { ...byCategoryMine };
  let mySpent = 0;
  let groupSpent = 0;
  const owed: Record<string, number> = {};
  for (const e of expenses) {
    const mine = e.shares[me.id] ?? 0;
    mySpent += mine;
    byCategoryMine[e.category] += mine;
    if (isShared(e)) {
      groupSpent += e.amount;
      byCategoryGroup[e.category] += e.amount;
    }
    // if I paid, everyone else owes me their share
    if (e.paidBy === me.id) {
      for (const [id, v] of Object.entries(e.shares)) if (id !== me.id) owed[id] = (owed[id] ?? 0) + v;
    }
  }
  const budget = budgetLocal(trip);
  const groupBudget = groupBudgetLocal(trip);
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
      .filter((p) => p.id !== me.id)
      .map((p) => ({ personId: p.id, name: p.name, amount: Math.round((owed[p.id] ?? 0) * 100) / 100 })),
    viewerId: me.id,
    myBudget: budget,
    groupBudget,
    groupLeft: groupBudget - groupSpent,
    net: balances(trip, expenses)[me.id] ?? 0,
    transfers: settleUp(trip, expenses),
  };
}
