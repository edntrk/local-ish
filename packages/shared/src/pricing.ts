/**
 * Pure price-check logic. No network, no database, so it is easy to test.
 * Used by the API. The Interface can also use it for instant offline answers.
 */
import { CATEGORIES, type BargainMode, type Category, type CheckResult, type Expense, type Person, type PriceItem, type Style, type Summary, type Transfer, type Trip, type Verdict } from "./contracts";

type Plan = NonNullable<CheckResult["plan"]>;
type Phrase = NonNullable<CheckResult["phrase"]>;
type Alternative = NonNullable<CheckResult["alternative"]>;

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

/** The usual mode for an item when nothing else is known. Rows without one fall back to a sensible guess for their category. */
export function defaultBargain(item: Pick<PriceItem, "bargain" | "category">): BargainMode {
  if (item.bargain) return item.bargain;
  return ({ transport: "bargain", shopping: "bargain", food: "ask", activities: "ask", other: "ask", stay: "fixed", essentials: "fixed" } as const)[item.category] ?? "ask";
}

// Words that mean a fixed-price place: a menu, a chain, an app, a meter, a supermarket or mall, a beach club, a hotel.
const FIXED_SIGNAL = /\b(menu|restaurant|caf[eé]|beach ?club|rooftop|resort|hotel|supermarket|mall|chain|grab|gojek|app|meter(ed)?|indomaret|alfamart|circle k|starbucks|mcdonald'?s|kfc|official)\b/i;

/**
 * One rule for every mode decision. The item's usual mode is the start, the situation (as read by the AI) can override it,
 * and a fancy place or a chain/app/menu situation is never "bargain": it is a fixed-price place.
 */
export function resolveBargainMode(o: { style?: Style; situation?: string; requested?: BargainMode; itemDefault: BargainMode }): BargainMode {
  if (o.style === "fancy" || FIXED_SIGNAL.test(o.situation ?? "")) return "fixed";
  return o.requested ?? o.itemDefault;
}

/** Shown only for "fixed" places: a cheaper way to get the same thing, from our own prices. */
export function cheaperAlternative(item: PriceItem, style: Style, prices: PriceItem[]): Alternative | undefined {
  // a fancy or mid-range price: the same thing at a local place costs the plain range
  if (style !== "local") return { name: item.name, min: item.min, max: item.max, currency: item.currency };
  const cheaper = prices
    .filter((p) => p.id !== item.id && p.category === item.category && p.max < item.max && defaultBargain(p) !== "fixed")
    .sort((a, b) => b.max - a.max)[0];
  return cheaper && { name: cheaper.name, min: cheaper.min, max: cheaper.max, currency: cheaper.currency };
}

const ADVICE: Record<BargainMode, Record<Verdict, string>> = {
  bargain: { great: "Good deal, go for it.", fair: "That's normal here.", high: "A bit high, try to bargain.", tooHigh: "Way above normal, bargain or walk away." },
  ask: { great: "Good deal, go for it.", fair: "That's normal here.", high: "A bit high. It's fine to ask politely if there's a discount.", tooHigh: "Well above normal. Ask politely about a discount, or look elsewhere." },
  fixed: { great: "Good price, and it's fixed, so you're set.", fair: "That's the normal price here.", high: "A bit above normal, and the price is fixed. Check the bill, or try a cheaper spot.", tooHigh: "Well above normal for a fixed price. Check the bill and consider somewhere cheaper." },
};
export const templateAdvice = (mode: BargainMode, verdict: Verdict) => ADVICE[mode][verdict];

/** Politely asking for a discount (ask mode): one short phrase, no plan. */
export const askPhrase = (): Phrase => ({ local: "Ada diskon?", polite: "Boleh kurang sedikit?", english: "Is there a discount?", lang: "id-ID", localLang: "id-ID" });

const money = (n: number, currency: string) => (currency === "IDR" ? "Rp" + fmt(n) : `${fmt(n)} ${currency}`);

/** Tips for a fixed-price place when Gemini isn't available. No haggling, ever. */
export function templateTips(item: Pick<PriceItem, "category">, alternative?: Alternative): string[] {
  const tips = [
    item.category === "transport" ? "Use the app or the meter, not a street quote."
      : item.category === "food" ? "Ask for the menu with prices before you order."
      : "Ask what is included before you pay.",
    "Check the bill for service charge and tax: many places add them on top.",
  ];
  if (alternative) tips.push(`A cheaper option nearby: ${alternative.name}, usually ${money(alternative.min, alternative.currency)} to ${money(alternative.max, alternative.currency)}.`);
  return tips.slice(0, 3);
}

// anything about haggling is wrong for a fixed-price place; the code refuses it even if the AI writes it
const HAGGLE = /barg|haggl|negotiat|knock .*off|lower the price|drop the price|counter.?offer|discount/i;

/** What Gemini may add on top of a checked result. The numbers and the verdict stay as checkPrice made them. */
export type AdviceDraft = { advice: string; plan?: Plan; phrase?: { local: string; polite?: string; english: string }; tips?: string[] };

export function applyAdvice(base: CheckResult, draft: AdviceDraft): CheckResult {
  const mode = base.bargainMode ?? "bargain";
  const words = draft.advice.trim();
  // in a fixed-price place any talk of haggling is dropped and the template advice stays
  const out: CheckResult = { ...base, advice: words && !(mode === "fixed" && HAGGLE.test(words)) ? words : base.advice };
  if (mode === "fixed") {
    const tips = (draft.tips ?? []).map((t) => t.trim()).filter((t) => t && t.length <= 200 && !HAGGLE.test(t)).slice(0, 3);
    out.tips = tips.length >= 2 ? tips : base.tips; // fewer than two usable tips: use the template ones
    return out;
  }
  if (!base.plan) return out; // great / fair, or "ask" mode: advice only
  const plan = draft.plan ? clampPlan(draft.plan, base.range, base.currency) : base.plan;
  out.plan = plan;
  // the phrase must say the same number as the plan; otherwise use the template so words and numbers agree
  const ribu = String(Math.round(plan.openWith / 1000));
  out.phrase = draft.phrase && new RegExp(`\\b${ribu}\\b`).test(draft.phrase.local)
    ? { ...draft.phrase, lang: "id-ID", localLang: "id-ID" }
    : templatePhrase(plan.openWith, base.currency);
  return out;
}

export function checkPrice(
  trip: Trip, item: PriceItem, amount: number, style: Style,
  opts: { bargainMode?: BargainMode; situation?: string; alternative?: Alternative } = {},
): CheckResult {
  const range = rangeFor(item, style);
  const verdict = verdictFor(amount, range);
  const target = roundMoney((range.min + range.max) / 2, item.currency);
  const daily = budgetLocal(trip) / tripDays(trip);
  const share = amount / trip.people.length;
  // the verdict is the same in every mode; only the suggested action changes
  const mode = resolveBargainMode({ style, situation: opts.situation, requested: opts.bargainMode, itemDefault: defaultBargain(item) });
  const high = verdict === "high" || verdict === "tooHigh";
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
    bargainMode: mode,
    advice: templateAdvice(mode, verdict),
    // bargain: a plan and a Bahasa phrase when the price is high. ask: one polite phrase. fixed: tips, no haggling.
    ...(mode === "bargain" && high
      ? (() => {
          const plan = templatePlan(range, target);
          return { plan, phrase: templatePhrase(plan.openWith, item.currency) };
        })()
      : {}),
    ...(mode === "ask" && verdict !== "great" ? { phrase: askPhrase() } : {}),
    ...(mode === "fixed" ? { tips: templateTips(item, opts.alternative), ...(opts.alternative ? { alternative: opts.alternative } : {}) } : {}),
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
  const byCategoryMine = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
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
