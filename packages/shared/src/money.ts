/** Reading prices people type or say: "400000", "400k", "400 ribu", "1,5 juta", "Rp 400.000". Used by the API and the page. */

// A number followed by one of these is a count, a time or a size, never a price: "3 friends", "3am", "1.5L".
const NOT_A_PRICE = /^(people|person|persons|friends?|pax|guests?|days?|nights?|km|hours?|hrs?|hr|am|pm|l|ml|kg)$/i;
const MULTIPLIER: Record<string, number> = { k: 1e3, rb: 1e3, ribu: 1e3, jt: 1e6, juta: 1e6 };

/** "400.000" and "400,000" are 400000 (a dot or comma followed by exactly 3 digits is thousands); "1.5k", "1,5 juta" are decimals. */
function numberValue(raw: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  return Number(raw.replace(",", "."));
}

/**
 * The price in a sentence. Counts, times and sizes are skipped; a number marked as money
 * (k / rb / ribu / jt / juta / Rp / IDR) wins; otherwise the largest remaining number, not just the last one.
 */
export function lastAmount(text: string): number | null {
  const marked: number[] = [], plain: number[] = [];
  for (const m of text.matchAll(/(rp\.?\s*|idr\s*)?(\d+(?:[.,]\d+)*)(?:\s*([a-z]+))?/gi)) {
    const word = m[3]?.toLowerCase();
    if (word && NOT_A_PRICE.test(word)) continue;
    const factor = word ? MULTIPLIER[word] : undefined;
    const value = numberValue(m[2]) * (factor ?? 1);
    if (!Number.isFinite(value)) continue;
    (m[1] || factor ? marked : plain).push(value);
  }
  const pool = marked.length ? marked : plain;
  return pool.length ? Math.max(...pool) : null;
}

