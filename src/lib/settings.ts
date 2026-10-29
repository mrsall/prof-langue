import { getSetting, setSetting } from "@/lib/db";
import type { Language } from "@/config/personalities";

/**
 * Réglages persistants (base de données) et leurs valeurs par défaut.
 */
import { type LevelInfo } from "@/lib/levels";
export { LEVELS, LEVEL_DESCRIPTIONS, levelIsStale, type LevelInfo } from "@/lib/levels";

/** `planFcfa` : prix mensuel de l'abonnement ElevenLabs en FCFA (0 = inconnu → estimation par minute). */
export type CostSettings = { perMinuteFcfa: number; dailyCapMinutes: number; planFcfa: number };
export type ReminderSettings = { enabled: boolean; hour: number; lastSentDay: string | null };

export const DEFAULT_COST: CostSettings = { perMinuteFcfa: 60, dailyCapMinutes: 30, planFcfa: 0 };
export const DEFAULT_REMINDER: ReminderSettings = { enabled: false, hour: 18, lastSentDay: null };

export function levelKey(language: Language) {
  return `level:${language}`;
}

export async function getLevel(language: Language): Promise<LevelInfo | null> {
  return getSetting<LevelInfo | null>(levelKey(language), null);
}

export async function saveLevel(language: Language, info: LevelInfo) {
  return setSetting(levelKey(language), info);
}

export async function getCostSettings(): Promise<CostSettings> {
  const c = await getSetting<Partial<CostSettings>>("cost", DEFAULT_COST);
  return { ...DEFAULT_COST, ...c };
}

/** Variante d'anglais enseignée par tous les personnages (orthographe, vocabulaire). Américain par défaut. */
export type EnglishVariant = "us" | "uk";
export function isEnglishVariant(v: unknown): v is EnglishVariant {
  return v === "us" || v === "uk";
}
export async function getEnglishVariant(): Promise<EnglishVariant> {
  const v = await getSetting<string>("english_variant", "us");
  return isEnglishVariant(v) ? v : "us";
}

/** Objectif quotidien en minutes (tout mode confondu). 10 par défaut. */
export const DEFAULT_GOAL_MINUTES = 10;
export async function getGoalMinutes(): Promise<number> {
  const g = Number(await getSetting<number>("goal_minutes", DEFAULT_GOAL_MINUTES));
  return Number.isFinite(g) && g >= 1 && g <= 120 ? Math.round(g) : DEFAULT_GOAL_MINUTES;
}

export async function getReminder(): Promise<ReminderSettings> {
  const r = await getSetting<Partial<ReminderSettings>>("reminder", DEFAULT_REMINDER);
  return { ...DEFAULT_REMINDER, ...r };
}
