import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// Always read the repo-root .env: npm runs this from apps/api, where plain "dotenv/config" finds nothing.
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

export const config = {
  // Hosts like Render hand us PORT; API_PORT is for local use.
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 8787),
  // Comma-separated frontend origins allowed to call the API. Empty = allow any (fine for local dev).
  corsOrigins: (process.env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean),
  dataMode: pick(process.env.DATA_MODE, ["mock", "tiger"] as const, "mock"),
  voiceMode: pick(process.env.VOICE_MODE, ["mock", "elevenlabs"] as const, "mock"),
  aiMode: pick(process.env.AI_MODE, ["mock", "gemini"] as const, "mock"),
  databaseUrl: process.env.DATABASE_URL ?? "",
  elevenLabsKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  elevenLabsVoiceIdEn: process.env.ELEVENLABS_VOICE_ID_EN || undefined, // optional: the voice that reads English aloud
  geminiKey: process.env.GEMINI_API_KEY ?? "",
};
