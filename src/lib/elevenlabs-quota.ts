import { ELEVENLABS_API_BASE } from "@/lib/elevenlabs-api";
import { elevenQuotaExhausted, markElevenQuotaExhausted, resetElevenQuota } from "@/lib/tts-chain";

/**
 * Vraie consommation de l'abonnement ElevenLabs (GET /v1/user/subscription) :
 * crédits utilisés / plafond du mois, date de remise à zéro. Lue au plus une fois
 * par minute (mémoire du serveur). Quand le compte a de nouveau du crédit, la
 * mémoire « quota épuisé » de la chaîne de voix est effacée.
 */
export type { ElevenQuota } from "@/lib/quota-format";
export { formatReset } from "@/lib/quota-format";
import type { ElevenQuota } from "@/lib/quota-format";

type Subscription = {
  tier?: string;
  character_count?: number;
  character_limit?: number;
  next_character_count_reset_unix?: number;
};

const CACHE_MS = 60 * 1000;
let cached: { at: number; value: ElevenQuota } | null = null;

export async function elevenQuota(options: { timeoutMs?: number; force?: boolean } = {}): Promise<ElevenQuota> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { configured: false, used: null, limit: null, pct: null, resetAt: null, exhausted: false, tier: null, error: "ELEVENLABS_API_KEY manquante." };
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) return { ...cached.value, exhausted: cached.value.exhausted || elevenQuotaExhausted() };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000);
  let value: ElevenQuota;
  try {
    const res = await fetch(`${ELEVENLABS_API_BASE}/v1/user/subscription`, { headers: { "xi-api-key": apiKey }, signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 160);
      value = { configured: true, used: null, limit: null, pct: null, resetAt: null, exhausted: elevenQuotaExhausted(), tier: null, error: `ElevenLabs a répondu ${res.status}${detail ? ` : ${detail}` : ""}` };
    } else {
      const sub = (await res.json()) as Subscription;
      const used = Number(sub.character_count ?? 0);
      const limit = Number(sub.character_limit ?? 0);
      const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
      const exhausted = limit > 0 && used >= limit;
      if (exhausted) markElevenQuotaExhausted(`${Math.max(0, limit - used)} crédit restant`);
      else if (limit > 0) resetElevenQuota();
      value = {
        configured: true,
        used,
        limit,
        pct,
        resetAt: sub.next_character_count_reset_unix ? new Date(sub.next_character_count_reset_unix * 1000).toISOString() : null,
        exhausted,
        tier: sub.tier ?? null,
        error: null,
      };
    }
  } catch (error) {
    value = {
      configured: true,
      used: null,
      limit: null,
      pct: null,
      resetAt: null,
      exhausted: elevenQuotaExhausted(),
      tier: null,
      error: error instanceof Error && error.name === "AbortError" ? "ElevenLabs n'a pas répondu en 4 s." : `ElevenLabs injoignable : ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
  cached = { at: Date.now(), value };
  return value;
}

/** Coût du mois en FCFA à partir des vrais crédits : part consommée × prix mensuel de l'abonnement (réglable). */
export function monthFcfaFromQuota(quota: ElevenQuota, planFcfa: number): number | null {
  if (!planFcfa || quota.pct == null) return null;
  return Math.round((quota.pct / 100) * planFcfa);
}
