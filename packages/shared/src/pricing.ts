/**
 * Pure price-check logic. No network, no database, so it is easy to test.
 * Used by the API. The Interface can also use it for instant offline answers.
 */
import type { CheckResult, Expense, PriceItem, Style, Summary, Trip, Verdict } from "./contracts";

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

export function budgetLocal(trip: Trip): number {
  return trip.budgetHome * trip.rateToLocal;
}

export function checkPrice(trip: Trip, item: PriceItem, amount: number, style: Style): CheckResult {
  const range = rangeFor(item, style);
  const verdict = verdictFor(amount, range);
  const target = Math.round((range.min + range.max) / 2 / 5) * 5;
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
    phrase: {
      local: `Ghali bzaf! ${target} dirham, safi?`,
      localLang: "ar-MA",
      french: `C'est trop cher. ${target} dirhams, d'accord ?`,
      english: `Too expensive! ${target} dirhams, okay?`,
    },
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
