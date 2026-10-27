import Anthropic from "@anthropic-ai/sdk";
import { connection } from "next/server";

export const maxDuration = 30;

/**
 * Vérifie que Claude répond comme en séance : même appel que le mode éco,
 * sur une phrase simple. Renvoie le modèle, la raison d'arrêt et un extrait,
 * sans jamais afficher la clé.
 */
const DEFAULT_MODEL = "claude-haiku-5-5";

export type ClaudeDiagnostic = {
  ok: boolean;
  configured: boolean;
  model: string;
  ms: number;
  stopReason: string | null;
  textLength: number;
  sample: string;
  error: string | null;
};

export async function GET() {
  await connection();
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const start = Date.now();
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, configured: false, model, ms: 0, stopReason: null, textLength: 0, sample: "", error: "ANTHROPIC_API_KEY manquante dans Vercel." } satisfies ClaudeDiagnostic);
  }
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: 120,
      system: "Tu es Emma, professeure de français patiente. Réponds en texte parlé simple, une ou deux phrases, puis une question.",
      messages: [{ role: "user", content: "hier j'ai bu mon café et après avoir bu le café" }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return Response.json({
      ok: text.length > 0,
      configured: true,
      model: response.model || model,
      ms: Date.now() - start,
      stopReason: response.stop_reason ?? null,
      textLength: text.length,
      sample: text.slice(0, 160),
      error: text.length > 0 ? null : `Claude a répondu sans texte (arrêt : ${response.stop_reason ?? "?"}, blocs : ${response.content.map((b) => b.type).join(", ") || "aucun"}).`,
    } satisfies ClaudeDiagnostic);
  } catch (error) {
    const detail = error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, configured: true, model, ms: Date.now() - start, stopReason: null, textLength: 0, sample: "", error: detail.slice(0, 300) } satisfies ClaudeDiagnostic);
  }
}
