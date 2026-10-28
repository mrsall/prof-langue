import { findPersonality, isLanguage, pickFirstMessage, type Language, type Personality } from "@/config/personalities";
import { isCorrectionLevel, type CorrectionLevel } from "@/config/correction";
import { buildPrompt, type MemoryItem, type PastError, type Rematch, type ReviewWord, type SessionKind, type TranscriptLine } from "@/lib/prompt";
import { getLevel, LEVEL_DESCRIPTIONS, LEVELS } from "@/lib/settings";
import { db, dbAvailable, withTimeout } from "@/lib/db";

/**
 * Prépare les consignes d'une séance (personnalité, langue, correction, sujet,
 * niveau, mots à recycler, erreurs passées) et la première réplique.
 * Utilisé par la séance ElevenLabs (`/api/elevenlabs/session`) et par le mode
 * éco (`/api/eco/reply`), pour que les deux parlent exactement pareil.
 */
export type SessionBody = {
  personality?: string;
  language?: string;
  correction?: string;
  topic?: string | null;
  ownTopic?: boolean;
  memory?: MemoryItem[];
  kind?: SessionKind;
  reviewWords?: ReviewWord[];
  rematch?: Rematch | null;
  /** Reprise d'une discussion en cours (changement de réglage, coupure). */
  context?: { transcript?: TranscriptLine[]; resumeMessage?: string };
};

export type PreparedSession = {
  personality: Personality;
  language: Language;
  correction: CorrectionLevel;
  kind: SessionKind;
  prompt: string;
  firstMessage: string;
};

const TEST_OPENERS: Record<Language, string> = {
  en: "Hi Cherif! Let's have a quick five-minute chat so I can see where you are. No pressure at all. First: can you tell me your name and where you live?",
  fr: "Bonjour Cherif ! On va discuter cinq petites minutes pour que je voie où tu en es. Aucune pression. D'abord : tu peux te présenter et me dire où tu habites ?",
};

const REVISION_OPENERS: Record<Language, string> = {
  en: "Hi Cherif! Quick vocabulary review, a few words from your last sessions. Ready? Here's the first one.",
  fr: "Salut Cherif ! Petite révision de vocabulaire, quelques mots de tes dernières séances. Prêt ? Voici le premier.",
};

export async function prepareSession(body: SessionBody): Promise<PreparedSession | null> {
  const personality = body.personality ? findPersonality(body.personality) : undefined;
  if (!personality) return null;
  const language: Language = isLanguage(body.language) ? body.language : "en";
  const correction = isCorrectionLevel(body.correction) ? body.correction : personality.correction;
  const topic = typeof body.topic === "string" && body.topic.trim() ? body.topic.trim().slice(0, 200) : null;
  const ownTopic = Boolean(body.ownTopic) || !topic;
  const memory = Array.isArray(body.memory)
    ? body.memory.filter((m) => m && typeof m.date === "string" && typeof m.mode === "string" && typeof m.topic === "string").slice(0, 5)
    : [];
  const context = body.context;
  const kind: SessionKind = body.kind === "test" || body.kind === "revision" ? body.kind : "conversation";
  const reviewWords = Array.isArray(body.reviewWords)
    ? body.reviewWords.filter((w) => w && typeof w.word === "string").slice(0, 12).map((w) => ({ word: w.word, translation: String(w.translation ?? "") }))
    : [];
  let levelText: string | undefined;
  let recycleWords: ReviewWord[] = [];
  let pastErrors: PastError[] = [];
  if (dbAvailable()) {
    try {
      // La séance ne doit jamais attendre la base : 1,5 s maximum, sinon on fait sans.
      const [rows, info, errs] = await withTimeout(
        (async () => {
          const sql = await db();
          const words =
            sql && kind === "conversation"
              ? await sql<{ word: string; translation: string | null }[]>`select word, translation from words
                  where language = ${language} order by due_at asc limit 6`
              : [];
          const recent =
            sql && kind === "conversation" && (personality.id === "prof" || personality.id === "debatteur")
              ? await sql<{ wrong: string; right: string }[]>`select wrong, "right" from errors
                  where language = ${language} order by created_at desc limit 6`
              : [];
          return [words, await getLevel(language), recent] as const;
        })(),
        1500,
      );
      recycleWords = rows.map((r) => ({ word: r.word, translation: r.translation ?? "" }));
      pastErrors = errs.map((e) => ({ wrong: e.wrong, right: e.right }));
      if (info) {
        const desc = LEVEL_DESCRIPTIONS[info.level]?.[language];
        const idx = LEVELS.indexOf(info.level as (typeof LEVELS)[number]);
        const next = idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : info.level;
        levelText =
          language === "en"
            ? `His current English level is ${info.level} (${desc ?? ""}). Speak one notch above it (${next}): that is how he progresses. During the session, if his answers are long and right, go deeper still (bigger topics, tougher questions, arguments and counter-arguments); if he struggles, come back down.`
            : `Son niveau actuel en français parlé est ${info.level} (${desc ?? ""}). Parle un cran au-dessus (${next}) : c'est comme ça qu'il progresse. Pendant la séance, si ses réponses sont longues et justes, va encore plus loin (sujets plus profonds, questions plus exigeantes, arguments et contre-arguments) ; s'il peine, redescends.`;
      }
    } catch (error) {
      console.error("Niveau indisponible", error);
    }
  }
  const prompt = buildPrompt({
    personality,
    language,
    correction,
    topic,
    ownTopic,
    memory,
    context: context?.transcript,
    kind,
    levelText,
    reviewWords,
    recycleWords,
    pastErrors,
    rematch: body.rematch && Array.isArray(body.rematch.notes) ? { side: body.rematch.side ?? null, notes: body.rematch.notes.filter((n) => typeof n === "string").slice(0, 6) } : null,
  });
  const firstMessage =
    context?.resumeMessage?.trim() ||
    (kind === "test"
      ? TEST_OPENERS[language]
      : kind === "revision"
        ? REVISION_OPENERS[language]
        : ownTopic
          ? personality.ownTopicMessages[language]
          : pickFirstMessage(personality, language, topic ?? ""));
  return { personality, language, correction, kind, prompt, firstMessage };
}
