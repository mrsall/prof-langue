import Anthropic from "@anthropic-ai/sdk";
import { connection } from "next/server";
import { askClaude, claudeErrorDetail, claudeModel } from "@/lib/claude";

export const maxDuration = 30;

/**
 * Vérifie que Claude répond comme en séance : même appel que le mode éco,
 * sur une phrase simple. Renvoie le modèle, la raison d'arrêt et un extrait,
 * sans jamais afficher la clé.
 */
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
  const model = claudeModel();
  const start = Date.now();
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, configured: false, model, ms: 0, stopReason: null, textLength: 0, sample: "", error: "ANTHROPIC_API_KEY manquante dans Vercel." } satisfies ClaudeDiagnostic);
  }
  try {
    const client = new Anthropic();
    const answer = await askClaude(client, {
      system: "Tu es Emma, professeure de français patiente. Réponds en texte parlé simple, une ou deux phrases, puis une question.",
      messages: [{ role: "user", content: "hier j'ai bu mon café et après avoir bu le café" }],
      maxTokens: 1024,
      effort: "low",
      thinking: "disabled",
    });
    return Response.json({
      ok: answer.text.length > 0,
      configured: true,
      model: answer.model || model,
      ms: Date.now() - start,
      stopReason: answer.stopReason,
      textLength: answer.text.length,
      sample: answer.text.slice(0, 160),
      error: answer.text.length > 0 ? null : `Claude a répondu sans texte (arrêt : ${answer.stopReason ?? "?"}, blocs : ${answer.blocks.join(", ") || "aucun"}).`,
    } satisfies ClaudeDiagnostic);
  } catch (error) {
    return Response.json({ ok: false, configured: true, model, ms: Date.now() - start, stopReason: null, textLength: 0, sample: "", error: claudeErrorDetail(error).slice(0, 300) } satisfies ClaudeDiagnostic);
  }
}
