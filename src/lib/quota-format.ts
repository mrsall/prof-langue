/** Côté téléphone comme côté serveur : mise en forme du quota ElevenLabs (sans dépendance serveur). */
export type ElevenQuota = {
  configured: boolean;
  used: number | null;
  limit: number | null;
  /** Part consommée, 0 à 100. */
  pct: number | null;
  /** Date ISO de la remise à zéro des crédits. */
  resetAt: string | null;
  /** Plus aucun crédit (ou ElevenLabs vient de répondre quota_exceeded). */
  exhausted: boolean;
  tier: string | null;
  error: string | null;
};

/** « 12/11 » pour la date de remise à zéro, heure de Dakar. */
export function formatReset(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Africa/Dakar" });
}
