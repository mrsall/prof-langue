"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Petite valeur texte persistée sur le téléphone (préférence, réglage).
 * Rend `null` côté serveur et tant que le stockage n'est pas lisible.
 */
export function useLocalStorage(key: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );

  const setValue = useCallback(
    (next: string | null) => {
      try {
        if (next == null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {
        // stockage indisponible (navigation privée…) : on ignore
      }
      emit();
    },
    [key],
  );

  return [value, setValue] as const;
}

const noopSubscribe = () => () => {};

/**
 * `false` pendant le rendu serveur et l'hydratation, `true` dès que les
 * préférences du téléphone (localStorage) sont lisibles. Sert à ne pas
 * afficher des sélecteurs par défaut qu'un appui rendrait caducs.
 */
export function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
