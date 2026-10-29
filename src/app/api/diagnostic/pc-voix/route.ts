import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { pcAvailable, pcSpeak, type PcVoiceEngine } from "@/lib/pc-tts";

export const maxDuration = 30;

/**
 * Page /test-voix-pc : fait dire la même phrase par un moteur du PC et renvoie
 * l'audio (base64) avec les temps mesurés, pour comparer à l'oreille.
 *   /api/diagnostic/pc-voix?engine=multilingual|turbo&lang=en|fr&text=…&voice=prof
 */
export async function GET(request: Request) {
  await connection();
  if (!pcAvailable()) return Response.json({ ok: false, error: "PC non configuré." }, { status: 503 });
  const url = new URL(request.url);
  const engineRaw = url.searchParams.get("engine");
  const engine: PcVoiceEngine | null = engineRaw === "turbo" || engineRaw === "multilingual" ? engineRaw : null;
  const lang = url.searchParams.get("lang") ?? "en";
  const language = isLanguage(lang) ? lang : "en";
  const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const voice = (url.searchParams.get("voice") ?? "prof").replace(/[^a-z-]/gi, "").slice(0, 20) || "prof";
  if (!text) return Response.json({ ok: false, error: "Texte manquant." }, { status: 400 });
  const start = Date.now();
  try {
    const result = await pcSpeak({ text, language, voice, engine, timeoutMs: 25000 });
    return Response.json({
      ok: true,
      engine: result.engine ?? engine ?? "multilingual",
      ms: Date.now() - start,
      generationMs: result.generationMs,
      audioMs: result.audioMs,
      rtf: result.rtf,
      audio: `data:audio/wav;base64,${result.wav.toString("base64")}`,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
