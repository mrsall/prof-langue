import Anthropic from "@anthropic-ai/sdk";

/**
 * Un seul point d'appel à Claude pour toute l'app.
 *
 * Pourquoi : les modèles récents (Haiku 5.5) réfléchissent avant de répondre,
 * et cette réflexion compte dans `max_tokens`. Avec un plafond bas (260), la
 * réflexion consommait tout le budget et la réponse arrivait sans texte :
 * c'était la cause des « Réponse vide » en séance. Ici : plafond large,
 * effort faible (réponses rapides et économiques), réflexion coupée pour les
 * répliques courtes, et repli automatique si un modèle refuse ces réglages.
 */
export const DEFAULT_MODEL = "claude-haiku-5-5";

export function claudeModel() {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export type ClaudeAsk = {
  system: string;
  messages: Anthropic.MessageParam[];
  /** Plafond de sortie, réflexion comprise. Ne jamais le mettre trop bas. */
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** `disabled` (défaut) : réponse directe ; `adaptive` : le modèle réfléchit si utile (bilan, niveau). */
  thinking?: "disabled" | "adaptive";
};

export type ClaudeAnswer = {
  text: string;
  stopReason: string | null;
  model: string;
  /** Types de blocs reçus (text, thinking…), pour le diagnostic. */
  blocks: string[];
  /** Le plafond de sortie a coupé la réponse. */
  truncated: boolean;
};

export function textOf(response: Anthropic.Message) {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function askClaude(client: Anthropic, ask: ClaudeAsk): Promise<ClaudeAnswer> {
  const plain: Anthropic.MessageCreateParamsNonStreaming = {
    model: claudeModel(),
    max_tokens: ask.maxTokens ?? 2048,
    system: ask.system,
    messages: ask.messages,
  };
  const attempts: Anthropic.MessageCreateParamsNonStreaming[] = [
    { ...plain, output_config: { effort: ask.effort ?? "low" }, thinking: { type: ask.thinking ?? "disabled" } },
    { ...plain, output_config: { effort: ask.effort ?? "low" } },
    plain,
  ];
  let response: Anthropic.Message | null = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      response = await client.messages.create(attempts[i]);
      break;
    } catch (error) {
      // Un modèle qui n'accepte pas ces réglages (réflexion impossible à couper, effort inconnu) : même demande sans eux.
      if (!(error instanceof Anthropic.BadRequestError) || i === attempts.length - 1) throw error;
      console.warn("Claude : réglage refusé, nouvel essai sans", error.message.slice(0, 160));
    }
  }
  if (!response) throw new Error("Claude n'a pas répondu.");
  return {
    text: textOf(response),
    stopReason: response.stop_reason ?? null,
    model: response.model,
    blocks: response.content.map((b) => b.type),
    truncated: response.stop_reason === "max_tokens",
  };
}

export function claudeErrorDetail(error: unknown) {
  return error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error instanceof Error ? error.message : String(error);
}
