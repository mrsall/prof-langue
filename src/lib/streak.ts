import type { Sql } from "postgres";

/**
 * Série de jours : UNE seule fonction, sur le fuseau de Dakar, utilisée par
 * l'accueil (/api/reglages), le suivi (/api/suivi) et le bilan (/api/sessions).
 * Un jour compte quand une séance d'au moins 30 s y a eu lieu (tout moteur confondu).
 */
export const TZ = "Africa/Dakar";

/** AAAA-MM-JJ du jour à Dakar. */
export function dakarToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Jours consécutifs avec une séance, aujourd'hui ou hier comme point de départ. */
export function streakFromDays(days: string[], today = dakarToday()): number {
  if (days.length === 0) return 0;
  const set = new Set(days);
  let cursor = set.has(today) ? today : set.has(shiftDay(today, -1)) ? shiftDay(today, -1) : null;
  if (!cursor) return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

export type DayStats = { streak: number; /** minutes de toutes les séances du jour (objectif) */ todayAllMinutes: number; /** minutes ElevenLabs du jour (plafond) */ todayMinutes: number };

/** Série et minutes du jour lues dans la base. */
export async function dayStats(sql: Sql): Promise<DayStats> {
  const [days, today] = await Promise.all([
    sql<{ day: string }[]>`select distinct to_char((started_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day
      from sessions where seconds >= 30 order by 1 desc limit 400`,
    sql<{ all_seconds: number; eleven_seconds: number }[]>`select
      coalesce(sum(seconds), 0)::int as all_seconds,
      coalesce(sum(seconds) filter (where engine = 'elevenlabs'), 0)::int as eleven_seconds
      from sessions where (started_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date`,
  ]);
  return {
    streak: streakFromDays(days.map((d) => d.day)),
    todayAllMinutes: Math.round((today[0]?.all_seconds ?? 0) / 60),
    todayMinutes: Math.round((today[0]?.eleven_seconds ?? 0) / 60),
  };
}
