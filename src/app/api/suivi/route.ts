import { connection } from "next/server";
import { db, dbAvailable, dbErrorMessage, withTimeout } from "@/lib/db";
import { getLevel } from "@/lib/settings";

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
  levels: { en: string | null; fr: string | null };
  /** Courbe de progression : niveau observé à chaque séance comptée (plus récent d'abord). */
  progression: { day: string; language: string; level: string }[];
  byMode: { personality: string; minutes: number }[];
  monthFcfa: number;
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
    levels: { en: null, fr: null },
    progression: [],
    byMode: [],
    monthFcfa: 0,
    pron: { attempts: 0, average: null, weeks: [], sounds: [] },
  };
  if (!empty.db) return Response.json(empty);
  try {
    const sql = (await withTimeout(db(), 16000))!;
    const [weeks, days, totals, words, due, byMode, month, en, fr, pronWeeks, pronTotals, pronSounds, progression] = await withTimeout(Promise.all([
      sql<{ start: string; seconds: number }[]>`select to_char(date_trunc('week', started_at at time zone 'Africa/Dakar'), 'YYYY-MM-DD') as start,
        sum(seconds)::int as seconds from sessions
        where started_at > now() - interval '8 weeks' group by 1 order by 1`,
      sql<{ day: string }[]>`select distinct to_char((started_at at time zone 'Africa/Dakar')::date, 'YYYY-MM-DD') as day
        from sessions where seconds >= 30 order by 1 desc limit 400`,
      sql<{ n: number; seconds: number }[]>`select count(*)::int as n, coalesce(sum(seconds), 0)::int as seconds from sessions`,
      sql<{ n: number }[]>`select count(*)::int as n from words`,
      sql<{ n: number }[]>`select count(*)::int as n from words where due_at <= now()`,
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
    ]), 20000);
    return Response.json({
      ...empty,
      weeks: weeks.map((w) => ({ start: w.start, minutes: Math.round(w.seconds / 60) })),
      streak: streakFromDays(days.map((d) => d.day)),
      totalSessions: totals[0]?.n ?? 0,
      totalMinutes: Math.round((totals[0]?.seconds ?? 0) / 60),
      words: words[0]?.n ?? 0,
      dueWords: due[0]?.n ?? 0,
      levels: { en: en?.level ?? null, fr: fr?.level ?? null },
      progression,
      byMode: byMode.map((m) => ({ personality: m.personality, minutes: Math.round(m.seconds / 60) })),
      monthFcfa: Math.round(month[0]?.fcfa ?? 0),
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

/** Jours consécutifs avec une séance, en comptant aujourd'hui ou hier comme point de départ. */
function streakFromDays(days: string[]) {
  if (days.length === 0) return 0;
  const set = new Set(days);
  const today = new Date();
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!set.has(key(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (set.has(key(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
