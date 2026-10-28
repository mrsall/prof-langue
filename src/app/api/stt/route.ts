import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { sttAvailable, transcribeWithScribe } from "@/lib/stt";
import { groqAvailable, transcribeWithGroq } from "@/lib/groq-stt";
import { pcAvailable, pcTranscribe } from "@/lib/pc-tts";

export const maxDuration = 30;

/**
 * Transcription d'un court enregistrement : FormData { audio: WAV, language: en|fr, engine?: groq|scribe|auto }
 * → { text, words, durationMs, engine }. « auto » = Groq si la clé est là, sinon Scribe.
 * Sert d'oreille au mode éco (au choix de Cherif) et de secours quand le téléphone n'a
 * pas de reconnaissance vocale. L'audio n'est jamais conservé.
 */
export async function GET() {
  await connection();
  return Response.json({ available: sttAvailable() || groqAvailable() || pcAvailable(), groq: groqAvailable(), scribe: sttAvailable(), pc: pcAvailable() });
}

export async function POST(request: Request) {
  if (!sttAvailable() && !groqAvailable() && !pcAvailable()) return Response.json({ error: "Aucune transcription configurée (GROQ_API_KEY, PC_TTS_URL ou ELEVENLABS_API_KEY)." }, { status: 503 });
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
  const auto = groqAvailable() ? "groq" : sttAvailable() ? "scribe" : "pc";
  const engine = wanted === "pc" && pcAvailable() ? "pc" : wanted === "groq" && groqAvailable() ? "groq" : wanted === "scribe" && sttAvailable() ? "scribe" : auto;
  const run = (e: string) => (e === "pc" ? pcTranscribe(audio, language) : e === "groq" ? transcribeWithGroq(audio, language) : transcribeWithScribe(audio, language));
  try {
    const result = await run(engine);
    return Response.json({ ...result, engine });
  } catch (error) {
    // PC éteint : on ne laisse pas Cherif sans oreille, Groq ou Scribe prennent le relais.
    if (engine === "pc" && (groqAvailable() || sttAvailable())) {
      try {
        const result = await run(auto === "pc" ? "scribe" : auto);
        return Response.json({ ...result, engine: auto, fallbackFrom: "pc" });
      } catch {
        // on renvoie l'erreur d'origine
      }
    }
    return Response.json({ error: error instanceof Error ? error.message : "Transcription impossible." }, { status: 502 });
  }
}
