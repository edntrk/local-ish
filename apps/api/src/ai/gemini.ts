/**
 * AI part of the VOICE & AI role: Gemini turns free text or a photo into a structured ask.
 * Status: DRAFT, not yet run with a real key. Check the model name and request shape against the Gemini API docs.
 * Turn on with AI_MODE=gemini and GEMINI_API_KEY in .env (GEMINI_MODEL is optional).
 */
import { ParsedAsk, type ParseRequest, type PriceItem } from "@fairfare/shared";
import type { AskParser } from "../ports";
import { ParseError } from "./mock";

export class GeminiAskParser implements AskParser {
  constructor(private apiKey: string, private model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash") {}

  async parse(req: ParseRequest, prices: PriceItem[]): Promise<ParsedAsk> {
    const menu = prices.map((p) => `- ${p.id}: ${p.name}`).join("\n");
    const prompt = `You help a tourist in ${req.city} check if a price is fair.
Pick the ONE item id from this list that matches what they are paying for:
${menu}
Return JSON only: {"itemId": string, "amount": number, "currency": "${prices[0]?.currency ?? "MAD"}", "style": "local"|"mid"|"fancy", "situation": string, "confidence": number 0-1}.
style is "fancy" for rooftops, hotels and upmarket places, "mid" for normal sit-down places, otherwise "local".
If nothing matches, use confidence 0.
${req.text ? `They said: "${req.text}"` : "Read the item and price from the photo."}`;

    const parts: unknown[] = [{ text: prompt }];
    if (req.imageBase64) parts.push({ inline_data: { mime_type: "image/jpeg", data: req.imageBase64 } });

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json" } }),
    });
    if (!res.ok) throw new Error(`Gemini failed: ${res.status} ${await res.text()}`);
    const data: any = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = ParsedAsk.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.confidence < 0.3 || !prices.some((p) => p.id === parsed.data.itemId)) {
      throw new ParseError('Could not understand that. Try "mint tea in the souk, 30".');
    }
    return parsed.data;
  }
}
