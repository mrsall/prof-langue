import { connection } from "next/server";

export const maxDuration = 30;
/**
 * Réglage automatique de l'agent ElevenLabs, pour éviter les clics dans le
 * dashboard : autorise les overrides dont l'app a besoin (consignes, première
 * phrase, langue, voix, vitesse), ajoute le français aux langues de l'agent,
 * passe sur un modèle de voix multilingue et choisit Claude Haiku.
 *
 * GET  : état actuel (sans rien changer).
 * POST : applique les réglages. Idempotent : refaire n'abîme rien.
 */
const AGENTS_API = "https://api.elevenlabs.io/v1/convai/agents";
const TARGET_LLM = process.env.ELEVENLABS_AGENT_LLM || "claude-haiku-5-5";
const MULTILINGUAL_TTS = process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";
const ENGLISH_ONLY_TTS = new Set(["eleven_turbo_v2", "eleven_flash_v2"]);
/** Voix du juge en anglais (Daniel, britannique, posé). */
const JUDGE_VOICE_EN = process.env.ELEVENLABS_VOICE_JUDGE_EN || "onwK4e9ZLuTAKqWW03F9";

type OverrideFlags = {
  agent?: { first_message?: boolean; language?: boolean; prompt?: { prompt?: boolean } };
  tts?: { voice_id?: boolean; speed?: boolean };
};

type SupportedVoice = { label: string; voice_id: string; description?: string; language?: string };

type Agent = {
  agent_id?: string;
  name?: string;
  conversation_config?: {
    agent?: { prompt?: Record<string, unknown> & { llm?: string } };
    tts?: Record<string, unknown> & { model_id?: string; supported_voices?: SupportedVoice[] };
    language_presets?: Record<string, unknown>;
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
  ttsModel: string | null;
  ttsMultilingual: boolean;
  frenchReady: boolean;
  judgeVoices: boolean;
  overrides: { prompt: boolean; firstMessage: boolean; language: boolean; voiceId: boolean; speed: boolean };
  ok: boolean;
};

function env() {
  return { apiKey: process.env.ELEVENLABS_API_KEY, agentId: process.env.ELEVENLABS_AGENT_ID };
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
  const ttsModel = agent.conversation_config?.tts?.model_id ?? null;
  const overrides = {
    prompt: Boolean(flags.agent?.prompt?.prompt),
    firstMessage: Boolean(flags.agent?.first_message),
    language: Boolean(flags.agent?.language),
    voiceId: Boolean(flags.tts?.voice_id),
    speed: Boolean(flags.tts?.speed),
  };
  const llmOk = typeof llm === "string" && llm.startsWith("claude");
  const ttsMultilingual = typeof ttsModel === "string" && !ENGLISH_ONLY_TTS.has(ttsModel);
  const frenchReady = Boolean(agent.conversation_config?.language_presets && "fr" in agent.conversation_config.language_presets);
  const supported = agent.conversation_config?.tts?.supported_voices ?? [];
  const judgeVoices = supported.some((v) => v.label === "judge");
  return {
    configured: true,
    name: agent.name ?? null,
    llm,
    llmOk,
    ttsModel,
    ttsMultilingual,
    frenchReady,
    judgeVoices,
    overrides,
    ok:
      llmOk &&
      ttsMultilingual &&
      frenchReady &&
      judgeVoices &&
      overrides.prompt &&
      overrides.firstMessage &&
      overrides.language &&
      overrides.voiceId &&
      overrides.speed,
  };
}

export async function GET() {
  await connection();
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
    const currentTts = current.conversation_config?.tts ?? {};
    const currentPresets = current.conversation_config?.language_presets ?? {};
    const ttsModel =
      typeof currentTts.model_id === "string" && !ENGLISH_ONLY_TTS.has(currentTts.model_id)
        ? currentTts.model_id
        : MULTILINGUAL_TTS;

    // Voix du juge (mode débat) : une en anglais, une en français si disponible.
    const others = (currentTts.supported_voices ?? []).filter((v) => v.label !== "judge" && v.label !== "juge");
    const supportedVoices: SupportedVoice[] = [
      ...others,
      { label: "judge", voice_id: JUDGE_VOICE_EN, description: "The neutral judge of the debate, in English. Use only for the judge's lines in debate mode." },
    ];
    try {
      const { listFrenchVoices } = await import("@/lib/french-voices");
      const fr = await listFrenchVoices(apiKey);
      const judgeFr = process.env.ELEVENLABS_VOICE_JUDGE_FR || fr.filter((v) => v.gender === "male").at(-1)?.voiceId || fr.at(-1)?.voiceId;
      if (judgeFr) supportedVoices.push({ label: "juge", voice_id: judgeFr, language: "fr", description: "Le juge neutre du débat, en français. Seulement pour les répliques du juge en mode débat." });
    } catch (error) {
      console.error("Voix du juge FR indisponible", error);
    }

    // On repart de l'existant pour ne rien effacer d'autre.
    const body = {
      conversation_config: {
        agent: { prompt: { ...currentPrompt, llm: TARGET_LLM } },
        tts: { ...currentTts, model_id: ttsModel, supported_voices: supportedVoices },
        language_presets: {
          ...currentPresets,
          fr: currentPresets.fr ?? { overrides: { agent: { language: "fr" } } },
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
              language: true,
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
