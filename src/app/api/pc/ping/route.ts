import { connection } from "next/server";
import { pcAvailable, pcHealth, pcLikelyDown } from "@/lib/pc-tts";

export const maxDuration = 15;

/**
 * Le PC de Cherif répond-il ? Réponse en 3 s au plus. Sert au début d'une séance
 * pour choisir tout de suite une voix et une oreille de repli si le PC est éteint,
 * au lieu d'attendre un délai à chaque phrase.
 */
export async function GET() {
  await connection();
  if (!pcAvailable()) return Response.json({ ok: false, configured: false, error: "PC non configuré." });
  if (pcLikelyDown()) return Response.json({ ok: false, configured: true, error: "PC marqué injoignable il y a moins d'une minute." });
  const health = await pcHealth(3000);
  return Response.json({ ok: Boolean(health.ok), configured: true, live: Boolean(health.live), error: health.ok ? null : (health.error ?? "Le PC ne répond pas.") });
}
