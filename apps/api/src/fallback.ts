/**
 * "The connection can't be broken":
 * if a real service (ElevenLabs, Gemini) fails or has no key, quietly use its mock instead,
 * so the demo keeps working and nobody's part blocks anyone else.
 */
import { ParseError } from "./ai/mock";

export function withFallback<T extends object>(name: string, real: T, mock: T): T {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const fn = Reflect.get(target, prop, receiver);
      if (typeof fn !== "function") return fn;
      return async (...args: unknown[]) => {
        try {
          return await fn.apply(target, args);
        } catch (err) {
          if (err instanceof ParseError) throw err; // a real "I didn't understand" (or "no price for that yet") is not a failure
          console.warn(`[fallback] ${name}.${String(prop)} failed, using mock:`, (err as Error).message);
          return (mock as any)[prop](...args);
        }
      };
    },
  });
}
