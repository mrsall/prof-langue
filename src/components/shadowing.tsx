"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PhrasesResponse, ShadowPhrase, SoundStat } from "@/app/api/prononciation/phrases/route";
import type { PronunciationResult, WordScore } from "@/lib/pronunciation";
import { startWavRecorder, type WavRecorder } from "@/lib/recorder";
import { scoreTone, type ScoreTone } from "@/config/shadowing";
import { LANGUAGE_LABELS, isLanguage, type Language } from "@/config/personalities";

/**
 * V4 — Shadowing : une phrase est lue par la voix, Cherif la répète, chaque mot
 * est coloré (vert / orange / rouge) et un mot raté se rejoue lentement d'un appui.
 * Les phrases viennent des dernières séances, des mots ratés, puis d'une réserve.
 */

const MAX_RECORD_SECONDS = 15;
const HANDOFF_KEY = "prof-langue:shadowing";
const LANGUAGE_KEY = "prof-langue:language";

type Status = "idle" | "playing" | "recording" | "scoring";
type Done = { phrase: ShadowPhrase; result: PronunciationResult };

const TONE_CLASS: Record<ScoreTone, string> = {
  good: "bg-speaking/15 text-speaking border-speaking/40",
  medium: "bg-listening/15 text-listening border-listening/40",
  bad: "bg-danger/10 text-danger border-danger/40",
};

export function Shadowing() {
  const [language, setLanguage] = useState<Language | null>(null);
  const [setup, setSetup] = useState<PhrasesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [seed, setSeed] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<WavRecorder | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoff = useRef<{ language: Language; phrases: string[] } | null>(null);

  // Langue : celle passée par le bilan, sinon celle choisie sur l'accueil.
  useEffect(() => {
    let lang: Language = "en";
    try {
      const fromHome = localStorage.getItem(LANGUAGE_KEY)?.replace(/"/g, "");
      if (isLanguage(fromHome)) lang = fromHome;
      if (new URLSearchParams(window.location.search).get("from") === "seance") {
        const raw = sessionStorage.getItem(HANDOFF_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { language?: unknown; phrases?: unknown };
          if (isLanguage(parsed.language) && Array.isArray(parsed.phrases)) {
            handoff.current = { language: parsed.language, phrases: parsed.phrases.filter((p): p is string => typeof p === "string").slice(0, 6) };
            lang = parsed.language;
          }
        }
        sessionStorage.removeItem(HANDOFF_KEY);
      }
    } catch {
      // stockage indisponible
    }
    const id = setTimeout(() => setLanguage(lang), 0);
    return () => clearTimeout(id);
  }, []);

  // Phrases de la série.
  useEffect(() => {
    if (!language) return;
    let active = true;
    fetch(`/api/prononciation/phrases?lang=${language}&count=6`)
      .then(async (res) => (await res.json()) as PhrasesResponse)
      .then((data) => {
        if (!active) return;
        const extra = handoff.current && handoff.current.language === language ? handoff.current.phrases : [];
        handoff.current = null;
        if (extra.length > 0) {
          const fromSession = extra.map<ShadowPhrase>((text) => ({ text, from: "seance", note: "De ta séance" }));
          const rest = data.phrases.filter((p) => !extra.includes(p.text));
          data = { ...data, phrases: [...fromSession, ...rest].slice(0, 6) };
        }
        setSetup(data);
      })
      .catch(() => {
        if (active) setLoadError("Pas de connexion. Réessaie dans un instant.");
      });
    return () => {
      active = false;
    };
  }, [language, seed]);

  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      if (stopTimer.current) clearTimeout(stopTimer.current);
      audioRef.current?.pause();
    },
    [],
  );

  const phrases = setup?.phrases ?? [];
  const current = phrases[index] ?? null;
  const finished = setup !== null && phrases.length > 0 && index >= phrases.length;

  function play(text: string, speed: number) {
    if (!language) return;
    const audio = audioRef.current ?? (audioRef.current = new Audio());
    audio.pause();
    audio.src = `/api/tts?text=${encodeURIComponent(text)}&lang=${language}&speed=${speed}`;
    audio.onended = () => setStatus((s) => (s === "playing" ? "idle" : s));
    audio.onerror = () => {
      setStatus((s) => (s === "playing" ? "idle" : s));
      setError("Impossible de lire la voix. Vérifie la connexion.");
    };
    setError(null);
    setStatus("playing");
    void audio.play().catch(() => setStatus("idle"));
  }

  async function startRecording() {
    if (!current) return;
    audioRef.current?.pause();
    setError(null);
    setResult(null);
    try {
      const rec = await startWavRecorder(setLevel);
      recorderRef.current = rec;
      navigator.vibrate?.(30);
      setStatus("recording");
      stopTimer.current = setTimeout(() => void stopRecording(), MAX_RECORD_SECONDS * 1000);
    } catch (e) {
      setError(e instanceof Error && /denied|permission|NotAllowed/i.test(e.message + e.name) ? "Autorise le micro pour ce site, puis réessaie." : e instanceof Error ? e.message : "Micro indisponible.");
    }
  }

  async function stopRecording() {
    const rec = recorderRef.current;
    if (!rec || !current || !language) return;
    recorderRef.current = null;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    navigator.vibrate?.(20);
    setStatus("scoring");
    setLevel(0);
    try {
      const blob = await rec.stop();
      const form = new FormData();
      form.append("audio", blob, "repetition.wav");
      form.append("reference", current.text);
      form.append("language", language);
      const res = await fetch("/api/prononciation", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as PronunciationResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Erreur ${res.status}`);
      setResult(data);
      setDone((d) => [...d.filter((x) => x.phrase.text !== current.text), { phrase: current, result: data }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse impossible.");
    } finally {
      setStatus("idle");
    }
  }

  function next() {
    audioRef.current?.pause();
    setResult(null);
    setError(null);
    setIndex((i) => i + 1);
  }

  function restart() {
    setSetup(null);
    setLoadError(null);
    setIndex(0);
    setResult(null);
    setDone([]);
    setError(null);
    setSeed((s) => s + 1);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Prononciation</h1>
        <Link href="/" className="h-10 rounded-xl border border-line bg-elevated px-4 text-sm font-semibold leading-10">
          Accueil
        </Link>
      </header>

      {language && (
        <div className="flex gap-2" role="radiogroup" aria-label="Langue">
          {(["en", "fr"] as Language[]).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={language === l}
              disabled={status !== "idle"}
              onClick={() => {
                if (l === language) return;
                setLanguage(l);
                setSetup(null);
                setLoadError(null);
                setIndex(0);
                setResult(null);
                setDone([]);
              }}
              className={`h-10 flex-1 rounded-xl border text-sm font-semibold ${language === l ? "border-accent bg-accent-soft text-accent" : "border-line bg-elevated"}`}
            >
              {LANGUAGE_LABELS[l]}
            </button>
          ))}
        </div>
      )}

      {loadError && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{loadError}</p>}

      {setup === null && !loadError ? (
        <p className="text-sm text-muted">Je prépare tes phrases…</p>
      ) : setup && !setup.available ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4 text-sm">
          <h2 className="text-base font-semibold">À configurer</h2>
          <p className="text-muted">
            L&apos;évaluation de la prononciation utilise Azure Speech (5 heures gratuites par mois). Il manque <code className="font-mono">AZURE_SPEECH_KEY</code> et{" "}
            <code className="font-mono">AZURE_SPEECH_REGION</code> dans Vercel. La marche à suivre est dans <Link href="/reglages" className="underline">Réglages</Link>.
          </p>
          <p className="text-muted">En attendant, tu peux écouter les phrases et les répéter sans note.</p>
        </section>
      ) : null}

      {setup?.sounds && setup.sounds.length > 0 && !finished && (
        <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
          <span className="text-sm font-semibold">Sons à travailler</span>
          <SoundChips sounds={setup.sounds} />
        </section>
      )}

      {finished && setup ? (
        <Summary done={done} total={phrases.length} language={language ?? "en"} onPlayWord={(w) => play(w, 0.75)} onRestart={restart} />
      ) : current ? (
        <>
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                Phrase {index + 1} sur {phrases.length}
              </span>
              {current.note && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{current.note}</span>}
            </div>
            {result ? (
              <p className="flex flex-wrap gap-x-1.5 gap-y-2 text-lg leading-snug">
                {result.words.map((w, i) => (
                  <WordChip key={`${w.word}-${i}`} word={w} onPlay={() => play(w.word, 0.7)} />
                ))}
              </p>
            ) : (
              <p className="text-lg font-semibold leading-snug">{current.text}</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => play(current.text, 1)} disabled={status === "recording" || status === "scoring"} className="h-11 flex-1 rounded-xl border border-line bg-bg text-sm font-semibold disabled:opacity-50">
                {status === "playing" ? "Écoute…" : "Écouter"}
              </button>
              <button type="button" onClick={() => play(current.text, 0.75)} disabled={status === "recording" || status === "scoring"} className="h-11 flex-1 rounded-xl border border-line bg-bg text-sm font-semibold disabled:opacity-50">
                Lentement
              </button>
            </div>
          </section>

          {result && (
            <section className="grid grid-cols-3 gap-2">
              <ScoreTile label="Prononciation" value={result.scores.pron} />
              <ScoreTile label="Précision" value={result.scores.accuracy} />
              <ScoreTile label="Fluidité" value={result.scores.fluency} />
            </section>
          )}
          {result && result.words.some((w) => w.score !== null && w.score < 80) && <p className="text-center text-xs text-muted">Appuie sur un mot pour l&apos;entendre lentement.</p>}
          {result && result.weakSounds.length > 0 && (
            <p className="text-center text-xs text-muted">
              Son{result.weakSounds.length > 1 ? "s" : ""} à soigner : {result.weakSounds.map((s) => `/${s.phoneme}/`).join(" ")}
            </p>
          )}

          {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          <div className="mt-auto flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => (status === "recording" ? void stopRecording() : void startRecording())}
              disabled={status === "scoring" || status === "playing"}
              aria-label={status === "recording" ? "Arrêter et noter" : "Je répète"}
              className={`relative grid h-24 w-24 place-items-center rounded-full text-accent-contrast shadow-lg transition disabled:opacity-50 ${status === "recording" ? "bg-listening" : "bg-accent"}`}
              style={status === "recording" ? { boxShadow: `0 0 0 ${Math.round(6 + level * 26)}px rgba(255, 138, 61, 0.25)` } : undefined}
            >
              {status === "scoring" ? (
                <span className="text-sm font-bold">…</span>
              ) : status === "recording" ? (
                <svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              )}
            </button>
            <span className="text-sm text-muted">
              {status === "recording" ? "Je t'écoute… appuie pour arrêter" : status === "scoring" ? "Je note ta phrase…" : result ? "Réessaie, ou passe à la suivante" : "Appuie, répète la phrase, appuie à nouveau"}
            </span>
            <button type="button" onClick={next} disabled={status === "recording" || status === "scoring"} className={`h-12 w-full rounded-2xl text-sm font-bold disabled:opacity-50 ${result ? "bg-accent text-accent-contrast" : "border border-line bg-elevated"}`}>
              {result ? "Phrase suivante" : "Passer"}
            </button>
          </div>
        </>
      ) : setup && phrases.length === 0 ? (
        <p className="text-sm text-muted">Aucune phrase pour l&apos;instant. Fais d&apos;abord une séance.</p>
      ) : null}
    </main>
  );
}

function WordChip({ word, onPlay }: { word: WordScore; onPlay: () => void }) {
  const tone = scoreTone(word.score);
  if (word.errorType === "Insertion") {
    return <span className="rounded-md border border-dashed border-line px-1.5 text-base text-muted line-through">{word.word}</span>;
  }
  const omitted = word.errorType === "Omission";
  return (
    <button type="button" onClick={onPlay} className={`rounded-md border px-1.5 font-semibold ${TONE_CLASS[tone]} ${omitted ? "opacity-70" : ""}`} aria-label={`${word.word}, ${omitted ? "oublié" : `${word.score} sur 100`}. Écouter lentement`}>
      {word.word}
      {omitted && <span className="ml-1 text-xs font-normal">(oublié)</span>}
    </button>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  const tone = scoreTone(value);
  const color = tone === "good" ? "text-speaking" : tone === "medium" ? "text-listening" : "text-danger";
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-elevated px-2 py-3 text-center">
      <span className={`font-mono text-2xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function SoundChips({ sounds }: { sounds: SoundStat[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {sounds.map((s) => (
        <li key={s.phoneme} className={`rounded-full border px-2.5 py-1 font-mono text-sm ${TONE_CLASS[scoreTone(s.score)]}`} title={`${s.attempts} essais`}>
          /{s.phoneme}/ {s.score}
        </li>
      ))}
    </ul>
  );
}

function Summary({ done, total, language, onPlayWord, onRestart }: { done: Done[]; total: number; language: Language; onPlayWord: (word: string) => void; onRestart: () => void }) {
  const scored = done.filter((d) => d.result);
  const average = scored.length ? Math.round(scored.reduce((s, d) => s + d.result.scores.pron, 0) / scored.length) : null;
  const hardWords = scored
    .flatMap((d) => d.result.words.filter((w) => w.score !== null && w.score < 60 && w.errorType !== "Insertion"))
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .filter((w, i, arr) => arr.findIndex((x) => x.word.toLowerCase() === w.word.toLowerCase()) === i)
    .slice(0, 6);
  const sounds = new Map<string, number[]>();
  for (const d of scored) for (const s of d.result.weakSounds) sounds.set(s.phoneme, [...(sounds.get(s.phoneme) ?? []), s.score]);
  const weak = [...sounds.entries()].map(([phoneme, v]) => ({ phoneme, score: Math.round(v.reduce((a, b) => a + b, 0) / v.length), attempts: v.length })).sort((a, b) => a.score - b.score).slice(0, 4);
  const message =
    average === null
      ? "Série terminée. Configure Azure pour avoir des notes."
      : average >= 80
        ? "Très clair. On monte la difficulté la prochaine fois."
        : average >= 60
          ? "On te comprend bien. Encore quelques sons à soigner."
          : "C'est en travaillant ces mots-là que tu gagneras le plus.";

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
      <h2 className="text-base font-semibold">Série terminée</h2>
      <p className="text-sm text-muted">
        {scored.length} phrase{scored.length > 1 ? "s" : ""} notée{scored.length > 1 ? "s" : ""} sur {total} en {LANGUAGE_LABELS[language].toLowerCase()}.
      </p>
      {average !== null && (
        <div className="grid grid-cols-1">
          <ScoreTile label="Moyenne de la série" value={average} />
        </div>
      )}
      <p className="text-sm">{message}</p>
      {hardWords.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Mots à refaire (appuie pour écouter)</span>
          <div className="flex flex-wrap gap-2">
            {hardWords.map((w) => (
              <WordChip key={w.word} word={w} onPlay={() => onPlayWord(w.word)} />
            ))}
          </div>
        </div>
      )}
      {weak.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Sons à soigner</span>
          <SoundChips sounds={weak} />
        </div>
      )}
      <button type="button" onClick={onRestart} className="h-12 rounded-2xl bg-accent text-sm font-bold text-accent-contrast">
        Encore une série
      </button>
      <Link href="/suivi" className="text-center text-xs text-muted underline">
        Voir mes notes dans le suivi
      </Link>
    </section>
  );
}
