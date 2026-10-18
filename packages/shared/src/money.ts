/** Reading prices people type or say: "400000", "400k", "400 ribu", "1,5 juta", "Rp 400.000". Used by the API and the page. */

// A number followed by one of these is a count, a time or a size, never a price: "3 friends", "3am", "1.5L".
const NOT_A_PRICE = /^(people|person|persons|friends?|pax|guests?|days?|nights?|km|hours?|hrs?|hr|am|pm|l|ml|kg)$/i;
const MULTIPLIER: Record<string, number> = { k: 1e3, rb: 1e3, ribu: 1e3, thousand: 1e3, jt: 1e6, juta: 1e6, million: 1e6 };

/** "400.000" and "400,000" are 400000 (a dot or comma followed by exactly 3 digits is thousands); "1.5k", "1,5 juta" are decimals. */
function numberValue(raw: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  return Number(raw.replace(",", "."));
}

// ---- number words: "four hundred", "four hundred thousand", "empat ratus ribu", "lima puluh ribu" ----
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11,
};
const BIG: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, ratus: 100, ribu: 1e3, juta: 1e6, seratus: 100, seribu: 1e3, sejuta: 1e6 };
/** Every word that can be part of a spoken number (also used to tidy an item name). */
export const NUMBER_WORDS = new Set([...Object.keys(UNITS), ...Object.keys(BIG), "puluh", "belas", "and", "dan"]);
const WORD = [...Object.keys(UNITS), ...Object.keys(BIG), "puluh", "belas"].sort((a, b) => b.length - a.length).join("|");
// a run starts with a digit word (never with "ribu" alone, so "400 ribu" stays a digit + unit) and may continue with any number word
const START = `(?:a(?=[\\s-]+(?:hundred|thousand|million)\\b)|${Object.keys(UNITS).concat(["seratus", "seribu", "sejuta"]).sort((a, b) => b.length - a.length).join("|")})`;
const RUN = new RegExp(`\\b${START}(?:[\\s-]+(?:(?:and|dan)[\\s-]+)?(?:${WORD}))*\\b`, "gi");

function wordsValue(run: string): number {
  let total = 0, cur = 0, last = 0; // last = the digit just added, so "seratus lima puluh" is 100 + 5 x 10, not (100 + 5) x 10
  for (const w of run.toLowerCase().split(/[\s-]+/)) {
    if (w === "and" || w === "dan" || w === "a") continue;
    if (w === "puluh") { cur += (last || 1) * 9; last = 0; } // "lima puluh": the 5 already in cur becomes 50
    else if (w === "belas") cur += 10;
    else if (w in BIG) {
      const mult = BIG[w];
      last = 0;
      if (mult === 100) cur = (cur || 1) * 100;
      else { total += (cur || 1) * mult; cur = 0; }
    } else { last = UNITS[w] ?? 0; cur += last; }
  }
  return total + cur;
}

/** "I paid four hundred thousand" -> "I paid 400000". Digits and everything else stay as they are. */
export function numberWordsToDigits(text: string): string {
  return text.replace(RUN, (run) => ` ${wordsValue(run)} `);
}

function readAmount(text: string): { value: number; marked: boolean } | null {
  const marked: number[] = [], plain: number[] = [];
  for (const m of numberWordsToDigits(text).matchAll(/(rp\.?\s*|idr\s*)?(\d+(?:[.,]\d+)*)(?:\s*([a-z]+))?/gi)) {
    const word = m[3]?.toLowerCase();
    if (word && NOT_A_PRICE.test(word)) continue;
    const factor = word ? MULTIPLIER[word] : undefined;
    const value = numberValue(m[2]) * (factor ?? 1);
    if (!Number.isFinite(value)) continue;
    (m[1] || factor ? marked : plain).push(value);
  }
  const pool = marked.length ? marked : plain;
  return pool.length ? { value: Math.max(...pool), marked: marked.length > 0 } : null;
}

/**
 * The price in a sentence. Counts, times and sizes are skipped; a number marked as money
 * (k / rb / ribu / jt / juta / Rp / IDR) wins; otherwise the largest remaining number, not just the last one.
 * Number words count too ("four hundred thousand", "empat ratus ribu").
 */
export function lastAmount(text: string): number | null {
  return readAmount(text)?.value ?? null;
}

/**
 * Like lastAmount, plus the way people really say rupiah: a bare number under 1,000 means thousands
 * ("tea 15" or "four hundred" is Rp15,000 / Rp400,000, nothing costs under Rp1,000). A marked amount ("Rp 400") stays as written.
 */
export function rupiahAmount(text: string): number | null {
  const r = readAmount(text);
  return r ? (!r.marked && r.value > 0 && r.value < 1000 ? r.value * 1000 : r.value) : null;
}
