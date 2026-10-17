import { describe, expect, it } from "vitest";
import { checkPrice, equalShares, rangeFor, summarise, verdictFor } from "./pricing";
import { CheckResult, type PriceItem, type Trip } from "./contracts";

const taxi: PriceItem = { id: "taxi-airport", city: "marrakech", category: "transport", name: "Taxi: airport to Medina", min: 100, max: 150, currency: "MAD", tip: "Agree the price first." };
const trip: Trip = {
  id: "t1", city: "marrakech", currency: "MAD", homeCurrency: "GBP", rateToLocal: 12.5, budgetHome: 600,
  start: "2026-10-24", end: "2026-10-30", inviteCode: "MRK-24OCT",
  people: [
    { id: "me", name: "Renata", isMe: true, status: "joined" },
    { id: "bella", name: "Bella", isMe: false, status: "joined" },
    { id: "dewi", name: "Dewi", isMe: false, status: "joined" },
  ],
};

describe("price check", () => {
  it("gives the four verdicts", () => {
    const r = { min: 100, max: 150 };
    expect(verdictFor(80, r)).toBe("great");
    expect(verdictFor(120, r)).toBe("fair");
    expect(verdictFor(180, r)).toBe("high");
    expect(verdictFor(250, r)).toBe("tooHigh");
  });
  it("raises the range for fancy places", () => {
    expect(rangeFor(taxi, "fancy").min).toBeGreaterThan(taxi.min);
  });
  it("returns data that matches the contract", () => {
    const res = checkPrice(trip, taxi, 250, "local");
    expect(() => CheckResult.parse(res)).not.toThrow();
    expect(res.verdict).toBe("tooHigh");
    expect(res.target).toBe(125);
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
