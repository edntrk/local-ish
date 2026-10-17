import type { VoiceService } from "../ports";

/** Fake voice so the app works without an ElevenLabs key.
 *  textToSpeech returns no audio; the route marks it as mock and the Interface falls back to the phone's own voice. */
export class MockVoice implements VoiceService {
  async speechToText() { return "Taxi from the airport to Seminyak at night, he wants 400000"; }
  async textToSpeech() { return { audio: Buffer.alloc(0), mimeType: "audio/mpeg" }; }
}
