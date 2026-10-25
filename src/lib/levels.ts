/**
 * Niveaux A1 à C2 : types et descriptions, sans dépendance serveur (utilisable
 * côté téléphone).
 */
export type LevelInfo = { level: string; date: string; summary: string; strengths: string[]; toWorkOn: string[] };

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const LEVEL_DESCRIPTIONS: Record<string, { en: string; fr: string }> = {
  A1: { en: "absolute beginner: single words and very short memorised phrases", fr: "grand débutant : mots isolés et phrases très courtes" },
  A2: { en: "beginner: simple sentences about familiar topics, present tense mostly", fr: "débutant : phrases simples sur des sujets familiers" },
  B1: { en: "intermediate: can tell a story and give simple opinions, with mistakes", fr: "intermédiaire : raconte et donne un avis simple, avec des erreurs" },
  B2: { en: "upper intermediate: fluent on most topics, argues and nuances", fr: "intermédiaire avancé : à l'aise sur la plupart des sujets, argumente" },
  C1: { en: "advanced: precise, flexible, rare mistakes", fr: "avancé : précis, souple, rares erreurs" },
  C2: { en: "mastery", fr: "maîtrise" },
};

/** Le test est à refaire après 30 jours. */
export function levelIsStale(info: { date: string } | null) {
  if (!info) return true;
  const age = Date.now() - new Date(info.date).getTime();
  return age > 30 * 86_400_000;
}
