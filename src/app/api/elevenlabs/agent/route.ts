/**
 * Réglage automatique de l'agent ElevenLabs, pour éviter les clics dans le
 * dashboard : autorise les overrides dont l'app a besoin (consignes, première
 * phrase, voix, vitesse) et choisit un modèle Claude Haiku comme cerveau.
 *
 * GET  : état actuel (sans rien changer).
 * POST : applique les réglages. Idempotent : refaire n'abîme rien.
 */
const AGENTS_API = "https://api.elevenlabs.io/v1/convai/agents";
const TARGET_LLM = process.env.ELEVENLABS_AGENT_LLM || "claude-haiku-5-5";

type OverrideFlags = {
  agent?: { first_message?: boolean; prompt?: { prompt?: boolean } };
  tts?: { voice_id?: boolean; speed?: boolean };
};

type Agent = {
  agent_id?: string;
  name?: string;
  conversation_config?: {
    agent?: { prompt?: Record<string, unknown> & { llm?: string } };
  };
  platform_settings?: {
    overrides?: { conversation_config_override?: OverrideFlags } & Record<string, unknown>;
  };
};

export type AgentStatus = {
  configured: boolean;
  name: string | null;
  llm: string | null;
  llmOk: boolean;
  overrides: { prompt: boolean; firstMessage: boolean; voiceId: boolean; speed: boolean };
  ok: boolean;
};

function env() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  return { apiKey, agentId };
}

function missing(variable: string) {
  return Response.json(
    { error: `Configuration manquante : la variable ${variable} n'est pas définie sur le serveur (Vercel → Settings → Environment Variables).` },
    { status: 500 },
  );
}

async function fetchAgent(apiKey: string, agentId: string) {
  const res = await fetch(`${AGENTS_API}/${encodeURIComponent(agentId)}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("ElevenLabs get agent", res.status, detail);
    throw new Error(
      res.status === 401
        ? "Clé API ElevenLabs refusée. Vérifie ELEVENLABS_API_KEY."
        : res.status === 404
          ? "Agent introuvable. Vérifie ELEVENLABS_AGENT_ID."
          : `ElevenLabs a répondu ${res.status}.`,
    );
  }
  return (await res.json()) as Agent;
}

function statusOf(agent: Agent): AgentStatus {
  const flags = agent.platform_settings?.overrides?.conversation_config_override ?? {};
  const llm = agent.conversation_config?.agent?.prompt?.llm ?? null;
  const overrides = {
    prompt: Boolean(flags.agent?.prompt?.prompt),
    firstMessage: Boolean(flags.agent?.first_message),
    voiceId: Boolean(flags.tts?.voice_id),
    speed: Boolean(flags.tts?.speed),
  };
  const llmOk = typeof llm === "string" && llm.startsWith("claude");
  return {
    configured: true,
    name: agent.name ?? null,
    llm,
    llmOk,
    overrides,
    ok: llmOk && overrides.prompt && overrides.firstMessage && overrides.voiceId && overrides.speed,
  };
}

export async function GET() {
  const { apiKey, agentId } = env();
  if (!apiKey) return missing("ELEVENLABS_API_KEY");
  if (!agentId) return missing("ELEVENLABS_AGENT_ID");
  try {
    return Response.json(statusOf(await fetchAgent(apiKey, agentId)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erreur ElevenLabs." }, { status: 502 });
  }
}

export async function POST() {
  const { apiKey, agentId } = env();
  if (!apiKey) return missing("ELEVENLABS_API_KEY");
  if (!agentId) return missing("ELEVENLABS_AGENT_ID");

  try {
    const current = await fetchAgent(apiKey, agentId);
    const currentOverrides = current.platform_settings?.overrides ?? {};
    const currentFlags = currentOverrides.conversation_config_override ?? {};
    const currentPrompt = current.conversation_config?.agent?.prompt ?? {};

    // On repart de l'existant pour ne rien effacer d'autre.
    const body = {
      conversation_config: {
        agent: {
          prompt: { ...currentPrompt, llm: TARGET_LLM },
        },
      },
      platform_settings: {
        overrides: {
          ...currentOverrides,
          conversation_config_override: {
            ...currentFlags,
            agent: {
              ...(currentFlags.agent ?? {}),
              first_message: true,
              prompt: { ...(currentFlags.agent?.prompt ?? {}), prompt: true },
            },
            tts: { ...(currentFlags.tts ?? {}), voice_id: true, speed: true },
          },
        },
      },
    };

    const res = await fetch(`${AGENTS_API}/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("ElevenLabs patch agent", res.status, detail);
      return Response.json(
        { error: `ElevenLabs a refusé le réglage (${res.status}). Vérifie que la clé API a le droit de modifier les agents.` },
        { status: 502 },
      );
    }
    return Response.json(statusOf(await fetchAgent(apiKey, agentId)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erreur ElevenLabs." }, { status: 502 });
  }
}
