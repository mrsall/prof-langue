import { createHmac } from "node:crypto";
import {
  prepareSession,
  SPOKEN_RULES,
  type SessionBody,
} from "@/lib/session-prompt";
import { pcAvailable, pcBaseUrl } from "@/lib/pc-tts";

export const maxDuration = 30;

/**
 * Mode temps réel sur le PC de Cherif (V5) : le téléphone parle directement au
 * PC par WebSocket. Ici, on prépare les consignes du personnage (mêmes que les
 * autres modes : niveau, carnet, souvenirs) et un ticket signé que le PC
 * vérifie avec le mot de passe partagé, sans que ce mot de passe quitte le serveur.
 */
export type LiveSession = {
  url: string;
  ticket: string;
  prompt: string;
  firstMessage: string;
  language: "en" | "fr";
  voice: string;
  personality: string;
};

export function makeTicket(secret: string, ttlMs = 3 * 3600_000) {
  const exp = String(Date.now() + ttlMs);
  const sig = createHmac("sha256", secret).update(exp).digest("hex");
  return `${exp}.${sig}`;
}

export async function POST(request: Request) {
  if (!pcAvailable())
    return Response.json(
      {
        error:
          "Le mode temps réel a besoin du PC (PC_TTS_URL et PC_TTS_TOKEN dans Vercel).",
      },
      { status: 503 },
    );
  let body: SessionBody = {};
  try {
    body = (await request.json()) as SessionBody;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const prepared = await prepareSession(body);
  if (!prepared)
    return Response.json({ error: "Personnalité inconnue." }, { status: 400 });
  const base = pcBaseUrl().replace(/^http/, "ws");
  const session: LiveSession = {
    url: `${base}/live`,
    ticket: makeTicket(process.env.PC_TTS_TOKEN!.trim()),
    prompt: `${prepared.prompt}\n\n${SPOKEN_RULES[prepared.language]}`,
    firstMessage: prepared.firstMessage,
    language: prepared.language,
    voice: prepared.personality.id,
    personality: prepared.personality.id,
  };
  return Response.json(session);
}
