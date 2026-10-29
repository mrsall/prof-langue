import { db, dbAvailable, dbErrorMessage } from "@/lib/db";
import { dayStats } from "@/lib/streak";
import { dedupeWords } from "@/lib/words-dedupe";
import { getCostSettings, getLevel, LEVELS, saveLevel } from "@/lib/settings";
import { isLanguage, type Language } from "@/config/personalities";
import type { Sql } from "postgres";

export const maxDuration = 30;

/**
 * Enregistre une séance terminée (texte, bilan, statistiques) et alimente le
 * carnet de mots et la liste des erreurs. Sans base de données : ne fait rien.
 */
type Body = {
  kind?: string;
  language?: string;
  personality?: string;
  topic?: string | null;
  seconds?: number;
  userTurns?: number;
  userShare?: number;
  transcript?: { role: "user" | "agent"; text: string }[];
  corrections?: { index: number; corrected: string }[];
  errors?: { wrong: string; right: string; tip: string }[];
  /** `kind` : "mot" (défaut) ou "plus-naturel" (tournure plus polie / naturelle / précise, pas une erreur). */
  words?: { en: string; fr: string; kind?: string }[];
  encouragement?: string | null;
  level?: string | null;
  /** Niveau observé par le bilan sur cette séance (A1 à C2). */
  observedLevel?: string | null;
  /** "elevenlabs" (minutes payantes), "eco" (téléphone + Claude) ou "live" (temps réel sur le PC), ces deux-là gratuits. */
  engine?: string;
};

/** Courbe de progression : où en est Cherif par rapport au niveau enregistré. */
export type Progression = {
  language: Language;
  /** Niveau observé sur cette séance. */
  observed: string;
  /** Niveau enregistré avant cette séance (null : pas encore de test). */
  current: string | null;
  /** Séances de suite (celle-ci comprise) jugées au-dessus du niveau enregistré. */
  streak: number;
  needed: number;
  /** Nouveau niveau atteint grâce à cette séance, sinon null. */
  promoted: string | null;
};

/** Nombre de séances de suite au-dessus du niveau pour passer au niveau suivant. */
const SESSIONS_TO_LEVEL_UP = 3;
/** Une séance compte si elle est assez longue et si Cherif a vraiment parlé. */
const MIN_SECONDS = 180;
const MIN_TURNS = 6;

/**
 * Le niveau monte d'un cran quand plusieurs séances de suite sont jugées au-dessus
 * du niveau enregistré ; il ne redescend jamais tout seul (le test mensuel s'en charge).
 */
async function updateProgression(sql: Sql, language: Language, observed: string, seconds: number, userTurns: number): Promise<Progression | null> {
  const idx = (l: string | null | undefined) => (l ? (LEVELS as readonly string[]).indexOf(l) : -1);
  if (idx(observed) < 0 || seconds < MIN_SECONDS || userTurns < MIN_TURNS) return null;
  const current = await getLevel(language);
  const currentIdx = idx(current?.level);
  // Seules les séances postérieures au dernier niveau enregistré (test ou passage) comptent pour le suivant.
  const since = current?.date && !Number.isNaN(Date.parse(current.date)) ? new Date(current.date) : new Date(0);
  const rows = await sql<{ observed_level: string }[]>`select observed_level from sessions
    where language = ${language} and kind = 'conversation' and observed_level is not null
      and seconds >= ${MIN_SECONDS} and user_turns >= ${MIN_TURNS} and started_at > ${since}
    order by started_at desc limit ${SESSIONS_TO_LEVEL_UP}`;
  let streak = 0;
  for (const r of rows) {
    if (idx(r.observed_level) > currentIdx) streak++;
    else break;
  }
  let promoted: string | null = null;
  if (streak >= SESSIONS_TO_LEVEL_UP && currentIdx < LEVELS.length - 1) {
    // Sans test de niveau : on retient le plus bas des niveaux observés (prudent) ; sinon un cran au-dessus.
    const targetIdx = currentIdx < 0 ? Math.min(...rows.map((r) => idx(r.observed_level))) : currentIdx + 1;
    promoted = LEVELS[Math.max(0, targetIdx)];
    await saveLevel(language, {
      level: promoted,
      date: new Date().toISOString(),
      summary: `Niveau atteint par la progression en séance : ${SESSIONS_TO_LEVEL_UP} séances de suite jugées au-dessus de ${current?.level ?? "ton niveau de départ"}.`,
      strengths: current?.strengths ?? [],
      toWorkOn: current?.toWorkOn ?? [],
    });
  }
  return { language, observed, current: current?.level ?? null, streak, needed: SESSIONS_TO_LEVEL_UP, promoted };
}

export async function POST(request: Request) {
  if (!dbAvailable()) return Response.json({ saved: false });
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // vide
  }
  const language = isLanguage(body.language) ? body.language : "en";
  const seconds = Math.max(0, Math.round(Number(body.seconds ?? 0)));
  try {
    const sql = (await db())!;
    const cost = await getCostSettings();
    const engine = body.engine === "eco" || body.engine === "live" ? body.engine : "elevenlabs";
    const costFcfa = engine === "elevenlabs" ? Math.round((seconds / 60) * cost.perMinuteFcfa) : 0;
    const userTurns = Math.round(Number(body.userTurns ?? 0));
    const observed = typeof body.observedLevel === "string" && /^[ABC][12]$/.test(body.observedLevel) ? body.observedLevel : null;
    const rows = await sql<{ id: number }[]>`insert into sessions
      (kind, language, personality, topic, seconds, user_turns, user_share, transcript, corrections, errors, words, encouragement, level, observed_level, cost_fcfa, engine)
      values (${body.kind ?? "conversation"}, ${language}, ${body.personality ?? "ami"}, ${body.topic ?? null}, ${seconds},
        ${userTurns}, ${Math.round(Number(body.userShare ?? 0))},
        ${sql.json((body.transcript ?? []) as never)}, ${sql.json((body.corrections ?? []) as never)},
        ${sql.json((body.errors ?? []) as never)}, ${sql.json((body.words ?? []) as never)},
        ${body.encouragement ?? null}, ${body.level ?? null}, ${observed}, ${costFcfa}, ${engine})
      returning id`;
    const sessionId = rows[0]?.id ?? null;
    let progression: Progression | null = null;
    if (observed && (body.kind ?? "conversation") === "conversation") {
      try {
        progression = await updateProgression(sql, language, observed, seconds, userTurns);
      } catch (error) {
        console.error("Progression du niveau", error);
      }
    }

    // Dédoublonnage : ni deux fois la même entrée (casse, ponctuation, « please »), ni une entrée déjà dans le carnet.
    const candidates = (body.words ?? []).filter((w) => w && typeof w.en === "string" && w.en.trim()).slice(0, 12);
    const existing = candidates.length ? (await sql<{ word: string }[]>`select word from words where language = ${language} order by created_at desc limit 600`).map((r) => r.word) : [];
    const words = dedupeWords(candidates, existing).slice(0, 8);
    for (const w of words) {
      const kind = w.kind === "plus-naturel" ? "plus-naturel" : "mot";
      await sql`insert into words (language, word, translation, session_id, kind)
        values (${language}, ${w.en.trim()}, ${(w.fr ?? "").trim()}, ${sessionId}, ${kind})
        on conflict (language, lower(word)) do nothing`;
    }
    const errors = (body.errors ?? []).filter((e) => e && typeof e.wrong === "string" && typeof e.right === "string");
    for (const e of errors.slice(0, 5)) {
      await sql`insert into errors (session_id, language, wrong, "right", tip) values (${sessionId}, ${language}, ${e.wrong}, ${e.right}, ${e.tip ?? ""})`;
    }
    // Série et minutes du jour recalculées par la même fonction que l'accueil et le suivi (fuseau de Dakar).
    const day = await dayStats(sql).catch(() => null);
    return Response.json({ saved: true, id: sessionId, costFcfa, wordsAdded: words.length, progression, streak: day?.streak ?? null, todayAllMinutes: day?.todayAllMinutes ?? null });
  } catch (error) {
    return Response.json({ saved: false, error: dbErrorMessage(error) }, { status: 502 });
  }
}
