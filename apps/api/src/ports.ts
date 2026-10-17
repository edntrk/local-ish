/**
 * PORTS = the plugs between roles.
 * Each role builds ONE class that implements its port. The API only talks to these
 * interfaces, so swapping mock -> real never breaks anyone else's code.
 */
import type { AdviceDraft, CheckResult, Expense, NewExpense, ParsedAsk, ParseRequest, PriceItem, Trip } from "@fairfare/shared";


/** DATA role (Tiger Data / PostgreSQL) */
export interface DataStore {
  listPrices(city: string): Promise<PriceItem[]>;
  getPrice(city: string, itemId: string): Promise<PriceItem | null>;
  /**
   * Saves a researched price. If the slug already exists nothing is duplicated: a "seed" row is never overwritten,
   * and a "web" row is refreshed only when it is more than 30 days old. Returns the row that is now stored.
   */
  addPriceItem(item: PriceItem): Promise<PriceItem>;
  /** Optional: runs safe, repeatable setup (like adding a column) when the server starts. */
  init?(): Promise<void>;
  /** `inviteCode` may be one handed out earlier by reserveInviteCode (so the link can be shown before the trip exists). */
  createTrip(trip: Omit<Trip, "id" | "inviteCode"> & { inviteCode?: string }): Promise<Trip>;
  /** A fresh invite code nobody else has. Used when the invite link is shown while the creator is still setting up. */
  reserveInviteCode(): Promise<string>;
  /** Optional: true for a code that was handed out but whose trip isn't created yet (lets the join screen say "still setting up"). */
  isInviteReserved?(inviteCode: string): Promise<boolean>;
  getTrip(tripId: string): Promise<Trip | null>;
  getTripByCode(inviteCode: string): Promise<Trip | null>;
  /** Joins by invite code. If an "invited" person has the same name (any capitals) they are claimed, not duplicated. */
  joinTrip(inviteCode: string, name: string, email?: string): Promise<Trip | null>;
  listExpenses(tripId: string): Promise<Expense[]>;
  addExpense(expense: NewExpense): Promise<Expense>;
}

/** VOICE role (ElevenLabs) */
export interface VoiceService {
  speechToText(audio: Buffer, mimeType: string): Promise<string>;
  /** returns audio bytes (mp3) */
  textToSpeech(text: string, lang: string): Promise<{ audio: Buffer; mimeType: string }>;
}

/** AI role (Gemini): turn typed text, spoken text or a photo into a structured ask */
export interface AskParser {
  parse(req: ParseRequest, prices: PriceItem[]): Promise<ParsedAsk>;
}

/** AI role (Gemini): explain a price check that was already worked out. It never changes the numbers or the verdict. */
export interface AdviceWriter {
  advise(result: CheckResult, context: { city: string; amount: number; style: string; situation?: string }): Promise<AdviceDraft>;
}

/** What the researcher found for ONE item, before our own sanity checks. */
export type ResearchedPrice = {
  id: string; name: string; category: string; min: number; max: number; currency: string; tip: string; sources: string[]; bargain?: string;
};

/** AI role (Gemini + Google Search): finds the typical local price range for an item we don't have yet. It is never told what the tourist was quoted. */
export interface PriceResearcher {
  research(q: { city: string; item: string; category?: string; area?: string }): Promise<ResearchedPrice>;
}

/** Researches an unknown item, checks the answer, saves it, and returns it. Returns null when there is nothing safe to use. */
export type LearnResult = { item: PriceItem; sources: string[]; researched: boolean };
export interface PriceLearner {
  learn(q: { city: string; item: string; category?: string; area?: string; slug?: string }): Promise<LearnResult | null>;
}
