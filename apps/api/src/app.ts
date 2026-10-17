import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { CheckRequest, NewExpense, ParseRequest, TtsRequest, Trip, applyAdvice, checkPrice, summarise } from "@fairfare/shared";
import type { AdviceWriter, AskParser, DataStore, VoiceService } from "./ports";
import { ParseError } from "./ai/mock";

export type Deps = { data: DataStore; voice: VoiceService; ai: AskParser; advisor?: AdviceWriter; modes: { data: string; voice: string; ai: string } };

/** wraps async route handlers so errors reach the error handler */
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

export function createApp({ data, voice, ai, advisor, modes }: Deps) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" })); // photos arrive as base64

  app.get("/api/health", (_req, res) => res.json({ ok: true, modes }));

  /* ----- prices (Data) ----- */
  app.get("/api/prices", h(async (req, res) => res.json(await data.listPrices(String(req.query.city ?? "bali")))));

  /* ----- trips, expenses, summary (Data) ----- */
  app.post("/api/trips", h(async (req, res) => {
    const body = Trip.omit({ id: true, inviteCode: true }).parse(req.body);
    res.status(201).json(await data.createTrip(body));
  }));
  app.get("/api/trips/:id", h(async (req, res) => {
    const trip = await data.getTrip(req.params.id);
    trip ? res.json(trip) : res.status(404).json({ error: "Trip not found" });
  }));
  app.post("/api/trips/join", h(async (req, res) => {
    const { code, name, email } = req.body ?? {};
    if (!code || !name) return res.status(400).json({ error: "Send code and name" });
    const trip = await data.joinTrip(code, name, email);
    trip ? res.json(trip) : res.status(404).json({ error: "That invite link doesn't exist" });
  }));
  app.get("/api/trips/:id/expenses", h(async (req, res) => res.json(await data.listExpenses(req.params.id))));
  app.post("/api/trips/:id/expenses", h(async (req, res) => {
    const body = NewExpense.parse({ ...req.body, tripId: req.params.id });
    res.status(201).json(await data.addExpense(body));
  }));
  app.get("/api/trips/:id/summary", h(async (req, res) => {
    const trip = await data.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(summarise(trip, await data.listExpenses(trip.id)));
  }));

  /* ----- understanding the ask (AI) ----- */
  app.post("/api/parse", h(async (req, res) => {
    const body = ParseRequest.parse(req.body);
    res.json(await ai.parse(body, await data.listPrices(body.city)));
  }));

  /* ----- the main feature ----- */
  app.post("/api/check", h(async (req, res) => {
    const body = CheckRequest.parse(req.body);
    const trip = await data.getTrip(body.tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const item = await data.getPrice(trip.city, body.itemId);
    if (!item) return res.status(404).json({ error: "We don't have a price for that item yet" });
    // the numbers and the verdict come from checkPrice; Gemini only explains them, and a template stands in if it fails
    const result = checkPrice(trip, item, body.amount, body.style);
    if (!advisor) return res.json(result);
    try {
      res.json(applyAdvice(result, await advisor.advise(result, { city: trip.city, amount: body.amount, style: body.style, situation: body.situation })));
    } catch (err) {
      console.warn("[fallback] advice failed, using template:", (err as Error).message);
      res.json(result);
    }
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
