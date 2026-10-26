"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KOKORO_VOICES, kokoroSupported, loadKokoro, synthesize, webgpuAvailable, type KokoroDevice, type KokoroProgress } from "@/lib/kokoro";
import { LANGUAGE_LABELS, type Language } from "@/config/personalities";

/**
 * Page de test : Kokoro, la voix libre qui tourne dans le téléphone.
 * Mesure le temps de chargement et le temps de fabrication de chaque phrase,
 * pour décider si ce téléphone peut s'en servir au quotidien.
 */

const SAMPLES: Record<Language, string[]> = {
  en: [
    "Hi Cherif! So, what did you do this weekend? Tell me everything.",
    "To be honest, I think the city is better than the village, because there are more jobs.",
    "Can you say that again, please? A bit slower this time.",
  ],
  fr: [
    "Salut Cherif ! Alors, qu'est-ce que tu as fait ce week-end ? Raconte-moi tout.",
    "Honnêtement, je pense que la ville est mieux que le village, parce qu'il y a plus de travail.",
    "Tu peux répéter, s'il te plaît ? Un peu plus lentement cette fois.",
  ],
};

type Run = { id: number; language: Language; voice: string; text: string; seconds: number; generationMs: number; url: string; phonemes?: string };

export function KokoroTest() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [device, setDevice] = useState<KokoroDevice>("wasm");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState<{ label: string; percent: number } | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [voice, setVoice] = useState(KOKORO_VOICES.en[0].id);
  const [text, setText] = useState(SAMPLES.en[0]);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setSupported(kokoroSupported());
      setDevice(webgpuAvailable() ? "webgpu" : "wasm");
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function load() {
    setLoadState("loading");
    setError(null);
    const start = performance.now();
    try {
      await loadKokoro({
        device,
        onProgress: (p: KokoroProgress) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            setProgress({ label: p.file ?? "modèle", percent: Math.round(p.progress) });
          } else if (p.status === "done" || p.status === "ready") {
            setProgress({ label: p.file ?? "modèle", percent: 100 });
          }
        },
      });
      setLoadMs(Math.round(performance.now() - start));
      setLoadState("ready");
    } catch (e) {
      setLoadState("error");
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }

  async function run() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await synthesize(text, { language, voice, speed });
      const url = URL.createObjectURL(result.blob);
      setRuns((r) => [{ id: Date.now(), language, voice, text, seconds: result.seconds, generationMs: result.generationMs, url, phonemes: result.phonemes }, ...r].slice(0, 8));
      const audio = audioRef.current ?? (audioRef.current = new Audio());
      audio.src = url;
      void audio.play().catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fabrication impossible.");
    } finally {
      setBusy(false);
    }
  }

  function pickLanguage(l: Language) {
    setLanguage(l);
    setVoice(KOKORO_VOICES[l][0].id);
    setText(SAMPLES[l][0]);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Test Kokoro</h1>
        <Link href="/reglages" className="h-10 rounded-xl border border-line bg-elevated px-4 text-sm font-semibold leading-10">
          Réglages
        </Link>
      </header>

      <p className="text-sm text-muted">
        Une voix naturelle et gratuite qui tourne dans ton téléphone, sans serveur. Première fois : téléchargement d&apos;environ 90 Mo (mieux en Wi-Fi), ensuite c&apos;est gardé en mémoire.
      </p>

      {supported === false && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">Ce navigateur ne peut pas faire tourner le modèle.</p>}

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">1. Charger la voix</span>
          <span className="text-xs text-muted">Calcul : {device === "webgpu" ? "carte graphique (WebGPU)" : "processeur (WASM)"}</span>
        </div>
        {loadState !== "ready" && (
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-bg p-1" role="radiogroup" aria-label="Mode de calcul">
            {(["webgpu", "wasm"] as KokoroDevice[]).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={device === d}
                disabled={loadState === "loading" || (d === "webgpu" && !webgpuAvailable())}
                onClick={() => setDevice(d)}
                className={`h-10 rounded-lg text-sm font-medium disabled:opacity-40 ${device === d ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
              >
                {d === "webgpu" ? "Carte graphique" : "Processeur"}
              </button>
            ))}
          </div>
        )}
        {loadState === "ready" ? (
          <p className="text-sm text-speaking">Voix prête en {loadMs !== null ? `${(loadMs / 1000).toFixed(1)} s` : "?"}.</p>
        ) : (
          <button type="button" onClick={load} disabled={loadState === "loading" || supported === false} className="h-12 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
            {loadState === "loading" ? "Chargement…" : "Charger la voix (≈ 90 Mo, une seule fois)"}
          </button>
        )}
        {loadState === "loading" && progress && (
          <div className="flex flex-col gap-1">
            <div className="h-2 overflow-hidden rounded-full bg-bg">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            <span className="truncate text-xs text-muted">
              {progress.percent} % · {progress.label}
            </span>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
        <span className="text-sm font-semibold">2. Faire parler</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Langue">
          {(["en", "fr"] as Language[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={language === l} onClick={() => pickLanguage(l)} className={`h-10 flex-1 rounded-xl border text-sm font-semibold ${language === l ? "border-accent bg-accent-soft text-accent" : "border-line bg-bg"}`}>
              {LANGUAGE_LABELS[l]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Voix
          <select value={voice} onChange={(e) => setVoice(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-sm text-fg">
            {KOKORO_VOICES[language].map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES[language].map((s, i) => (
            <button key={s} type="button" onClick={() => setText(s)} className="rounded-full border border-line bg-bg px-3 py-1 text-xs">
              Phrase {i + 1}
            </button>
          ))}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-xl border border-line bg-bg px-3 py-2 text-sm text-fg" />
        <label className="flex items-center gap-3 text-xs text-muted">
          Vitesse {speed.toFixed(2)}
          <input type="range" min={0.7} max={1.2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="flex-1" />
        </label>
        <button type="button" onClick={run} disabled={loadState !== "ready" || busy} className="h-12 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
          {busy ? "Je fabrique la voix…" : "Générer et écouter"}
        </button>
        {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      </section>

      {runs.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
          <span className="text-sm font-semibold">3. Résultats (envoie une capture)</span>
          <ul className="flex flex-col gap-2 text-sm">
            {runs.map((r) => {
              const ratio = r.generationMs / 1000 / Math.max(0.1, r.seconds);
              return (
                <li key={r.id} className="flex flex-col gap-1 rounded-xl bg-bg px-3 py-2">
                  <span className="text-xs text-muted">
                    {LANGUAGE_LABELS[r.language]} · {r.voice} · {r.text.slice(0, 50)}
                    {r.text.length > 50 ? "…" : ""}
                  </span>
                  <span>
                    Audio de <strong>{r.seconds.toFixed(1)} s</strong> fabriqué en <strong>{(r.generationMs / 1000).toFixed(1)} s</strong>{" "}
                    <span className={ratio <= 0.6 ? "text-speaking" : ratio <= 1.2 ? "text-listening" : "text-danger"}>({ratio <= 0.6 ? "rapide" : ratio <= 1.2 ? "acceptable" : "trop lent"})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const audio = audioRef.current ?? (audioRef.current = new Audio());
                      audio.src = r.url;
                      void audio.play().catch(() => undefined);
                    }}
                    className="h-9 w-fit rounded-lg border border-line px-3 text-xs font-semibold"
                  >
                    Réécouter
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">Repère : « rapide » = la voix est fabriquée plus vite qu&apos;elle ne se dit, utilisable en conversation. « Acceptable » = bon pour la prononciation, un peu lent pour discuter.</p>
        </section>
      )}
    </main>
  );
}
