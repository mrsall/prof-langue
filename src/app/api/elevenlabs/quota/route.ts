import { connection } from "next/server";
import { elevenQuota } from "@/lib/elevenlabs-quota";

export const maxDuration = 15;

/** Crédits ElevenLabs réellement consommés ce mois-ci (`?force=1` ignore la mémoire d'une minute). */
export async function GET(req: Request) {
  await connection();
  const force = new URL(req.url).searchParams.get("force") === "1";
  return Response.json(await elevenQuota({ force }));
}
