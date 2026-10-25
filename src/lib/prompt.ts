import { CORRECTION_INSTRUCTIONS, type CorrectionLevel } from "@/config/correction";
import type { Language, Personality } from "@/config/personalities";

/**
 * Assemble les consignes envoyées à l'agent : personnage, règles communes,
 * niveau de correction, sujet, souvenirs des séances précédentes, et
 * éventuellement la reprise d'une discussion coupée.
 */
export type MemoryItem = { date: string; mode: string; topic: string };
export type TranscriptLine = { role: "user" | "agent"; text: string };
export type SessionKind = "conversation" | "test" | "revision";
export type ReviewWord = { word: string; translation: string };

const COMMON_RULES: Record<Language, string> = {
  en: `
About Cherif: a French speaker from Senegal (Dakar and Thiès). {level} He often freezes when he has to speak, so make talking easy.

Conversation rules (follow them strictly):
1. Keep every reply short: one to three sentences, then ask a question or invite him to continue. Cherif must talk more than you.
2. Use simple, natural everyday English with contractions. Adapt to his level and raise it slowly over time.
3. French is allowed as a bridge: if he asks "comment on dit ..." or says a word in French, give the English word or phrase, ask him to repeat it once, then continue.
4. If he is silent, stuck or says he doesn't know, suggest a sentence starter or two possible answers he can pick from.
5. Never say the words "mistake" or "error" to him. Never comment on his accent. Never mock him. Never discouraging.
6. When he asks you to repeat, say your last sentence again, a little slower and simpler.
7. Stay realistic: react like a real person, with feelings, opinions and small stories.
8. You only receive text, so never judge his pronunciation.
9. Stay on the chosen topic, but follow him if he wants to change.`,
  fr: `
À propos de Cherif : francophone du Sénégal (Dakar et Thiès). Il parle français couramment, avec un accent marqué. {level} L'objectif en français : gagner en aisance, en vocabulaire précis et en clarté pour être facilement compris, pas effacer son accent.

Règles de conversation (à suivre strictement) :
1. Réponses courtes : une à trois phrases, puis une question ou une relance. Cherif doit parler plus que toi.
2. Un français naturel et vivant, avec des expressions courantes. Propose parfois un mot plus précis ou une tournure plus élégante, sans en faire un cours.
3. S'il cherche un mot, donne-le, fais-le répéter une fois, puis reprends.
4. S'il bloque ou se tait, propose un début de phrase ou deux réponses possibles.
5. Ne dis jamais « erreur » ou « faute ». Jamais de remarque sur son accent. Jamais moqueur, jamais décourageant.
6. S'il demande de répéter, redis ta dernière phrase, un peu plus lentement et plus simplement.
7. Reste réaliste : réagis comme une vraie personne, avec des émotions, des avis et de petites histoires.
8. Tu ne reçois que du texte : ne juge jamais sa prononciation.
9. Reste sur le sujet choisi, mais suis-le s'il veut changer.`,
};

const REFER_TO_TEACHER: Record<Language, string> = {
  en: "If you notice many mistakes during the session, do not say anything about it during the conversation. The app will suggest a lesson with Emma, the teacher, at the end.",
  fr: "Si tu remarques beaucoup d'erreurs pendant la séance, n'en parle pas pendant la discussion. L'app proposera une séance avec Emma, la professeure, à la fin.",
};

const TEST_INSTRUCTIONS: Record<Language, string> = {
  en: `This session is a 5-minute PLACEMENT TEST disguised as a friendly chat, to measure Cherif's level from A1 to C2. Start very simple (his name, where he lives, his family), then raise the difficulty step by step: his daily routine (present), what he did yesterday or last weekend (past), his plans (future), his opinion on something with reasons, then a hypothetical question ("if you could..."). One question at a time, your turns are one short sentence. Do NOT correct, do NOT teach, do NOT give vocabulary unless he is completely stuck (then give one word and move on). Encourage briefly. After about 8 to 10 exchanges, or when he clearly cannot go further, thank him warmly and say the test is finished and the app will show his level.`,
  fr: `Cette séance est un TEST DE NIVEAU de 5 minutes déguisé en discussion amicale, pour situer Cherif de A1 à C2 en français parlé. Commence très simple (se présenter, sa ville, sa famille), puis monte progressivement : sa journée type, ce qu'il a fait hier (passé), ses projets (futur), son avis argumenté sur un sujet, puis une hypothèse (« si tu pouvais… »). Une question à la fois, tes répliques font une phrase courte. Ne corrige PAS, n'enseigne PAS, ne donne un mot que s'il est totalement bloqué. Encourage brièvement. Après 8 à 10 échanges, ou quand il ne peut clairement pas aller plus loin, remercie-le chaleureusement et dis que le test est terminé et que l'app va afficher son niveau.`,
};

function revisionInstructions(language: Language, words: ReviewWord[]) {
  const list = words.map((w) => `- ${w.word}${w.translation ? ` (${w.translation})` : ""}`).join("\n");
  return language === "en"
    ? `This session is a spoken VOCABULARY REVIEW. Quiz Cherif on these words, one at a time, in this order:
${list}
For each word: say the French meaning (or describe the situation) and ask him for the English word; or ask him to use the word in a sentence. If he gets it, confirm in a few words and move on. If not, give the answer, ask him to repeat it once, then move on. Keep it quick and warm. At the end, congratulate him and say which words to look at again.`
    : `Cette séance est une RÉVISION DE VOCABULAIRE à l'oral. Interroge Cherif sur ces mots, un par un, dans cet ordre :
${list}
Pour chaque mot : donne une définition ou une situation et demande-lui le mot ; ou demande-lui de l'utiliser dans une phrase. S'il trouve, confirme en quelques mots et passe au suivant. Sinon, donne la réponse, fais-la répéter une fois, puis passe au suivant. Rapide et chaleureux. À la fin, félicite-le et dis quels mots revoir.`;
}

export function buildPrompt(options: {
  personality: Personality;
  language: Language;
  correction: CorrectionLevel;
  topic: string | null;
  ownTopic: boolean;
  memory: MemoryItem[];
  context?: TranscriptLine[];
  kind?: SessionKind;
  levelText?: string;
  reviewWords?: ReviewWord[];
}) {
  const { personality, language, correction, topic, ownTopic, memory, context, kind = "conversation", levelText, reviewWords } = options;
  const parts: string[] = [];

  parts.push(personality.character[language]);
  parts.push(COMMON_RULES[language].trim().replace("{level}", levelText ?? (language === "en" ? "He is a beginner in English (around A2)." : "")).replace(/  +/g, " "));

  if (kind === "test") {
    parts.push(TEST_INSTRUCTIONS[language]);
    return parts.join("\n\n");
  }
  if (kind === "revision") {
    parts.push(revisionInstructions(language, reviewWords ?? []));
    return parts.join("\n\n");
  }

  parts.push(CORRECTION_INSTRUCTIONS[language][correction]);

  if (["ami", "grand-frere", "debatteur"].includes(personality.id)) {
    parts.push(REFER_TO_TEACHER[language]);
  }

  if (ownTopic) {
    parts.push(
      language === "en"
        ? "Topic: Cherif will choose the topic himself at the start. Ask him, then follow his choice."
        : "Sujet : Cherif choisit lui-même le sujet au début. Demande-le-lui, puis suis son choix.",
    );
  } else if (topic) {
    parts.push(language === "en" ? `Topic of this session: ${topic}.` : `Sujet de cette séance : ${topic}.`);
  }

  if (memory.length > 0) {
    const lines = memory.slice(0, 5).map((m) => `- ${m.date}: ${m.mode}, ${m.topic}`);
    parts.push(
      (language === "en"
        ? "You remember your previous sessions with Cherif (most recent first). Mention one naturally if it fits, never list them:\n"
        : "Tu te souviens de tes séances précédentes avec Cherif (la plus récente en premier). Fais-y allusion naturellement si ça colle, sans les lister :\n") +
        lines.join("\n"),
    );
  }

  if (context && context.length > 0) {
    const lines = context
      .slice(-12)
      .filter((l) => typeof l.text === "string" && l.text.trim())
      .map((l) => `${l.role === "user" ? "Cherif" : language === "en" ? "You" : "Toi"}: ${l.text.trim().slice(0, 300)}`);
    if (lines.length > 0) {
      parts.push(
        (language === "en"
          ? "This conversation was interrupted for a second and is now resuming. Do not greet him again, do not restart the topic: continue naturally from here.\nConversation so far:\n"
          : "Cette discussion a été coupée une seconde et reprend maintenant. Ne le salue pas à nouveau, ne recommence pas le sujet : continue naturellement.\nDiscussion jusqu'ici :\n") +
          lines.join("\n"),
      );
    }
  }

  return parts.join("\n\n");
}
