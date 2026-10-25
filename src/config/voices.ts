/**
 * Voix ElevenLabs (bibliothèque, disponibles sur tous les comptes).
 * Pour en changer une : copie son « Voice ID » depuis elevenlabs.io
 * (Voices → la voix → ID) et remplace `voiceId`.
 *
 * `key` sert aussi à chercher un agent dédié dans les variables
 * d'environnement (ELEVENLABS_AGENT_ID_<KEY en majuscules>).
 */
export type VoiceOption = {
  key: string;
  name: string;
  voiceId: string;
  accent: "américain" | "britannique";
  gender: "homme" | "femme";
  description: string;
  emoji: string;
};

export const VOICES: VoiceOption[] = [
  {
    key: "brian",
    name: "Brian",
    voiceId: "nPczCjzI2devNBz1zQrb",
    accent: "américain",
    gender: "homme",
    description: "Voix grave et posée, très naturelle. Un pote calme.",
    emoji: "🧑🏾‍💻",
  },
  {
    key: "jessica",
    name: "Jessica",
    voiceId: "cgSgspJ2msm6clMCkdW9",
    accent: "américain",
    gender: "femme",
    description: "Voix jeune, expressive et chaleureuse.",
    emoji: "👩🏽",
  },
  {
    key: "george",
    name: "George",
    voiceId: "JBFqnCBsobJjWmhhKeHm",
    accent: "britannique",
    gender: "homme",
    description: "Voix chaude, un peu plus lente. Style grand frère.",
    emoji: "🧔🏽",
  },
  {
    key: "will",
    name: "Will",
    voiceId: "bIHbv24MWmeRgasZH58o",
    accent: "américain",
    gender: "homme",
    description: "Voix jeune et énergique.",
    emoji: "🧑🏽",
  },
  {
    key: "sarah",
    name: "Sarah",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    accent: "américain",
    gender: "femme",
    description: "Voix douce et claire.",
    emoji: "👩🏾‍🏫",
  },
  {
    key: "daniel",
    name: "Daniel",
    voiceId: "onwK4e9ZLuTAKqWW03F9",
    accent: "britannique",
    gender: "homme",
    description: "Voix posée et professionnelle.",
    emoji: "👨🏽‍💼",
  },
  {
    key: "roger",
    name: "Roger",
    voiceId: "CwhRBWXzGAHq8TQ4Fs17",
    accent: "américain",
    gender: "homme",
    description: "Voix assurée, passe-partout.",
    emoji: "🧑🏻‍✈️",
  },
];

export function findVoice(key: string | null | undefined): VoiceOption | undefined {
  return VOICES.find((v) => v.key === key);
}
