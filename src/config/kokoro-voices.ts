/**
 * Voix Kokoro (gratuites, dans le téléphone) par personnage, en anglais.
 * Le français n'a qu'une voix de qualité insuffisante : il passe par ElevenLabs.
 */
export const KOKORO_VOICE_BY_PERSONALITY: Record<string, string> = {
  ami: "bm_george",
  "grand-frere": "bm_fable",
  debatteur: "am_michael",
  prof: "bf_emma",
  collegue: "bm_daniel",
  situation: "am_puck",
};

export const KOKORO_JUDGE_VOICE = "bm_lewis";
export const KOKORO_DEFAULT_VOICE = "bm_george";

export function kokoroVoiceFor(personalityId: string | null | undefined, role: "main" | "judge" = "main") {
  if (role === "judge") return KOKORO_JUDGE_VOICE;
  return (personalityId && KOKORO_VOICE_BY_PERSONALITY[personalityId]) || KOKORO_DEFAULT_VOICE;
}
