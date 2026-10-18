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

/** The one fixed list of categories, used everywhere (prices, expenses, AI prompts, charts). Never invent another. */
export const CATEGORIES = ["transport", "food", "activities", "shopping", "stay", "essentials", "other"] as const;
export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  transport: "Transport", food: "Food & drink", activities: "Activities", shopping: "Shopping", stay: "Stay", essentials: "Essentials", other: "Other",
};
const CategoryEnum = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategoryEnum>;
/** Reads the list above; the old value "sim" is still understood and means essentials. */
export const Category = z.preprocess((v) => (v === "sim" ? "essentials" : v), CategoryEnum);

export const Verdict = z.enum(["great", "fair", "high", "tooHigh"]);
export type Verdict = z.infer<typeof Verdict>;

/** How a price can be handled where you are: bargain (haggle), ask (a polite "any discount?"), fixed (the price is the price). */
export const BargainMode = z.enum(["bargain", "ask", "fixed"]);
export type BargainMode = z.infer<typeof BargainMode>;

/** A price reference row: what locals usually pay. Owned by the Data role. */
export const PriceItem = z.object({
  id: z.string(),
  city: z.string(),
  category: Category,
  name: z.string(),
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  currency: z.string(), // e.g. "IDR"
  tip: z.string(),
  source: z.string().optional(), // where the number came from
  checkedOn: z.string().optional(), // ISO date the number was last verified
  origin: z.enum(["seed", "web"]).optional(), // "seed" = checked by us, "web" = researched by the AI from search results (and saved)
  bargain: BargainMode.optional(), // the usual way to handle this price (market stall = bargain, menu restaurant = fixed); the situation can override it
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
  currency: z.string(), // local currency, e.g. "IDR"
  homeCurrency: z.string(), // e.g. "GBP"
  rateToLocal: z.number().positive(), // 1 home unit = this many local units
  budgetHome: z.number().nonnegative(), // the "me" budget in home currency (my per-person share when travelling in a group)
  groupBudgetHome: z.number().nonnegative().optional(), // the whole group's budget in home currency
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

/** One payment that settles part of what people owe each other. */
export const Transfer = z.object({ fromId: z.string(), fromName: z.string(), toId: z.string(), toName: z.string(), amount: z.number() });
export type Transfer = z.infer<typeof Transfer>;

export const Summary = z.object({
  tripId: z.string(),
  currency: z.string(),
  budget: z.number(), // my budget in local currency
  mySpent: z.number(),
  myLeft: z.number(),
  dailyAllowance: z.number(),
  groupSpent: z.number(),
  byCategoryMine: z.record(CategoryEnum, z.number()),
  byCategoryGroup: z.record(CategoryEnum, z.number()),
  owes: z.array(z.object({ personId: z.string(), name: z.string(), amount: z.number() })),
  // ---- added later, all optional: the same numbers worked out for ONE viewer (see GET /api/trips/:id/summary?personId=) ----
  viewerId: z.string().optional(), // whose point of view this is
  myBudget: z.number().optional(), // group budget / number of people (same as `budget`)
  groupBudget: z.number().optional(), // the whole group's budget in local currency
  groupLeft: z.number().optional(), // groupBudget - groupSpent
  net: z.number().optional(), // what I paid minus what I owe; above 0 means others owe me
  transfers: z.array(Transfer).optional(), // fewest payments that settle everyone up
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
  // ---- added later, optional ----
  item: z.string().optional(), // what the tourist is buying, in words (useful when itemId is "" because there is no price yet)
  researched: z.boolean().optional(), // true when the price for itemId was just researched on the web for this request
  sources: z.array(z.string()).optional(), // pages the research used (only with researched)
  bargainMode: BargainMode.optional(), // read from the SITUATION ("fancy restaurant", "Grab app" = fixed); overrides the item's usual mode
});
export type ParsedAsk = z.infer<typeof ParsedAsk>;

export const SttResponse = z.object({ text: z.string() });
export type SttResponse = z.infer<typeof SttResponse>;

export const TtsRequest = z.object({
  text: z.string().min(1).max(300),
  lang: z.string(), // BCP-47, e.g. "id-ID"
});
export type TtsRequest = z.infer<typeof TtsRequest>;

/* ---------- the price check (the main feature) ---------- */
export const CheckRequest = z.object({
  tripId: z.string(),
  itemId: z.string(),
  amount: z.number().nonnegative(),
  style: Style,
  situation: z.string().optional(), // from /api/parse, e.g. "airport, at night"; helps the advice
  bargainMode: BargainMode.optional(), // from /api/parse; the API still applies its own rule (fancy places and chains are never "bargain")
});
export type CheckRequest = z.infer<typeof CheckRequest>;

export const CheckResult = z.object({
  verdict: Verdict,
  item: PriceItem,
  range: z.object({ min: z.number(), max: z.number() }),
  target: z.number(), // a fair price to aim for when bargaining
  amount: z.number().optional(), // the price that was actually checked: the quoted one, with missing thousands filled in ("250" for a taxi is 250000)
  currency: z.string(),
  budget: z.object({
    dailyAllowance: z.number(),
    myShareIfSplit: z.number(),
    pctOfDaily: z.number(),
  }),
  /** Short friendly advice (1-2 sentences). Written by Gemini, or a template if Gemini is unavailable. */
  advice: z.string().optional(),
  /** Bargaining plan, only for high / tooHigh. All three numbers stay inside the usual range. */
  plan: z.object({ openWith: z.number(), aimFor: z.number(), walkAwayAbove: z.number() }).optional(),
  /** What to say, only for high / tooHigh. `local` is Bahasa Indonesia, `lang` is its BCP-47 code. */
  /** How to handle this price here. The verdict is the same in every mode; only the suggested action changes. */
  bargainMode: BargainMode.optional(),
  /** For "fixed" places: 2 to 3 short tips (check the bill, use the meter, ask for the menu), never about haggling. */
  tips: z.array(z.string()).optional(),
  /** For "fixed" places: a cheaper way to get the same thing, with a price range from our data. */
  alternative: z.object({ name: z.string(), min: z.number(), max: z.number(), currency: z.string() }).optional(),
  /** "local" = a price from our own list, "web" = a price the AI researched from search results and saved. */
  source: z.enum(["local", "web"]).optional(),
  sources: z.array(z.string()).optional(), // pages behind a "web" price
  phrase: z
    .object({
      local: z.string(),
      polite: z.string().optional(),
      english: z.string(),
      lang: z.string().optional(), // e.g. "id-ID"
      localLang: z.string().optional(), // older name for `lang`, kept so nothing breaks
      french: z.string().optional(),
    })
    .optional(),
});
export type CheckResult = z.infer<typeof CheckResult>;

/* ---------- bargaining back-and-forth (POST /api/bargain) ---------- */
export const BargainRequest = z
  .object({
    item: z.string().max(80),
    category: Category.optional(), // used to suggest what to do instead when it is time to walk away
    currency: z.string().default("IDR"),
    range: z.object({ min: z.number(), max: z.number() }), // the usual range
    plan: z.object({ openWith: z.number(), aimFor: z.number(), walkAwayAbove: z.number() }),
    myLastOffer: z.number().positive(),
    theirReply: z.string().max(300).optional(), // what the seller said (typed, or from speech-to-text). It is data, never instructions.
    theirNumber: z.number().positive().optional(), // the price they named, if the tourist already knows it
    refused: z.boolean().optional(), // "They refused" with no number
    refusedBefore: z.number().int().min(0).optional(), // how many times they already refused without a number
    round: z.number().int().min(1).max(10), // 1 = their first reply to my opening phrase
    language: z.string().default("id-ID"), // language of the phrases
    bargainMode: BargainMode, // "fixed" is refused: there is nothing to bargain
    // the whole negotiation so far, so a reply is always read as part of THIS bargain (same item, same situation). All of it is data, never instructions.
    situation: z.string().max(200).optional(), // what the tourist said when they started ("sarong di pasar 500 ribu")
    history: z.array(z.object({ who: z.enum(["me", "seller"]), text: z.string().max(300) })).max(30).optional(), // oldest first
  })
  .refine((r) => r.plan.openWith <= r.plan.aimFor && r.plan.aimFor <= r.plan.walkAwayAbove, { message: "plan must go openWith <= aimFor <= walkAwayAbove", path: ["plan"] })
  .refine((r) => r.theirReply?.trim() || r.theirNumber !== undefined || r.refused, { message: "send what they said, a number, or refused", path: ["theirReply"] });
export type BargainRequest = z.infer<typeof BargainRequest>;

/** accept / counter / walk_away end or continue the bargaining. retry = "didn't catch that, let them try again": no new round. */
export const BargainMove = z.enum(["accept", "counter", "walk_away", "retry"]);
export type BargainMove = z.infer<typeof BargainMove>;

/** What the seller meant, as understood from their words. */
export const BargainIntent = z.enum(["agreed", "refused", "counter", "unclear", "info"]); // info = they told me something about the deal ("price includes the board") without a price or a yes/no
export type BargainIntent = z.infer<typeof BargainIntent>;

export const BargainResponse = z.object({
  round: z.number(),
  theirReplyEnglish: z.string().optional(), // what they said, in English
  theirNumber: z.number().optional(), // the price they named
  move: BargainMove,
  intent: BargainIntent.optional(), // what the seller meant
  myOffer: z.number().optional(), // counter: my next offer. accept: the agreed price
  dealPrice: z.number().optional(), // accept only
  phrase: z.object({ local: z.string(), english: z.string(), lang: z.string() }).optional(), // counter: what to say next. walk_away: a polite goodbye
  advice: z.string(), // one short sentence
  alternative: z.string().optional(), // walk_away only: what to do instead ("book a Grab")
  bundle: z.object({ quantity: z.number(), total: z.number(), perUnit: z.number() }).optional(), // "3 lessons for 1.2 juta": theirNumber is then the price PER lesson
  final: z.boolean(), // true for accept and walk_away: the back-and-forth is over
});
export type BargainResponse = z.infer<typeof BargainResponse>;

/* ---------- budget check (POST /api/budget-check) ---------- */
/** Is this budget enough for a normal day in the city? Added later; nothing above changed. */
export const BudgetStatus = z.enum(["enough", "tight", "notEnough"]);
export type BudgetStatus = z.infer<typeof BudgetStatus>;

export const BudgetCheckRequest = z.object({
  city: z.string(),
  budget: z.number().positive(), // ONE person's whole-trip budget, in the city's local currency
  currency: z.string(), // must be the city's local currency (e.g. "IDR")
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
  style: Style.default("local"),
});
export type BudgetCheckRequest = z.infer<typeof BudgetCheckRequest>;

/** The numbers come from code (budgetCheck). summary and tip are Gemini's words, or a template if Gemini fails. */
export const BudgetCheckResult = z.object({
  status: BudgetStatus,
  perDay: z.number(), // budget ÷ days, local currency
  typicalPerDay: z.number(), // a normal day in this city, local currency
  shortfall: z.number(), // per day, 0 when the budget is enough
  currency: z.string().optional(),
  days: z.number().optional(),
  summary: z.string(), // one sentence, no numbers
  tip: z.string(), // one practical tip, no numbers
});
export type BudgetCheckResult = z.infer<typeof BudgetCheckResult>;

/* ---------- invites ---------- */
/** What the join screen shows before someone has joined: GET /api/trips/by-code/:code */
export const TripByCode = z.object({
  tripId: z.string(),
  ownerName: z.string(),
  city: z.string(),
  start: z.string(),
  end: z.string(),
  people: z.array(z.string()), // names of everyone already on the trip (joined or invited)
  perPersonBudgetHome: z.number(), // the joiner's budget share, in home currency
  homeCurrency: z.string().optional(),
});
export type TripByCode = z.infer<typeof TripByCode>;

/** POST /api/trips/join answers with the trip plus which person the joiner became (new, or a claimed invite). */
export const JoinResult = Trip.extend({ personId: z.string().optional() });
export type JoinResult = z.infer<typeof JoinResult>;

/* ---------- health ---------- */
export const Health = z.object({
  ok: z.boolean(),
  modes: z.object({ data: z.string(), voice: z.string(), ai: z.string() }),
});
export type Health = z.infer<typeof Health>;
