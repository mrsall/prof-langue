/**
 * Oreille du mode éco : qui transcrit ce que dit Cherif.
 *  - "phone"  : reconnaissance vocale du téléphone (Google sur Android), gratuite, immédiate ;
 *  - "groq"   : le téléphone enregistre, Whisper (Groq) transcrit : très bon avec l'accent,
 *               gratuit avec une clé Groq (GROQ_API_KEY), environ 1 s de plus ;
 *  - "scribe" : même chose avec Scribe (ElevenLabs), décompté de l'abonnement.
 * Partagé entre le téléphone et le serveur (pas de dépendance serveur ici).
 */
export type EarChoice = "phone" | "groq" | "pc" | "scribe";

export const EAR_CHOICE_KEY = "prof-langue:ear-choice";

export const EAR_CHOICES: { key: EarChoice; label: string; hint: string }[] = [
  { key: "phone", label: "Téléphone", hint: "Reconnaissance vocale du téléphone : gratuite et immédiate, mais plus fragile en anglais avec l'accent." },
  { key: "groq", label: "Groq (gratuite)", hint: "Le téléphone enregistre, Whisper transcrit : comprend très bien l'accent, en français comme en anglais. Gratuit avec une clé Groq (Réglages), environ une seconde de plus." },
  { key: "pc", label: "Mon PC (gratuite)", hint: "Le téléphone enregistre, Whisper tourne sur la carte graphique de ton PC (dossier pc-voix) : même qualité que Groq, illimité, sans envoi à un tiers. PC éteint : Groq ou Scribe prennent le relais." },
  { key: "scribe", label: "ElevenLabs", hint: "Transcription Scribe d'ElevenLabs, la même oreille que le mode complet. Décomptée de ton abonnement (environ 330 crédits par minute)." },
];

export function parseEarChoice(raw: string | null | undefined): EarChoice {
  return raw === "groq" || raw === "scribe" || raw === "pc" ? raw : "phone";
}
