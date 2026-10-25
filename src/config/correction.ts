/**
 * Niveaux de correction pendant la discussion. Réglables à tout moment.
 * Le texte est inséré tel quel dans les consignes de l'agent.
 */
export type CorrectionLevel = "aucune" | "legere" | "active";

export const CORRECTION_LEVELS: { key: CorrectionLevel; label: string; short: string }[] = [
  { key: "aucune", label: "Aucune correction", short: "Aucune" },
  { key: "legere", label: "Correction légère", short: "Légère" },
  { key: "active", label: "Correction active", short: "Active" },
];

export const CORRECTION_ORDER: CorrectionLevel[] = ["aucune", "legere", "active"];

export function isCorrectionLevel(v: unknown): v is CorrectionLevel {
  return v === "aucune" || v === "legere" || v === "active";
}

export const CORRECTION_INSTRUCTIONS: Record<"en" | "fr", Record<CorrectionLevel, string>> = {
  en: {
    aucune:
      "Corrections: do NOT correct him during the chat. If he makes a mistake, simply reuse the correct form naturally in your own reply, without pointing it out. All the learning happens in the end-of-session recap.",
    legere:
      "Corrections: light touch. Mostly reuse the correct form naturally in your reply (rephrase what he said), without saying it was wrong. When the SAME mistake comes back a second time, prompt him instead of correcting: repeat his sentence up to the mistake with a rising tone and let him finish it correctly ('Yesterday you... ?'). At most one correction per reply.",
    active:
      "Corrections: active but kind. Pick ONE mistake per reply, the most useful one. First prompt him to self-correct (repeat his words up to the mistake with a rising tone, or ask 'how do we say that in the past?'). If he does not find it, give the correct form, explain it in one short sentence, and ask him to repeat the whole correct sentence once. Then continue the conversation. Never two corrections in the same reply, never comment on his accent.",
  },
  fr: {
    aucune:
      "Corrections : ne le corrige PAS pendant la discussion. S'il fait une erreur, reprends simplement la forme correcte naturellement dans ta réponse, sans la signaler. Tout l'apprentissage se fait dans le bilan de fin de séance.",
    legere:
      "Corrections : légères. Le plus souvent, reprends la forme correcte naturellement dans ta réponse (reformule ce qu'il a dit), sans dire que c'était faux. Quand la MÊME erreur revient une deuxième fois, fais-le trouver plutôt que de corriger : répète sa phrase jusqu'à l'erreur avec une intonation montante et laisse-le finir (« Hier tu… ? »). Au plus une correction par réplique.",
    active:
      "Corrections : actives mais bienveillantes. Choisis UNE erreur par réplique, la plus utile. Fais-le d'abord se corriger lui-même (répète ses mots jusqu'à l'erreur avec une intonation montante, ou demande « comment on dit ça au passé ? »). S'il ne trouve pas, donne la forme correcte, explique-la en une phrase courte, et demande-lui de répéter toute la phrase correcte une fois. Puis reprends la discussion. Jamais deux corrections dans la même réplique, jamais de remarque sur son accent.",
  },
};
