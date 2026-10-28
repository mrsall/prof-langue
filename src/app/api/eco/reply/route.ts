import Anthropic from "@anthropic-ai/sdk";
import { prepareSession, type SessionBody } from "@/lib/session-prompt";
import type { TranscriptLine } from "@/lib/prompt";
import { askClaude, claudeErrorDetail, streamClaude } from "@/lib/claude";

export const maxDuration = 60;

/**
 * Mode éco : une réplique du personnage, calculée par Claude avec exactement
 * les mêmes consignes que la séance ElevenLabs. Le téléphone fait l'oreille
 * et la voix. Sans message de Cherif : renvoie la première réplique.
 */
type Body = SessionBody & { transcript?: TranscriptLine[]; /** Réponse au fil de l'eau (NDJSON) pour que la voix démarre à la première phrase. */ stream?: boolean };

/** Si Claude ne renvoie rien (rare), le personnage relance au lieu de casser la séance. */
const FALLBACK_LINES: Record<"en" | "fr", string> = {
  en: "Sorry, I had a small hiccup on my side, not yours. Can you say that again?",
  fr: "Pardon, j'ai eu un petit souci de mon côté, pas du tien. Tu peux redire ta phrase ?",
};

const ECO_RULES: Record<"en" | "fr", string> = {
  en: "You are speaking through a phone voice that reads your text aloud. Reply with plain spoken text only: no markdown, no lists, no stage directions, no emojis. One to three short sentences, then a question. Keep any <voice name=\"judge\"> tags exactly as instructed for the debate; never use other tags.",
  fr: "Tu parles à travers une voix de téléphone qui lit ton texte à voix haute. Réponds en texte parlé simple : pas de markdown, pas de liste, pas de didascalie, pas d'émoji. Une à trois phrases courtes, puis une question. Garde les balises <voice name=\"juge\"> exactement comme demandé pour le débat ; aucune autre balise.",
};

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const prepared = await prepareSession(body);
  if (!prepared) return Response.json({ error: "Personnalité inconnue." }, { status: 400 });

  const transcript = (Array.isArray(body.transcript) ? body.transcript : [])
    .filter((l): l is TranscriptLine => Boolean(l) && (l.role === "user" || l.role === "agent") && typeof l.text === "string" && l.text.trim().length > 0)
    .slice(-40);
  const firstUser = transcript.findIndex((l) => l.role === "user");
  if (firstUser === -1) return Response.json({ text: prepared.firstMessage });

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Clé Anthropic manquante (ANTHROPIC_API_KEY) : le mode éco a besoin de Claude pour répondre." }, { status: 503 });
  }

  const opening = transcript
    .slice(0, firstUser)
    .map((l) => l.text)
    .join(" ");
  const messages: Anthropic.MessageParam[] = [];
  for (const line of transcript.slice(firstUser)) {
    const role = line.role === "user" ? "user" : "assistant";
    const last = messages.at(-1);
    if (last && last.role === role) {
      last.content = `${last.content as string}\n${line.text}`;
    } else {
      messages.push({ role, content: line.text });
    }
  }
  if (messages.at(-1)?.role !== "user") return Response.json({ text: null });

  const system = [
    prepared.prompt,
    ECO_RULES[prepared.language],
    opening ? (prepared.language === "en" ? `You opened the conversation with: "${opening}"` : `Tu as ouvert la discussion avec : « ${opening} »`) : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = new Anthropic();
  const tidy = (t: string) => t.replace(/\*\*|__|#+\s?/g, "").trim();
  const language = prepared.language;
  const nudgeFor = (): Anthropic.MessageParam => ({
    role: "user",
    content: `${messages.at(-1)?.content as string}\n\n(${language === "en" ? "Answer in one or two spoken sentences, then ask a question." : "Réponds en une ou deux phrases parlées, puis pose une question."})`,
  });

  if (body.stream) {
    // Une ligne JSON par événement : {type:"delta",text} … {type:"done",text,fallback?,reason?} ou {type:"error",message,fatal}.
    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          let streamed = "";
          const first = await streamClaude(client, { system, messages, maxTokens: 2048, effort: "medium", thinking: "disabled" }, (delta) => {
            streamed += delta;
            send({ type: "delta", text: delta });
          });
          let text = tidy(first.text || streamed);
          if (text) {
            send({ type: "done", text });
          } else {
            console.error("Mode éco (flux) : réponse vide", { stop_reason: first.stopReason, blocks: first.blocks, model: first.model });
            const retry = await askClaude(client, { system, messages: [...messages.slice(0, -1), nudgeFor()], maxTokens: 2048, effort: "low", thinking: "disabled" });
            text = tidy(retry.text);
            const detail = `réponse vide : arrêt ${first.stopReason ?? "?"}, blocs ${first.blocks.join("+") || "aucun"}, modèle ${first.model}`;
            const final = text || FALLBACK_LINES[language];
            send({ type: "delta", text: final });
            send({ type: "done", text: final, fallback: true, reason: text ? `${detail} ; seconde tentative réussie` : detail });
          }
        } catch (error) {
          console.error("Mode éco (flux) : erreur Anthropic", claudeErrorDetail(error));
          send({ type: "error", message: friendlyError(error), fatal: error instanceof Anthropic.APIError && error.status === 401 });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(readable, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  }

  try {
    // Réplique courte : pas de réflexion, plafond large (la réflexion, quand un modèle l'impose, compte dedans).
    const first = await askClaude(client, { system, messages, maxTokens: 2048, effort: "medium", thinking: "disabled" });
    let text = tidy(first.text);
    if (text) return Response.json({ text });

    // Réponse sans texte : on redemande une fois en insistant, puis le personnage relance lui-même.
    console.error("Mode éco : réponse vide", { stop_reason: first.stopReason, blocks: first.blocks, model: first.model });
    const retry = await askClaude(client, { system, messages: [...messages.slice(0, -1), nudgeFor()], maxTokens: 2048, effort: "low", thinking: "disabled" });
    text = tidy(retry.text);
    const detail = `réponse vide : arrêt ${first.stopReason ?? "?"}, blocs ${first.blocks.join("+") || "aucun"}, modèle ${first.model}`;
    if (!text) return Response.json({ text: FALLBACK_LINES[prepared.language], fallback: true, reason: detail });
    return Response.json({ text, fallback: true, reason: `${detail} ; seconde tentative réussie` });
  } catch (error) {
    console.error("Mode éco : erreur Anthropic", claudeErrorDetail(error));
    return Response.json({ error: friendlyError(error) }, { status: 502 });
  }
}

function friendlyError(error: unknown) {
  return error instanceof Anthropic.APIError && error.status === 401
    ? "Clé Anthropic refusée. Vérifie ANTHROPIC_API_KEY."
    : error instanceof Anthropic.APIError && error.status === 429
      ? "Trop de demandes à Claude en ce moment. Attends quelques secondes."
      : "Claude n'a pas répondu. Réessaie.";
}
