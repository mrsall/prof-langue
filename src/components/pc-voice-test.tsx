"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PcDiagnostic } from "@/app/api/diagnostic/pc/route";
import { LANGUAGE_LABELS, type Language } from "@/config/personalities";

/**
 * B2 : page /test-voix-pc. La même phrase dite par chaque moteur de voix chargé
 * sur le PC (Chatterbox Multilingue, Chatterbox Turbo…), avec le temps de
 * fabrication, la durée de l'audio et leur rapport (RTF). Pour comparer à l'oreille.
 */
const DEFAULT_TEXT: Record<Language, string> = {
  en: "Honestly, I think the city is better. There are more jobs, but life is more expensive. What do you think?",
  fr: "Franchement, je pense que la ville est mieux. Il y a plus de travail, mais la vie est plus chère. Tu en penses quoi ?",
};

type Result = { ok: boolean; engine?: string; ms?: number; generationMs?: number | null; audioMs?: number | null; rtf?: number | null; audio?: string; error?: string };

export function PcVoiceTest() {
  const [diag, setDiag] = useState<PcDiagnostic | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [text, setText] = useState(DEFAULT_TEXT.en);
  const [results, setResults] = useState<Record<string, Result | "pending">>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/diagnostic/pc")
      .then(async (r) => (await r.json()) as PcDiagnostic)
      .then((d) => {
        if (active) setDiag(d);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const engines = diag?.engines?.length ? diag.engines : ["multilingual"];

  const run = async (engine: string) => {
    setResults((r) => ({ ...r, [engine]: "pending" }));
    try {
      const q = new URLSearchParams({ engine, lang: language, text, voice: "prof" });
      const res = await fetch(`/api/diagnostic/pc-voix?${q.toString()}`);
      const data = (await res.json()) as Result;
      setResults((r) => ({ ...r, [engine]: data }));
      if (data.ok && data.audio) {
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = data.audio;
        void audio.play().catch(() => undefined);
      }
    } catch {
      setResults((r) => ({ ...r, [engine]: { ok: false, error: "Pas de connexion." } }));
    }
  };

  const label = (e: string) => (e === "turbo" ? "Chatterbox Turbo (anglais, léger)" : "Chatterbox Multilingue (français et anglais)");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Voix de mon PC</h1>
        <Link href="/admin" className="flex h-11 items-center rounded-xl border border-line bg-elevated px-4 text-sm font-semibold">
          Admin
        </Link>
      </header>
      <p className="text-sm text-muted">
        La même phrase par chaque moteur chargé sur ton PC, avec le temps de fabrication. RTF = fabrication ÷ durée du son : au-dessus de 1, la carte fabrique moins vite qu&apos;elle ne lit (le téléphone attend alors la fin de la réponse avant de parler).
        {diag?.rtf?.avg != null ? ` Moyenne actuelle sur le PC : ${diag.rtf.avg} (${diag.rtf.count} phrases).` : ""}
      </p>
      {diag && !diag.configured && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">PC non configuré dans Vercel.</p>}
      {diag && diag.configured && !diag.ok && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{diag.error}</p>}
      {diag?.turboError && <p className="text-xs text-muted">Chatterbox Turbo demandé mais indisponible : {diag.turboError}</p>}
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-elevated p-1" role="radiogroup" aria-label="Langue">
        {(["en", "fr"] as Language[]).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={language === l}
            onClick={() => {
              setLanguage(l);
              setText(DEFAULT_TEXT[l]);
              setResults({});
            }}
            className={`h-11 rounded-lg text-sm font-medium ${language === l ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
          >
            {LANGUAGE_LABELS[l]}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Phrase à dire" className="rounded-xl border border-line bg-elevated px-3 py-2 text-base text-fg" />
      <ul className="flex flex-col gap-2">
        {engines.map((e) => {
          const r = results[e];
          const disabled = e === "turbo" && language === "fr";
          return (
            <li key={e} className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{label(e)}</span>
                <button type="button" disabled={disabled || r === "pending" || !diag?.ok} onClick={() => run(e)} className="h-11 rounded-xl bg-accent px-4 text-sm font-bold text-accent-contrast disabled:opacity-60">
                  {r === "pending" ? "Fabrication…" : "Écouter"}
                </button>
              </div>
              {disabled && <p className="text-xs text-muted">Turbo ne parle qu&apos;anglais.</p>}
              {r && r !== "pending" && (
                <p className={`font-mono text-xs ${r.ok ? "text-muted" : "text-danger"}`}>
                  {r.ok ? `fabrication ${r.generationMs ?? "?"} ms · audio ${r.audioMs ?? "?"} ms · RTF ${r.rtf ?? "?"} · ${r.ms} ms au total (réseau compris)` : r.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        Pour activer Turbo sur le PC : <code className="font-mono">PC_TTS_ENGINE=turbo</code> dans <code className="font-mono">docker-compose.yml</code>, puis <code className="font-mono">docker compose up -d --build</code> (téléchargement du modèle au premier démarrage). Kyutai TTS (français et anglais, temps réel) reste une piste à essayer plus tard, avec ton accord.
      </p>
    </main>
  );
}
