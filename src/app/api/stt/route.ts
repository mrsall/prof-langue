import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { sttAvailable, transcribeWithScribe } from "@/lib/stt";

export const maxDuration = 30;

/**
 * Transcription de secours (Scribe, ElevenLabs) quand le téléphone n'a pas de
 * reconnaissance vocale. FormData { audio: WAV, language: en|fr } → { text, words, durationMs }.
 * L'audio n'est jamais conservé.
 */
export async function GET() {
  await connection();
  return Response.json({ available: sttAvailable() });
}

export async function POST(request: Request) {
  if (!sttAvailable()) return Response.json({ error: "Transcription de secours non configurée (ELEVENLABS_API_KEY)." }, { status: 503 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const audio = form.get("audio");
  const lang = String(form.get("language") ?? "en");
  if (!(audio instanceof Blob) || audio.size < 1000) return Response.json({ error: "Enregistrement vide." }, { status: 400 });
  if (audio.size > 6_000_000) return Response.json({ error: "Enregistrement trop long." }, { status: 413 });
  try {
    const result = await transcribeWithScribe(audio, isLanguage(lang) ? lang : "en");
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Transcription impossible." }, { status: 502 });
  }
}
