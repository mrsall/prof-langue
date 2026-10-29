"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EAR_CHOICES, EAR_CHOICE_KEY, parseEarChoice, type EarChoice } from "@/lib/ear";
import { useLocalStorage } from "@/lib/use-local-storage";
import { VOICE_CHOICES, VOICE_CHOICE_KEY, parseVoiceChoice, type VoiceChoice } from "@/lib/voice-engine";

/**
 * Réglages avancés : le choix détaillé des moteurs (conversation, voix, oreille).
 * L'accueil ne montre plus que « Qualité : Max / Économique (auto) » ; ici,
 * chaque groupe a un titre, et tout choix explicite désactive le mode auto.
 */
export const ENGINE_KEY = "prof-langue:engine";
/** "1" = l'app choisit elle-même la voix et l'oreille du mode éco au début de chaque séance. */
export const AUTO_KEY = "prof-langue:auto";

export type Engine = "elevenlabs" | "eco" | "live";

export function parseEngine(raw: string | null | undefined): Engine {
  return raw === "eco" || raw === "live" ? raw : "elevenlabs";
}

export function AdvancedSettings() {
  const [savedEngine, setSavedEngine] = useLocalStorage(ENGINE_KEY);
  const [savedAuto, setSavedAuto] = useLocalStorage(AUTO_KEY);
  const [savedVoice, setSavedVoice] = useLocalStorage(VOICE_CHOICE_KEY);
  const [savedEar, setSavedEar] = useLocalStorage(EAR_CHOICE_KEY);
  const engine = parseEngine(savedEngine);
  const auto = savedAuto === "1";
  const voice: VoiceChoice = parseVoiceChoice(savedVoice);
  const ear: EarChoice = parseEarChoice(savedEar);
  const [pcReady, setPcReady] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/reglages")
      .then(async (r) => (await r.json()) as { pc?: { configured?: boolean } })
      .then((d) => {
        if (active) setPcReady(Boolean(d.pc?.configured));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const engines: { key: Engine; label: string; hint: string }[] = [
    { key: "elevenlabs", label: "Conversation ElevenLabs", hint: "Temps réel ElevenLabs : voix très naturelle, interruption fluide. Consomme tes minutes de conversation." },
    { key: "eco", label: "Mode éco", hint: "Le téléphone écoute, Claude réfléchit, et seule la lecture de la réponse est confiée à la voix choisie ci-dessous : zéro minute de conversation ElevenLabs." },
    ...(pcReady ? [{ key: "live" as const, label: "Temps réel (mon PC)", hint: "Tout se passe sur ton PC (oreille Whisper, Claude, voix Chatterbox) en continu. Gratuit, illimité ; le PC doit être allumé, sinon la séance repasse en mode éco." }] : []),
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Réglages avancés</h1>
        <Link href="/reglages" className="flex h-11 items-center rounded-xl border border-line bg-elevated px-4 text-sm font-semibold">
          Retour
        </Link>
      </header>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Mode auto</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${auto ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>{auto ? "Activé" : "Choix manuel"}</span>
        </div>
        <p className="text-sm text-muted">
          En mode auto (« Économique » sur l&apos;accueil), l&apos;app choisit au début de chaque séance la meilleure voix et la meilleure oreille gratuites : ton PC s&apos;il est en ligne, sinon les autres. Choisir une voix ou une oreille ci-dessous passe en manuel.
        </p>
        {!auto && (
          <button type="button" onClick={() => setSavedAuto("1")} className="h-11 rounded-xl border border-line bg-bg text-sm font-semibold">
            Revenir au mode auto
          </button>
        )}
      </section>

      <Group title="Conversation" aria="Qui fait la voix" hint={engines.find((e) => e.key === engine)?.hint}>
        {engines.map((e) => (
          <Choice key={e.key} selected={engine === e.key} onClick={() => setSavedEngine(e.key)} label={e.label} />
        ))}
      </Group>

      <Group title="Voix (mode éco et prononciation)" aria="Voix du mode éco" hint={VOICE_CHOICES.find((v) => v.key === voice)?.hint}>
        {VOICE_CHOICES.map((v) => (
          <Choice
            key={v.key}
            selected={voice === v.key}
            onClick={() => {
              setSavedVoice(v.key);
              setSavedAuto("0");
            }}
            label={v.label}
          />
        ))}
      </Group>

      <Group title="Oreille (mode éco)" aria="Oreille du mode éco" hint={EAR_CHOICES.find((e) => e.key === ear)?.hint}>
        {EAR_CHOICES.map((e) => (
          <Choice
            key={e.key}
            selected={ear === e.key}
            onClick={() => {
              setSavedEar(e.key);
              setSavedAuto("0");
            }}
            label={e.label}
          />
        ))}
      </Group>
    </main>
  );
}

function Group({ title, aria, hint, children }: { title: string; aria: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-bg p-1" role="radiogroup" aria-label={aria}>
        {children}
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </section>
  );
}

function Choice({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick} className={`min-h-11 rounded-lg px-2 text-sm font-medium leading-tight ${selected ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}>
      {label}
    </button>
  );
}
