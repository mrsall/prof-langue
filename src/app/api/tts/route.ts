import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { resolveVoiceId } from "@/lib/tts-voices";
import { ELEVENLABS_API_BASE } from "@/lib/elevenlabs-api";
import { geminiAvailable, geminiSpeak } from "@/lib/gemini";
import { geminiVoiceFor } from "@/config/gemini-voices";
import { pcAvailable, pcSpeak } from "@/lib/pc-tts";

export const maxDuration = 30;

/**
 * Lit une phrase courte avec une voix ElevenLabs (phrase modèle du shadowing,
 * ou un mot raté rejoué lentement). GET pour que le téléphone puisse la jouer
 * directement dans un lecteur audio au moment où Cherif appuie.
 *
 *   /api/tts?text=...&lang=en|fr&speed=0.7..1.2&personality=ami&role=main|judge&engine=eleven|gemini
 */
const MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const wanted = url.searchParams.get("engine");
  const engine = wanted === "gemini" ? "gemini" : wanted === "pc" ? "pc" : "eleven";
  if (engine === "pc") {
    const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
    const language = isLanguage(url.searchParams.get("lang")) ? (url.searchParams.get("lang") as "en" | "fr") : "en";
    if (!text) return Response.json({ error: "Texte manquant." }, { status: 400 });
    if (!pcAvailable()) return Response.json({ error: "Voix du PC non configurée : PC_TTS_URL et PC_TTS_TOKEN dans Vercel (voir pc-voix/README.md)." }, { status: 503 });
    try {
      const voice = url.searchParams.get("role") === "judge" ? "juge" : url.searchParams.get("personality") || "prof";
      const { wav } = await pcSpeak({ text, language, voice });
      return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400", "Content-Length": String(wav.length) } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Voix du PC indisponible." }, { status: 502 });
    }
  }
  if (engine === "gemini") {
    const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
    const language = isLanguage(url.searchParams.get("lang")) ? (url.searchParams.get("lang") as "en" | "fr") : "en";
    if (!text) return Response.json({ error: "Texte manquant." }, { status: 400 });
    if (!geminiAvailable()) return Response.json({ error: "Voix Google non configurée : ajoute GEMINI_API_KEY dans Vercel (clé gratuite sur aistudio.google.com)." }, { status: 503 });
    try {
      const role = url.searchParams.get("role") === "judge" ? "judge" : "main";
      // Pas de vitesse côté Google : le téléphone règle la vitesse à la lecture (sinon le modèle lit la consigne à voix haute).
      const { wav } = await geminiSpeak({ text, language, voice: geminiVoiceFor(url.searchParams.get("personality"), language, role) });
      return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400", "Content-Length": String(wav.length) } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Voix Google indisponible." }, { status: 502 });
    }
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return Response.json({ error: "ELEVENLABS_API_KEY manquante." }, { status: 503 });
  const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const lang = url.searchParams.get("lang") ?? "en";
  const language = isLanguage(lang) ? lang : "en";
  const speed = Math.min(1.2, Math.max(0.7, Number(url.searchParams.get("speed") ?? "1") || 1));
  if (!text) return Response.json({ error: "Texte manquant." }, { status: 400 });

  const personalityId = url.searchParams.get("personality") || null;
  const role = url.searchParams.get("role") === "judge" ? "judge" : "main";
  const voiceId = await resolveVoiceId({ apiKey, language, personalityId, role });

  let res: Response;
  try {
    res = await fetch(`${ELEVENLABS_API_BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        language_code: language,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
      }),
    });
  } catch (error) {
    return Response.json({ error: `ElevenLabs injoignable : ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return Response.json({ error: `ElevenLabs a répondu ${res.status}${detail ? ` : ${detail}` : ""}` }, { status: 502 });
  }
  const audio = await res.arrayBuffer();
  return new Response(audio, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(audio.byteLength),
    },
  });
}
