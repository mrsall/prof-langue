import { findVoice } from "@/config/voices";

/**
 * Crée les identifiants d'une conversation ElevenLabs Agents.
 *
 * La clé API ne quitte jamais le serveur : le téléphone reçoit seulement un
 * jeton WebRTC (ou une URL signée WebSocket) valable quelques minutes.
 */
const ELEVENLABS_API = "https://api.elevenlabs.io/v1/convai/conversation";

type Body = {
  voice?: string;
  connectionType?: "webrtc" | "websocket";
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

  const voice = findVoice(body.voice);
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

  return Response.json({
    connectionType,
    conversationToken: data.token,
    signedUrl: data.signed_url,
    // On n'impose la voix que sur l'agent commun.
    voiceId: dedicatedAgentId ? null : voice.voiceId,
  });
}
