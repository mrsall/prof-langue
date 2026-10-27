import Anthropic from "@anthropic-ai/sdk";
import { askClaude } from "@/lib/claude";
import { connection } from "next/server";
import { isLanguage, type Language } from "@/config/personalities";
import { db, dbAvailable, withTimeout } from "@/lib/db";
import { assessPronunciation, localeFor, pronunciationAvailable, type PronunciationResult } from "@/lib/pronunciation";
import { scoreByText, type AlignedWord } from "@/lib/pronunciation-text";
import { sttAvailable, transcribeWithScribe } from "@/lib/stt";

export const maxDuration = 30;

/**
 * V4 — note une phrase répétée par Cherif.
 *
 * Trois moteurs, du plus précis au plus simple :
 *  - "azure"  : Azure Speech (si AZURE_SPEECH_KEY est réglée) → note son par son.
 *  - "phone"  : le téléphone a reconnu la phrase (gratuit) ; le serveur compare
 *               mot à mot avec la phrase modèle et Claude explique les sons ratés.
 *  - "scribe" : pas de reconnaissance sur le téléphone → l'audio est transcrit
 *               par Scribe (ElevenLabs), puis comparé pareil.
 *
 * GET  : état { engine, scribe, db }.
 * POST : FormData { audio, reference, language } ou JSON { transcript, reference, language, durationMs }.
 *        Enregistre notes et sons en base (jamais l'audio).
 */
export type PronunciationEngine = "azure" | "phone" | "scribe";
export type PronunciationStatus = { available: boolean; engine: "azure" | "text"; scribe: boolean; locales: { en: string; fr: string }; db: boolean };
export type PronunciationTip = { word: string; heard: string | null; sound: string; tip: string };
export type PronunciationResponse = PronunciationResult & { engine: PronunciationEngine; tips: PronunciationTip[] };


export async function GET() {
  await connection();
  return Response.json({
    available: true,
    engine: pronunciationAvailable() ? "azure" : "text",
    scribe: sttAvailable(),
    locales: { en: localeFor("en"), fr: localeFor("fr") },
    db: dbAvailable(),
  } satisfies PronunciationStatus);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    let result: PronunciationResult;
    let engine: PronunciationEngine;
    let language: Language = "en";
    let durationMs: number | null = null;

    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as { transcript?: string; reference?: string; language?: string; durationMs?: number };
      const reference = String(body.reference ?? "").trim();
      const transcript = String(body.transcript ?? "").trim();
      language = isLanguage(body.language) ? body.language : "en";
      durationMs = typeof body.durationMs === "number" && body.durationMs > 0 ? body.durationMs : null;
      if (!reference) return Response.json({ error: "Phrase modèle manquante." }, { status: 400 });
      if (!transcript) return Response.json({ error: "Je n'ai rien entendu. Parle plus près du micro, dans un endroit plus calme." }, { status: 422 });
      result = scoreByText({ reference, recognized: transcript, language, durationMs });
      engine = "phone";
    } else {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return Response.json({ error: "Requête invalide." }, { status: 400 });
      }
      const audio = form.get("audio");
      const reference = String(form.get("reference") ?? "").trim();
      language = isLanguage(String(form.get("language") ?? "en")) ? (String(form.get("language")) as Language) : "en";
      if (!(audio instanceof Blob) || !reference) return Response.json({ error: "Audio ou phrase manquante." }, { status: 400 });
      if (audio.size > 4_000_000) return Response.json({ error: "Enregistrement trop long (15 secondes maximum)." }, { status: 413 });
      if (pronunciationAvailable()) {
        result = await assessPronunciation({ audio: await audio.arrayBuffer(), referenceText: reference, language });
        engine = "azure";
      } else if (sttAvailable()) {
        const stt = await transcribeWithScribe(audio, language);
        if (!stt.text) return Response.json({ error: "Je n'ai rien entendu. Parle plus près du micro, dans un endroit plus calme." }, { status: 422 });
        result = scoreByText({ reference, recognized: stt.text, language, durationMs: stt.durationMs });
        engine = "scribe";
      } else {
        return Response.json({ error: "Aucun moyen d'évaluer la prononciation : ce téléphone n'a pas de reconnaissance vocale et ELEVENLABS_API_KEY manque." }, { status: 503 });
      }
    }

    const tips = engine === "azure" ? [] : await withTimeout(explainMistakes(result.words as AlignedWord[], language, result.reference), 8000).catch(() => [] as PronunciationTip[]);
    if (engine !== "azure" && tips.length > 0) {
      const byWord = new Map(result.words.map((w) => [w.word.toLowerCase(), w.score ?? 0]));
      result.weakSounds = tips.map((t) => ({ phoneme: t.sound, score: byWord.get(t.word.toLowerCase()) ?? 40 })).filter((s, i, arr) => arr.findIndex((x) => x.phoneme === s.phoneme) === i).slice(0, 5);
    }
    const response: PronunciationResponse = { ...result, engine, tips };
    await withTimeout(persist(language, response), 2500).catch(() => undefined);
    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analyse impossible." }, { status: 502 });
  }
}

/** Claude explique, en une phrase, le son derrière chaque mot mal compris. */
async function explainMistakes(words: AlignedWord[], language: Language, reference: string): Promise<PronunciationTip[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const failed = words.filter((w) => w.errorType !== "Insertion" && w.score !== null && w.score < 60).slice(0, 3);
  if (failed.length === 0) return [];
  const client = new Anthropic();
  const target = language === "en" ? "anglais (accent britannique)" : "français (accent de France)";
  const list = failed.map((w) => `- mot attendu : « ${w.word} » ; entendu : ${w.heard ? `« ${w.heard} »` : "rien (mot oublié)"}`).join("\n");
  const response = await askClaude(client, {
    maxTokens: 1024,
    effort: "low",
    thinking: "disabled",
    system: `Tu es coach de prononciation pour Cherif, francophone du Sénégal (Dakar), qui apprend le ${target}. La reconnaissance vocale a mal compris certains mots qu'il a répétés. Pour chaque mot, devine le son le plus probablement raté (en tenant compte des habitudes des francophones d'Afrique de l'Ouest : th → s/z, h muet, r, voyelles longues/courtes, consonnes finales, accent tonique) et donne UN conseil concret en français de 20 mots maximum sur la bouche, la langue ou le rythme, en comparant à un son du français ou du wolof si utile. Réponds UNIQUEMENT en JSON : [{"word":"...","sound":"étiquette courte du son, ex. th, h, r, i court, -ed final","tip":"..."}]`,
    messages: [{ role: "user", content: `Phrase modèle : « ${reference} »\n${list}` }],
  });
  const match = response.text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]) as { word?: unknown; sound?: unknown; tip?: unknown }[];
  return parsed
    .filter((t) => typeof t.word === "string" && typeof t.tip === "string")
    .map((t) => {
      const word = failed.find((w) => w.word.toLowerCase() === String(t.word).toLowerCase()) ?? null;
      return { word: String(t.word), heard: word?.heard ?? null, sound: typeof t.sound === "string" && t.sound.trim() ? t.sound.trim().slice(0, 24) : "son", tip: String(t.tip).slice(0, 200) };
    })
    .slice(0, 3);
}

/** Garde les notes et les sons (pas l'audio) pour le suivi et les phrases à retravailler. */
async function persist(language: string, result: PronunciationResponse) {
  if (!dbAvailable()) return;
  const sql = await db();
  if (!sql) return;
  const words = result.words.map((w) => ({ word: w.word, score: w.score, errorType: w.errorType }));
  await sql`insert into pron_attempts (language, reference, recognized, pron_score, accuracy, fluency, completeness, words)
    values (${language}, ${result.reference}, ${result.recognized}, ${result.scores.pron}, ${result.scores.accuracy}, ${result.scores.fluency}, ${result.scores.completeness}, ${sql.json(words as never)})`;
  const bySound = new Map<string, { sum: number; n: number; fails: number }>();
  if (result.engine === "azure") {
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
  } else {
    // Sans note son par son : on compte les sons que Claude a identifiés comme ratés.
    for (const s of result.weakSounds) {
      const cur = bySound.get(s.phoneme) ?? { sum: 0, n: 0, fails: 0 };
      cur.sum += s.score;
      cur.n += 1;
      cur.fails += 1;
      bySound.set(s.phoneme, cur);
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
