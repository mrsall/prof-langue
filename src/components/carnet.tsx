"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { WordRow } from "@/app/api/mots/route";
import { LANGUAGE_LABELS, type Language } from "@/config/personalities";

/**
 * Carnet de mots : les mots à réviser aujourd'hui (révision espacée), puis
 * tout le carnet. Révision par cartes, ou à la voix avec Emma.
 */
const REVISION_STORAGE_KEY = "prof-langue:revision-words";

type State = { db: boolean; due: WordRow[]; all: WordRow[]; error?: string };

export function Carnet() {
  const [state, setState] = useState<State | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    fetch("/api/mots")
      .then(async (res) => (await res.json()) as State)
      .then((data) => {
        if (active) setState(data);
      })
      .catch(() => {
        if (active) setState({ db: true, due: [], all: [], error: "Pas de connexion. Réessaie." });
      });
    return () => {
      active = false;
    };
  }, []);

  const due = (state?.due ?? []).filter((w) => w.language === language);
  const all = (state?.all ?? []).filter((w) => w.language === language);
  const current = due[0];

  const answer = async (success: boolean) => {
    if (!current) return;
    setFlipped(false);
    setDone((d) => d + 1);
    setState((prev) => (prev ? { ...prev, due: prev.due.filter((w) => w.id !== current.id) } : prev));
    try {
      await fetch("/api/mots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: current.id, success }) });
    } catch {
      // on réessaiera à la prochaine ouverture
    }
  };

  const startVoiceReview = () => {
    const words = due.slice(0, 10).map((w) => ({ word: w.word, translation: w.translation ?? "" }));
    try {
      sessionStorage.setItem(REVISION_STORAGE_KEY, JSON.stringify(words));
    } catch {
      // stockage indisponible
    }
    router.push(`/?start=revision&lang=${language}`);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Carnet de mots</h1>
        <Link href="/" className="h-10 rounded-xl border border-line bg-elevated px-4 text-sm font-semibold leading-10">
          Accueil
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-elevated p-1" role="radiogroup" aria-label="Langue">
        {(["en", "fr"] as Language[]).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={language === l}
            onClick={() => {
              setLanguage(l);
              setFlipped(false);
            }}
            className={`h-10 rounded-xl text-sm font-medium ${language === l ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
          >
            {LANGUAGE_LABELS[l]}
          </button>
        ))}
      </div>

      {state === null ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : !state.db ? (
        <section className="rounded-2xl border border-line bg-elevated p-4 text-sm text-muted">
          Le carnet a besoin de la base de données. Voir <Link href="/reglages" className="underline">Réglages</Link>.
        </section>
      ) : state.error ? (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-3xl border border-line bg-elevated p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">À réviser aujourd&apos;hui</h2>
              <span className="text-xs text-muted">{due.length} restant{due.length > 1 ? "s" : ""}</span>
            </div>
            {current ? (
              <>
                <button
                  type="button"
                  onClick={() => setFlipped((f) => !f)}
                  className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl bg-accent-soft p-5 text-center"
                  aria-label={flipped ? "Retourner la carte" : "Voir la réponse"}
                >
                  {flipped ? (
                    <>
                      <span className="text-xs uppercase tracking-wide text-muted">{language === "en" ? "En anglais" : "Le mot"}</span>
                      <span className="text-2xl font-bold">{current.word}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs uppercase tracking-wide text-muted">{language === "en" ? "Comment on dit…" : "Quel mot pour…"}</span>
                      <span className="text-2xl font-bold">{current.translation || current.word}</span>
                      <span className="text-xs text-muted">Appuie pour voir la réponse</span>
                    </>
                  )}
                </button>
                {flipped && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => answer(false)} className="h-12 rounded-2xl border border-line text-sm font-semibold">
                      Pas encore
                    </button>
                    <button type="button" onClick={() => answer(true)} className="h-12 rounded-2xl bg-speaking text-sm font-bold text-bg">
                      Je savais
                    </button>
                  </div>
                )}
                <button type="button" onClick={startVoiceReview} className="h-12 rounded-2xl bg-accent text-sm font-bold text-accent-contrast">
                  Réviser à la voix avec Emma
                </button>
              </>
            ) : (
              <p className="text-sm text-muted">
                {done > 0 ? `Bravo, ${done} mot${done > 1 ? "s" : ""} révisé${done > 1 ? "s" : ""}. ` : ""}
                Rien à réviser pour l&apos;instant en {LANGUAGE_LABELS[language].toLowerCase()}. Les mots reviennent à J+1, J+3, J+7 puis J+21.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Tout le carnet</h2>
              <span className="text-xs text-muted">{all.length} mot{all.length > 1 ? "s" : ""}</span>
            </div>
            {all.length === 0 ? (
              <p className="text-sm text-muted">Les mots du jour de chaque séance arrivent ici automatiquement.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {all.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="flex flex-col">
                      <span className="font-semibold">{w.word}</span>
                      <span className="text-xs text-muted">{w.translation}</span>
                    </span>
                    <span className="text-xs text-muted">{stageLabel(w)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function stageLabel(w: WordRow) {
  const due = new Date(w.due_at).getTime();
  if (due <= Date.now()) return "à réviser";
  const days = Math.ceil((due - Date.now()) / 86_400_000);
  return w.stage >= 4 ? "acquis" : `dans ${days} j`;
}
