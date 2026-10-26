import type { Language } from "@/config/personalities";

/**
 * Transcription d'un court enregistrement avec Scribe (ElevenLabs), compris
 * dans l'abonnement : sert de secours quand le téléphone n'a pas de
 * reconnaissance vocale (par exemple l'app installée sur iPhone).
 */
export type SttWord = { text: string; start: number; end: number };
export type SttResult = { text: string; words: SttWord[]; durationMs: number | null };

const MODELS = [process.env.ELEVENLABS_STT_MODEL || "scribe_v2", "scribe_v1"];
const ISO3: Record<Language, string> = { en: "eng", fr: "fra" };

export function sttAvailable() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export async function transcribeWithScribe(audio: Blob, language: Language): Promise<SttResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY manquante : la transcription de secours n'est pas disponible.");
  let lastError = "";
  for (const model of [...new Set(MODELS)]) {
    const form = new FormData();
    form.append("file", audio, "audio.wav");
    form.append("model_id", model);
    form.append("language_code", ISO3[language]);
    form.append("tag_audio_events", "false");
    form.append("timestamps_granularity", "word");
    form.append("diarize", "false");
    let res: Response;
    try {
      res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
    } catch (error) {
      throw new Error(`ElevenLabs injoignable : ${error instanceof Error ? error.message : String(error)}`);
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { text?: string; words?: { text?: string; start?: number; end?: number; type?: string }[] };
      const words = (data.words ?? [])
        .filter((w) => (w.type ?? "word") === "word" && typeof w.text === "string" && w.text.trim())
        .map((w) => ({ text: w.text as string, start: Number(w.start ?? 0), end: Number(w.end ?? 0) }));
      const first = words[0]?.start ?? null;
      const last = words.at(-1)?.end ?? null;
      return { text: (data.text ?? "").trim(), words, durationMs: first !== null && last !== null && last > first ? Math.round((last - first) * 1000) : null };
    }
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    lastError = `ElevenLabs a répondu ${res.status}${detail ? ` : ${detail}` : ""}`;
    if (res.status === 401) throw new Error("Clé ElevenLabs refusée pour la transcription.");
    // Modèle inconnu ou retiré : on essaie le suivant.
    if (!(res.status === 400 || res.status === 404 || res.status === 422)) break;
  }
  throw new Error(lastError || "Transcription impossible.");
}
