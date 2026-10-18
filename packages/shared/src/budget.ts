/**
 * Budget check: is this budget enough for a normal day in the city?
 * Pure code. The numbers are decided here; Gemini only words them (see templateBudgetNote / applyBudgetNote).
 */
import { cleanText } from "./text";
import { STYLE_MULTIPLIER, tripDays } from "./pricing";
import type { BudgetCheckResult, BudgetStatus, PriceItem, Style } from "./contracts";

// A normal day: 3 meals, 2 rides, 1 night's stay, a little water. A missing item type is skipped, never guessed.
const BASKET: { count: number; pick: (p: PriceItem) => boolean }[] = [
  { count: 3, pick: (p) => p.id === "nasi" }, // meals at a warung
  { count: 2, pick: (p) => p.id === "taxi-city" }, // rides by app
  { count: 1, pick: (p) => p.category === "stay" }, // a night's stay
  { count: 2, pick: (p) => p.id === "water" }, // small essentials
];

/** The middle of each item's range × the style multiplier, added up for one day. 0 when the city has none of these items. */
export function typicalPerDay(city: string, style: Style, prices: PriceItem[]): number {
  const here = prices.filter((p) => p.city === city).sort((a, b) => a.id.localeCompare(b.id)); // sorted: the "stay" pick never depends on row order
  const total = BASKET.reduce((sum, { count, pick }) => {
    const item = here.find(pick);
    return item ? sum + count * ((item.min + item.max) / 2) * STYLE_MULTIPLIER[style] : sum;
  }, 0);
  return Math.round(total);
}

/** ≥ 100% of a normal day = enough · 70–100% = tight · under 70% = notEnough. */
export function budgetCheck(o: { budget: number; startDate: string; endDate: string; typicalPerDay: number }) {
  const days = tripDays({ start: o.startDate, end: o.endDate });
  const raw = o.budget / days;
  const ratio = o.typicalPerDay > 0 ? raw / o.typicalPerDay : Infinity; // no basket = nothing to compare with, so don't warn
  const status: BudgetStatus = ratio >= 1 ? "enough" : ratio >= 0.7 ? "tight" : "notEnough";
  return {
    status,
    perDay: Math.round(raw),
    typicalPerDay: o.typicalPerDay,
    shortfall: Math.max(0, Math.round(o.typicalPerDay - raw)),
    days,
  };
}

type Numbers = ReturnType<typeof budgetCheck>;
export type BudgetNote = Pick<BudgetCheckResult, "summary" | "tip">;

/** The no-AI words. Neither sentence contains a number: the screen adds the numbers from the code. */
export function templateBudgetNote(status: BudgetStatus): BudgetNote {
  const tip = "Eat at local warungs and book rides in an app like Grab or Gojek: both cost much less than tourist restaurants and street taxis.";
  return {
    enough: { summary: "Your budget covers a normal day here.", tip },
    tight: { summary: "Your budget is close to a normal day here, so spend with care.", tip },
    notEnough: { summary: "Your budget is below a normal day here.", tip: "Cut the big costs first: pick a cheaper place to stay, eat at warungs and book rides in an app like Grab or Gojek." },
  }[status];
}

/** Gemini's words are used only if they are clean AND contain no digit at all, so it can't invent a number. */
export function applyBudgetNote(draft: Partial<BudgetNote> | undefined, status: BudgetStatus): BudgetNote {
  const base = templateBudgetNote(status);
  const clean = (t: unknown, max: number) => {
    const c = cleanText(t, { max });
    return c && !/\d/.test(c) ? c : undefined;
  };
  return { summary: clean(draft?.summary, 160) ?? base.summary, tip: clean(draft?.tip, 200) ?? base.tip };
}

/** The numbers + words together, in the shape the contract promises. */
export function budgetResult(n: Numbers, currency: string, note: BudgetNote): BudgetCheckResult {
  return { ...n, currency, ...note };
}
