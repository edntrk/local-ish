import { describe, expect, it } from "vitest";
import { lastAmount, numberWordsToDigits, rupiahAmount } from "./money";

describe("reading a price", () => {
  it("commas and dots as thousands", () => {
    expect(lastAmount("hotel 1.234.567")).toBe(1234567);
    expect(lastAmount("Hotel is 400,000")).toBe(400000);
    expect(lastAmount("Hotel is 400.000")).toBe(400000);
  });
  it("k, rb, ribu and juta", () => {
    expect(lastAmount("hotel 400k")).toBe(400000);
    expect(lastAmount("hotel 400 ribu")).toBe(400000);
    expect(lastAmount("hotel 400rb")).toBe(400000);
    expect(lastAmount("villa 1,5 juta")).toBe(1500000);
  });
  it("number words in English", () => {
    expect(lastAmount("four hundred thousand")).toBe(400000);
    expect(lastAmount("two hundred and fifty thousand")).toBe(250000);
    expect(lastAmount("twenty-five thousand")).toBe(25000);
    expect(lastAmount("a hundred thousand")).toBe(100000);
    expect(lastAmount("two million")).toBe(2000000);
    expect(lastAmount("four hundred")).toBe(400);
  });
  it("number words in Bahasa Indonesia", () => {
    expect(lastAmount("empat ratus ribu")).toBe(400000);
    expect(lastAmount("lima puluh ribu")).toBe(50000);
    expect(lastAmount("seratus lima puluh ribu")).toBe(150000);
    expect(lastAmount("dua belas ribu")).toBe(12000);
    expect(lastAmount("dua juta")).toBe(2000000);
  });
  it("a unit after digits is not read as a number word", () => {
    expect(numberWordsToDigits("400 ribu")).toBe("400 ribu");
    expect(lastAmount("I paid 400 ribu for 2 nights")).toBe(400000);
    expect(lastAmount("one night, 400k")).toBe(400000); // the marked amount beats the plain "one"
    expect(lastAmount("two nights")).toBeNull(); // counts are not prices
  });
  it("a bare amount under 1,000 means thousands of rupiah, but a marked one stays", () => {
    expect(rupiahAmount("The hotel was four hundred")).toBe(400000);
    expect(rupiahAmount("tea 15")).toBe(15000);
    expect(rupiahAmount("Rp 400")).toBe(400);
    expect(rupiahAmount("hotel 400,000")).toBe(400000);
    expect(rupiahAmount("hello")).toBeNull();
  });
});
