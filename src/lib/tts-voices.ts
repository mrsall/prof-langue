import { findPersonality, type Language } from "@/config/personalities";
import { findVoice } from "@/config/voices";
import { PERSONALITIES } from "@/config/personalities";
import { listFrenchVoices, pickFrenchVoice } from "@/lib/french-voices";

/**
 * Choix de la voix ElevenLabs pour la lecture d'un texte (mode éco et
 * shadowing) : la voix du personnage, ou celle du juge en mode débat,
 * avec les mêmes règles que la séance en temps réel.
 */
const DEFAULT_VOICE_EN = process.env.ELEVENLABS_VOICE_TTS_EN || "JBFqnCBsobJjWmhhKeHm"; // George
const JUDGE_VOICE_EN = process.env.ELEVENLABS_VOICE_JUDGE_EN || "onwK4e9ZLuTAKqWW03F9"; // Daniel

export type TtsRole = "main" | "judge";

export async function resolveVoiceId(options: { apiKey: string; language: Language; personalityId?: string | null; role?: TtsRole }): Promise<string> {
  const role = options.role ?? "main";
  const personality = options.personalityId ? findPersonality(options.personalityId) : undefined;

  if (options.language === "en") {
    if (role === "judge") return JUDGE_VOICE_EN;
    if (personality) return findVoice(personality.voiceKey)?.voiceId ?? DEFAULT_VOICE_EN;
    return DEFAULT_VOICE_EN;
  }

  // Français : voix de la bibliothèque ajoutées automatiquement (accent de France).
  const override = role === "judge" ? process.env.ELEVENLABS_VOICE_JUDGE_FR : process.env.ELEVENLABS_VOICE_TTS_FR;
  if (override && (role === "judge" || !personality)) return override;
  const voices = await listFrenchVoices(options.apiKey).catch(() => []);
  if (role === "judge") {
    return voices.filter((v) => v.gender === "male").at(-1)?.voiceId ?? voices.at(-1)?.voiceId ?? DEFAULT_VOICE_EN;
  }
  if (personality) {
    const voice = findVoice(personality.voiceKey);
    const gender = voice?.gender === "femme" ? "female" : "male";
    const index = Math.max(0, PERSONALITIES.findIndex((p) => p.id === personality.id));
    return pickFrenchVoice(voices, personality.id, gender, index) ?? voices[0]?.voiceId ?? DEFAULT_VOICE_EN;
  }
  return pickFrenchVoice(voices, "prof", "female", 0) ?? voices[0]?.voiceId ?? DEFAULT_VOICE_EN;
}
