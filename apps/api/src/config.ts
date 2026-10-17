import "dotenv/config";

const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

export const config = {
  port: Number(process.env.API_PORT ?? 8787),
  dataMode: pick(process.env.DATA_MODE, ["mock", "tiger"] as const, "mock"),
  voiceMode: pick(process.env.VOICE_MODE, ["mock", "elevenlabs"] as const, "mock"),
  aiMode: pick(process.env.AI_MODE, ["mock", "gemini"] as const, "mock"),
  databaseUrl: process.env.DATABASE_URL ?? "",
  elevenLabsKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
};
