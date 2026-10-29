"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WordRow } from "@/app/api/mots/route";
import { LANGUAGE_LABELS, type Language } from "@/config/personalities";
import { useLocalStorage } from "@/lib/use-local-storage";
import { VOICE_CHOICE_KEY, createSpeaker, parseVoiceChoice, unlockAudio, type Speaker } from "@/lib/voice-engine";
import { speechSynthesisAvailable } from "@/lib/speech";

/**
 * Carnet de mots : les mots à réviser aujourd'hui (révision espacée), puis
 * tout le carnet. Révision par cartes, ou à la voix avec Emma.
 */
const REVISION_STORAGE_KEY = "prof-langue:revision-words";

type Counts = { en: { total: number; due: number }; fr: { total: number; due: number } };
type State = { db: boolean; due: WordRow[]; all: WordRow[]; counts?: Counts; error?: string };

export function Carnet() {
  const [state, setState] = useState<State | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [editing, setEditing] = useState<{ id: WordRow["id"]; word: string; translation: string } | null>(null);
  const [busyId, setBusyId] = useState<WordRow["id"] | null>(null);
  const router = useRouter();
  // 🔊 : voix gratuite par défaut (téléphone, PC, Kokoro, Google) ; ElevenLabs seulement si c'est la seule voix.
  const [rawVoice] = useLocalStorage(VOICE_CHOICE_KEY);
  const speakerRef = useRef<{ key: string; speaker: Speaker } | null>(null);
  const say = (text: string) => {
    const chosen = parseVoiceChoice(rawVoice);
    const free = chosen === "eleven" ? (speechSynthesisAvailable() ? "phone" : "eleven") : chosen;
    const key = `${free}:${language}`;
    if (speakerRef.current?.key !== key) speakerRef.current = { key, speaker: createSpeaker(free, { language, personalityId: "prof" }) };
    unlockAudio();
    speakerRef.current.speaker.speak(text, 1);
  };

  const removeWord = async (id: WordRow["id"]) => {
    if (!window.confirm("Supprimer ce mot du carnet ?")) return;
    setBusyId(id);
    try {
      await fetch("/api/mots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "delete" }) });
      setState((prev) => (prev ? { ...prev, due: prev.due.filter((w) => w.id !== id), all: prev.all.filter((w) => w.id !== id) } : prev));
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.word.trim()) return;
    setBusyId(editing.id);
    try {
      const res = await fetch("/api/mots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, action: "edit", word: editing.word, translation: editing.translation }) });
      if (res.ok) {
        const patch = (w: WordRow) => (w.id === editing.id ? { ...w, word: editing.word.trim(), translation: editing.translation.trim() } : w);
        setState((prev) => (prev ? { ...prev, due: prev.due.map(patch), all: prev.all.map(patch) } : prev));
        setEditing(null);
      }
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/mots")
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<State> & { error?: string };
        if (res.status === 401) {
          router.push("/acces");
          return null;
        }
        if (!res.ok || typeof body.db !== "boolean") {
          return { db: true, due: [], all: [], error: body.error ?? `Le serveur a répondu ${res.status}. Réessaie dans un instant.` } as State;
        }
        return body as State;
      })
      .then((data) => {
        if (active && data) setState(data);
      })
      .catch(() => {
        if (active) setState({ db: true, due: [], all: [], error: "Pas de connexion au serveur de l'app (réseau coupé ou trop lent)." });
      });
    return () => {
      active = false;
    };
  }, [router]);

  const due = (state?.due ?? []).filter((w) => w.language === language);
  const all = (state?.all ?? []).filter((w) => w.language === language);
  const total = state?.counts?.[language]?.total ?? all.length;
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
          Le carnet a besoin de la base de données. Voir <Link href="/admin" className="underline">Admin</Link>.
        </section>
      ) : state.error ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="text-danger">{state.error}</p>
          <Link href="/admin#diagnostic" className="h-10 rounded-xl border border-line bg-elevated text-center text-sm font-semibold leading-10">
            Lancer le diagnostic
          </Link>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-3xl border border-line bg-elevated p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">À réviser aujourd&apos;hui</h2>
              <span className="text-xs text-muted">
                {due.length} à réviser · {LANGUAGE_LABELS[language].toLowerCase()}
              </span>
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
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => say(current.word)} className="flex h-11 items-center gap-2 rounded-xl border border-line bg-bg px-4 text-sm font-semibold" aria-label="Écouter le mot">
                    <span aria-hidden>🔊</span> Écouter
                  </button>
                  {current.kind === "plus-naturel" && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">plus naturel</span>}
                </div>
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
              <span className="text-xs text-muted">
                {total} mot{total > 1 ? "s" : ""} · {LANGUAGE_LABELS[language].toLowerCase()}
              </span>
            </div>
            {all.length === 0 ? (
              <p className="text-sm text-muted">Les mots du jour de chaque séance arrivent ici automatiquement.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {all.map((w) =>
                  editing?.id === w.id ? (
                    <li key={w.id} className="flex flex-col gap-2 py-3 text-sm">
                      <input value={editing.word} onChange={(e) => setEditing({ ...editing, word: e.target.value })} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg" aria-label="Mot" />
                      <input value={editing.translation} onChange={(e) => setEditing({ ...editing, translation: e.target.value })} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg" aria-label="Traduction" placeholder="Traduction ou explication" />
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setEditing(null)} className="h-11 rounded-xl border border-line text-sm font-semibold">
                          Annuler
                        </button>
                        <button type="button" disabled={busyId === w.id} onClick={saveEdit} className="h-11 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
                          Enregistrer
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={w.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold">
                          {w.word}
                          {w.kind === "plus-naturel" && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">plus naturel</span>}
                        </span>
                        <span className="text-xs text-muted">{w.translation}</span>
                        <span className="text-[11px] text-muted">{stageLabel(w)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => say(w.word)} className="flex size-11 items-center justify-center rounded-xl border border-line bg-bg" aria-label={`Écouter ${w.word}`}>
                          <span aria-hidden>🔊</span>
                        </button>
                        <button type="button" onClick={() => setEditing({ id: w.id, word: w.word, translation: w.translation ?? "" })} className="flex size-11 items-center justify-center rounded-xl border border-line bg-bg text-xs font-semibold" aria-label={`Modifier ${w.word}`}>
                          ✎
                        </button>
                        <button type="button" disabled={busyId === w.id} onClick={() => removeWord(w.id)} className="flex size-11 items-center justify-center rounded-xl border border-danger/40 bg-danger/10 text-danger disabled:opacity-60" aria-label={`Supprimer ${w.word}`}>
                          ✕
                        </button>
                      </span>
                    </li>
                  ),
                )}
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
