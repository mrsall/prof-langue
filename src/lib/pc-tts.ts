import type { Language } from "@/config/personalities";

/**
 * Voix « Mon PC » : le serveur Chatterbox qui tourne sur l'ordinateur de Cherif
 * (dossier pc-voix/, carte NVIDIA), joint à travers un tunnel Tailscale.
 * Gratuit, illimité, mais seulement quand le PC est allumé : l'appelant prévoit
 * toujours le repli sur ElevenLabs.
 */
const TIMEOUT_MS = 12000;
/** Après un échec réseau, on considère le PC éteint pendant ce délai : les appels échouent tout de suite (repli immédiat). */
const DOWN_FOR_MS = 60000;
let pcDownUntil = 0;

export function markPcDown() {
  pcDownUntil = Date.now() + DOWN_FOR_MS;
}

export function markPcUp() {
  pcDownUntil = 0;
}

export function pcLikelyDown() {
  return Date.now() < pcDownUntil;
}

const DOWN_MESSAGE = "PC injoignable (éteint, en veille, ou Docker/Tailscale arrêtés).";

export function pcAvailable() {
  return Boolean(process.env.PC_TTS_URL?.trim()) && Boolean(process.env.PC_TTS_TOKEN?.trim());
}

export function pcBaseUrl() {
  return (process.env.PC_TTS_URL ?? "").trim().replace(/\/+$/, "");
}

/** Nom d'hôte affiché dans Réglages (jamais le mot de passe). */
export function pcHost() {
  try {
    return pcBaseUrl() ? new URL(pcBaseUrl()).host : null;
  } catch {
    return pcBaseUrl() || null;
  }
}

export type PcHealth = {
  ok: boolean;
  warm?: boolean;
  model?: string | null;
  device?: string;
  gpu?: string | null;
  voices?: string[];
  stt?: string | null;
  /** Mode temps réel possible (VAD, Whisper et clé Anthropic présents). */
  live?: boolean;
  claude?: { configured: boolean; ok: boolean; hint: string | null; model: string; error: string | null } | null;
  error?: string | null;
};

export async function pcHealth(timeoutMs = 6000): Promise<PcHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${pcBaseUrl()}/health`, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      markPcDown();
      return { ok: false, error: `Le PC a répondu ${res.status}.` };
    }
    const health = (await res.json()) as PcHealth;
    if (health.ok) markPcUp();
    return health;
  } catch (error) {
    markPcDown();
    return { ok: false, error: error instanceof Error && error.name === "AbortError" ? "Le PC ne répond pas (éteint, ou tunnel Tailscale arrêté)." : `PC injoignable : ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Transcription par Whisper sur le PC (même serveur que la voix). */
export async function pcTranscribe(audio: Blob, language: Language): Promise<{ text: string; words: { text: string; start: number; end: number }[]; durationMs: number | null }> {
  if (!pcAvailable()) throw new Error("Oreille du PC non configurée (PC_TTS_URL et PC_TTS_TOKEN).");
  if (pcLikelyDown()) throw new Error(DOWN_MESSAGE);
  const form = new FormData();
  form.append("audio", audio, "parole.wav");
  form.append("language", language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${pcBaseUrl()}/stt`, { method: "POST", headers: { Authorization: `Bearer ${process.env.PC_TTS_TOKEN!.trim()}` }, body: form, signal: controller.signal });
  } catch (error) {
    markPcDown();
    throw new Error(error instanceof Error && error.name === "AbortError" ? "Le PC met trop de temps à transcrire." : `PC injoignable : ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(res.status === 401 ? "Le PC refuse le mot de passe (PC_TTS_TOKEN)." : `Le PC a répondu ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  const data = (await res.json()) as { text?: string; words?: { text?: string; start?: number; end?: number }[]; durationMs?: number | null };
  return {
    text: (data.text ?? "").trim(),
    words: (data.words ?? []).filter((w) => typeof w.text === "string").map((w) => ({ text: w.text as string, start: Number(w.start ?? 0), end: Number(w.end ?? 0) })),
    durationMs: typeof data.durationMs === "number" ? data.durationMs : null,
  };
}

export async function pcSpeak(options: { text: string; language: Language; voice: string; timeoutMs?: number }): Promise<{ wav: Buffer; generationMs: number | null }> {
  if (!pcAvailable()) throw new Error("Voix du PC non configurée (PC_TTS_URL et PC_TTS_TOKEN).");
  if (pcLikelyDown()) throw new Error(DOWN_MESSAGE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${pcBaseUrl()}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PC_TTS_TOKEN!.trim()}` },
      body: JSON.stringify({ text: options.text, language: options.language, voice: options.voice }),
      signal: controller.signal,
    });
  } catch (error) {
    markPcDown();
    throw new Error(error instanceof Error && error.name === "AbortError" ? "Le PC met trop de temps à répondre." : `PC injoignable : ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401) throw new Error("Le PC refuse le mot de passe : PC_TTS_TOKEN doit être identique dans Vercel et dans pc-voix/.env.");
    throw new Error(`Le PC a répondu ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  const wav = Buffer.from(await res.arrayBuffer());
  if (wav.length < 100) throw new Error("Le PC a renvoyé un son vide.");
  const gen = Number(res.headers.get("x-generation-ms"));
  return { wav, generationMs: Number.isFinite(gen) && gen > 0 ? gen : null };
}
