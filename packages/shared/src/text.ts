/**
 * Cleaning and checking every sentence an AI writes before a tourist sees it.
 * One strict gate: whatever fails is dropped and the template text for that field is used instead.
 */

// control characters, zero-width and bidi marks, line/paragraph separators, the BOM
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;
// words that mean the model leaked a template, a stub or code
const BANNED = /placeholder|undefined|\bnull\b|\bnan\b|lorem|\btodo\b|syntax|control.?char|as an ai|\bjson\b/i;
// code-like tokens: snake_case words, backticks, braces, brackets, tags, arrows, escaped characters
const CODEY = /\b\w+_\w+\b|`|[{}[\]<>]|=>|\\[nrtu]/;

/** Is this letter written in a script the trip uses? Trip language Indonesian + English = Latin. Other trips can pass more scripts. */
const scriptTests = (scripts: string[]) => scripts.map((s) => new RegExp(`\\p{Script=${s}}`, "u"));

export type CleanOptions = { max: number; scripts?: string[] };

/**
 * Returns the cleaned sentence, or undefined if it can't be trusted.
 * - control characters are stripped; a stray letter from another script (like one Chinese character) is stripped too
 * - rejected: mostly foreign script, code-like tokens, words like "placeholder" or "undefined", too short, too long
 * - a text that is too long is rejected, never cut off in the middle of a sentence
 */
export function cleanText(raw: unknown, { max, scripts = ["Latin"] }: CleanOptions): string | undefined {
  if (typeof raw !== "string") return undefined;
  const tests = scriptTests(scripts);
  const withoutControl = raw.replace(/[\n\r\t]+/g, " ").replace(CONTROL, ""); // a line break or tab is a space, not a glue between words
  const kept = [...withoutControl].filter((ch) => !(/\p{L}/u.test(ch) && !tests.some((t) => t.test(ch))));
  const stripped = withoutControl.length - kept.join("").length;
  const text = kept.join("").replace(/\s+/g, " ").trim();
  if (stripped > Math.max(3, text.length * 0.2)) return undefined; // mostly the wrong script: not a sentence we can use
  if (BANNED.test(text) || CODEY.test(text)) return undefined;
  if (text.length < 2 || text.length > max) return undefined;
  return text;
}

/** The same cleaning for text that has to stay one sentence (a walk-away message). */
export function oneSentence(raw: unknown, max: number): string | undefined {
  const text = cleanText(raw, { max });
  if (!text) return undefined;
  const body = text.replace(/[.!?…]+$/, "");
  return /[.!?…]\s/.test(body) ? undefined : text; // a full stop in the middle means more than one sentence
}
