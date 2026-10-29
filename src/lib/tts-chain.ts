import type { Language } from "@/config/personalities";
import { resolveVoiceId } from "@/lib/tts-voices";
import { ELEVENLABS_API_BASE } from "@/lib/elevenlabs-api";
import { geminiAvailable, geminiSpeak } from "@/lib/gemini";
import { geminiVoiceFor } from "@/config/gemini-voices";
import { pcAvailable, pcLikelyDown, pcSpeak } from "@/lib/pc-tts";

/**
 * Chaîne de secours unique pour la voix lue par le serveur (/api/tts) :
 *   moteur demandé → ElevenLabs → PC de Cherif (s'il répond).
 * Google (Gemini) n'entre dans la chaîne que s'il a été choisi explicitement.
 * Chaque moteur a 4 s (6 s pour le PC, qui met ≈ 5 s à dire une phrase courte)
 * avant qu'on passe au suivant ; on n'attend plus 17 s sur un moteur en panne.
 * Kokoro et la voix du téléphone restent côté téléphone (voice-engine.ts).
 */
export type ServerEngine = "eleven" | "gemini" | "pc";
export type TtsFailure = { engine: ServerEngine; error: string };
export type TtsResult = { audio: Buffer; contentType: string; engine: ServerEngine; failures: TtsFailure[] };

const ELEVEN_TIMEOUT_MS = 4000;
const GEMINI_TIMEOUT_MS = 4000;
const PC_TIMEOUT_MS = 6000;
const QUOTA_MEMORY_MS = 10 * 60 * 1000;
const MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";

/** Quand ElevenLabs répond « quota_exceeded », on s'en souvient 10 min : plus aucune phrase ne lui est envoyée. */
let elevenQuotaUntil = 0;
let elevenQuotaDetail: string | null = null;

export function elevenQuotaExhausted() {
  return Date.now() < elevenQuotaUntil;
}
export function elevenQuotaMessage() {
  return elevenQuotaDetail;
}
export function markElevenQuotaExhausted(detail: string) {
  elevenQuotaUntil = Date.now() + QUOTA_MEMORY_MS;
  elevenQuotaDetail = detail;
}
export function resetElevenQuota() {
  elevenQuotaUntil = 0;
  elevenQuotaDetail = null;
}

export const ENGINE_LABELS: Record<ServerEngine | "kokoro" | "phone", string> = {
  eleven: "ElevenLabs",
  gemini: "Google",
  pc: "ton PC",
  kokoro: "Kokoro",
  phone: "le téléphone",
};

async function withSignal<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, onTimeout: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(onTimeout);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function elevenSpeak(req: TtsRequest): Promise<{ audio: Buffer; contentType: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY manquante.");
  if (elevenQuotaExhausted()) throw new Error(`crédit ElevenLabs épuisé${elevenQuotaDetail ? ` (${elevenQuotaDetail})` : ""}`);
  const voiceId = await resolveVoiceId({ apiKey, language: req.language, personalityId: req.personalityId, role: req.role });
  const res = await withSignal(
    ELEVEN_TIMEOUT_MS,
    (signal) =>
      fetch(`${ELEVENLABS_API_BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: req.text, model_id: MODEL, language_code: req.language, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: req.speed } }),
        signal,
      }),
    "ElevenLabs n'a pas répondu en 4 s.",
  ).catch((error: unknown) => {
    throw new Error(error instanceof Error && !/4 s/.test(error.message) ? `ElevenLabs injoignable : ${error.message}` : error instanceof Error ? error.message : String(error));
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (/quota_exceeded/i.test(detail) || res.status === 402) {
      const remaining = detail.match(/(\d+)\s+credits? remaining/i)?.[1];
      markElevenQuotaExhausted(remaining != null ? `${remaining} crédit restant` : "quota_exceeded");
      throw new Error("crédit ElevenLabs épuisé (quota_exceeded)");
    }
    throw new Error(`ElevenLabs a répondu ${res.status}${detail ? ` : ${detail}` : ""}`);
  }
  return { audio: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || "audio/mpeg" };
}

async function pcSpeakFast(req: TtsRequest): Promise<{ audio: Buffer; contentType: string }> {
  if (!pcAvailable()) throw new Error("voix du PC non configurée");
  if (pcLikelyDown()) throw new Error("PC injoignable (éteint, en veille, ou Docker/Tailscale arrêtés)");
  const voice = req.role === "judge" ? "juge" : req.personalityId || "prof";
  const { wav } = await pcSpeak({ text: req.text, language: req.language, voice, timeoutMs: PC_TIMEOUT_MS });
  return { audio: wav, contentType: "audio/wav" };
}

async function geminiSpeakFast(req: TtsRequest): Promise<{ audio: Buffer; contentType: string }> {
  if (!geminiAvailable()) throw new Error("voix Google non configurée (GEMINI_API_KEY)");
  const { wav } = await withSignal(
    GEMINI_TIMEOUT_MS,
    (signal) => geminiSpeak({ text: req.text, language: req.language, voice: geminiVoiceFor(req.personalityId, req.language, req.role), signal }),
    "Google n'a pas répondu en 4 s.",
  );
  return { audio: wav, contentType: "audio/wav" };
}

export type TtsRequest = { text: string; language: Language; personalityId: string | null; role: "main" | "judge"; speed: number };

/** Ordre d'essai : le moteur demandé d'abord, puis ElevenLabs, puis le PC. Google seulement s'il est demandé. */
export function engineOrder(requested: ServerEngine): ServerEngine[] {
  const chain: ServerEngine[] = ["eleven", "pc"];
  return [requested, ...chain.filter((e) => e !== requested)];
}

const RUNNERS: Record<ServerEngine, (req: TtsRequest) => Promise<{ audio: Buffer; contentType: string }>> = {
  eleven: elevenSpeak,
  pc: pcSpeakFast,
  gemini: geminiSpeakFast,
};

export async function speakWithChain(requested: ServerEngine, req: TtsRequest): Promise<TtsResult> {
  const failures: TtsFailure[] = [];
  for (const engine of engineOrder(requested)) {
    // On ne tente pas un moteur qu'on sait absent : pas de délai pour rien.
    if (engine === "pc" && (!pcAvailable() || pcLikelyDown())) {
      if (pcAvailable()) failures.push({ engine, error: "PC injoignable (marqué éteint il y a moins d'une minute)" });
      continue;
    }
    if (engine === "gemini" && !geminiAvailable()) continue;
    if (engine === "eleven" && !process.env.ELEVENLABS_API_KEY) continue;
    try {
      const { audio, contentType } = await RUNNERS[engine](req);
      return { audio, contentType, engine, failures };
    } catch (error) {
      failures.push({ engine, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new TtsChainError(failures);
}

export class TtsChainError extends Error {
  failures: TtsFailure[];
  constructor(failures: TtsFailure[]) {
    super(failures.length ? failures.map((f) => `${ENGINE_LABELS[f.engine]} : ${f.error}`).join(" · ") : "Aucune voix serveur configurée.");
    this.failures = failures;
  }
}

/** Phrase courte pour le bandeau « Voix de secours ». */
export function fallbackReason(failures: TtsFailure[]): string | null {
  if (failures.length === 0) return null;
  const quota = failures.find((f) => f.engine === "eleven" && /quota|crédit/i.test(f.error));
  if (quota) return "crédit ElevenLabs épuisé";
  const first = failures[0];
  return `${ENGINE_LABELS[first.engine]} indisponible`;
}
