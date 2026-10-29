import { connection } from "next/server";

export const maxDuration = 30;
import { db, dbAvailable, dbErrorMessage, normalizeDatabaseUrl, SCHEMA_SQL, setSetting, withTimeout } from "@/lib/db";
import { DEFAULT_COST, getCostSettings, getLevel, getReminder, type CostSettings } from "@/lib/settings";
import { elevenQuota, monthFcfaFromQuota, type ElevenQuota } from "@/lib/elevenlabs-quota";
import { dayStats } from "@/lib/streak";
import { localeFor, pronunciationAvailable } from "@/lib/pronunciation";
import { geminiAvailable } from "@/lib/gemini";
import { groqAvailable } from "@/lib/groq-stt";
import { pcAvailable, pcHost } from "@/lib/pc-tts";
import { sttAvailable } from "@/lib/stt";

/**
 * Réglages et état général pour l'accueil et la page Réglages.
 */
export type ReglagesState = {
  db: boolean;
  dbError: string | null;
  /** Ce que l'app lit dans DATABASE_URL, sans le mot de passe. */
  dbInfo: { user: string; host: string; port: string; pooler: boolean; passwordPlaceholder: boolean } | null;
  levels: { en: { level: string; date: string } | null; fr: { level: string; date: string } | null };
  cost: CostSettings;
  /** Minutes ElevenLabs du jour (plafond de dépense). */
  todayMinutes: number;
  /** Minutes de toutes les séances du jour, tout moteur (objectif du jour). */
  todayAllMinutes: number;
  monthFcfa: number;
  reminder: { enabled: boolean; hour: number; subscribed: boolean };
  dueWords: number;
  pinEnabled: boolean;
  /** Série de jours calculée sur la base (null sans base). */
  streak: number | null;
  /** V4 : évaluation de la prononciation (Azure Speech). */
  pronunciation: { configured: boolean; region: string | null; locales: { en: string; fr: string } };
  /** SQL complet du schéma, pour l'appliquer à la main dans Supabase si besoin. */
  schemaSql: string;
  /** Voix Google (Gemini) : clé présente ou non. */
  gemini: { configured: boolean };
  /** Oreilles du mode éco : Groq (Whisper, gratuit) et Scribe (ElevenLabs). */
  ears: { groq: boolean; scribe: boolean };
  /** Voix « Mon PC » (Chatterbox sur l'ordinateur de Cherif). */
  pc: { configured: boolean; host: string | null };
  /** Vrais crédits ElevenLabs du mois (null si la clé manque). */
  elevenQuota: ElevenQuota | null;
  /** D'où vient `monthFcfa` : des vrais crédits × prix de l'abonnement, ou des minutes estimées. */
  monthFcfaSource: "quota" | "minutes";
};

export async function GET() {
  await connection();
  const state: ReglagesState = {
    db: dbAvailable(),
    dbError: null,
    dbInfo: describeDatabaseUrl(process.env.DATABASE_URL),
    levels: { en: null, fr: null },
    cost: DEFAULT_COST,
    todayMinutes: 0,
    todayAllMinutes: 0,
    monthFcfa: 0,
    reminder: { enabled: false, hour: 18, subscribed: false },
    dueWords: 0,
    pinEnabled: Boolean(process.env.APP_PIN),
    streak: null,
    pronunciation: { configured: pronunciationAvailable(), region: process.env.AZURE_SPEECH_REGION?.trim().toLowerCase() || null, locales: { en: localeFor("en"), fr: localeFor("fr") } },
    schemaSql: SCHEMA_SQL,
    gemini: { configured: geminiAvailable() },
    ears: { groq: groqAvailable(), scribe: sttAvailable() },
    pc: { configured: pcAvailable(), host: pcHost() },
    elevenQuota: null,
    monthFcfaSource: "minutes",
  };
  const quotaJob = process.env.ELEVENLABS_API_KEY ? elevenQuota().catch(() => null) : Promise.resolve(null);
  if (!state.db) {
    state.elevenQuota = await quotaJob;
    return Response.json(state);
  }
  try {
    const sql = (await withTimeout(db(), 16000))!;
    const [en, fr, cost, reminder, push, day, month, due] = await withTimeout(Promise.all([
      getLevel("en"),
      getLevel("fr"),
      getCostSettings(),
      getReminder(),
      sql<{ value: unknown }[]>`select value from settings where key = 'push'`,
      dayStats(sql),
      sql<{ fcfa: number }[]>`select coalesce(sum(cost_fcfa), 0)::float as fcfa from sessions
        where date_trunc('month', started_at at time zone 'Africa/Dakar') = date_trunc('month', now() at time zone 'Africa/Dakar')`,
      sql<{ n: number }[]>`select count(*)::int as n from words where due_at <= now()`,
    ]), 15000);
    state.levels = {
      en: en ? { level: en.level, date: en.date } : null,
      fr: fr ? { level: fr.level, date: fr.date } : null,
    };
    state.cost = cost;
    state.todayMinutes = day.todayMinutes;
    state.todayAllMinutes = day.todayAllMinutes;
    state.monthFcfa = Math.round(month[0]?.fcfa ?? 0);
    state.elevenQuota = await quotaJob;
    const real = state.elevenQuota ? monthFcfaFromQuota(state.elevenQuota, cost.planFcfa) : null;
    if (real != null) {
      state.monthFcfa = real;
      state.monthFcfaSource = "quota";
    }
    state.reminder = { enabled: reminder.enabled, hour: reminder.hour, subscribed: push.length > 0 };
    state.dueWords = due[0]?.n ?? 0;
    state.streak = day.streak;
  } catch (error) {
    state.dbError = dbErrorMessage(error);
    state.elevenQuota = await quotaJob;
  }
  return Response.json(state);
}

type Body = { cost?: Partial<CostSettings>; reminder?: { enabled?: boolean; hour?: number } };

export async function POST(request: Request) {
  if (!dbAvailable()) return Response.json({ error: "Base de données non configurée." }, { status: 400 });
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // vide
  }
  try {
    if (body.cost) {
      const current = await getCostSettings();
      const next: CostSettings = {
        perMinuteFcfa: clamp(Number(body.cost.perMinuteFcfa ?? current.perMinuteFcfa), 0, 100_000),
        dailyCapMinutes: clamp(Number(body.cost.dailyCapMinutes ?? current.dailyCapMinutes), 1, 600),
        planFcfa: clamp(Number(body.cost.planFcfa ?? current.planFcfa), 0, 10_000_000),
      };
      await setSetting("cost", next);
    }
    if (body.reminder) {
      const current = await getReminder();
      await setSetting("reminder", {
        ...current,
        enabled: typeof body.reminder.enabled === "boolean" ? body.reminder.enabled : current.enabled,
        hour: typeof body.reminder.hour === "number" ? clamp(Math.round(body.reminder.hour), 0, 23) : current.hour,
      });
    }
    return GET();
  } catch (error) {
    return Response.json({ error: dbErrorMessage(error) }, { status: 502 });
  }
}

function describeDatabaseUrl(raw: string | undefined): ReglagesState["dbInfo"] {
  if (!raw) return null;
  try {
    const u = new URL(normalizeDatabaseUrl(raw));
    return {
      user: decodeURIComponent(u.username),
      host: u.hostname,
      port: u.port || "5432",
      pooler: u.hostname.includes("pooler"),
      passwordPlaceholder: /YOUR-PASSWORD/i.test(raw),
    };
  } catch {
    return { user: "?", host: "chaîne illisible", port: "?", pooler: false, passwordPlaceholder: /YOUR-PASSWORD/i.test(raw) };
  }
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
