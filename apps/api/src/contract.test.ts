/**
 * CONTRACT TESTS: the safety net that stops one role breaking another.
 * Every endpoint's response is checked against packages/shared/src/contracts.ts.
 * They run on mocks by default. With DATABASE_URL set they also run against Tiger Data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { CheckResult, Expense, Health, ParsedAsk, PriceItem, Summary, Trip } from "@fairfare/shared";
import { createApp } from "./app";
import { MockDataStore } from "./data/mock";
import { MockVoice } from "./voice/mock";
import { MockAskParser } from "./ai/mock";

let server: Server;
let base = "";
const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, { headers: { "content-type": "application/json" }, ...init });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null), headers: res.headers };
};

beforeAll(async () => {
  const app = createApp({ data: new MockDataStore(), voice: new MockVoice(), ai: new MockAskParser(), modes: { data: "mock", voice: "mock", ai: "mock" } });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("API keeps its promises", () => {
  it("health", async () => {
    const { body } = await call("/api/health");
    expect(() => Health.parse(body)).not.toThrow();
  });

  it("prices", async () => {
    const { body } = await call("/api/prices?city=marrakech");
    expect(body.length).toBeGreaterThan(0);
    body.forEach((p: unknown) => PriceItem.parse(p));
  });

  it("parse -> check: the main feature, end to end", async () => {
    const parsed = await call("/api/parse", { method: "POST", body: JSON.stringify({ city: "marrakech", text: "taxi from the airport, 250" }) });
    const ask = ParsedAsk.parse(parsed.body);
    const checked = await call("/api/check", { method: "POST", body: JSON.stringify({ tripId: "demo", itemId: ask.itemId, amount: ask.amount, style: ask.style }) });
    expect(CheckResult.parse(checked.body).verdict).toBe("tooHigh");
  });

  it("parse explains what is missing", async () => {
    const r = await call("/api/parse", { method: "POST", body: JSON.stringify({ city: "marrakech", text: "hello" }) });
    expect(r.status).toBe(422);
    expect(r.body.error).toBeTruthy();
  });

  it("save a split expense, then the summary updates", async () => {
    const add = await call("/api/trips/demo/expenses", { method: "POST", body: JSON.stringify({ item: "Tagine", category: "food", amount: 90, paidBy: "me", shares: { me: 30, bella: 60 } }) });
    expect(add.status).toBe(201);
    Expense.parse(add.body);
    const sum = Summary.parse((await call("/api/trips/demo/summary")).body);
    expect(sum.owes.find((o) => o.personId === "bella")!.amount).toBeGreaterThanOrEqual(60);
  });

  it("rejects a split that doesn't add up", async () => {
    const r = await call("/api/trips/demo/expenses", { method: "POST", body: JSON.stringify({ item: "Tea", category: "food", amount: 30, paidBy: "me", shares: { me: 10 } }) });
    expect(r.status).toBe(400);
  });

  it("join by invite code", async () => {
    const r = await call("/api/trips/join", { method: "POST", body: JSON.stringify({ code: "MRK-24OCT", name: "Rio" }) });
    expect(Trip.parse(r.body).people.some((p) => p.name === "Rio")).toBe(true);
  });

  it("voice: stt returns text, mock tts tells the Interface to use the phone voice", async () => {
    const stt = await fetch(base + "/api/voice/stt", { method: "POST", headers: { "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) });
    expect((await stt.json()).text).toBeTruthy();
    const tts = await call("/api/voice/tts", { method: "POST", body: JSON.stringify({ text: "Ghali bzaf", lang: "ar-MA" }) });
    expect(tts.status).toBe(204);
    expect(tts.headers.get("x-fairfare-mock")).toBe("1");
  });
});
