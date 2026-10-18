import { describe, expect, it } from "vitest";
import { BargainRequest } from "./contracts";
import { decideBargain } from "./bargain";
import { lastAmount } from "./money";
import { inferThousands, isImplausiblyLow } from "./scale";

const surf = { min: 350000, max: 600000 };

describe("inferThousands", () => {
  it("fills in missing thousands from the usual range", () => {
    expect(inferThousands(170, { range: surf })).toBe(170000);
    expect(inferThousands(30, { range: { min: 10000, max: 30000 } })).toBe(30000); // es teh 30
    expect(inferThousands(250, { range: { min: 20000, max: 50000 } })).toBe(250000); // taksi 250
  });
  it("uses the offers already made in the bargain", () => {
    // 170 is not far below the usual 50k..250k minimum rule (10,000), but it sits right next to my 160 ribu offer
    expect(inferThousands(170, { range: { min: 800, max: 5000 }, anchors: [160000] })).toBe(170000);
  });
  it("leaves real amounts and absurd results alone", () => {
    expect(inferThousands(170000, { range: surf })).toBe(170000);
    expect(inferThousands(1000, { range: surf })).toBe(1000);
    expect(inferThousands(0, { range: surf })).toBe(0);
    expect(inferThousands(900, { range: { min: 100, max: 500 } })).toBe(900); // x1000 would be 1,800x the usual maximum
  });
  it("calls a price under 1% of the usual minimum implausible", () => {
    expect(isImplausiblyLow(170, surf)).toBe(true);
    expect(isImplausiblyLow(3500, surf)).toBe(false);
  });
});

describe("a bargain at 160 ribu when the usual price is 350k to 600k", () => {
  const base = { item: "Surf lesson", category: "activities" as const, currency: "IDR", range: surf, plan: { openWith: 160000, aimFor: 400000, walkAwayAbove: 500000 }, myLastOffer: 160000, round: 1, language: "id-ID", bargainMode: "bargain" as const };
  const say = (text: string) => decideBargain(BargainRequest.parse({ ...base, theirReply: text, theirNumber: lastAmount(text) ?? undefined }));
  it("'seratus tujuh puluh' is 170,000, not 170", () => {
    const r = say("Kalau seratus tujuh puluh gimana?");
    expect(r.theirNumber).toBe(170000);
    expect(r.intent).toBe("counter");
    expect(r.move).not.toBe("retry");
  });
  it("'170' is 170,000", () => {
    expect(say("170").theirNumber).toBe(170000);
    expect(say("kalau 170 gimana").theirNumber).toBe(170000);
  });
  it("'170 ribu' and '170000' still mean 170,000", () => {
    expect(say("170 ribu").theirNumber).toBe(170000);
    expect(say("170000").theirNumber).toBe(170000);
  });
  it("a number Gemini heard without the scale is fixed too", () => {
    const r = decideBargain(BargainRequest.parse({ ...base, theirReply: "seratus tujuh puluh" }), { intent: "counter", theirNumber: 170 });
    expect(r.theirNumber).toBe(170000);
  });
});
