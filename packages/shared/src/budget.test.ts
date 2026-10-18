import { describe, expect, it } from "vitest";
import { applyBudgetNote, budgetCheck, budgetResult, templateBudgetNote, typicalPerDay } from "./budget";
import { BudgetCheckRequest, BudgetCheckResult, type PriceItem } from "./contracts";

const item = (id: string, min: number, max: number, category: PriceItem["category"] = "food", city = "bali"): PriceItem =>
  ({ id, city, category, name: id, min, max, currency: "IDR", tip: "" });
const prices = [item("nasi", 25000, 50000), item("taxi-city", 20000, 50000, "transport"), item("water", 6000, 12000)];
// 3 × 37,500 + 2 × 35,000 + 2 × 9,000 = 200,500
const BASE = 200500;

describe("typicalPerDay", () => {
  it("adds up the basket using the middle of each range", () => {
    expect(typicalPerDay("bali", "local", prices)).toBe(BASE);
  });
  it("multiplies by the style", () => {
    expect(typicalPerDay("bali", "mid", prices)).toBe(Math.round(BASE * 1.8));
    expect(typicalPerDay("bali", "fancy", prices)).toBe(Math.round(BASE * 3.5));
  });
  it("skips an item type that is missing instead of guessing", () => {
    expect(typicalPerDay("bali", "local", prices.filter((p) => p.id !== "taxi-city"))).toBe(BASE - 70000);
    expect(typicalPerDay("bali", "local", [])).toBe(0);
  });
  it("adds a night's stay when the city has one, and ignores other cities", () => {
    expect(typicalPerDay("bali", "local", [...prices, item("room", 200000, 400000, "stay")])).toBe(BASE + 300000);
    expect(typicalPerDay("bali", "local", [...prices, item("room", 200000, 400000, "stay", "ubud")])).toBe(BASE);
  });
});

describe("budgetCheck", () => {
  // 7 days (24 to 30 October, both days counted)
  const trip = { startDate: "2026-10-24", endDate: "2026-10-30", typicalPerDay: 200000 };
  it("is enough at 100% or more", () => {
    expect(budgetCheck({ ...trip, budget: 1400000 })).toMatchObject({ status: "enough", perDay: 200000, shortfall: 0, days: 7 });
    expect(budgetCheck({ ...trip, budget: 5000000 }).status).toBe("enough");
  });
  it("is tight from 70% up to 100%", () => {
    expect(budgetCheck({ ...trip, budget: 1399300 }).status).toBe("tight");
    expect(budgetCheck({ ...trip, budget: 980000 }).status).toBe("tight"); // exactly 70%
  });
  it("is notEnough below 70%, with the shortfall per day", () => {
    expect(budgetCheck({ ...trip, budget: 973000 })).toMatchObject({ status: "notEnough", perDay: 139000, shortfall: 61000 });
  });
  it("counts a one-day trip and a wrong date order as 1 day", () => {
    expect(budgetCheck({ ...trip, endDate: "2026-10-24", budget: 100000 }).days).toBe(1);
    expect(budgetCheck({ ...trip, endDate: "2026-10-01", budget: 100000 }).days).toBe(1);
  });
  it("does not warn when there is no normal day to compare with", () => {
    expect(budgetCheck({ ...trip, typicalPerDay: 0, budget: 1 }).status).toBe("enough");
  });
});

describe("budget words", () => {
  it("uses Gemini's clean sentences", () => {
    expect(applyBudgetNote({ summary: "You can eat well here.", tip: "Try a warung instead of a restaurant." }, "enough")).toEqual({
      summary: "You can eat well here.", tip: "Try a warung instead of a restaurant.",
    });
  });
  it("drops any sentence with a number in it, so Gemini can't invent one", () => {
    const note = applyBudgetNote({ summary: "You have 150,000 a day.", tip: "Grab costs about 30k." }, "tight");
    expect(note).toEqual(templateBudgetNote("tight"));
  });
  it("drops code-like or missing text and keeps the template", () => {
    expect(applyBudgetNote({ summary: "{status}", tip: undefined }, "notEnough")).toEqual(templateBudgetNote("notEnough"));
    expect(applyBudgetNote(undefined, "enough")).toEqual(templateBudgetNote("enough"));
  });
  it("template sentences have no numbers", () => {
    for (const s of ["enough", "tight", "notEnough"] as const) expect(JSON.stringify(templateBudgetNote(s))).not.toMatch(/\d/);
  });
});

describe("contract", () => {
  it("the result and the request match their schemas", () => {
    const n = budgetCheck({ budget: 973000, startDate: "2026-10-24", endDate: "2026-10-30", typicalPerDay: 200000 });
    expect(() => BudgetCheckResult.parse(budgetResult(n, "IDR", templateBudgetNote(n.status)))).not.toThrow();
    expect(BudgetCheckRequest.parse({ city: "bali", budget: 1, currency: "IDR", startDate: "2026-10-24", endDate: "2026-10-30" }).style).toBe("local");
  });
});
