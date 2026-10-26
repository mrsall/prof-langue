import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { db, dbAvailable, withTimeout } from "@/lib/db";
import { assessPronunciation, localeFor, pronunciationAvailable, type PronunciationResult } from "@/lib/pronunciation";

export const maxDuration = 30;

/**
 * V4 — note une phrase répétée par Cherif.
 * GET  : état du service (configuré ou non).
 * POST : FormData { audio: WAV 16 kHz, reference: phrase modèle, language: en|fr }
 *        → notes globales, mots colorés, sons ratés. Enregistre le résultat en base
 *        (notes et sons seulement, jamais l'audio).
 */
export type PronunciationStatus = { available: boolean; locales: { en: string; fr: string }; db: boolean };

export async function GET() {
  await connection();
  return Response.json({ available: pronunciationAvailable(), locales: { en: localeFor("en"), fr: localeFor("fr") }, db: dbAvailable() } satisfies PronunciationStatus);
}

export async function POST(request: Request) {
  if (!pronunciationAvailable()) {
    return Response.json({ error: "Prononciation non configurée : ajoute AZURE_SPEECH_KEY et AZURE_SPEECH_REGION dans Vercel, puis Redeploy." }, { status: 503 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const audio = form.get("audio");
  const reference = String(form.get("reference") ?? "").trim();
  const lang = String(form.get("language") ?? "en");
  const language = isLanguage(lang) ? lang : "en";
  if (!(audio instanceof Blob) || !reference) return Response.json({ error: "Audio ou phrase manquante." }, { status: 400 });
  if (audio.size > 4_000_000) return Response.json({ error: "Enregistrement trop long (15 secondes maximum)." }, { status: 413 });

  try {
    const result = await assessPronunciation({ audio: await audio.arrayBuffer(), referenceText: reference, language });
    await withTimeout(persist(language, result), 2500).catch(() => undefined);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analyse impossible." }, { status: 502 });
  }
}

/** Garde les notes et les sons (pas l'audio) pour le suivi et les phrases à retravailler. */
async function persist(language: string, result: PronunciationResult) {
  if (!dbAvailable()) return;
  const sql = await db();
  if (!sql) return;
  const words = result.words.map((w) => ({ word: w.word, score: w.score, errorType: w.errorType }));
  await sql`insert into pron_attempts (language, reference, recognized, pron_score, accuracy, fluency, completeness, words)
    values (${language}, ${result.reference}, ${result.recognized}, ${result.scores.pron}, ${result.scores.accuracy}, ${result.scores.fluency}, ${result.scores.completeness}, ${sql.json(words as never)})`;
  const bySound = new Map<string, { sum: number; n: number; fails: number }>();
  for (const w of result.words) {
    if (w.errorType === "Insertion") continue;
    for (const p of w.phonemes) {
      const cur = bySound.get(p.phoneme) ?? { sum: 0, n: 0, fails: 0 };
      cur.sum += p.score;
      cur.n += 1;
      if (p.score < 60) cur.fails += 1;
      bySound.set(p.phoneme, cur);
    }
  }
  for (const [phoneme, v] of bySound) {
    await sql`insert into pron_sounds (language, phoneme, attempts, fails, score_sum, updated_at)
      values (${language}, ${phoneme}, ${v.n}, ${v.fails}, ${v.sum}, now())
      on conflict (language, phoneme) do update set
        attempts = pron_sounds.attempts + excluded.attempts,
        fails = pron_sounds.fails + excluded.fails,
        score_sum = pron_sounds.score_sum + excluded.score_sum,
        updated_at = now()`;
  }
}
