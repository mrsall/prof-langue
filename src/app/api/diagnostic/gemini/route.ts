import { connection } from "next/server";
import { geminiAvailable, geminiSpeak, geminiTtsModel } from "@/lib/gemini";

export const maxDuration = 30;

/** Vérifie la clé Google AI Studio : liste les modèles, fabrique un « Bonjour ». */
export type GeminiDiagnostic = { ok: boolean; configured: boolean; model: string | null; ms: number; bytes: number; error: string | null };

export async function GET() {
  await connection();
  const start = Date.now();
  if (!geminiAvailable()) {
    return Response.json({ ok: false, configured: false, model: null, ms: 0, bytes: 0, error: "GEMINI_API_KEY manquante dans Vercel." } satisfies GeminiDiagnostic);
  }
  try {
    const model = await geminiTtsModel(process.env.GEMINI_API_KEY!.trim());
    const { wav } = await geminiSpeak({ text: "Bonjour Cherif, je suis la voix Google.", voice: "Kore", language: "fr" });
    return Response.json({ ok: wav.length > 1000, configured: true, model, ms: Date.now() - start, bytes: wav.length, error: wav.length > 1000 ? null : "Audio vide." } satisfies GeminiDiagnostic);
  } catch (error) {
    return Response.json({ ok: false, configured: true, model: null, ms: Date.now() - start, bytes: 0, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) } satisfies GeminiDiagnostic);
  }
}
