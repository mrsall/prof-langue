import { connection } from "next/server";
import { db, dbAvailable, dbErrorMessage } from "@/lib/db";

export const maxDuration = 30;

/**
 * Carnet de mots avec révision espacée : J+1, J+3, J+7, J+21, puis tous les
 * 60 jours. Une réponse ratée ramène le mot au début.
 */
const INTERVALS_DAYS = [1, 3, 7, 21, 60];

export type WordRow = {
  id: number;
  language: "en" | "fr";
  word: string;
  translation: string | null;
  created_at: string;
  due_at: string;
  stage: number;
  reviews: number;
  lapses: number;
};

export async function GET(request: Request) {
  await connection();
  if (!dbAvailable()) return Response.json({ db: false, due: [], all: [] });
  const url = new URL(request.url);
  const language = url.searchParams.get("language");
  try {
    const sql = (await db())!;
    const all = await sql<WordRow[]>`select id, language, word, translation, created_at, due_at, stage, reviews, lapses
      from words ${language ? sql`where language = ${language}` : sql``}
      order by due_at asc, created_at desc limit 300`;
    const now = Date.now();
    const due = all.filter((w) => new Date(w.due_at).getTime() <= now);
    return Response.json({ db: true, due, all });
  } catch (error) {
    return Response.json({ db: true, due: [], all: [], error: dbErrorMessage(error) }, { status: 502 });
  }
}

type Body = { id?: number; success?: boolean; action?: "delete" | "add"; word?: string; translation?: string; language?: string };

export async function POST(request: Request) {
  if (!dbAvailable()) return Response.json({ error: "Base de données non configurée." }, { status: 400 });
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // vide
  }
  try {
    const sql = (await db())!;
    if (body.action === "add" && body.word?.trim()) {
      const language = body.language === "fr" ? "fr" : "en";
      await sql`insert into words (language, word, translation) values (${language}, ${body.word.trim()}, ${(body.translation ?? "").trim()})
        on conflict (language, lower(word)) do update set translation = excluded.translation`;
      return Response.json({ ok: true });
    }
    if (typeof body.id !== "number") return Response.json({ error: "Mot inconnu." }, { status: 400 });
    if (body.action === "delete") {
      await sql`delete from words where id = ${body.id}`;
      return Response.json({ ok: true });
    }
    const rows = await sql<{ stage: number }[]>`select stage from words where id = ${body.id}`;
    if (rows.length === 0) return Response.json({ error: "Mot inconnu." }, { status: 404 });
    const stage = body.success ? Math.min(rows[0].stage + 1, INTERVALS_DAYS.length - 1) : 0;
    const days = body.success ? INTERVALS_DAYS[stage] : 1;
    await sql`update words set stage = ${stage}, reviews = reviews + 1, lapses = lapses + ${body.success ? 0 : 1},
      due_at = now() + make_interval(days => ${days}) where id = ${body.id}`;
    return Response.json({ ok: true, stage, nextInDays: days });
  } catch (error) {
    return Response.json({ error: dbErrorMessage(error) }, { status: 502 });
  }
}
