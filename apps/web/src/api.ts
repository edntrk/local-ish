/**
 * INTERFACE role: the ONLY place the app talks to the backend.
 * Every function is typed from the shared contract, so if the contract changes, TypeScript tells you what broke.
 */
import type { CheckRequest, CheckResult, Expense, Health, JoinResult, NewExpense, ParsedAsk, ParseRequest, PriceItem, Summary, Trip, TripByCode } from "@fairfare/shared";

const OFFLINE = "Can't reach the server. Check your connection and try again.";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + path, { headers: { "content-type": "application/json" }, ...init });
  } catch {
    throw new Error(OFFLINE); // a plain sentence instead of "Failed to fetch"
  }
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

  /** an invite code before the trip exists, so the invite link can show during setup */
  reserveInviteCode: () => post<{ code: string }>("/invite-codes", {}),
  createTrip: (t: Omit<Trip, "id" | "inviteCode"> & { inviteCode?: string }) => post<Trip>("/trips", t),
  getTrip: (id: string) => req<Trip>(`/trips/${id}`),
  /** what the join screen shows before anyone has joined */
  tripByCode: (code: string) => req<TripByCode>(`/trips/by-code/${encodeURIComponent(code)}`),
  /** joins by invite code; `personId` is who you became (a new person, or the invited person you claimed) */
  joinTrip: (code: string, name: string, email?: string) => post<JoinResult>("/trips/join", { code, name, email }),

  parse: (r: ParseRequest) => post<ParsedAsk>("/parse", r),
  check: (r: CheckRequest) => post<CheckResult>("/check", r),

  addExpense: (tripId: string, e: Omit<NewExpense, "tripId">) => post<Expense>(`/trips/${tripId}/expenses`, e),
  expenses: (tripId: string) => req<Expense[]>(`/trips/${tripId}/expenses`),
  /** everything worked out from one person's point of view; no personId = the trip creator */
  summary: (tripId: string, personId?: string) => req<Summary>(`/trips/${tripId}/summary${personId ? `?personId=${encodeURIComponent(personId)}` : ""}`),

  /** returns text heard in the recording */
  speechToText: async (audio: Blob) => {
    // "audio/webm;codecs=opus" -> "audio/webm": the server only wants the plain type
    const type = (audio.type || "audio/webm").split(";")[0].trim();
    const res = await fetch("/api/voice/stt", { method: "POST", headers: { "content-type": type }, body: audio });
    if (!res.ok) throw new Error("Couldn't hear that. Try again or type it.");
    return ((await res.json()) as { text: string }).text;
  },

  /**
   * Plays the phrase. Resolves when it has finished, with who spoke:
   * "api" = ElevenLabs audio, "device" = the phone's own voice (mock mode, an API error, or blocked audio).
   * Never throws, so a voice problem can't break the screen. Returns "none" if nothing could speak.
   */
  speak: async (text: string, lang: string): Promise<"api" | "device" | "none"> => {
    try {
      const res = await fetch("/api/voice/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, lang }) });
      if (res.status === 200) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        await new Promise<void>((done, fail) => {
          audio.onended = () => done();
          audio.onerror = () => fail(new Error("audio failed"));
          audio.play().catch(fail);
        });
        URL.revokeObjectURL(url);
        return "api";
      }
    } catch {
      // fall through to the device voice
    }
    if (!("speechSynthesis" in window)) return "none";
    return new Promise((done) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.85;
      u.onend = () => done("device");
      u.onerror = () => done("none");
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  },
};
