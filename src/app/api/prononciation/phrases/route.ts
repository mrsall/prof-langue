import { connection } from "next/server";
import { isLanguage, type Language } from "@/config/personalities";
import { SHADOWING_PHRASES, pickRandom, usableForShadowing } from "@/config/shadowing";
import { db, dbAvailable, withTimeout } from "@/lib/db";
import { pronunciationAvailable } from "@/lib/pronunciation";
import { sttAvailable } from "@/lib/stt";
import { getLevel } from "@/lib/settings";

export const maxDuration = 30;

/**
 * Phrases à répéter pour une série de shadowing :
 *  1. tes propres phrases corrigées et des phrases des personnages (dernières séances),
 *  2. des phrases où tu avais raté des mots,
 *  3. des phrases de secours adaptées à ton niveau.
 * Plus les sons les moins réussis, pour l'affichage.
 */
export type ShadowPhrase = { text: string; from: "seance" | "rate" | "base"; note?: string };
export type SoundStat = { phoneme: string; score: number; attempts: number };
export type PhrasesResponse = { available: boolean; db: boolean; language: Language; phrases: ShadowPhrase[]; sounds: SoundStat[] };

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") ?? "en";
  const language: Language = isLanguage(lang) ? lang : "en";
  const count = Math.min(10, Math.max(3, Number(url.searchParams.get("count") ?? "6") || 6));
  // Noter est toujours possible avec la reconnaissance du téléphone ; Azure ou Scribe en plus côté serveur.
  const out: PhrasesResponse = { available: true, db: dbAvailable(), language, phrases: [], sounds: [] };
  void pronunciationAvailable;
  void sttAvailable;

  let beginner = true;
  if (out.db) {
    try {
      const sql = await withTimeout(db(), 6000);
      if (sql) {
        const [sessions, failed, sounds, level] = await withTimeout(
          Promise.all([
            sql<{ transcript: { role: string; text: string }[] | null; corrections: { index: number; corrected: string }[] | null }[]>`
              select transcript, corrections from sessions
              where language = ${language} and kind = 'conversation' and seconds >= 60
              order by started_at desc limit 4`,
            sql<{ reference: string; words: { word: string; score: number | null }[] | null; pron_score: number }[]>`
              select reference, words, pron_score from pron_attempts
              where language = ${language} and created_at > now() - interval '30 days'
              order by pron_score asc, created_at desc limit 12`,
            sql<{ phoneme: string; attempts: number; score: number }[]>`
              select phoneme, attempts, (score_sum / greatest(attempts, 1))::int as score from pron_sounds
              where language = ${language} and attempts >= 3 order by 3 asc limit 5`,
            getLevel(language),
          ]),
          8000,
        );
        beginner = !level || /^A/i.test(level.level);
        out.sounds = sounds.map((s) => ({ phoneme: s.phoneme, score: s.score, attempts: s.attempts }));

        const own: string[] = [];
        const theirs: string[] = [];
        for (const s of sessions) {
          for (const c of s.corrections ?? []) {
            const t = usableForShadowing(c.corrected);
            if (t) own.push(t);
          }
          for (const line of s.transcript ?? []) {
            if (line.role !== "agent") continue;
            const t = usableForShadowing(line.text);
            if (t) theirs.push(t);
          }
        }
        const seance = pickRandom([...new Set(own)], 2).map<ShadowPhrase>((text) => ({ text, from: "seance", note: "Ta phrase, corrigée" }));
        if (seance.length < 3) {
          seance.push(...pickRandom([...new Set(theirs)].filter((t) => !own.includes(t)), 3 - seance.length).map<ShadowPhrase>((text) => ({ text, from: "seance", note: "Entendue en séance" })));
        }
        out.phrases.push(...seance);

        const seen = new Set(out.phrases.map((p) => p.text));
        const rate = failed
          .filter((f) => f.pron_score < 80 && !seen.has(f.reference))
          .map<ShadowPhrase>((f) => {
            const bad = (f.words ?? []).filter((w) => w.score !== null && w.score < 60).map((w) => w.word);
            return { text: f.reference, from: "rate", note: bad.length ? `Mot${bad.length > 1 ? "s" : ""} à soigner : ${bad.slice(0, 3).join(", ")}` : `Dernière note : ${f.pron_score}` };
          });
        out.phrases.push(...pickRandom(rate, 2));
      }
    } catch {
      // Sans base joignable : phrases de secours seulement.
    }
  }

  const pool = beginner ? SHADOWING_PHRASES[language].beginner : [...SHADOWING_PHRASES[language].intermediate, ...SHADOWING_PHRASES[language].beginner.slice(0, 4)];
  const seen = new Set(out.phrases.map((p) => p.text));
  out.phrases.push(...pickRandom(pool.filter((t) => !seen.has(t)), Math.max(0, count - out.phrases.length)).map<ShadowPhrase>((text) => ({ text, from: "base" })));
  out.phrases = out.phrases.slice(0, count);
  return Response.json(out);
}
