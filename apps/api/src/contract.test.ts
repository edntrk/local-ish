/**
 * CONTRACT TESTS: the safety net that stops one role breaking another.
 * Every endpoint's response is checked against packages/shared/src/contracts.ts.
 * They run on mocks by default. With DATABASE_URL set they also run against Tiger Data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { CheckResult, Expense, Health, JoinResult, ParsedAsk, PriceItem, Summary, Trip, TripByCode, perPersonBudget } from "@fairfare/shared";
import { createApp } from "./app";
import { MockDataStore } from "./data/mock";
import { MockVoice } from "./voice/mock";
import { MockAskParser } from "./ai/mock";
import type { AdviceWriter } from "./ports";

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
