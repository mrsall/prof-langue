import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { fallbackReason, speakWithChain, TtsChainError, type ServerEngine } from "@/lib/tts-chain";

export const maxDuration = 30;

/**
 * Lit une phrase courte avec une voix fabriquée par le serveur. GET pour que le
 * téléphone puisse la jouer directement dans un lecteur audio au moment où Cherif appuie.
 *
 *   /api/tts?text=...&lang=en|fr&speed=0.7..1.2&personality=ami&role=main|judge&engine=eleven|gemini|pc
 *
 * Chaîne de secours (src/lib/tts-chain.ts) : moteur demandé → ElevenLabs → PC,
 * 4 s par moteur. La réponse dit quel moteur a vraiment parlé (`X-Voice-Engine`)
 * et pourquoi les précédents ont échoué (`X-Voice-Fallback`, `X-Voice-Failures`).
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const wanted = url.searchParams.get("engine");
  const engine: ServerEngine = wanted === "gemini" ? "gemini" : wanted === "pc" ? "pc" : "eleven";
  const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const lang = url.searchParams.get("lang") ?? "en";
  const language = isLanguage(lang) ? lang : "en";
  const speed = Math.min(1.2, Math.max(0.7, Number(url.searchParams.get("speed") ?? "1") || 1));
  if (!text) return Response.json({ error: "Texte manquant." }, { status: 400 });
  const personalityId = url.searchParams.get("personality") || null;
  const role = url.searchParams.get("role") === "judge" ? "judge" : "main";

  try {
    const result = await speakWithChain(engine, { text, language, personalityId, role, speed });
    const headers = new Headers({
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(result.audio.length),
      "X-Voice-Engine": result.engine,
    });
    if (result.engine !== engine) {
      headers.set("X-Voice-Fallback", encodeURIComponent(fallbackReason(result.failures) ?? ""));
      headers.set("X-Voice-Failures", encodeURIComponent(result.failures.map((f) => `${f.engine}: ${f.error}`).join(" | ")));
    }
    return new Response(new Uint8Array(result.audio), { headers });
  } catch (error) {
    if (error instanceof TtsChainError) {
      return Response.json({ error: `Aucune voix serveur n'a répondu. ${error.message}`, failures: error.failures, reason: fallbackReason(error.failures) }, { status: 502 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Voix indisponible." }, { status: 502 });
  }
}
