"use client";

import { useSyncExternalStore } from "react";
import { useLocalStorage } from "@/lib/use-local-storage";

/**
 * Progression gardée sur le téléphone (V1). La base de données arrive en V3.
 */
export const GOAL_MINUTES = 10;
const PROGRESS_KEY = "prof-langue:progress";

type Progress = {
  streak: number;
  /** Dernier jour avec une séance, au format AAAA-MM-JJ (heure locale). */
  lastDay: string | null;
  /** Secondes de séance par jour. */
  secondsByDay: Record<string, number>;
};

const EMPTY: Progress = { streak: 0, lastDay: null, secondsByDay: {} };

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parse(raw: string | null): Progress {
  if (!raw) return EMPTY;
  try {
    const p = JSON.parse(raw) as Partial<Progress>;
    return {
      streak: typeof p.streak === "number" ? p.streak : 0,
      lastDay: typeof p.lastDay === "string" ? p.lastDay : null,
      secondsByDay: p.secondsByDay && typeof p.secondsByDay === "object" ? p.secondsByDay : {},
    };
  } catch {
    return EMPTY;
  }
}

function daysBetween(a: string, b: string) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86_400_000);
}

export function applySession(progress: Progress, seconds: number, today = todayKey()): Progress {
  const secondsByDay = { ...progress.secondsByDay, [today]: (progress.secondsByDay[today] ?? 0) + seconds };
  let streak = progress.streak;
  if (progress.lastDay === today) {
    // déjà compté aujourd'hui
  } else if (progress.lastDay && daysBetween(progress.lastDay, today) === 1) {
    streak += 1;
  } else {
    streak = 1;
  }
  return { streak, lastDay: today, secondsByDay };
}

/** Série en cours : remise à zéro si la dernière séance date d'avant hier. */
export function currentStreak(progress: Progress, today = todayKey()) {
  if (!progress.lastDay) return 0;
  const gap = daysBetween(progress.lastDay, today);
  return gap <= 1 ? progress.streak : 0;
}

const noop = () => () => {};

/** Date du jour, lue côté téléphone uniquement (null pendant le rendu serveur). */
export function useToday(): Date | null {
  const key = useSyncExternalStore(noop, () => todayKey(), () => null);
  return key ? new Date(`${key}T12:00:00`) : null;
}

export function useProgress() {
  const [raw, setRaw] = useLocalStorage(PROGRESS_KEY);
  const progress = parse(raw);
  const today = useToday();
  const key = today ? todayKey(today) : null;
  const minutesToday = key ? Math.round((progress.secondsByDay[key] ?? 0) / 60) : 0;

  const recordSession = (seconds: number) => {
    const next = applySession(parse(raw), seconds);
    setRaw(JSON.stringify(next));
    return { streak: next.streak, minutesToday: Math.round((next.secondsByDay[todayKey()] ?? 0) / 60) };
  };

  return {
    streak: key ? currentStreak(progress, key) : 0,
    minutesToday,
    goalMinutes: GOAL_MINUTES,
    recordSession,
  };
}
