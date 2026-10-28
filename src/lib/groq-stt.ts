import type { Language } from "@/config/personalities";
import type { SttResult } from "@/lib/stt";

/**
 * Transcription avec Whisper hébergé par Groq : très bon avec les accents,
 * gratuit avec une clé Groq (console.groq.com, sans carte bancaire), quelques
 * centaines de millisecondes pour une phrase. API compatible OpenAI.
 */
const API_BASE = (process.env.GROQ_API_BASE || "https://api.groq.com").replace(/\/+$/, "");
const MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo";

export function groqAvailable() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export async function transcribeWithGroq(audio: Blob, language: Language): Promise<SttResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY manquante : l'oreille Groq n'est pas configurée.");
  const form = new FormData();
  form.append("file", audio, "audio.wav");
  form.append("model", MODEL);
  form.append("language", language);
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/openai/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  } catch (error) {
    throw new Error(`Groq injoignable : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401) throw new Error("Clé Groq refusée. Vérifie GROQ_API_KEY.");
    if (res.status === 429) throw new Error("Limite gratuite Groq atteinte pour l'instant. Réessaie dans une minute.");
    throw new Error(`Groq a répondu ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; words?: { word?: string; start?: number; end?: number }[] };
  const words = (data.words ?? [])
    .filter((w) => typeof w.word === "string" && w.word.trim())
    .map((w) => ({ text: (w.word as string).trim(), start: Number(w.start ?? 0), end: Number(w.end ?? 0) }));
  const first = words[0]?.start ?? null;
  const last = words.at(-1)?.end ?? null;
  return { text: (data.text ?? "").trim(), words, durationMs: first !== null && last !== null && last > first ? Math.round((last - first) * 1000) : null };
}
