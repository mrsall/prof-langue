"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SuiviData } from "@/app/api/suivi/route";
import { findPersonality } from "@/config/personalities";

/**
 * Écran de suivi : minutes par semaine, série, niveau, carnet, coût du mois.
 */
export function Suivi() {
  const [data, setData] = useState<SuiviData | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/suivi")
      .then(async (res) => (await res.json()) as SuiviData)
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setData({ db: true, weeks: [], streak: 0, totalSessions: 0, totalMinutes: 0, words: 0, dueWords: 0, levels: { en: null, fr: null }, byMode: [], monthFcfa: 0, error: "Pas de connexion." });
      });
    return () => {
      active = false;
    };
  }, []);

  const max = Math.max(10, ...(data?.weeks.map((w) => w.minutes) ?? [0]));
  // Calculé seulement une fois les données chargées (donc côté téléphone).
  const weeks = data ? fillWeeks(data.weeks) : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Suivi</h1>
        <Link href="/" className="h-10 rounded-xl border border-line bg-elevated px-4 text-sm font-semibold leading-10">
          Accueil
        </Link>
      </header>

      {data === null ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : !data.db ? (
        <section className="rounded-2xl border border-line bg-elevated p-4 text-sm text-muted">
          Le suivi a besoin de la base de données. Voir <Link href="/reglages" className="underline">Réglages</Link>.
        </section>
      ) : (
        <>
          {data.error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{data.error}</p>}
          <section className="grid grid-cols-3 gap-2">
            <Tile value={String(data.streak)} label={data.streak > 1 ? "jours de suite" : "jour de suite"} />
            <Tile value={String(data.totalMinutes)} label="minutes au total" />
            <Tile value={String(data.totalSessions)} label={data.totalSessions > 1 ? "séances" : "séance"} />
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-sm font-semibold">Minutes par semaine</h2>
            <ul className="flex h-36 items-end gap-2" aria-label="Minutes par semaine, huit dernières semaines">
              {weeks.map((w) => (
                <li key={w.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1" aria-label={`Semaine du ${w.label} : ${w.minutes} minutes`}>
                  <span className="text-[10px] text-muted">{w.minutes > 0 ? w.minutes : ""}</span>
                  <span className={`w-full rounded-t-md ${w.minutes > 0 ? "bg-accent" : "bg-accent-soft"}`} style={{ height: `${Math.max(3, Math.round((w.minutes / max) * 96))}px` }} aria-hidden />
                  <span className="text-[10px] text-muted">{w.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Objectif : 10 minutes par jour, soit 70 par semaine.</p>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 rounded-2xl border border-line bg-elevated p-4">
              <span className="text-xs text-muted">Niveau</span>
              <span className="text-sm">
                Anglais : <strong>{data.levels.en ?? "à tester"}</strong>
              </span>
              <span className="text-sm">
                Français : <strong>{data.levels.fr ?? "à tester"}</strong>
              </span>
            </div>
            <Link href="/carnet" className="flex flex-col gap-1 rounded-2xl border border-line bg-elevated p-4">
              <span className="text-xs text-muted">Carnet</span>
              <span className="text-sm">
                <strong>{data.words}</strong> mot{data.words > 1 ? "s" : ""}
              </span>
              <span className="text-sm">
                <strong>{data.dueWords}</strong> à réviser
              </span>
            </Link>
          </section>

          {data.byMode.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
              <h2 className="text-sm font-semibold">Avec qui tu parles</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {data.byMode.map((m) => {
                  const pers = findPersonality(m.personality);
                  return (
                    <li key={m.personality} className="flex items-center justify-between">
                      <span>{pers ? (pers.id === "situation" ? pers.modeLabel : `${pers.name} · ${pers.modeLabel}`) : m.personality}</span>
                      <span className="text-muted">{m.minutes} min</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="text-center text-xs text-muted">
            Coût estimé ce mois-ci : ≈ {data.monthFcfa} FCFA. Les notes de prononciation arrivent en V4.
          </p>
        </>
      )}
    </main>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-elevated px-2 py-3 text-center">
      <span className="font-mono text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

/** Complète les 8 dernières semaines, même sans séance. */
function fillWeeks(weeks: { start: string; minutes: number }[]) {
  const byStart = new Map(weeks.map((w) => [w.start, w.minutes]));
  const out: { start: string; label: string; minutes: number }[] = [];
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - day);
  for (let i = 7; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() - i * 7);
    const start = d.toISOString().slice(0, 10);
    out.push({ start, label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, minutes: byStart.get(start) ?? 0 });
  }
  return out;
}
