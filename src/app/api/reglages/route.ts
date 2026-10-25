import { connection } from "next/server";
import { db, dbAvailable, dbErrorMessage, setSetting } from "@/lib/db";
import { DEFAULT_COST, getCostSettings, getLevel, getReminder, type CostSettings } from "@/lib/settings";

/**
 * Réglages et état général pour l'accueil et la page Réglages.
 */
export type ReglagesState = {
  db: boolean;
  dbError: string | null;
  levels: { en: { level: string; date: string } | null; fr: { level: string; date: string } | null };
  cost: CostSettings;
  todayMinutes: number;
  monthFcfa: number;
  reminder: { enabled: boolean; hour: number; subscribed: boolean };
  dueWords: number;
  pinEnabled: boolean;
};

export async function GET() {
  await connection();
  const state: ReglagesState = {
    db: dbAvailable(),
    dbError: null,
    levels: { en: null, fr: null },
    cost: DEFAULT_COST,
    todayMinutes: 0,
    monthFcfa: 0,
    reminder: { enabled: false, hour: 18, subscribed: false },
    dueWords: 0,
    pinEnabled: Boolean(process.env.APP_PIN),
  };
  if (!state.db) return Response.json(state);
  try {
    const sql = (await db())!;
    const [en, fr, cost, reminder, push, today, month, due] = await Promise.all([
      getLevel("en"),
      getLevel("fr"),
      getCostSettings(),
      getReminder(),
      sql<{ value: unknown }[]>`select value from settings where key = 'push'`,
      sql<{ seconds: number }[]>`select coalesce(sum(seconds), 0)::int as seconds from sessions
        where (started_at at time zone 'Africa/Dakar')::date = (now() at time zone 'Africa/Dakar')::date`,
      sql<{ fcfa: number }[]>`select coalesce(sum(cost_fcfa), 0)::float as fcfa from sessions
        where date_trunc('month', started_at at time zone 'Africa/Dakar') = date_trunc('month', now() at time zone 'Africa/Dakar')`,
      sql<{ n: number }[]>`select count(*)::int as n from words where due_at <= now()`,
    ]);
    state.levels = {
      en: en ? { level: en.level, date: en.date } : null,
      fr: fr ? { level: fr.level, date: fr.date } : null,
    };
    state.cost = cost;
    state.todayMinutes = Math.round((today[0]?.seconds ?? 0) / 60);
    state.monthFcfa = Math.round(month[0]?.fcfa ?? 0);
    state.reminder = { enabled: reminder.enabled, hour: reminder.hour, subscribed: push.length > 0 };
    state.dueWords = due[0]?.n ?? 0;
  } catch (error) {
    state.dbError = dbErrorMessage(error);
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

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
