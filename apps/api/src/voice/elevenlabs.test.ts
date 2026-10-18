import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENGLISH_VOICE, ElevenLabsVoice } from "./elevenlabs";

const sent: Array<string | null> = [];
const answer = (texts: Record<string, string>) =>
  vi.stubGlobal("fetch", async (_url: string, init: { body: FormData }) => {
    const lang = init.body.get("language_code") as string | null;
    sent.push(lang);
    return new Response(JSON.stringify({ text: texts[lang ?? "auto"] ?? "" }), { status: 200 });
  });

afterEach(() => { vi.unstubAllGlobals(); sent.length = 0; });

describe("ElevenLabs speech-to-text languages", () => {
  const audio = Buffer.from("fake audio");
  const voice = new ElevenLabsVoice("key", "voice");

  it("auto-detects when no languages are given", async () => {
    answer({ auto: "hello" });
    expect(await voice.speechToText(audio, "audio/webm")).toBe("hello");
    expect(sent).toEqual([null]);
  });

  it("tries Indonesian first and stops when it hears words", async () => {
    answer({ id: "dua ratus ribu", en: "two hundred thousand" });
    expect(await voice.speechToText(audio, "audio/webm", ["id", "en"])).toBe("dua ratus ribu");
    expect(sent).toEqual(["id"]);
  });

  it("falls back to English when Indonesian hears nothing", async () => {
    answer({ en: "two hundred thousand" });
    expect(await voice.speechToText(audio, "audio/webm", ["id", "en"])).toBe("two hundred thousand");
    expect(sent).toEqual(["id", "en"]);
  });

  it("says so plainly when neither language hears anything", async () => {
    answer({});
    await expect(voice.speechToText(audio, "audio/webm", ["id", "en"])).rejects.toThrow("clear speech");
  });
});

describe("ElevenLabs text-to-speech voices", () => {
  const urls: string[] = [];
  const stub = () => vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  });
  afterEach(() => { urls.length = 0; });

  it("reads English (the seller's translation) with the English voice and Bahasa with the chosen voice", async () => {
    stub();
    const voice = new ElevenLabsVoice("key", "bahasa-voice", "english-voice");
    await voice.textToSpeech("How about 400 thousand?", "en-US");
    await voice.textToSpeech("Bagaimana kalau 400 ribu?", "id-ID");
    expect(urls[0]).toContain("/text-to-speech/english-voice");
    expect(urls[1]).toContain("/text-to-speech/bahasa-voice");
  });
  it("has a built-in English voice when none is chosen", async () => {
    stub();
    await new ElevenLabsVoice("key", "bahasa-voice").textToSpeech("Okay, deal.", "en-US");
    expect(urls[0]).toContain(`/text-to-speech/${DEFAULT_ENGLISH_VOICE}`);
  });
  it("a voice that needs a paid plan says so in a plain sentence", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 402 }));
    await expect(new ElevenLabsVoice("key", "v").textToSpeech("Okay.", "en-US")).rejects.toThrow("paid ElevenLabs plan");
  });
  it("a failure is a plain error, so the page falls back to the browser's en-US voice", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    await expect(new ElevenLabsVoice("key", "v").textToSpeech("Okay.", "en-US")).rejects.toThrow("busy or out of credits");
  });
});
