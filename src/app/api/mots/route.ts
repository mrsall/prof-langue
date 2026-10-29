import { connection } from "next/server";
import { db, dbAvailable, dbErrorMessage } from "@/lib/db";
import { sameEntry } from "@/lib/words-dedupe";

export const maxDuration = 30;

/**
 * Carnet de mots avec révision espacée : J+1, J+3, J+7, J+21, puis tous les
 * 60 jours. Une réponse ratée ramène le mot au début.
 */
const INTERVALS_DAYS = [1, 3, 7, 21, 60];

export type WordRow = {
  /** Identifiant (bigserial : postgres.js le renvoie en texte). */
  id: number | string;
  language: "en" | "fr";
  word: string;
  translation: string | null;
  created_at: string;
  due_at: string;
  stage: number;
  reviews: number;
  lapses: number;
  /** "mot" ou "plus-naturel" (tournure plus polie / naturelle, pas une correction). */
  kind: "mot" | "plus-naturel";
};

export async function GET(request: Request) {
  await connection();
  if (!dbAvailable()) return Response.json({ db: false, due: [], all: [] });
  const url = new URL(request.url);
  const language = url.searchParams.get("language");
  try {
    const sql = (await db())!;
    const all = await sql<WordRow[]>`select id, language, word, translation, created_at, due_at, stage, reviews, lapses, kind
      from words ${language ? sql`where language = ${language}` : sql``}
      order by due_at asc, created_at desc limit 300`;
    const now = Date.now();
    const due = all.filter((w) => new Date(w.due_at).getTime() <= now);
    // Compteurs exacts (la liste ci-dessus est plafonnée à 300 lignes).
    const counted = await sql<{ language: string; total: number; due: number }[]>`select language, count(*)::int as total,
      count(*) filter (where due_at <= now())::int as due from words group by language`;
    const counts = {
      en: { total: counted.find((c) => c.language === "en")?.total ?? 0, due: counted.find((c) => c.language === "en")?.due ?? 0 },
      fr: { total: counted.find((c) => c.language === "fr")?.total ?? 0, due: counted.find((c) => c.language === "fr")?.due ?? 0 },
    };
    return Response.json({ db: true, due, all, counts });
  } catch (error) {
    return Response.json({ db: true, due: [], all: [], error: dbErrorMessage(error) }, { status: 502 });
  }
}

type Body = { id?: number | string; success?: boolean; action?: "delete" | "add" | "edit"; word?: string; translation?: string; language?: string };

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
      const existing = (await sql<{ word: string }[]>`select word from words where language = ${language} order by created_at desc limit 600`).map((r) => r.word);
      if (existing.some((e) => sameEntry(e, body.word!))) return Response.json({ ok: true, duplicate: true });
      await sql`insert into words (language, word, translation) values (${language}, ${body.word.trim()}, ${(body.translation ?? "").trim()})
        on conflict (language, lower(word)) do update set translation = excluded.translation`;
      return Response.json({ ok: true });
    }
    // Les identifiants bigserial arrivent en texte depuis la base : on les accepte en nombre ou en texte.
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Mot inconnu." }, { status: 400 });
    if (body.action === "edit") {
      const word = (body.word ?? "").trim().slice(0, 200);
      if (!word) return Response.json({ error: "Le mot ne peut pas être vide." }, { status: 400 });
      await sql`update words set word = ${word}, translation = ${(body.translation ?? "").trim().slice(0, 300)} where id = ${id}`;
      return Response.json({ ok: true });
    }
    if (body.action === "delete") {
      await sql`delete from words where id = ${id}`;
      return Response.json({ ok: true });
    }
    const rows = await sql<{ stage: number }[]>`select stage from words where id = ${id}`;
    if (rows.length === 0) return Response.json({ error: "Mot inconnu." }, { status: 404 });
    const stage = body.success ? Math.min(rows[0].stage + 1, INTERVALS_DAYS.length - 1) : 0;
    const days = body.success ? INTERVALS_DAYS[stage] : 1;
    await sql`update words set stage = ${stage}, reviews = reviews + 1, lapses = lapses + ${body.success ? 0 : 1},
      due_at = now() + make_interval(days => ${days}) where id = ${id}`;
    return Response.json({ ok: true, stage, nextInDays: days });
  } catch (error) {
    return Response.json({ error: dbErrorMessage(error) }, { status: 502 });
  }
}
