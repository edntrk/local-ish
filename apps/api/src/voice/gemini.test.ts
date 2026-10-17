import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiVoice } from "./gemini";
afterEach(()=>vi.restoreAllMocks());
describe("real voice input",()=>{
  it("sends actual audio and returns only its transcript",async()=>{
    const spy=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"text":"hotel 500 dirhams"}'}]}}]})));
    expect(await new GeminiVoice("test").speechToText(Buffer.from("recorded-audio"),"audio/webm;codecs=opus")).toBe("hotel 500 dirhams");
    const body=JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.contents[0].parts[1].inline_data).toEqual({mime_type:"audio/webm",data:Buffer.from("recorded-audio").toString("base64")});
  });
  it("does not turn silence into a simulated taxi expense",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"text":""}'}]}}]})));
    await expect(new GeminiVoice("test").speechToText(Buffer.from("silence"),"audio/mp4")).rejects.toThrow("clear speech");
  });
  it("explains service limits",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("",{status:429}));
    await expect(new GeminiVoice("test").speechToText(Buffer.from("audio"),"audio/webm")).rejects.toThrow("quota");
  });
});


describe("Gemini spoken phrases", () => {
  it("wraps PCM in a playable WAV file and keeps the phrase separate from delivery instructions", async () => {
    const pcm = Buffer.from([0, 0, 1, 0]);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64"), mimeType: "audio/L16;codec=pcm;rate=24000" } }] } }] })));
    const result = await new GeminiVoice("test").textToSpeech("Hello", "en-GB");
    expect(result.mimeType).toBe("audio/wav");
    expect(result.audio.subarray(0, 4).toString()).toBe("RIFF");
    expect(result.audio.readUInt32LE(24)).toBe(24000);
    expect(result.audio.subarray(44)).toEqual(pcm);
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.contents[0].parts[0].text).toBe("Hello");
    expect(body.contents[0].parts[0].speech_metadata.style).toContain("English");
  });
  it("keeps an existing WAV container intact", async () => {
    const wav = Buffer.alloc(44); wav.write("RIFF", 0); wav.write("WAVE", 8);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: wav.toString("base64"), mimeType: "audio/wav" } }] } }] })));
    expect((await new GeminiVoice("test").textToSpeech("Hello", "en-GB")).audio).toEqual(wav);
  });
  it("reports missing audio instead of playing a fake result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [] })));
    await expect(new GeminiVoice("test").textToSpeech("Hello", "en-GB")).rejects.toThrow("no spoken audio");
  });
});

it("accepts a non-English recording and returns an English transcript", async () => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "I paid 600 dirhams for the hotel." }) }] } }] })));
  expect(await new GeminiVoice("test").speechToText(Buffer.from("Turkish recording"), "audio/webm")).toBe("I paid 600 dirhams for the hotel.");
  const prompt = JSON.parse(spy.mock.calls[0][1]!.body as string).contents[0].parts[0].text;
  expect(prompt).toContain("speech in any language");
  expect(prompt).toContain("into clear English");
  expect(prompt).not.toContain("Accept English speech only");
});
