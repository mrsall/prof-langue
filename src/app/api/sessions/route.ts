import { db, dbAvailable, dbErrorMessage } from "@/lib/db";
import { getCostSettings } from "@/lib/settings";
import { isLanguage } from "@/config/personalities";

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
  words?: { en: string; fr: string }[];
  encouragement?: string | null;
  level?: string | null;
  /** "elevenlabs" (minutes payantes) ou "eco" (téléphone + Claude, gratuit). */
  engine?: string;
};

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
    const engine = body.engine === "eco" ? "eco" : "elevenlabs";
    const costFcfa = engine === "eco" ? 0 : Math.round((seconds / 60) * cost.perMinuteFcfa);
    const rows = await sql<{ id: number }[]>`insert into sessions
      (kind, language, personality, topic, seconds, user_turns, user_share, transcript, corrections, errors, words, encouragement, level, cost_fcfa, engine)
      values (${body.kind ?? "conversation"}, ${language}, ${body.personality ?? "ami"}, ${body.topic ?? null}, ${seconds},
        ${Math.round(Number(body.userTurns ?? 0))}, ${Math.round(Number(body.userShare ?? 0))},
        ${sql.json((body.transcript ?? []) as never)}, ${sql.json((body.corrections ?? []) as never)},
        ${sql.json((body.errors ?? []) as never)}, ${sql.json((body.words ?? []) as never)},
        ${body.encouragement ?? null}, ${body.level ?? null}, ${costFcfa}, ${engine})
      returning id`;
    const sessionId = rows[0]?.id ?? null;

    const words = (body.words ?? []).filter((w) => w && typeof w.en === "string" && w.en.trim());
    for (const w of words.slice(0, 8)) {
      await sql`insert into words (language, word, translation, session_id)
        values (${language}, ${w.en.trim()}, ${(w.fr ?? "").trim()}, ${sessionId})
        on conflict (language, lower(word)) do nothing`;
    }
    const errors = (body.errors ?? []).filter((e) => e && typeof e.wrong === "string" && typeof e.right === "string");
    for (const e of errors.slice(0, 5)) {
      await sql`insert into errors (session_id, language, wrong, "right", tip) values (${sessionId}, ${language}, ${e.wrong}, ${e.right}, ${e.tip ?? ""})`;
    }
    return Response.json({ saved: true, id: sessionId, costFcfa, wordsAdded: words.length });
  } catch (error) {
    return Response.json({ saved: false, error: dbErrorMessage(error) }, { status: 502 });
  }
}
