import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { resolveVoiceId } from "@/lib/tts-voices";

export const maxDuration = 30;

/**
 * Lit une phrase courte avec une voix ElevenLabs (phrase modèle du shadowing,
 * ou un mot raté rejoué lentement). GET pour que le téléphone puisse la jouer
 * directement dans un lecteur audio au moment où Cherif appuie.
 *
 *   /api/tts?text=...&lang=en|fr&speed=0.7..1.2&personality=ami&role=main|judge
 */
const MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";

export async function GET(request: Request) {
  await connection();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return Response.json({ error: "ELEVENLABS_API_KEY manquante." }, { status: 503 });
  const url = new URL(request.url);
  const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const lang = url.searchParams.get("lang") ?? "en";
  const language = isLanguage(lang) ? lang : "en";
  const speed = Math.min(1.2, Math.max(0.7, Number(url.searchParams.get("speed") ?? "1") || 1));
  if (!text) return Response.json({ error: "Texte manquant." }, { status: 400 });

  const personalityId = url.searchParams.get("personality") || null;
  const role = url.searchParams.get("role") === "judge" ? "judge" : "main";
  const voiceId = await resolveVoiceId({ apiKey, language, personalityId, role });

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
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
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(audio.byteLength),
    },
  });
}
