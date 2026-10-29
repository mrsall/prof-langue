import { connection } from "next/server";
import { db, dbAvailable, dbErrorMessage, withTimeout } from "@/lib/db";
import { getCostSettings, getLevel } from "@/lib/settings";
import { elevenQuota, monthFcfaFromQuota, type ElevenQuota } from "@/lib/elevenlabs-quota";
import { streakFromDays } from "@/lib/streak";

export const maxDuration = 30;

/**
 * Chiffres pour l'écran de suivi : minutes par semaine, série, niveau, mots.
 */
export type SuiviData = {
  db: boolean;
  error?: string;
  weeks: { start: string; minutes: number }[];
  streak: number;
  totalSessions: number;
  totalMinutes: number;
  words: number;
  dueWords: number;
  /** Total et « à réviser aujourd'hui » par langue (même requête que le carnet). */
  wordsByLanguage: { en: { total: number; due: number }; fr: { total: number; due: number } };
  levels: { en: string | null; fr: string | null };
  /** Courbe de progression : niveau observé à chaque séance comptée (plus récent d'abord). */
  progression: { day: string; language: string; level: string }[];
  byMode: { personality: string; minutes: number }[];
  monthFcfa: number;
  elevenQuota: ElevenQuota | null;
  monthFcfaSource: "quota" | "minutes";
  /** V4 : prononciation (vide tant qu'aucune phrase n'a été notée). */
  pron: { attempts: number; average: number | null; weeks: { start: string; score: number }[]; sounds: { language: string; phoneme: string; score: number; attempts: number }[] };
};

export async function GET() {
  await connection();
  const empty: SuiviData = {
    db: dbAvailable(),
    weeks: [],
    streak: 0,
    totalSessions: 0,
    totalMinutes: 0,
    words: 0,
    dueWords: 0,
    wordsByLanguage: { en: { total: 0, due: 0 }, fr: { total: 0, due: 0 } },
    levels: { en: null, fr: null },
    progression: [],
    byMode: [],
    monthFcfa: 0,
    elevenQuota: null,
    monthFcfaSource: "minutes",
    pron: { attempts: 0, average: null, weeks: [], sounds: [] },
  };
  if (!empty.db) return Response.json(empty);
  try {
    const sql = (await withTimeout(db(), 16000))!;
    const quotaJob = process.env.ELEVENLABS_API_KEY ? elevenQuota().catch(() => null) : Promise.resolve(null);
    const [weeks, days, totals, words, , byMode, month, en, fr, pronWeeks, pronTotals, pronSounds, progression, cost] = await withTimeout(Promise.all([
      sql<{ start: string; seconds: number }[]>`select to_char(date_trunc('week', started_at at time zone 'Africa/Dakar'), 'YYYY-MM-DD') as start,
        sum(seconds)::int as seconds from sessions
        where started_at > now() - interval '8 weeks' group by 1 order by 1`,
      sql<{ day: string }[]>`select distinct to_char((started_at at time zone 'Africa/Dakar')::date, 'YYYY-MM-DD') as day
        from sessions where seconds >= 30 order by 1 desc limit 400`, // même règle que src/lib/streak.ts (dayStats)
      sql<{ n: number; seconds: number }[]>`select count(*)::int as n, coalesce(sum(seconds), 0)::int as seconds from sessions`,
      sql<{ language: string; total: number; due: number }[]>`select language, count(*)::int as total,
        count(*) filter (where due_at <= now())::int as due from words group by language`,
      Promise.resolve(null),
      sql<{ personality: string; seconds: number }[]>`select personality, sum(seconds)::int as seconds from sessions group by 1 order by 2 desc`,
      sql<{ fcfa: number }[]>`select coalesce(sum(cost_fcfa), 0)::float as fcfa from sessions
        where date_trunc('month', started_at at time zone 'Africa/Dakar') = date_trunc('month', now() at time zone 'Africa/Dakar')`,
      getLevel("en"),
      getLevel("fr"),
      sql<{ start: string; score: number }[]>`select to_char(date_trunc('week', created_at at time zone 'Africa/Dakar'), 'YYYY-MM-DD') as start,
        avg(pron_score)::int as score from pron_attempts
        where created_at > now() - interval '8 weeks' group by 1 order by 1`,
      sql<{ n: number; avg: number | null }[]>`select count(*)::int as n, avg(pron_score)::int as avg from pron_attempts
        where created_at > now() - interval '30 days'`,
      sql<{ language: string; phoneme: string; attempts: number; score: number }[]>`select language, phoneme, attempts,
        (score_sum / greatest(attempts, 1))::int as score from pron_sounds where attempts >= 3 order by 4 asc limit 6`,
      sql<{ day: string; language: string; level: string }[]>`select to_char(started_at at time zone 'Africa/Dakar', 'YYYY-MM-DD') as day, language, observed_level as level
        from sessions where observed_level is not null and kind = 'conversation' and seconds >= 180 order by started_at desc limit 14`,
      getCostSettings(),
    ]), 20000);
    const quota = await quotaJob;
    const realFcfa = quota ? monthFcfaFromQuota(quota, cost.planFcfa) : null;
    return Response.json({
      ...empty,
      weeks: weeks.map((w) => ({ start: w.start, minutes: Math.round(w.seconds / 60) })),
      streak: streakFromDays(days.map((d) => d.day)),
      totalSessions: totals[0]?.n ?? 0,
      totalMinutes: Math.round((totals[0]?.seconds ?? 0) / 60),
      words: words.reduce((n, w) => n + w.total, 0),
      dueWords: words.reduce((n, w) => n + w.due, 0),
      wordsByLanguage: {
        en: { total: words.find((w) => w.language === "en")?.total ?? 0, due: words.find((w) => w.language === "en")?.due ?? 0 },
        fr: { total: words.find((w) => w.language === "fr")?.total ?? 0, due: words.find((w) => w.language === "fr")?.due ?? 0 },
      },
      levels: { en: en?.level ?? null, fr: fr?.level ?? null },
      progression,
      byMode: byMode.map((m) => ({ personality: m.personality, minutes: Math.round(m.seconds / 60) })),
      monthFcfa: realFcfa ?? Math.round(month[0]?.fcfa ?? 0),
      elevenQuota: quota,
      monthFcfaSource: realFcfa != null ? "quota" : "minutes",
      pron: {
        attempts: pronTotals[0]?.n ?? 0,
        average: pronTotals[0]?.avg ?? null,
        weeks: pronWeeks,
        sounds: pronSounds,
      },
    } satisfies SuiviData);
  } catch (error) {
    return Response.json({ ...empty, error: dbErrorMessage(error) }, { status: 502 });
  }
}
