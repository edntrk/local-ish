/**
 * Missing thousands. People say "seratus tujuh puluh" or "170" and mean 170,000 rupiah.
 * The usual price range of the item and the offers already made in this bargain tell us which scale is meant.
 */

type Range = { min: number; max: number };

/**
 * A number under 1,000 is read as thousands when that is the only plausible reading:
 * the plain number is far below what this item costs (under a fifth of the usual minimum, and x 1,000 is not absurd: over 20x the usual maximum),
 * or the number x 1,000 sits next to an offer already made in this bargain. Never touches 1,000 or more.
 */
export function inferThousands(value: number, ctx: { range: Range; anchors?: number[] }): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1000) return value;
  const scaled = value * 1000;
  const nearAnOffer = (ctx.anchors ?? []).some((a) => a > 0 && scaled >= a * 0.3 && scaled <= a * 3);
  const farBelowUsual = value < ctx.range.min * 0.2;
  const notAbsurd = scaled <= ctx.range.max * 20;
  return nearAnOffer || (farBelowUsual && notAbsurd) ? scaled : value; // next to an offer we already made, it is surely thousands
}

/** A price this far below the usual range (under 1% of its minimum) is a typo or a missing scale, never a "great deal". */
export const isImplausiblyLow = (amount: number, range: Range): boolean => amount < range.min * 0.01;
