import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { sttAvailable, transcribeWithScribe } from "@/lib/stt";
import { groqAvailable, transcribeWithGroq } from "@/lib/groq-stt";

export const maxDuration = 30;

/**
 * Transcription d'un court enregistrement : FormData { audio: WAV, language: en|fr, engine?: groq|scribe|auto }
 * → { text, words, durationMs, engine }. « auto » = Groq si la clé est là, sinon Scribe.
 * Sert d'oreille au mode éco (au choix de Cherif) et de secours quand le téléphone n'a
 * pas de reconnaissance vocale. L'audio n'est jamais conservé.
 */
export async function GET() {
  await connection();
  return Response.json({ available: sttAvailable() || groqAvailable(), groq: groqAvailable(), scribe: sttAvailable() });
}

export async function POST(request: Request) {
  if (!sttAvailable() && !groqAvailable()) return Response.json({ error: "Aucune transcription configurée (GROQ_API_KEY ou ELEVENLABS_API_KEY)." }, { status: 503 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const audio = form.get("audio");
  const lang = String(form.get("language") ?? "en");
  const language = isLanguage(lang) ? lang : "en";
  const wanted = String(form.get("engine") ?? "auto");
  if (!(audio instanceof Blob) || audio.size < 1000) return Response.json({ error: "Enregistrement vide." }, { status: 400 });
  if (audio.size > 6_000_000) return Response.json({ error: "Enregistrement trop long." }, { status: 413 });
  const engine = wanted === "groq" && groqAvailable() ? "groq" : wanted === "scribe" && sttAvailable() ? "scribe" : groqAvailable() ? "groq" : "scribe";
  try {
    const result = engine === "groq" ? await transcribeWithGroq(audio, language) : await transcribeWithScribe(audio, language);
    return Response.json({ ...result, engine });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Transcription impossible." }, { status: 502 });
  }
}
