import type { VoiceService } from "../ports";
import { ParseError } from "../ai/mock";

const BASE = "https://api.elevenlabs.io/v1";
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac",
};

/**
 * A ready-made English ElevenLabs voice ("Sarah"), used to read the seller's English translation aloud unless ELEVENLABS_VOICE_ID_EN picks another.
 * It must be a premade voice: library voices (like "Rachel") answer 402 on a free plan, and then the page falls back to the device voice.
 */
export const DEFAULT_ENGLISH_VOICE = "EXAVITQu4vr4xnSDxMaL";

export class ElevenLabsVoice implements VoiceService {
  constructor(private apiKey: string, private voiceId: string, private englishVoiceId = DEFAULT_ENGLISH_VOICE) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (!this.apiKey.trim()) throw new ParseError("Add your ElevenLabs API key first.");
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...init, signal: AbortSignal.timeout(30000),
        headers: { ...init.headers, "xi-api-key": this.apiKey },
      });
    } catch { throw new ParseError("Couldn't reach the voice service. Please try again."); }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        throw new ParseError("Check your ElevenLabs key and its speech permissions.");
      if (res.status === 402) throw new ParseError("That voice needs a paid ElevenLabs plan. Choose a premade voice instead.");
      if (res.status === 429) throw new ParseError("The voice service is busy or out of credits. Try again shortly.");
      if (res.status === 404) throw new ParseError("That voice was not found. Check your ElevenLabs voice ID.");
      throw new ParseError("The voice service couldn't process that. Please try again.");
    }
    return res;
  }

  async speechToText(audio: Buffer, mimeType: string, languages?: string[]): Promise<string> {
    const mime = mimeType.split(";")[0].trim().toLowerCase();
    const extension = EXTENSIONS[mime];
    if (!Buffer.isBuffer(audio) || !audio.length) throw new ParseError("Record a short message first.");
    if (audio.length > 10 * 1024 * 1024) throw new ParseError("That recording is too large. Please record a shorter message.");
    if (!extension) throw new ParseError("Please use a WebM, MP4, Ogg, MP3 or WAV recording.");
    // No languages given: let ElevenLabs detect it (browser recordings may mix languages).
    // Languages given: try each in order and keep the first that hears words, so "id" first and "en" as the fallback.
    let lastError: unknown = new ParseError("I couldn't hear clear speech. Try again or type your expense.");
    for (const lang of languages?.length ? languages : [undefined]) {
      try { return await this.transcribe(audio, mime, extension, lang); } catch (e) { lastError = e; }
    }
    throw lastError;
  }

  private async transcribe(audio: Buffer, mime: string, extension: string, language?: string): Promise<string> {
    const form = new FormData();
    form.append("model_id", "scribe_v2");
    form.append("tag_audio_events", "false");
    if (language) form.append("language_code", language);
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `speech.${extension}`);
    const res = await this.request("/speech-to-text", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) throw new ParseError("I couldn't hear clear speech. Try again or type your expense.");
    return text;
  }

  async textToSpeech(text: string, lang: string) {
    if (!this.voiceId.trim()) throw new ParseError("Choose an ElevenLabs voice and add its voice ID first.");
    if (!text.trim() || text.length > 300) throw new ParseError("Use a phrase between 1 and 300 characters.");
    // Multilingual v2 detects language from text; it does not accept language_code.
    // English lines (the seller's translation) get an English voice; Bahasa phrases keep the chosen voice
    const voice = /^en\b/i.test(lang) && this.englishVoiceId.trim() ? this.englishVoiceId : this.voiceId;
    const res = await this.request(`/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: text.trim(), model_id: "eleven_multilingual_v2" }),
    });
    if (!(res.headers.get("content-type") ?? "").startsWith("audio/"))
      throw new ParseError("The voice service returned no playable audio. Please try again.");
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new ParseError("The voice service returned empty audio. Please try again.");
    return { audio, mimeType: "audio/mpeg" };
  }
}
