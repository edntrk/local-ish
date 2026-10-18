import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsVoice } from "./elevenlabs";

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
