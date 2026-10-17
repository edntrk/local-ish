import { describe, expect, it } from "vitest";
import { applyAdvice, askPhrase, balances, cheaperAlternative, defaultBargain, resolveBargainMode, templateAdvice, templateTips, checkPrice, clampPlan, equalShares, perPersonBudget, rangeFor, settleUp, summarise, templatePhrase, verdictFor } from "./pricing";
import { CATEGORIES, CATEGORY_LABELS, Category, CheckResult, Expense, NewExpense, PriceItem as PriceItemSchema, Summary, Trip, type PriceItem } from "./contracts";

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

describe("per viewer: summary, balances and settle up", () => {
  // Renata (me) paid 300,000 split 3 ways; Bella paid 90,000 split between Bella and Dewi; Dewi paid a 60,000 solo drink
  const group: Trip = { ...trip, groupBudgetHome: 1800, budgetHome: 600 };
  const ex = (id: string, paidBy: string, amount: number, shares: Record<string, number>) =>
    ({ id, tripId: "t1", item: id, category: "food" as const, amount, paidBy, shares, createdAt: "" });
  const spend = [
    ex("taxi", "me", 300000, { me: 100000, bella: 100000, dewi: 100000 }),
    ex("lunch", "bella", 90000, { bella: 45000, dewi: 45000 }),
    ex("drink", "dewi", 60000, { dewi: 60000 }),
  ];

  it("works out everything from the chosen person's point of view", () => {
    const renata = summarise(group, spend, "me");
    expect(renata.viewerId).toBe("me");
    expect(renata.myBudget).toBe(600 * 21500);
    expect(renata.mySpent).toBe(100000);
    expect(renata.myLeft).toBe(600 * 21500 - 100000);
    expect(renata.groupBudget).toBe(1800 * 21500);
    expect(renata.groupSpent).toBe(390000); // taxi + lunch are shared, the solo drink is not
    expect(renata.groupLeft).toBe(1800 * 21500 - 390000);
    const bella = summarise(group, spend, "bella");
    expect(bella.mySpent).toBe(145000);
    expect(bella.myBudget).toBe(renata.myBudget);
    expect(bella.groupSpent).toBe(renata.groupSpent); // the group pot is the same for everyone
  });
  it("no personId means the trip creator, so old callers keep working", () => {
    expect(summarise(group, spend).viewerId).toBe("me");
    expect(summarise(group, spend, "nobody").viewerId).toBe("me");
  });
  it("net is what I paid minus what I owe, and nets add up to zero", () => {
    const net = balances(group, spend);
    expect(net).toEqual({ me: 200000, bella: -55000, dewi: -145000 });
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    expect(summarise(group, spend, "bella").net).toBe(-55000);
  });
  it("settle up: mixed payers, fewest transfers", () => {
    expect(settleUp(group, spend)).toEqual([
      { fromId: "dewi", fromName: "Dewi", toId: "me", toName: "Renata", amount: 145000 },
      { fromId: "bella", fromName: "Bella", toId: "me", toName: "Renata", amount: 55000 },
    ]);
    // one debtor owes two creditors: 150 splits into 100 + 50, still 2 payments for 3 people
    const two = [ex("a", "me", 100, { dewi: 100 }), ex("b", "bella", 50, { dewi: 50 })];
    const t = settleUp(group, two);
    expect(t).toHaveLength(2);
    expect(t.map((x) => [x.fromId, x.toId, x.amount])).toEqual([["dewi", "me", 100], ["dewi", "bella", 50]]);
  });
  it("is all settled when everyone paid their own way", () => {
    expect(settleUp(group, [ex("solo", "me", 50, { me: 50 })])).toEqual([]);
    expect(settleUp(group, [ex("even", "me", 90, { me: 30, bella: 30, dewi: 30 }), ex("back", "bella", 30, { me: 30 }), ex("back2", "dewi", 30, { me: 30 })]).length).toBe(0);
  });
  it("splits that don't add up to the amount are refused by the contract", () => {
    const bad = { tripId: "t1", item: "Tea", category: "food", amount: 100, paidBy: "me", shares: { me: 50 } };
    expect(NewExpense.safeParse(bad).success).toBe(false);
    expect(NewExpense.safeParse({ ...bad, shares: { me: 50, bella: 50 } }).success).toBe(true);
  });
  it("a joiner changes the head count, so everyone's share shrinks", () => {
    const four = { ...group, people: [...group.people, { id: "rio", name: "Rio", isMe: false, status: "joined" as const }] };
    expect(summarise(four, [], "me").myBudget).toBe((1800 * 21500) / 4);
  });
});

describe("the fixed category list", () => {
  it("is exactly these seven, with these labels", () => {
    expect([...CATEGORIES]).toEqual(["transport", "food", "activities", "shopping", "stay", "essentials", "other"]);
    expect(Object.values(CATEGORY_LABELS)).toEqual(["Transport", "Food & drink", "Activities", "Shopping", "Stay", "Essentials", "Other"]);
  });
  it("accepts the seven, reads the old 'sim' as essentials, and refuses anything else", () => {
    for (const c of CATEGORIES) expect(Category.parse(c)).toBe(c);
    expect(Category.parse("sim")).toBe("essentials");
    expect(Category.safeParse("adventure").success).toBe(false);
    const old = { id: "sim", city: "bali", category: "sim", name: "SIM", min: 1, max: 2, currency: "IDR", tip: "" };
    expect(PriceItemSchema.parse(old).category).toBe("essentials");
    expect(Expense.parse({ id: "e", tripId: "t", item: "SIM", category: "sim", amount: 5, paidBy: "me", shares: { me: 5 }, createdAt: "" }).category).toBe("essentials");
  });
  it("the summary has all seven categories, so every one can be charted", () => {
    const sum = summarise(trip, [
      { id: "a", tripId: "t1", item: "Surf lesson", category: "activities", amount: 300, paidBy: "me", shares: { me: 100, bella: 100, dewi: 100 }, createdAt: "" },
      { id: "b", tripId: "t1", item: "Villa", category: "stay", amount: 90, paidBy: "me", shares: { me: 30, bella: 30, dewi: 30 }, createdAt: "" },
      { id: "c", tripId: "t1", item: "SIM", category: "essentials", amount: 20, paidBy: "me", shares: { me: 20 }, createdAt: "" },
    ]);
    expect(Object.keys(sum.byCategoryMine)).toEqual([...CATEGORIES]);
    expect(sum.byCategoryMine).toMatchObject({ activities: 100, stay: 30, essentials: 20, transport: 0, other: 0 });
    expect(sum.byCategoryGroup).toMatchObject({ activities: 300, stay: 90, essentials: 0 });
    expect(() => Summary.parse(sum)).not.toThrow();
  });
});

describe("bargain modes: the verdict stays, only the action changes", () => {
  const item = (o: Partial<PriceItem> = {}): PriceItem => ({ ...taxi, ...o });
  const pricesList: PriceItem[] = [
    item({ id: "nasi", category: "food", name: "Nasi goreng at a warung", min: 25000, max: 50000, bargain: "ask" }),
    item({ id: "tea", category: "food", name: "Iced tea at a café", min: 10000, max: 25000, bargain: "fixed" }),
    item({ id: "steak", category: "food", name: "Steak dinner", min: 120000, max: 220000, bargain: "fixed" }),
  ];

  it("defaults: the item's own mode, or a guess by category", () => {
    expect(defaultBargain({ category: "transport", bargain: "fixed" })).toBe("fixed");
    expect(defaultBargain({ category: "shopping" })).toBe("bargain");
    expect(defaultBargain({ category: "activities" })).toBe("ask");
    expect(defaultBargain({ category: "stay" })).toBe("fixed");
    expect(defaultBargain({ category: "essentials" })).toBe("fixed");
  });
  it("fancy places and chain, app or menu situations are never 'bargain'", () => {
    const base = { itemDefault: "bargain" as const };
    expect(resolveBargainMode({ ...base, style: "fancy" })).toBe("fixed");
    for (const situation of ["fancy restaurant", "supermarket", "Grab app", "Indomaret", "at the mall", "beach club", "restaurant with a menu", "metered taxi", "Starbucks"])
      expect(resolveBargainMode({ ...base, situation })).toBe("fixed");
    // even if the AI said bargain, or the item says ask
    expect(resolveBargainMode({ requested: "bargain", situation: "supermarket", itemDefault: "ask" })).toBe("fixed");
    expect(resolveBargainMode({ style: "fancy", itemDefault: "ask" })).toBe("fixed");
  });
  it("without such a sign, the situation can override the item's usual mode", () => {
    expect(resolveBargainMode({ situation: "market stall", itemDefault: "bargain" })).toBe("bargain");
    expect(resolveBargainMode({ requested: "ask", situation: "street", itemDefault: "bargain" })).toBe("ask");
    expect(resolveBargainMode({ itemDefault: "ask" })).toBe("ask");
  });

  it("same verdict in every mode; plan and Bargain only in bargain mode", () => {
    const run = (bargainMode: "bargain" | "ask" | "fixed") => checkPrice(trip, taxi, 400000, "local", { bargainMode });
    const [b, a, f] = [run("bargain"), run("ask"), run("fixed")];
    expect([b.verdict, a.verdict, f.verdict]).toEqual(["tooHigh", "tooHigh", "tooHigh"]);
    expect([b.range, a.range]).toEqual([f.range, f.range]);
    expect(b.bargainMode).toBe("bargain");
    expect(b.plan).toBeDefined();
    expect(b.phrase?.local).toContain("ribu");
    expect(b.tips).toBeUndefined();
    // ask: no plan chips, one polite phrase
    expect(a.bargainMode).toBe("ask");
    expect(a.plan).toBeUndefined();
    expect(a.phrase).toMatchObject({ local: "Ada diskon?", english: "Is there a discount?", lang: "id-ID" });
    expect(a.tips).toBeUndefined();
    // fixed: no plan, no phrase, tips instead, and nothing about haggling
    expect(f.bargainMode).toBe("fixed");
    expect(f.plan).toBeUndefined();
    expect(f.phrase).toBeUndefined();
    expect(f.tips!.length).toBeGreaterThanOrEqual(2);
    expect([f.advice, ...f.tips!].join(" ")).not.toMatch(/barg|haggl|negotiat/i);
    expect(() => CheckResult.parse(f)).not.toThrow();
  });
  it("ask mode offers the phrase unless the price is already a great deal", () => {
    expect(checkPrice(trip, taxi, 100000, "local", { bargainMode: "ask" }).phrase).toBeUndefined();
    expect(checkPrice(trip, taxi, 200000, "local", { bargainMode: "ask" }).phrase?.local).toBe("Ada diskon?");
  });
  it("the item's own mode is used when nothing else is said", () => {
    expect(checkPrice(trip, item({ bargain: "fixed" }), 200000, "local").bargainMode).toBe("fixed");
    expect(checkPrice(trip, item({ bargain: "ask" }), 200000, "local").bargainMode).toBe("ask");
    expect(checkPrice(trip, taxi, 200000, "fancy").bargainMode).toBe("fixed"); // taxi defaults to bargain, fancy overrides
  });
  it("a cheaper alternative comes from our data", () => {
    // fancy or mid-range: the same thing at a local place costs the plain range
    expect(cheaperAlternative(pricesList[0], "fancy", pricesList)).toEqual({ name: "Nasi goreng at a warung", min: 25000, max: 50000, currency: "IDR" });
    // local but fixed: a cheaper item in the same category that is not itself fixed
    expect(cheaperAlternative(pricesList[2], "local", pricesList)?.name).toBe("Nasi goreng at a warung");
    // nothing cheaper and not fixed: no alternative
    expect(cheaperAlternative(pricesList[1], "local", pricesList)).toBeUndefined();
  });
  it("fixed-mode tips: no haggling, mention the alternative with its range", () => {
    const tips = templateTips({ category: "food" }, { name: "Nasi goreng at a warung", min: 25000, max: 50000, currency: "IDR" });
    expect(tips).toHaveLength(3);
    expect(tips[0]).toContain("menu");
    expect(tips[1]).toContain("service charge and tax");
    expect(tips[2]).toContain("Rp25,000 to Rp50,000");
    expect(templateTips({ category: "transport" })[0]).toContain("meter");
    for (const v of ["great", "fair", "high", "tooHigh"] as const) expect(templateAdvice("fixed", v)).not.toMatch(/barg|haggl|negotiat/i);
  });
  it("applyAdvice in a fixed-price place drops anything about haggling and keeps the verdict", () => {
    const base = checkPrice(trip, taxi, 400000, "local", { bargainMode: "fixed" });
    const bad = applyAdvice(base, { advice: "Try to bargain it down.", tips: ["Haggle hard.", "Negotiate a discount.", "Check the bill for service charge."] });
    expect(bad.verdict).toBe("tooHigh");
    expect(bad.advice).toBe(base.advice); // the haggling advice was refused
    expect(bad.tips).toEqual(base.tips); // fewer than two usable tips: the template tips stay
    const good = applyAdvice(base, { advice: "Check the bill, it is a fixed price.", tips: ["Ask for the menu first.", "Use the meter.", "Check service and tax.", "A fourth tip is cut."] });
    expect(good.advice).toBe("Check the bill, it is a fixed price.");
    expect(good.tips).toEqual(["Ask for the menu first.", "Use the meter.", "Check service and tax."]);
    expect(good.plan).toBeUndefined();
    expect(good.phrase).toBeUndefined();
  });
  it("applyAdvice in ask mode keeps the one polite phrase and adds no plan", () => {
    const base = checkPrice(trip, taxi, 400000, "local", { bargainMode: "ask" });
    const out = applyAdvice(base, { advice: "Worth asking nicely.", plan: { openWith: 1, aimFor: 2, walkAwayAbove: 3 }, phrase: { local: "Wah 1 ribu", english: "x" } });
    expect(out.advice).toBe("Worth asking nicely.");
    expect(out.plan).toBeUndefined();
    expect(out.phrase).toEqual(askPhrase());
  });
});
