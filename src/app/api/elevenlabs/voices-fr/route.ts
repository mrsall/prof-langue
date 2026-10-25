import { connection } from "next/server";
import { ensureFrenchVoices, listFrenchVoices } from "@/lib/french-voices";

export const maxDuration = 30;

/**
 * Voix françaises du compte ElevenLabs.
 * GET  : état (combien de voix françaises, lesquelles).
 * POST : ajoute celles qui manquent depuis la bibliothèque partagée.
 */
function missing(variable: string) {
  return Response.json(
    { error: `Configuration manquante : la variable ${variable} n'est pas définie sur le serveur (Vercel → Settings → Environment Variables).` },
    { status: 500 },
  );
}

export type FrenchVoicesStatus = {
  voices: { voiceId: string; name: string; gender: "male" | "female" }[];
  ok: boolean;
  added?: string[];
};

function statusOf(voices: FrenchVoicesStatus["voices"], added?: string[]): FrenchVoicesStatus {
  const males = voices.filter((v) => v.gender === "male").length;
  const females = voices.filter((v) => v.gender === "female").length;
  return { voices, ok: males >= 1 && females >= 1, added };
}

export async function GET() {
  await connection();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return missing("ELEVENLABS_API_KEY");
  try {
    return Response.json(statusOf(await listFrenchVoices(apiKey, true)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erreur ElevenLabs." }, { status: 502 });
  }
}

export async function POST() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return missing("ELEVENLABS_API_KEY");
  try {
    const { voices, added } = await ensureFrenchVoices(apiKey);
    return Response.json(statusOf(voices, added));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erreur ElevenLabs." }, { status: 502 });
  }
}
