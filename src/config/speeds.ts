/**
 * Vitesses de la voix. ElevenLabs accepte entre 0.7 et 1.2.
 */
export type SpeedKey = "lent" | "normal" | "rapide";

export const SPEEDS: { key: SpeedKey; label: string; value: number }[] = [
  { key: "lent", label: "Lent", value: 0.85 },
  { key: "normal", label: "Normal", value: 1.0 },
  { key: "rapide", label: "Rapide", value: 1.1 },
];

export const SPEED_ORDER: SpeedKey[] = ["lent", "normal", "rapide"];

export function speedValue(key: SpeedKey | string | null | undefined): number {
  return SPEEDS.find((s) => s.key === key)?.value ?? 1.0;
}

export function isSpeedKey(v: unknown): v is SpeedKey {
  return v === "lent" || v === "normal" || v === "rapide";
}

/** Phrase de reprise quand on change la vitesse en pleine discussion. */
export const SPEED_RESUME_MESSAGES: Record<SpeedKey, string> = {
  lent: "Alright, I'll slow down a bit. So, where were we?",
  normal: "Okay, back to normal speed. Where were we?",
  rapide: "Okay, a bit faster then! So, where were we?",
};
