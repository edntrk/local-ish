import { describe, expect, it } from "vitest";
import { applyAdvice, checkPrice } from "./pricing";
import { cleanText, oneSentence } from "./text";
import type { PriceItem, Trip } from "./contracts";

// the exact junk Gemini once put into a phrase
const JUNK = "假phrase_placeholder_to_ensure_no_syntax_issue_if_any_control_char";

describe("cleanText: the gate for everything an AI writes", () => {
  it("rejects the exact junk string we saw", () => {
    expect(cleanText(JUNK, { max: 80 })).toBeUndefined();
    expect(cleanText("Wah, mahal banget! " + JUNK, { max: 200 })).toBeUndefined();
  });
  it("keeps normal Indonesian and English sentences untouched", () => {
    for (const ok of ["Wah, mahal banget! 170 ribu saja, boleh?", "That's almost double the usual fare. Offer 170k and settle around 200k.", "Maaf, bisa 215 ribu saja, Pak?", "How about Rp215,000?"])
      expect(cleanText(ok, { max: 200 })).toBe(ok);
  });
  it("strips control characters and zero-width marks", () => {
    expect(cleanText("Good\u0000 deal\u200b, go\u0007 for it\ufeff", { max: 80 })).toBe("Good deal, go for it");
    expect(cleanText("line one\nline two\t!", { max: 80 })).toBe("line one line two !");
  });
  it("strips a stray letter from another script, but not a sentence that is mostly another script", () => {
    expect(cleanText("Good price \u5047 for you", { max: 80 })).toBe("Good price for you");
    expect(cleanText("Harga ini wajar \u8fd9\u4e2a\u4ef7\u683c\u5f88\u5408\u7406", { max: 80 })).toBeUndefined(); // Chinese in an Indonesian answer
    expect(cleanText("\u041e\u0442\u043b\u0438\u0447\u043d\u0430\u044f \u0446\u0435\u043d\u0430", { max: 80 })).toBeUndefined(); // Cyrillic
    expect(cleanText("\u0647\u0630\u0627 \u0633\u0639\u0631 \u062c\u064a\u062f", { max: 80 })).toBeUndefined(); // Arabic
  });
  it("another trip language can allow its own script", () => {
    expect(cleanText("\u0e23\u0e32\u0e04\u0e32\u0e19\u0e35\u0e49\u0e41\u0e1e\u0e07", { max: 80, scripts: ["Latin", "Thai"] })).toBeDefined();
  });
  it("rejects code-like tokens and stub words", () => {
    for (const bad of ["use the snake_case_token here", "price is undefined", "price is null", "NaN ribu", "a `code` block", "{\"a\":1}", "<b>bold</b>", "x => y", "placeholder text", "Lorem ipsum dolor", "TODO fix this", "line\\nbreak", "valid json output"])
      expect(cleanText(bad, { max: 80 })).toBeUndefined();
  });
  it("enforces maximum lengths by rejecting, never by cutting a sentence in half", () => {
    expect(cleanText("a".repeat(200), { max: 200 })).toBeDefined();
    expect(cleanText("a".repeat(201), { max: 200 })).toBeUndefined();
    expect(cleanText("Maaf, bisa 215 ribu saja, Pak? " + "x".repeat(60), { max: 80 })).toBeUndefined();
    expect(cleanText("x", { max: 80 })).toBeUndefined(); // too short to be a sentence
    expect(cleanText(undefined, { max: 80 })).toBeUndefined();
    expect(cleanText(42, { max: 80 })).toBeUndefined();
  });
  it("oneSentence rejects two sentences", () => {
    expect(oneSentence("Time to walk away.", 100)).toBe("Time to walk away.");
    expect(oneSentence("That is too much. Walk away.", 100)).toBeUndefined();
  });
});

describe("junk from Gemini never reaches the tourist (advice step)", () => {
  const taxi: PriceItem = { id: "taxi-airport", city: "bali", category: "transport", name: "Taxi", min: 150000, max: 250000, currency: "IDR", tip: "x", bargain: "bargain" };
  const trip: Trip = { id: "t", city: "bali", currency: "IDR", homeCurrency: "GBP", rateToLocal: 21500, budgetHome: 600, start: "2026-10-24", end: "2026-10-30", inviteCode: "BAL-X", people: [{ id: "me", name: "R", isMe: true, status: "joined" }] };
  it("a junk phrase is replaced by the template phrase, and junk advice by the template advice", () => {
    const base = checkPrice(trip, taxi, 400000, "local");
    const out = applyAdvice(base, { advice: JUNK, plan: base.plan, phrase: { local: JUNK, english: "How about 150,000?" } });
    expect(out.advice).toBe(base.advice);
    expect(out.phrase!.local).toBe("Wah, mahal banget! 150 ribu saja, boleh?");
    expect(JSON.stringify(out)).not.toMatch(/placeholder|\u5047|_to_ensure/);
  });
  it("a too-long phrase or advice falls back too", () => {
    const base = checkPrice(trip, taxi, 400000, "local");
    const out = applyAdvice(base, { advice: "x".repeat(250), plan: base.plan, phrase: { local: "Wah, mahal banget! 150 ribu saja, boleh? " + "z".repeat(60), english: "ok" } });
    expect(out.advice).toBe(base.advice);
    expect(out.phrase).toEqual(base.phrase);
  });
  it("clean text still goes through", () => {
    const base = checkPrice(trip, taxi, 400000, "local");
    const out = applyAdvice(base, { advice: "Almost double the usual fare.", plan: base.plan, phrase: { local: "Wah, mahal! 150 ribu saja?", english: "Wow, too much! Just 150,000?" } });
    expect(out.advice).toBe("Almost double the usual fare.");
    expect(out.phrase).toMatchObject({ local: "Wah, mahal! 150 ribu saja?", english: "Wow, too much! Just 150,000?", lang: "id-ID" });
  });
  it("junk tips in a fixed-price place are dropped; fewer than two good ones means the template tips", () => {
    const base = checkPrice(trip, taxi, 400000, "local", { bargainMode: "fixed" });
    const out = applyAdvice(base, { advice: "Check the bill.", tips: [JUNK, "Ask for the menu first.", "tip_with_underscores"] });
    expect(out.tips).toEqual(base.tips);
    const good = applyAdvice(base, { advice: "Check the bill.", tips: [JUNK, "Ask for the menu first.", "Check service and tax."] });
    expect(good.tips).toEqual(["Ask for the menu first.", "Check service and tax."]);
  });
});
