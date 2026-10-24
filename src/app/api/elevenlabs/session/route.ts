import { findVoice } from "@/config/voices";
import { findPersonality, pickFirstMessage } from "@/config/personalities";
import { isSpeedKey, speedValue } from "@/config/speeds";

/**
 * Crée les identifiants d'une conversation ElevenLabs Agents et prépare les
 * consignes (personnalité, voix, vitesse) envoyées au début de la séance.
 *
 * La clé API ne quitte jamais le serveur : le téléphone reçoit seulement un
 * jeton WebRTC (ou une URL signée WebSocket) valable quelques minutes.
 */
const ELEVENLABS_API = "https://api.elevenlabs.io/v1/convai/conversation";

type TranscriptLine = { role: "user" | "agent"; text: string };

type Body = {
  voice?: string;
  connectionType?: "webrtc" | "websocket";
  personality?: string;
  speed?: string;
  /** Reprise d'une discussion en cours (changement de vitesse, coupure). */
  context?: { transcript?: TranscriptLine[]; resumeMessage?: string };
};

export type SessionOverrides = {
  agent?: { prompt?: { prompt: string }; firstMessage?: string };
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

function buildContextBlock(transcript: TranscriptLine[]) {
  const lines = transcript
    .slice(-12)
    .filter((l) => typeof l.text === "string" && l.text.trim())
    .map((l) => `${l.role === "user" ? "Cherif" : "You"}: ${l.text.trim().slice(0, 300)}`);
  if (lines.length === 0) return "";
  return `\n\nThis conversation was interrupted for a second and is now resuming. Do not greet him again, do not restart the topic: continue naturally from here.\nConversation so far:\n${lines.join("\n")}`;
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

  const connectionType: "webrtc" | "websocket" =
    body.connectionType === "websocket"
      ? "websocket"
      : body.connectionType === "webrtc"
        ? "webrtc"
        : process.env.ELEVENLABS_CONNECTION_TYPE === "websocket"
          ? "websocket"
          : "webrtc";

  // Agent dédié à cette voix (optionnel), sinon agent commun + voix imposée.
  const dedicatedAgentId =
    process.env[`ELEVENLABS_AGENT_ID_${voice.key.toUpperCase()}`];
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

  const data = (await upstream.json()) as {
    token?: string;
    signed_url?: string;
  };

  const overrides: SessionOverrides = {};
  const tts: NonNullable<SessionOverrides["tts"]> = {};
  if (!dedicatedAgentId) tts.voiceId = voice.voiceId;
  if (isSpeedKey(body.speed) && body.speed !== "normal") tts.speed = speedValue(body.speed);
  if (Object.keys(tts).length > 0) overrides.tts = tts;

  if (personality) {
    const context = body.context;
    const prompt = personality.prompt + buildContextBlock(context?.transcript ?? []);
    const firstMessage =
      context?.resumeMessage?.trim() || pickFirstMessage(personality);
    overrides.agent = { prompt: { prompt }, firstMessage };
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
