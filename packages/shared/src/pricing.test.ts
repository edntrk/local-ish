import { describe, expect, it } from "vitest";
import { applyAdvice, checkPrice, clampPlan, equalShares, perPersonBudget, rangeFor, summarise, templatePhrase, verdictFor } from "./pricing";
import { CheckResult, Trip, type PriceItem } from "./contracts";

const taxi: PriceItem = { id: "taxi-airport", city: "bali", category: "transport", name: "Taxi: airport to Seminyak", min: 150000, max: 250000, currency: "IDR", tip: "Use Grab or the official counter." };
const trip: Trip = {
  id: "t1", city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: 600,
  start: "2026-10-24", end: "2026-10-30", inviteCode: "BAL-24OCT",
  people: [
    { id: "me", name: "Renata", isMe: true, status: "joined" },
    { id: "bella", name: "Bella", isMe: false, status: "joined" },
    { id: "dewi", name: "Dewi", isMe: false, status: "joined" },
  ],
};

describe("price check", () => {
  it("gives the four verdicts", () => {
    const r = { min: 150000, max: 250000 };
    expect(verdictFor(100000, r)).toBe("great");
    expect(verdictFor(200000, r)).toBe("fair");
    expect(verdictFor(300000, r)).toBe("high");
    expect(verdictFor(400000, r)).toBe("tooHigh");
  });
  it("raises the range for fancy places", () => {
    expect(rangeFor(taxi, "fancy").min).toBeGreaterThan(taxi.min);
  });
  it("returns data that matches the contract", () => {
    const res = checkPrice(trip, taxi, 400000, "local");
    expect(() => CheckResult.parse(res)).not.toThrow();
    expect(res.verdict).toBe("tooHigh");
    expect(res.target).toBe(200000);
  });
  it("gives a template plan and Bahasa phrase only when the price is high", () => {
    const high = checkPrice(trip, taxi, 400000, "local");
    expect(high.plan).toEqual({ openWith: 150000, aimFor: 200000, walkAwayAbove: 250000 });
    expect(high.phrase).toMatchObject({ lang: "id-ID", local: "Wah, mahal banget! 150 ribu saja, boleh?" });
    const fair = checkPrice(trip, taxi, 200000, "local");
    expect(fair.advice).toBe("That's normal here.");
    expect(fair.plan).toBeUndefined();
    expect(fair.phrase).toBeUndefined();
  });
  it("rounds rupiah offers to the nearest 5,000", () => {
    expect(templatePhrase(172000, "IDR").local).toContain("170 ribu");
    expect(templatePhrase(173000, "IDR").english).toContain("175,000");
  });
  it("keeps any plan inside the usual range, in order", () => {
    const range = { min: 150000, max: 250000 };
    expect(clampPlan({ openWith: 1, aimFor: 999999, walkAwayAbove: 5 }, range, "IDR")).toEqual({ openWith: 150000, aimFor: 250000, walkAwayAbove: 250000 });
  });
  it("applyAdvice never changes the verdict, and swaps a phrase whose number disagrees with the plan", () => {
    const base = checkPrice(trip, taxi, 400000, "local");
    const out = applyAdvice(base, { advice: "Hello.", plan: { openWith: 170000, aimFor: 200000, walkAwayAbove: 250000 }, phrase: { local: "Wah! 90 ribu saja", english: "x" } });
    expect(out.verdict).toBe("tooHigh");
    expect(out.plan?.openWith).toBe(170000);
    expect(out.phrase?.local).toContain("170 ribu");
    expect(applyAdvice(checkPrice(trip, taxi, 200000, "local"), { advice: "Fine.", plan: { openWith: 1, aimFor: 1, walkAwayAbove: 1 } }).plan).toBeUndefined();
  });
});

describe("group budget", () => {
  it("splits the group total by head count, me included", () => {
    expect(perPersonBudget(1800, 3)).toBe(600);
    expect(perPersonBudget(1000, 3)).toBe(333.33);
    expect(perPersonBudget(600, 1)).toBe(600);
  });
  it("my money is my per-person share minus my share of each expense (budgetHome is per person)", () => {
    const mine = { ...trip, budgetHome: perPersonBudget(1800, 3), groupBudgetHome: 1800 };
    expect(() => Trip.parse(mine)).not.toThrow();
    const sum = summarise(mine, [
      { id: "e1", tripId: "t1", item: "Taxi", category: "transport", amount: 300000, paidBy: "me", shares: { me: 100000, bella: 100000, dewi: 100000 }, createdAt: "" },
    ]);
    expect(sum.budget).toBe(600 * 21500);
    expect(sum.myLeft).toBe(600 * 21500 - 100000);
    expect(sum.groupSpent).toBe(300000); // the group pot is 1800 * 21500 minus this, worked out in the app
  });
});

describe("splitting", () => {
  it("equal shares always add up exactly", () => {
    const s = equalShares(100, ["me", "bella", "dewi"]);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
  it("works out who owes me", () => {
    const sum = summarise(trip, [
      { id: "e1", tripId: "t1", item: "Taxi", category: "transport", amount: 90, paidBy: "me", shares: { me: 30, bella: 30, dewi: 30 }, createdAt: "" },
      { id: "e2", tripId: "t1", item: "Tea", category: "food", amount: 15, paidBy: "me", shares: { me: 15 }, createdAt: "" },
    ]);
    expect(sum.mySpent).toBe(45);
    expect(sum.groupSpent).toBe(90);
    expect(sum.owes.find((o) => o.personId === "bella")?.amount).toBe(30);
  });
});
