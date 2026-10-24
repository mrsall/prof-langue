/**
 * Voix testées en V0.
 *
 * Ce sont des voix de la bibliothèque ElevenLabs, disponibles sur tous les
 * comptes. Pour en tester une autre : copie son « Voice ID » depuis
 * elevenlabs.io (Voices → la voix → ID) et remplace la valeur `voiceId`.
 *
 * `key` sert aussi à chercher un agent dédié dans les variables
 * d'environnement (ELEVENLABS_AGENT_ID_<KEY en majuscules>). Si cette variable
 * existe, elle est utilisée telle quelle, sans forcer la voix. Sinon on utilise
 * l'agent commun ELEVENLABS_AGENT_ID et on lui impose la voix ci-dessous.
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
];

export function findVoice(key: string | null | undefined): VoiceOption | undefined {
  return VOICES.find((v) => v.key === key);
}
