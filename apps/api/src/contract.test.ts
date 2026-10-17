/**
 * CONTRACT TESTS: the safety net that stops one role breaking another.
 * Every endpoint's response is checked against packages/shared/src/contracts.ts.
 * They run on mocks by default. With DATABASE_URL set they also run against Tiger Data.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { CheckResult, Expense, Health, JoinResult, ParsedAsk, PriceItem, Summary, Trip, TripByCode, perPersonBudget } from "@fairfare/shared";
import { createApp } from "./app";
import { MockDataStore } from "./data/mock";
import { MockVoice } from "./voice/mock";
import { MockAskParser } from "./ai/mock";
import type { AdviceWriter } from "./ports";
import type { AskParser, PriceResearcher } from "./ports";
import { UnknownItemError } from "./ai/gemini";
import { createPriceLearner } from "./ai/learn";

let server: Server;
let base = "";
let advisor: AdviceWriter | undefined;
const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, { headers: { "content-type": "application/json" }, ...init });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null), headers: res.headers };
};

beforeAll(async () => {
  const app = createApp({ data: new MockDataStore(), voice: new MockVoice(), ai: new MockAskParser(), advisor: { advise: (...a) => advisor!.advise(...a) }, modes: { data: "mock", voice: "mock", ai: "mock" } });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("check + Gemini advice", () => {
  const body = JSON.stringify({ tripId: "demo", itemId: "taxi-airport", amount: 400000, style: "local", situation: "airport, at night" });
  afterAll(() => { advisor = undefined; });

  it("uses Gemini's words but keeps the verdict, and clamps a plan that leaves the range", async () => {
    advisor = { advise: async () => ({
      advice: "Almost double the usual fare. Offer 170k and settle around 200k.",
      plan: { openWith: 20000, aimFor: 200000, walkAwayAbove: 900000 },
      phrase: { local: "Wah, mahal banget! 150 ribu saja, boleh?", polite: "Maaf, bisa 150 ribu saja, Pak?", english: "Wow, very expensive! Just 150,000, okay?" },
    }) };
    const result = CheckResult.parse((await call("/api/check", { method: "POST", body })).body);
    expect(result.verdict).toBe("tooHigh");
    expect(result.advice).toContain("Almost double");
    expect(result.plan).toEqual({ openWith: 150000, aimFor: 200000, walkAwayAbove: 250000 });
    expect(result.phrase?.local).toContain("150 ribu");
  });

  it("falls back to the template when Gemini fails", async () => {
    advisor = { advise: async () => { throw new Error("quota"); } };
    const r = await call("/api/check", { method: "POST", body });
    expect(r.status).toBe(200);
    const result = CheckResult.parse(r.body);
    expect(result.advice).toBe("Way above normal, bargain or walk away.");
    expect(result.plan?.openWith).toBe(150000);
  });
});

describe("API keeps its promises", () => {
  it("health", async () => {
    const { body } = await call("/api/health");
    expect(() => Health.parse(body)).not.toThrow();
  });

  it("prices", async () => {
    const { body } = await call("/api/prices?city=bali");
    expect(body.length).toBeGreaterThan(0);
    body.forEach((p: unknown) => PriceItem.parse(p));
  });

  it("parse -> check: the main feature, end to end", async () => {
    const parsed = await call("/api/parse", { method: "POST", body: JSON.stringify({ city: "bali", text: "taxi from the airport to Seminyak at night, he wants 400000" }) });
    const ask = ParsedAsk.parse(parsed.body);
    const checked = await call("/api/check", { method: "POST", body: JSON.stringify({ tripId: "demo", itemId: ask.itemId, amount: ask.amount, style: ask.style }) });
    const result = CheckResult.parse(checked.body);
    expect(ask.amount).toBe(400000);
    expect(result.verdict).toBe("tooHigh");
    expect(result.currency).toBe("IDR");
    // no Gemini in this test, so the template advice, plan and Bahasa phrase come back
    expect(result.advice).toBeTruthy();
    expect(result.plan).toEqual({ openWith: 150000, aimFor: 200000, walkAwayAbove: 250000 });
    expect(result.phrase).toMatchObject({ lang: "id-ID", local: expect.stringContaining("150 ribu") });
  });

  it("check: a fair price gets advice but no plan or phrase", async () => {
    const r = await call("/api/check", { method: "POST", body: JSON.stringify({ tripId: "demo", itemId: "taxi-city", amount: 50000, style: "local" }) });
    const result = CheckResult.parse(r.body);
    expect(result.verdict).toBe("fair");
    expect(result.advice).toBeTruthy();
    expect(result.plan).toBeUndefined();
    expect(result.phrase).toBeUndefined();
  });

  it("check: an item that isn't in the database gets a plain 404", async () => {
    const r = await call("/api/check", { method: "POST", body: JSON.stringify({ tripId: "demo", itemId: "surf-lesson", amount: 500000, style: "local" }) });
    expect(r.status).toBe(404);
    expect(r.body.error).toBeTruthy();
  });

  it("parse explains what is missing", async () => {
    const r = await call("/api/parse", { method: "POST", body: JSON.stringify({ city: "bali", text: "hello" }) });
    expect(r.status).toBe(422);
    expect(r.body.error).toBeTruthy();
  });

  it("save a split expense, then the summary updates", async () => {
    const add = await call("/api/trips/demo/expenses", { method: "POST", body: JSON.stringify({ item: "Tagine", category: "food", amount: 90000, paidBy: "me", shares: { me: 30000, bella: 60000 } }) });
    expect(add.status).toBe(201);
    Expense.parse(add.body);
    const sum = Summary.parse((await call("/api/trips/demo/summary")).body);
    expect(sum.owes.find((o) => o.personId === "bella")!.amount).toBeGreaterThanOrEqual(60000);
  });

  it("expense categories: the fixed seven, old 'sim' saved as essentials, anything else refused", async () => {
    const save = (category: string) => call("/api/trips/demo/expenses", { method: "POST", body: JSON.stringify({ item: "Thing", category, amount: 1000, paidBy: "me", shares: { me: 1000 } }) });
    for (const c of ["transport", "food", "activities", "shopping", "stay", "essentials", "other"]) expect((await save(c)).status).toBe(201);
    const old = await save("sim");
    expect(old.status).toBe(201);
    expect(old.body.category).toBe("essentials");
    expect((await save("adventure")).status).toBe(400);
  });

  it("rejects a split that doesn't add up", async () => {
    const r = await call("/api/trips/demo/expenses", { method: "POST", body: JSON.stringify({ item: "Tea", category: "food", amount: 30000, paidBy: "me", shares: { me: 10000 } }) });
    expect(r.status).toBe(400);
  });

  it("a group trip stores the total and my per-person share, and the summary uses my share", async () => {
    const people = [
      { id: "me", name: "Renata", isMe: true, status: "joined" },
      { id: "Bella", name: "Bella", isMe: false, status: "joined" },
      { id: "Dewi", name: "Dewi", isMe: false, status: "invited" },
    ];
    const create = await call("/api/trips", { method: "POST", body: JSON.stringify({
      city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: perPersonBudget(1800, 3), groupBudgetHome: 1800,
      start: "2026-10-24", end: "2026-10-30", people }) });
    expect(create.status).toBe(201);
    const trip = Trip.parse(create.body);
    expect(trip.groupBudgetHome).toBe(1800);
    expect(trip.budgetHome).toBe(600);
    const sum = Summary.parse((await call(`/api/trips/${trip.id}/summary`)).body);
    expect(sum.budget).toBe(600 * 21500); // my share, not the group total
  });

  it("invites: by-code for the join screen, claiming an invited person, and per-person summaries", async () => {
    const people = [
      { id: "x1", name: "Renata", isMe: true, status: "joined" },
      { id: "x2", name: "Bella", isMe: false, status: "invited", email: "bella@example.com" },
      { id: "x3", name: "Dewi", isMe: false, status: "invited" },
    ];
    const created = Trip.parse((await call("/api/trips", { method: "POST", body: JSON.stringify({
      city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: 600, groupBudgetHome: 1800,
      start: "2026-10-24", end: "2026-10-30", people }) })).body);
    // the server made its own person ids
    expect(created.people.map((p) => p.id)).not.toContain("x1");
    const renata = created.people.find((p) => p.isMe)!;

    const info = TripByCode.parse((await call(`/api/trips/by-code/${created.inviteCode}`)).body);
    expect(info).toMatchObject({ tripId: created.id, ownerName: "Renata", city: "bali", perPersonBudgetHome: 600, homeCurrency: "GBP" });
    expect(info.people).toEqual(["Renata", "Bella", "Dewi"]);
    const bad = await call("/api/trips/by-code/NOPE-0000");
    expect(bad.status).toBe(404);
    expect(bad.body.error).toBe("This invite link doesn't work. Ask your friend for a new one.");

    // "bella" (small letters) claims the invited Bella: no duplicate, same person id, now joined
    const join = JoinResult.parse((await call("/api/trips/join", { method: "POST", body: JSON.stringify({ code: created.inviteCode, name: "bella" }) })).body);
    const bella = created.people.find((p) => p.name === "Bella")!;
    expect(join.personId).toBe(bella.id);
    expect(join.people).toHaveLength(3);
    expect(join.people.find((p) => p.id === bella.id)!.status).toBe("joined");

    // a stranger becomes a new person and the head count (and so everyone's share) changes
    const rio = JoinResult.parse((await call("/api/trips/join", { method: "POST", body: JSON.stringify({ code: created.inviteCode, name: "Rio" }) })).body);
    expect(rio.people).toHaveLength(4);
    expect(rio.people.find((p) => p.id === rio.personId)!.name).toBe("Rio");

    // Bella pays for lunch for Bella + Renata; ids only
    const lunch = await call(`/api/trips/${created.id}/expenses`, { method: "POST", body: JSON.stringify({
      item: "Lunch", category: "food", amount: 100000, paidBy: bella.id, shares: { [bella.id]: 50000, [renata.id]: 50000 } }) });
    expect(lunch.status).toBe(201);
    const nope = await call(`/api/trips/${created.id}/expenses`, { method: "POST", body: JSON.stringify({
      item: "Lunch", category: "food", amount: 100000, paidBy: "Bella", shares: { Bella: 100000 } }) });
    expect(nope.status).toBe(400); // names are not person ids

    const forRenata = Summary.parse((await call(`/api/trips/${created.id}/summary?personId=${renata.id}`)).body);
    const forBella = Summary.parse((await call(`/api/trips/${created.id}/summary?personId=${bella.id}`)).body);
    expect(forRenata.mySpent).toBe(50000);
    expect(forBella.mySpent).toBe(50000);
    expect(forRenata.myBudget).toBe((1800 * 21500) / 4);
    expect(forRenata.net).toBe(-50000);
    expect(forBella.net).toBe(50000);
    expect(forRenata.transfers).toEqual([{ fromId: renata.id, fromName: "Renata", toId: bella.id, toName: "Bella", amount: 50000 }]);
    expect(forRenata.groupSpent).toBe(100000);
    expect(forRenata.groupLeft).toBe(1800 * 21500 - 100000);
    expect((await call(`/api/trips/${created.id}/summary?personId=ghost`)).status).toBe(404);
    // no personId = the creator
    expect(Summary.parse((await call(`/api/trips/${created.id}/summary`)).body).viewerId).toBe(renata.id);
  });

  it("the invite link can be shown before the trip exists: reserve a code, then create the trip with it", async () => {
    const { code } = (await call("/api/invite-codes", { method: "POST", body: "{}" })).body;
    expect(code).toMatch(/^BAL-[A-Z0-9]{5}$/);
    const early = await call(`/api/trips/by-code/${code}`); // a friend is too early
    expect(early.status).toBe(404);
    expect(early.body.error).toContain("still setting up");
    const trip = Trip.parse((await call("/api/trips", { method: "POST", body: JSON.stringify({
      city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: 600, groupBudgetHome: 600, inviteCode: code,
      start: "2026-10-24", end: "2026-10-30", people: [{ id: "x", name: "Renata", isMe: true, status: "joined" }] }) })).body);
    expect(trip.inviteCode).toBe(code);
    expect(TripByCode.parse((await call(`/api/trips/by-code/${code}`)).body).tripId).toBe(trip.id);
    // the same code can't be used for a second trip
    const again = Trip.parse((await call("/api/trips", { method: "POST", body: JSON.stringify({
      city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: 600, inviteCode: code,
      start: "2026-10-24", end: "2026-10-30", people: [{ id: "y", name: "Other", isMe: true, status: "joined" }] }) })).body);
    expect(again.inviteCode).not.toBe(code);
  });

  it("joining with an empty name or a bad code gives plain errors", async () => {
    expect((await call("/api/trips/join", { method: "POST", body: JSON.stringify({ code: "BAL-24OCT", name: "  " }) })).status).toBe(400);
    const r = await call("/api/trips/join", { method: "POST", body: JSON.stringify({ code: "NOPE", name: "Rio" }) });
    expect(r.status).toBe(404);
    expect(r.body.error).toContain("invite link");
  });

  it("a trip without groupBudgetHome still works (the field is optional)", async () => {
    const trip = Trip.parse((await call("/api/trips/demo")).body);
    expect(trip.groupBudgetHome).toBeUndefined();
  });

  it("join by invite code", async () => {
    const r = await call("/api/trips/join", { method: "POST", body: JSON.stringify({ code: "BAL-24OCT", name: "Rio" }) });
    expect(Trip.parse(r.body).people.some((p) => p.name === "Rio")).toBe(true);
  });

  it("voice: stt returns text, mock tts tells the Interface to use the phone voice", async () => {
    const stt = await fetch(base + "/api/voice/stt", { method: "POST", headers: { "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) });
    expect((await stt.json()).text).toBeTruthy();
    const tts = await call("/api/voice/tts", { method: "POST", body: JSON.stringify({ text: "Wah, mahal banget!", lang: "id-ID" }) });
    expect(tts.status).toBe(204);
    expect(tts.headers.get("x-fairfare-mock")).toBe("1");
  });
});

describe("bargain modes through the real routes (mock parser, no Gemini)", () => {
  // "parse" then "check", the way the page does it: the situation and mode from parse go into check
  const flow = async (text: string) => {
    const ask = ParsedAsk.parse((await call("/api/parse", { method: "POST", body: JSON.stringify({ city: "bali", text }) })).body);
    const res = CheckResult.parse((await call("/api/check", { method: "POST", body: JSON.stringify({
      tripId: "demo", itemId: ask.itemId, amount: ask.amount, style: ask.style, situation: ask.situation, bargainMode: ask.bargainMode }) })).body);
    return { ask, res };
  };

  it("'fancy restaurant' is a fixed-price place: tips, a cheaper alternative from our data, no plan or phrase", async () => {
    const { res } = await flow("nasi goreng at a fancy restaurant, 150000");
    expect(res.bargainMode).toBe("fixed");
    expect(res.plan).toBeUndefined();
    expect(res.phrase).toBeUndefined();
    expect(res.tips!.length).toBeGreaterThanOrEqual(2);
    expect(res.alternative).toMatchObject({ name: "Nasi goreng at a warung", min: 25000, max: 50000 }); // the same dish at a local place
    expect(res.verdict).toBe("fair"); // fancy range 87,500-175,000: the verdict still shows
    expect([res.advice, ...res.tips!].join(" ")).not.toMatch(/barg|haggl|negotiat/i);
  });
  it("'market sarong' is bargain: plan and phrase", async () => {
    const { res } = await flow("batik sarong at the market, 300000");
    expect(res.bargainMode).toBe("bargain");
    expect(res.verdict).toBe("tooHigh");
    expect(res.plan).toBeDefined();
    expect(res.phrase?.local).toContain("ribu");
    expect(res.tips).toBeUndefined();
  });
  it("'massage' is ask: one polite phrase, no plan chips, the verdict still shows", async () => {
    const { res } = await flow("massage, 400000");
    expect(res.bargainMode).toBe("ask");
    expect(res.item.id).toBe("massage");
    expect(res.verdict).toBe("tooHigh");
    expect(res.plan).toBeUndefined();
    expect(res.phrase).toMatchObject({ local: "Ada diskon?", english: "Is there a discount?" });
  });
  it("a chain, app or supermarket situation can never be bargain, even if the request says so", async () => {
    const r = await call("/api/check", { method: "POST", body: JSON.stringify({ tripId: "demo", itemId: "sarong", amount: 300000, style: "local", situation: "supermarket", bargainMode: "bargain" }) });
    expect(CheckResult.parse(r.body)).toMatchObject({ bargainMode: "fixed", verdict: "tooHigh" });
    const grab = await flow("Grab ride, 90000");
    expect(grab.res.bargainMode).toBe("fixed"); // Grab: the app sets the price
    expect(grab.res.plan).toBeUndefined();
  });
});

describe("learning a new price end to end (parse -> research -> save -> check)", () => {
  let srv: Server, url = "", researched = 0, mode: "good" | "quota" = "good";
  // Gemini "understands" the sentence but has no item for it; the researcher answers from (mocked) search results
  const ai: AskParser = { parse: async (req) => {
    const item = /scuba/i.test(req.text ?? "") ? "scuba dive" : "surf lesson";
    throw new UnknownItemError(item, "other", { amount: 500000, currency: "IDR", style: "local", situation: "Canggu", confidence: 0.9 });
  } };
  const researcher: PriceResearcher = { research: async () => {
    researched++;
    if (mode === "quota") throw new Error("gemini research 429");
    return { id: "surf-lesson", name: "Beginner surf lesson", category: "other", min: 350000, max: 600000, currency: "IDR", tip: "Ask what is included.", sources: ["https://example.com/surf"] };
  } };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  beforeAll(async () => {
    const data = new MockDataStore();
    srv = createApp({ data, voice: new MockVoice(), ai, learner: createPriceLearner(data, researcher), modes: { data: "mock", voice: "mock", ai: "mock" } }).listen(0);
    await new Promise((r) => srv.once("listening", r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());

  it("researches once, saves it, and the check uses it and labels it as web data", async () => {
    const parsed = await post("/api/parse", { city: "bali", text: "surf lesson in Canggu, 500000" });
    expect(parsed.body).toMatchObject({ itemId: "surf-lesson", researched: true, sources: ["https://example.com/surf"], amount: 500000 });
    const prices = await (await fetch(url + "/api/prices?city=bali")).json();
    expect(prices.find((p: { id: string }) => p.id === "surf-lesson")).toMatchObject({ origin: "web", source: "https://example.com/surf" });
    const checked = CheckResult.parse((await post("/api/check", { tripId: "demo", itemId: "surf-lesson", amount: 500000, style: "local" })).body);
    expect(checked).toMatchObject({ verdict: "fair", source: "web", sources: ["https://example.com/surf"] });
    // the tourist's 500000 was never stored as data
    expect(checked.item).toMatchObject({ min: 350000, max: 600000 });
    expect(researched).toBe(1);
  });
  it("next time the same item comes from the database: no new search", async () => {
    const before = researched;
    const second = await post("/api/parse", { city: "bali", text: "surf lesson in Canggu, 450000" });
    expect(second.body).toMatchObject({ itemId: "surf-lesson", researched: false });
    expect(researched).toBe(before);
  });
  it("our own items are labelled local", async () => {
    const checked = CheckResult.parse((await post("/api/check", { tripId: "demo", itemId: "taxi-airport", amount: 200000, style: "local" })).body);
    expect(checked.source).toBe("local");
    expect(checked.sources).toBeUndefined();
  });
  it("if research fails the answer is a plain 'no price yet' (itemId empty), never an error page", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mode = "quota";
    const r = await post("/api/parse", { city: "bali", text: "scuba dive, 900000" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ itemId: "", item: "scuba dive", researched: false, amount: 500000 });
    vi.restoreAllMocks();
  });
});
