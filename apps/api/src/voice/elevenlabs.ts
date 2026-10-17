/**
 * VOICE role: ElevenLabs.
 * Status: DRAFT, not yet run with a real key. Check the endpoints against the ElevenLabs docs before the demo.
 * Turn on with VOICE_MODE=elevenlabs plus ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.
 */
import type { VoiceService } from "../ports";

const BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsVoice implements VoiceService {
  constructor(private apiKey: string, private voiceId: string) {}

  async speechToText(audio: Buffer, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append("model_id", "scribe_v1");
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "speech");
    const res = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: { "xi-api-key": this.apiKey }, body: form });
    if (!res.ok) throw new Error(`ElevenLabs speech-to-text failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  }

  async textToSpeech(text: string, _lang: string) {
    const res = await fetch(`${BASE}/text-to-speech/${this.voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) throw new Error(`ElevenLabs text-to-speech failed: ${res.status} ${await res.text()}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mimeType: "audio/mpeg" };
  }
}
