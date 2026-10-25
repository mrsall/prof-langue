import { findVoice } from "@/config/voices";
import { findPersonality, isLanguage, pickFirstMessage, type Language } from "@/config/personalities";
import { isSpeedKey, speedValue } from "@/config/speeds";
import { isCorrectionLevel } from "@/config/correction";
import { buildPrompt, type MemoryItem, type TranscriptLine } from "@/lib/prompt";
import { listFrenchVoices, pickFrenchVoice } from "@/lib/french-voices";
import { PERSONALITIES } from "@/config/personalities";

/**
 * Crée les identifiants d'une conversation ElevenLabs Agents et prépare les
 * consignes (personnalité, langue, correction, sujet, voix, vitesse) envoyées
 * au début de la séance.
 *
 * La clé API ne quitte jamais le serveur : le téléphone reçoit seulement un
 * jeton WebRTC (ou une URL signée WebSocket) valable quelques minutes.
 */
const ELEVENLABS_API = "https://api.elevenlabs.io/v1/convai/conversation";

type Body = {
  voice?: string;
  connectionType?: "webrtc" | "websocket";
  personality?: string;
  language?: string;
  correction?: string;
  speed?: string;
  topic?: string | null;
  ownTopic?: boolean;
  memory?: MemoryItem[];
  /** Reprise d'une discussion en cours (changement de réglage, coupure). */
  context?: { transcript?: TranscriptLine[]; resumeMessage?: string };
};

export type SessionOverrides = {
  agent?: { prompt?: { prompt: string }; firstMessage?: string; language?: Language };
  tts?: { voiceId?: string; speed?: number };
};

function configError(variable: string) {
  return Response.json(
    {
      error: `Configuration manquante : la variable ${variable} n'est pas définie sur le serveur (Vercel → Settings → Environment Variables).`,
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return configError("ELEVENLABS_API_KEY");

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // corps vide : on garde les valeurs par défaut
  }

  const personality = body.personality ? findPersonality(body.personality) : undefined;
  if (body.personality && !personality) {
    return Response.json({ error: "Personnalité inconnue." }, { status: 400 });
  }

  const voice = findVoice(body.voice ?? personality?.voiceKey);
  if (!voice) {
    return Response.json({ error: "Voix inconnue." }, { status: 400 });
  }

  const language: Language = isLanguage(body.language) ? body.language : "en";
  const correction = isCorrectionLevel(body.correction) ? body.correction : (personality?.correction ?? "aucune");

  const connectionType: "webrtc" | "websocket" =
    body.connectionType === "websocket"
      ? "websocket"
      : body.connectionType === "webrtc"
        ? "webrtc"
        : process.env.ELEVENLABS_CONNECTION_TYPE === "websocket"
          ? "websocket"
          : "webrtc";

  // Agent dédié à cette voix (optionnel), sinon agent commun + voix imposée.
  const dedicatedAgentId = process.env[`ELEVENLABS_AGENT_ID_${voice.key.toUpperCase()}`];
  const agentId = dedicatedAgentId || process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) return configError("ELEVENLABS_AGENT_ID");

  const endpoint =
    connectionType === "webrtc"
      ? `${ELEVENLABS_API}/token?agent_id=${encodeURIComponent(agentId)}`
      : `${ELEVENLABS_API}/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;

  const upstream = await fetch(endpoint, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    const hint =
      upstream.status === 401
        ? "Clé API ElevenLabs refusée. Vérifie ELEVENLABS_API_KEY."
        : upstream.status === 404
          ? "Agent introuvable. Vérifie ELEVENLABS_AGENT_ID."
          : `ElevenLabs a répondu ${upstream.status}.`;
    console.error("ElevenLabs session error", upstream.status, detail);
    return Response.json({ error: hint }, { status: 502 });
  }

  const data = (await upstream.json()) as { token?: string; signed_url?: string };

  const overrides: SessionOverrides = {};
  const tts: NonNullable<SessionOverrides["tts"]> = {};
  if (!dedicatedAgentId) tts.voiceId = voice.voiceId;
  if (language === "fr" && personality) {
    // En français, une vraie voix française (accent de France) plutôt qu'une
    // voix anglaise qui lit du français.
    try {
      const frenchVoices = await listFrenchVoices(apiKey);
      const index = Math.max(0, PERSONALITIES.findIndex((p) => p.id === personality.id));
      const gender = voice.gender === "femme" ? "female" : "male";
      const frVoice = pickFrenchVoice(frenchVoices, personality.id, gender, index);
      if (frVoice) tts.voiceId = frVoice;
    } catch (error) {
      console.error("Voix françaises indisponibles, voix par défaut utilisée", error);
    }
  }
  if (isSpeedKey(body.speed) && body.speed !== "normal") tts.speed = speedValue(body.speed);
  if (Object.keys(tts).length > 0) overrides.tts = tts;

  if (personality) {
    const topic = typeof body.topic === "string" && body.topic.trim() ? body.topic.trim().slice(0, 200) : null;
    const ownTopic = Boolean(body.ownTopic) || !topic;
    const memory = Array.isArray(body.memory)
      ? body.memory
          .filter((m) => m && typeof m.date === "string" && typeof m.mode === "string" && typeof m.topic === "string")
          .slice(0, 5)
      : [];
    const context = body.context;
    const prompt = buildPrompt({
      personality,
      language,
      correction,
      topic,
      ownTopic,
      memory,
      context: context?.transcript,
    });
    const firstMessage =
      context?.resumeMessage?.trim() ||
      (ownTopic ? personality.ownTopicMessages[language] : pickFirstMessage(personality, language, topic ?? ""));
    overrides.agent = { prompt: { prompt }, firstMessage };
    if (language !== "en") overrides.agent.language = language;
  }

  return Response.json({
    connectionType,
    conversationToken: data.token,
    signedUrl: data.signed_url,
    overrides,
    // Compatibilité avec la page de test V0.
    voiceId: dedicatedAgentId ? null : voice.voiceId,
  });
}
