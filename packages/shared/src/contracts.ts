/**
 * THE CONTRACT
 * ------------
 * Every piece of data that moves between Interface, Data and Voice/AI is defined here.
 * If you change this file, all three roles must approve the pull request (see .github/CODEOWNERS).
 * Add new optional fields freely. Never rename or remove a field without telling the team.
 */
import { z } from "zod";

/* ---------- basics ---------- */
export const Style = z.enum(["local", "mid", "fancy"]);
export type Style = z.infer<typeof Style>;

export const Category = z.enum(["transport", "food", "sim", "shopping"]);
export type Category = z.infer<typeof Category>;

export const Verdict = z.enum(["great", "fair", "high", "tooHigh"]);
export type Verdict = z.infer<typeof Verdict>;

/** A price reference row: what locals usually pay. Owned by the Data role. */
export const PriceItem = z.object({
  id: z.string(),
  city: z.string(),
  category: Category,
  name: z.string(),
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  currency: z.string(), // e.g. "MAD"
  tip: z.string(),
  source: z.string().optional(), // where the number came from
  checkedOn: z.string().optional(), // ISO date the number was last verified
});
export type PriceItem = z.infer<typeof PriceItem>;

/* ---------- people, trip, money (Data role) ---------- */
export const Person = z.object({
  id: z.string(),
  name: z.string(),
  isMe: z.boolean(),
  status: z.enum(["joined", "invited"]),
  email: z.string().email().optional(),
});
export type Person = z.infer<typeof Person>;

export const Trip = z.object({
  id: z.string(),
  city: z.string(),
  currency: z.string(), // local currency, e.g. "MAD"
  homeCurrency: z.string(), // e.g. "GBP"
  rateToLocal: z.number().positive(), // 1 home unit = this many local units
  budgetHome: z.number().nonnegative(), // the "me" budget in home currency
  start: z.string(), // ISO date
  end: z.string(), // ISO date
  people: z.array(Person).min(1),
  inviteCode: z.string(),
});
export type Trip = z.infer<typeof Trip>;

/** shares: personId -> amount in local currency. Must add up to `amount`. */
export const NewExpense = z
  .object({
    tripId: z.string(),
    item: z.string(),
    category: Category,
    amount: z.number().nonnegative(),
    paidBy: z.string(), // personId
    shares: z.record(z.string(), z.number().nonnegative()),
  })
  .refine((e) => Math.abs(Object.values(e.shares).reduce((a, b) => a + b, 0) - e.amount) < 1, {
    message: "shares must add up to amount",
    path: ["shares"],
  });
export type NewExpense = z.infer<typeof NewExpense>;

export const Expense = z.object({
  id: z.string(),
  tripId: z.string(),
  item: z.string(),
  category: Category,
  amount: z.number().nonnegative(),
  paidBy: z.string(),
  shares: z.record(z.string(), z.number().nonnegative()),
  createdAt: z.string(),
});
export type Expense = z.infer<typeof Expense>;

export const Summary = z.object({
  tripId: z.string(),
  currency: z.string(),
  budget: z.number(), // my budget in local currency
  mySpent: z.number(),
  myLeft: z.number(),
  dailyAllowance: z.number(),
  groupSpent: z.number(),
  byCategoryMine: z.record(Category, z.number()),
  byCategoryGroup: z.record(Category, z.number()),
  owes: z.array(z.object({ personId: z.string(), name: z.string(), amount: z.number() })),
});
export type Summary = z.infer<typeof Summary>;

/* ---------- understanding what the user said / typed / snapped (Voice & AI role) ---------- */
export const ParseRequest = z
  .object({
    city: z.string(),
    text: z.string().optional(), // typed text, or text from speech-to-text
    imageBase64: z.string().optional(), // photo of a price tag or menu
  })
  .refine((r) => !!r.text || !!r.imageBase64, { message: "send text or imageBase64" });
export type ParseRequest = z.infer<typeof ParseRequest>;

export const ParsedAsk = z.object({
  itemId: z.string(), // must match a PriceItem.id for this city
  amount: z.number().nonnegative(),
  currency: z.string(),
  style: Style,
  situation: z.string().optional(), // e.g. "at night", "tourist area"
  confidence: z.number().min(0).max(1),
});
export type ParsedAsk = z.infer<typeof ParsedAsk>;

export const SttResponse = z.object({ text: z.string() });
export type SttResponse = z.infer<typeof SttResponse>;

export const TtsRequest = z.object({
  text: z.string().min(1).max(300),
  lang: z.string(), // BCP-47, e.g. "ar-MA", "fr-FR"
});
export type TtsRequest = z.infer<typeof TtsRequest>;

/* ---------- the price check (the main feature) ---------- */
export const CheckRequest = z.object({
  tripId: z.string(),
  itemId: z.string(),
  amount: z.number().nonnegative(),
  style: Style,
});
export type CheckRequest = z.infer<typeof CheckRequest>;

export const CheckResult = z.object({
  verdict: Verdict,
  item: PriceItem,
  range: z.object({ min: z.number(), max: z.number() }),
  target: z.number(), // a fair price to aim for when bargaining
  currency: z.string(),
  budget: z.object({
    dailyAllowance: z.number(),
    myShareIfSplit: z.number(),
    pctOfDaily: z.number(),
  }),
  phrase: z.object({ local: z.string(), localLang: z.string(), french: z.string(), english: z.string() }),
});
export type CheckResult = z.infer<typeof CheckResult>;

/* ---------- health ---------- */
export const Health = z.object({
  ok: z.boolean(),
  modes: z.object({ data: z.string(), voice: z.string(), ai: z.string() }),
});
export type Health = z.infer<typeof Health>;
