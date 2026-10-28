import { connection } from "next/server";
import { pcAvailable, pcHealth, pcHost, pcSpeak } from "@/lib/pc-tts";

export const maxDuration = 30;

/** Vérifie la voix « Mon PC » : le PC répond, le mot de passe passe, une phrase sort. */
export type PcDiagnostic = { ok: boolean; configured: boolean; host: string | null; gpu: string | null; model: string | null; voices: string[]; stt: string | null; live: boolean; claude: string | null; ms: number; generationMs: number | null; bytes: number; error: string | null };

export async function GET() {
  await connection();
  const start = Date.now();
  const base = { configured: pcAvailable(), host: pcHost(), gpu: null, model: null, voices: [] as string[], stt: null as string | null, live: false, claude: null as string | null, generationMs: null, bytes: 0 };
  if (!pcAvailable()) {
    return Response.json({ ...base, ok: false, ms: 0, error: "PC_TTS_URL ou PC_TTS_TOKEN manquante dans Vercel." } satisfies PcDiagnostic);
  }
  const health = await pcHealth();
  if (!health.ok) {
    return Response.json({ ...base, ok: false, ms: Date.now() - start, error: health.error ?? "Le PC ne répond pas." } satisfies PcDiagnostic);
  }
  try {
    const { wav, generationMs } = await pcSpeak({ text: "Bonjour Cherif, je suis la voix de ton PC.", language: "fr", voice: "prof" });
    const claude = health.claude ? (health.claude.ok ? `OK (${health.claude.model}, clé ${health.claude.hint ?? "?"})` : (health.claude.error ?? "clé absente")) : null;
    return Response.json({ ...base, ok: wav.length > 1000, gpu: health.gpu ?? null, model: health.model ?? null, voices: health.voices ?? [], stt: health.stt ?? null, live: Boolean(health.live), claude, ms: Date.now() - start, generationMs, bytes: wav.length, error: wav.length > 1000 ? null : "Son vide." } satisfies PcDiagnostic);
  } catch (error) {
    return Response.json({ ...base, ok: false, gpu: health.gpu ?? null, model: health.model ?? null, voices: health.voices ?? [], ms: Date.now() - start, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) } satisfies PcDiagnostic);
  }
}
