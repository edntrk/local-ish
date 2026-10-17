/**
 * INTERFACE role: the ONLY place the app talks to the backend.
 * Every function is typed from the shared contract, so if the contract changes, TypeScript tells you what broke.
 */
import type { CheckRequest, CheckResult, Expense, Health, NewExpense, ParsedAsk, ParseRequest, PriceItem, Summary, Trip } from "@fairfare/shared";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch("/api" + path, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
const post = <T>(path: string, body: unknown) => req<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => req<Health>("/health"),
  prices: (city = "marrakech") => req<PriceItem[]>(`/prices?city=${encodeURIComponent(city)}`),

  createTrip: (t: Omit<Trip, "id" | "inviteCode">) => post<Trip>("/trips", t),
  getTrip: (id: string) => req<Trip>(`/trips/${id}`),
  joinTrip: (code: string, name: string, email?: string) => post<Trip>("/trips/join", { code, name, email }),

  parse: (r: ParseRequest) => post<ParsedAsk>("/parse", r),
  check: (r: CheckRequest) => post<CheckResult>("/check", r),

  addExpense: (tripId: string, e: Omit<NewExpense, "tripId">) => post<Expense>(`/trips/${tripId}/expenses`, e),
  expenses: (tripId: string) => req<Expense[]>(`/trips/${tripId}/expenses`),
  summary: (tripId: string) => req<Summary>(`/trips/${tripId}/summary`),

  /** returns text heard in the recording */
  speechToText: async (audio: Blob) => {
    const res = await fetch("/api/voice/stt", { method: "POST", headers: { "content-type": audio.type || "audio/webm" }, body: audio });
    if (!res.ok) throw new Error("Couldn't hear that. Try again or type it.");
    return ((await res.json()) as { text: string }).text;
  },

  /** plays the phrase: ElevenLabs if it's on, otherwise the phone's own voice */
  speak: async (text: string, lang: string) => {
    const res = await fetch("/api/voice/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, lang }) });
    if (res.status === 200) {
      const url = URL.createObjectURL(await res.blob());
      await new Audio(url).play();
      return;
    }
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.85;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  },
};
