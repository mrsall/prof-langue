"use client";

import { useLocalStorage } from "@/lib/use-local-storage";
import type { MemoryItem } from "@/lib/prompt";

/**
 * Historique léger des séances, gardé sur le téléphone (V2). Sert aux
 * souvenirs des personnages et à ne pas reproposer les mêmes sujets.
 * La base de données arrive en V3.
 */
const HISTORY_KEY = "prof-langue:history";

export type HistoryItem = {
  date: string;
  personality: string;
  language: "en" | "fr";
  topic: string;
  seconds: number;
};

function parse(raw: string | null): HistoryItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as HistoryItem[]).filter((h) => h && typeof h.topic === "string") : [];
  } catch {
    return [];
  }
}

export function useHistory() {
  const [raw, setRaw] = useLocalStorage(HISTORY_KEY);
  const items = parse(raw);

  const add = (item: HistoryItem) => {
    const next = [item, ...parse(raw)].slice(0, 30);
    setRaw(JSON.stringify(next));
  };

  /** Souvenirs pour un personnage (ses propres séances, les plus récentes). */
  const memoryFor = (personality: string, modeLabel: string): MemoryItem[] =>
    items
      .filter((h) => h.personality === personality && h.topic)
      .slice(0, 5)
      .map((h) => ({ date: h.date, mode: modeLabel, topic: h.topic }));

  /** Sujets récents d'un mode, pour ne pas les reproposer. */
  const recentTopics = (personality: string, language: "en" | "fr") =>
    items.filter((h) => h.personality === personality && h.language === language).slice(0, 8).map((h) => h.topic);

  return { items, add, memoryFor, recentTopics };
}
