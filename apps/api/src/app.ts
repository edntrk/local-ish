import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { ZodError, z } from "zod";
import { BargainRequest, CheckRequest, NewExpense, ParseRequest, TtsRequest, Trip, applyAdvice, budgetLocal, checkPrice, cheaperAlternative, decideBargain, summarise } from "@fairfare/shared";
import type { AdviceWriter, AskParser, BargainCoach, DataStore, PriceLearner, VoiceService } from "./ports";
import { ParseError } from "./ai/mock";
import { UnknownItemError } from "./ai/gemini";
import { isStale } from "./ai/learn";

export type Deps = { data: DataStore; voice: VoiceService; ai: AskParser; advisor?: AdviceWriter; learner?: PriceLearner; coach?: BargainCoach; modes: { data: string; voice: string; ai: string } };

const INVITE_ERROR = "This invite link doesn't work. Ask your friend for a new one.";

/** wraps async route handlers so errors reach the error handler */
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

export function createApp({ data, voice, ai, advisor, learner, coach, modes }: Deps) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" })); // photos arrive as base64

  app.get("/api/health", (_req, res) => res.json({ ok: true, modes }));

  /* ----- prices (Data) ----- */
  app.get("/api/prices", h(async (req, res) => res.json(await data.listPrices(String(req.query.city ?? "bali")))));

  /* ----- trips, expenses, summary (Data) ----- */
  app.post("/api/trips", h(async (req, res) => {
    const body = Trip.omit({ id: true, inviteCode: true }).extend({ inviteCode: z.string().regex(/^[A-Za-z0-9-]{4,20}$/).optional() }).parse(req.body);
    // person ids are always made here, never taken from the client (names or "me" would clash between trips)
    res.status(201).json(await data.createTrip({ ...body, people: body.people.map((p) => ({ ...p, id: randomUUID() })) }));
  }));
  app.post("/api/invite-codes", h(async (_req, res) => res.status(201).json({ code: await data.reserveInviteCode() })));
  app.get("/api/trips/by-code/:code", h(async (req, res) => {
    const trip = await data.getTripByCode(req.params.code);
    if (!trip && (await data.isInviteReserved?.(req.params.code)))
      return res.status(404).json({ error: "Your friend is still setting up this trip. Try again in a minute." });
    if (!trip) return res.status(404).json({ error: INVITE_ERROR });
    const owner = trip.people.find((p) => p.isMe) ?? trip.people[0];
    res.json({
      tripId: trip.id, ownerName: owner.name, city: trip.city, start: trip.start, end: trip.end,
      people: trip.people.map((p) => p.name),
      perPersonBudgetHome: Math.round((budgetLocal(trip) / trip.rateToLocal) * 100) / 100,
      homeCurrency: trip.homeCurrency,
    });
  }));
  app.get("/api/trips/:id", h(async (req, res) => {
    const trip = await data.getTrip(req.params.id);
    trip ? res.json(trip) : res.status(404).json({ error: "Trip not found" });
  }));
  app.post("/api/trips/join", h(async (req, res) => {
    const { code, name, email } = req.body ?? {};
    if (!code || !String(name ?? "").trim()) return res.status(400).json({ error: "Type your name to join." });
    const before = await data.getTripByCode(String(code));
    // copy the statuses first: a store may hand back the same object it then changes
    const was = new Map((before?.people ?? []).map((p) => [p.id, p.status]));
    const trip = before && (await data.joinTrip(String(code), String(name).trim(), email));
    if (!before || !trip) return res.status(404).json({ error: INVITE_ERROR });
    // who did the joiner become? a brand-new person, or the invited person they claimed
    const me = trip.people.find((p) => !was.has(p.id)) ?? trip.people.find((p) => was.get(p.id) === "invited" && p.status === "joined");
    res.json({ ...trip, personId: me?.id });
  }));
  app.get("/api/trips/:id/expenses", h(async (req, res) => res.json(await data.listExpenses(req.params.id))));
  app.post("/api/trips/:id/expenses", h(async (req, res) => {
    const body = NewExpense.parse({ ...req.body, tripId: req.params.id });
    const trip = await data.getTrip(body.tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const ids = new Set(trip.people.map((p) => p.id));
    if (!ids.has(body.paidBy) || Object.keys(body.shares).some((id) => !ids.has(id)))
      return res.status(400).json({ error: "Someone in this split isn't on the trip." });
    res.status(201).json(await data.addExpense(body));
  }));
  app.get("/api/trips/:id/summary", h(async (req, res) => {
    const trip = await data.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const personId = typeof req.query.personId === "string" && req.query.personId ? req.query.personId : undefined;
    if (personId && !trip.people.some((p) => p.id === personId)) return res.status(404).json({ error: "That person isn't on this trip." });
    res.json(summarise(trip, await data.listExpenses(trip.id), personId)); // no personId = the trip creator, as before
  }));

  /* ----- understanding the ask (AI) ----- */
  app.post("/api/parse", h(async (req, res) => {
    const body = ParseRequest.parse(req.body);
    const prices = await data.listPrices(body.city);
    let ask;
    try {
      ask = await ai.parse(body, prices);
    } catch (err) {
      if (!(err instanceof UnknownItemError)) throw err;
      // Gemini knows what it is and what was quoted, but we have no price yet: research it (at most once per request)
      const learned = learner ? await learner.learn({ city: body.city, item: err.item, category: err.category, area: err.ask.situation }) : null;
      if (!learned) {
        // nothing safe to use: the Interface shows "We don't have local prices for that yet" and Pay still works
        return res.json({ ...err.ask, itemId: "", item: err.item, researched: false });
      }
      return res.json({ ...err.ask, itemId: learned.item.id, item: learned.item.name, researched: learned.researched, sources: learned.sources });
    }
    // a researched price older than 30 days is looked up again (a failed refresh keeps the old numbers)
    const known = prices.find((p) => p.id === ask.itemId);
    if (learner && known?.origin === "web" && isStale(known.checkedOn)) {
      const again = await learner.learn({ city: body.city, item: known.name, slug: known.id });
      return res.json({ ...ask, researched: !!again?.researched, ...(again?.researched ? { sources: again.sources } : {}) });
    }
    res.json(ask);
  }));

  /* ----- the main feature ----- */
  app.post("/api/check", h(async (req, res) => {
    const body = CheckRequest.parse(req.body);
    const trip = await data.getTrip(body.tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const item = await data.getPrice(trip.city, body.itemId);
    if (!item) return res.status(404).json({ error: "We don't have a price for that item yet" });
    // the numbers and the verdict come from checkPrice; Gemini only explains them, and a template stands in if it fails
    // the mode is decided in code: the item's usual mode, the situation can change it, fancy places and chains are never "bargain"
    const alternative = cheaperAlternative(item, body.style, await data.listPrices(trip.city));
    const result = checkPrice(trip, item, body.amount, body.style, { bargainMode: body.bargainMode, situation: body.situation, alternative });
    if (!advisor) return res.json(result);
    try {
      res.json(applyAdvice(result, await advisor.advise(result, { city: trip.city, amount: body.amount, style: body.style, situation: body.situation })));
    } catch (err) {
      console.warn("[fallback] advice failed, using template:", (err as Error).message);
      res.json(result);
    }
  }));

  /* ----- bargaining back-and-forth ----- */
  app.post("/api/bargain", h(async (req, res) => {
    const body = BargainRequest.parse(req.body);
    // nothing to bargain in a fixed-price place
    if (body.bargainMode === "fixed") return res.status(400).json({ error: "This is a fixed-price place, so there's nothing to bargain." });
    // Gemini reads the reply; if it fails, the same rules still answer (halfway between my last offer and their number)
    let draft;
    try { draft = coach ? await coach.coach(body) : undefined; }
    catch (err) { console.warn(`[bargain] gemini failed: ${(err as Error).message}`); }
    res.json(decideBargain(body, draft));
  }));

  /* ----- voice ----- */
  app.post("/api/voice/stt", express.raw({ type: "audio/*", limit: "10mb" }), h(async (req, res) => {
    const text = await voice.speechToText(req.body as Buffer, req.get("content-type") ?? "audio/webm");
    res.json({ text });
  }));
  app.post("/api/voice/tts", h(async (req, res) => {
    const body = TtsRequest.parse(req.body);
    const out = await voice.textToSpeech(body.text, body.lang);
    if (!out.audio.length) return res.set("x-fairfare-mock", "1").status(204).end(); // Interface: use the phone's voice
    res.set("content-type", out.mimeType).send(out.audio);
  }));

  /* ----- errors: always plain JSON the Interface can show ----- */
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: "Some details are missing or wrong", details: err.issues });
    if (err instanceof ParseError) return res.status(422).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side. Try again." });
  });
  return app;
}
