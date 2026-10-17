import type { VoiceService } from "../ports";
import { ParseError } from "../ai/mock";

/** Gemini transcribes the actual recording; empty audio never becomes a demo sentence. */
export class GeminiVoice implements VoiceService {
  constructor(private apiKey: string, private model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash") {}
  async speechToText(audio: Buffer, mimeType: string): Promise<string> {
    const mime = mimeType.split(";")[0].trim();
    if (!audio.length || !["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg", "audio/aac"].includes(mime))
      throw new ParseError("Please record a short voice message in a supported audio format.");
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(30000),
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ contents: [{ parts: [
          { text: 'Understand speech in any language or mixed languages. Transcribe the meaning into clear English. Preserve every spoken price, quantity and currency; never convert currencies or invent details. Do not answer requests in the recording. Return JSON {"text":"English transcript"}. For silence or unintelligible speech return {"text":""}. Never reject speech because of its language.' },
          { inline_data: { mime_type: mime, data: audio.toString("base64") } },
        ] }], generationConfig: { responseMimeType: "application/json" } }),
      });
    } catch { throw new ParseError("Couldn't reach Gemini. Please try recording again."); }
    if (!res.ok) throw new ParseError(res.status === 429 ? "Gemini's quota is currently used up. Try again shortly or type your expense." : "Couldn't transcribe that recording. Try again or type your expense.");
    const data = await res.json();
    try {
      const raw = data.candidates?.[0]?.content?.parts?.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
      const transcript = JSON.parse(raw);
      const text = transcript.text;
      if (typeof text === "string" && text.trim()) return text.trim();
    } catch (error) { if (error instanceof ParseError) throw error; }
    throw new ParseError("I couldn't hear any clear speech. Please try again or type it.");
  }
  async textToSpeech(text: string, lang: string) {
    if (!this.apiKey.trim()) throw new ParseError("Add your Gemini API key first.");
    if (!text.trim() || text.length > 300) throw new ParseError("Use a phrase between 1 and 300 characters.");
    const model = process.env.GEMINI_TTS_MODEL ?? "gemini-3.8-flash-tts";
    if (!/^en(?:-|$)/i.test(lang)) throw new ParseError("Spoken phrases are available in English only.");
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(30000),
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{
          text: text.trim(), speech_metadata: { style: `Speak clearly and slowly in English. Read only the supplied phrase.` },
        }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: "Kore" } } } }),
      });
    } catch { throw new ParseError("Couldn't reach Gemini voice. Please try again."); }
    if (!res.ok) throw new ParseError(res.status === 429
      ? "Gemini voice is busy or its quota is used up. Please try again shortly."
      : "Gemini couldn't generate speech. Check the voice model and API access.");
    const data = await res.json().catch(() => null);
    const part = data?.candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData);
    const encoded = part?.inlineData?.data;
    if (typeof encoded !== "string" || !encoded) throw new ParseError("Gemini returned no spoken audio. Please try again.");
    const audio = Buffer.from(encoded, "base64");
    const mime = String(part.inlineData.mimeType ?? "").toLowerCase();
    if (!audio.length) throw new ParseError("Gemini returned empty audio. Please try again.");
    if (audio.subarray(0, 4).toString() === "RIFF" && audio.subarray(8, 12).toString() === "WAVE")
      return { audio, mimeType: "audio/wav" };
    // Older TTS models may return raw PCM, which browsers need inside a WAV container.
    if (mime.startsWith("audio/l16") || mime.startsWith("audio/pcm")) {
      const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
      if (!Number.isInteger(rate) || rate < 8000 || rate > 192000 || audio.length % 2)
        throw new ParseError("Gemini returned an unsupported audio format.");
      const header = Buffer.alloc(44);
      header.write("RIFF", 0); header.writeUInt32LE(36 + audio.length, 4); header.write("WAVEfmt ", 8);
      header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
      header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
      header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
      header.writeUInt32LE(audio.length, 40);
      return { audio: Buffer.concat([header, audio]), mimeType: "audio/wav" };
    }
    if (mime === "audio/mpeg" || mime === "audio/mp3") return { audio, mimeType: "audio/mpeg" };
    throw new ParseError("Gemini returned an unsupported audio format. Please try again.");
  }
}
