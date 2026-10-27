/**
 * Voix Google (Gemini) par personnage. Toutes parlent français et anglais ;
 * le modèle adapte l'accent au texte. Noms des voix prédéfinies de l'API.
 */
export const GEMINI_VOICE_BY_PERSONALITY: Record<string, string> = {
  ami: "Puck", // homme, enjoué
  "grand-frere": "Charon", // homme, posé
  debatteur: "Fenrir", // homme, vif
  prof: "Kore", // femme, assurée
  collegue: "Orus", // homme, ferme
  situation: "Enceladus", // homme, souple
};

export const GEMINI_JUDGE_VOICE = "Iapetus";
export const GEMINI_DEFAULT_VOICE: Record<"en" | "fr", string> = { en: "Puck", fr: "Kore" };

export function geminiVoiceFor(personalityId: string | null | undefined, language: "en" | "fr", role: "main" | "judge" = "main") {
  if (role === "judge") return GEMINI_JUDGE_VOICE;
  return (personalityId && GEMINI_VOICE_BY_PERSONALITY[personalityId]) || GEMINI_DEFAULT_VOICE[language];
}
