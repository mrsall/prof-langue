import Anthropic from "@anthropic-ai/sdk";
import { prepareSession, type SessionBody } from "@/lib/session-prompt";
import type { TranscriptLine } from "@/lib/prompt";
import { askClaude, claudeErrorDetail } from "@/lib/claude";

export const maxDuration = 60;

/**
 * Mode éco : une réplique du personnage, calculée par Claude avec exactement
 * les mêmes consignes que la séance ElevenLabs. Le téléphone fait l'oreille
 * et la voix. Sans message de Cherif : renvoie la première réplique.
 */
type Body = SessionBody & { transcript?: TranscriptLine[] };

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
  try {
    // Réplique courte : pas de réflexion, plafond large (la réflexion, quand un modèle l'impose, compte dedans).
    const first = await askClaude(client, { system, messages, maxTokens: 2048, effort: "medium", thinking: "disabled" });
    let text = tidy(first.text);
    if (text) return Response.json({ text });

    // Réponse sans texte : on redemande une fois en insistant, puis le personnage relance lui-même.
    console.error("Mode éco : réponse vide", { stop_reason: first.stopReason, blocks: first.blocks, model: first.model });
    const nudge: Anthropic.MessageParam = {
      role: "user",
      content: `${messages.at(-1)?.content as string}\n\n(${prepared.language === "en" ? "Answer in one or two spoken sentences, then ask a question." : "Réponds en une ou deux phrases parlées, puis pose une question."})`,
    };
    const retry = await askClaude(client, { system, messages: [...messages.slice(0, -1), nudge], maxTokens: 2048, effort: "low", thinking: "disabled" });
    text = tidy(retry.text);
    const detail = `réponse vide : arrêt ${first.stopReason ?? "?"}, blocs ${first.blocks.join("+") || "aucun"}, modèle ${first.model}`;
    if (!text) return Response.json({ text: FALLBACK_LINES[prepared.language], fallback: true, reason: detail });
    return Response.json({ text, fallback: true, reason: `${detail} ; seconde tentative réussie` });
  } catch (error) {
    const detail = claudeErrorDetail(error);
    console.error("Mode éco : erreur Anthropic", detail);
    const friendly =
      error instanceof Anthropic.APIError && error.status === 401
        ? "Clé Anthropic refusée. Vérifie ANTHROPIC_API_KEY."
        : error instanceof Anthropic.APIError && error.status === 429
          ? "Trop de demandes à Claude en ce moment. Attends quelques secondes."
          : "Claude n'a pas répondu. Réessaie.";
    return Response.json({ error: friendly }, { status: 502 });
  }
}
