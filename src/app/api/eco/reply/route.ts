import Anthropic from "@anthropic-ai/sdk";
import { prepareSession, type SessionBody } from "@/lib/session-prompt";
import type { TranscriptLine } from "@/lib/prompt";

export const maxDuration = 30;

/**
 * Mode éco : une réplique du personnage, calculée par Claude avec exactement
 * les mêmes consignes que la séance ElevenLabs. Le téléphone fait l'oreille
 * et la voix. Sans message de Cherif : renvoie la première réplique.
 */
const DEFAULT_MODEL = "claude-haiku-5-5";

type Body = SessionBody & { transcript?: TranscriptLine[] };

/** Si Claude ne renvoie rien (rare), le personnage relance au lieu de casser la séance. */
const FALLBACK_LINES: Record<"en" | "fr", string> = {
  en: "Sorry, I missed that. Can you say it again, a bit slower?",
  fr: "Pardon, je n'ai pas bien suivi. Tu peux redire ça, un peu plus lentement ?",
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
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const cleanText = (response: Anthropic.Message) =>
    response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/\*\*|__|#+\s?/g, "")
      .trim();
  try {
    const response = await client.messages.create({ model, max_tokens: 260, system, messages });
    let text = cleanText(response);
    if (!text) {
      // Réponse sans texte : on redemande une fois en insistant, puis on relance Cherif nous-mêmes.
      console.error("Mode éco : réponse vide", { stop_reason: response.stop_reason, blocks: response.content.map((b) => b.type) });
      const nudge: Anthropic.MessageParam = {
        role: "user",
        content: `${messages.at(-1)?.content as string}\n\n(${prepared.language === "en" ? "Answer in one or two spoken sentences, then ask a question." : "Réponds en une ou deux phrases parlées, puis pose une question."})`,
      };
      const retry = await client.messages.create({ model, max_tokens: 260, system, messages: [...messages.slice(0, -1), nudge] });
      text = cleanText(retry);
      if (!text) return Response.json({ text: FALLBACK_LINES[prepared.language], fallback: true, reason: `vide (${response.stop_reason ?? "?"})` });
    }
    return Response.json({ text });
  } catch (error) {
    const detail = error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error instanceof Error ? error.message : String(error);
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
