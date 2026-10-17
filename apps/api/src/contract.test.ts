/**
 * CONTRACT TESTS: the safety net that stops one role breaking another.
 * Every endpoint's response is checked against packages/shared/src/contracts.ts.
 * They run on mocks by default. With DATABASE_URL set they also run against Tiger Data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { CheckResult, Expense, Health, ParsedAsk, PriceItem, Summary, Trip, perPersonBudget } from "@fairfare/shared";
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
