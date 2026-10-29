"use client";

import { formatReset, type ElevenQuota } from "@/lib/quota-format";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SuiviData } from "@/app/api/suivi/route";
import { findPersonality } from "@/config/personalities";

/**
 * Écran de suivi : minutes par semaine, série, niveau, carnet, coût du mois.
 */
export function Suivi() {
  const [data, setData] = useState<SuiviData | null>(null);
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const empty: SuiviData = { db: true, weeks: [], streak: 0, totalSessions: 0, totalMinutes: 0, words: 0, dueWords: 0, levels: { en: null, fr: null }, progression: [], byMode: [], monthFcfa: 0, elevenQuota: null, monthFcfaSource: "minutes", pron: { attempts: 0, average: null, weeks: [], sounds: [] } };
    fetch("/api/suivi")
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<SuiviData> & { error?: string };
        if (res.status === 401) {
          router.push("/acces");
          return null;
        }
        if (!res.ok || typeof body.db !== "boolean") {
          return { ...empty, error: body.error ?? `Le serveur a répondu ${res.status}. Réessaie dans un instant.` };
        }
        return body as SuiviData;
      })
      .then((d) => {
        if (active && d) setData(d);
      })
      .catch(() => {
        if (active) setData({ ...empty, error: "Pas de connexion au serveur de l'app (réseau coupé ou trop lent)." });
      });
    return () => {
      active = false;
    };
  }, [attempt, router]);

  const max = Math.max(10, ...(data?.weeks.map((w) => w.minutes) ?? [0]));
  // Calculé seulement une fois les données chargées (donc côté téléphone).
  const weeks = data ? fillWeeks(data.weeks) : [];
  const pronWeeks = data ? fillWeeks(data.pron.weeks.map((w) => ({ start: w.start, minutes: w.score }))) : [];

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
          {data.error && (
            <section className="flex flex-col gap-2 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm">
              <p className="text-danger">{data.error}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setData(null);
                    setAttempt((a) => a + 1);
                  }}
                  className="h-10 flex-1 rounded-xl bg-accent text-sm font-bold text-accent-contrast"
                >
                  Réessayer
                </button>
                <Link href="/reglages#diagnostic" className="h-10 flex-1 rounded-xl border border-line bg-elevated text-center text-sm font-semibold leading-10">
                  Diagnostic
                </Link>
              </div>
            </section>
          )}
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
              <LevelLine label="Anglais" level={data.levels.en} observed={data.progression.find((p) => p.language === "en")?.level ?? null} />
              <LevelLine label="Français" level={data.levels.fr} observed={data.progression.find((p) => p.language === "fr")?.level ?? null} />
              {data.progression.length > 0 && (
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  Vu en séance : {data.progression.slice(0, 6).map((p) => `${p.level} (${p.language.toUpperCase()}, ${p.day.slice(8, 10)}/${p.day.slice(5, 7)})`).join(" · ")}. Trois séances de suite au-dessus de ton niveau le font monter.
                </p>
              )}
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

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Prononciation</h2>
              <Link href="/prononciation" className="text-xs text-accent underline">
                S&apos;entraîner
              </Link>
            </div>
            {data.pron.attempts === 0 ? (
              <p className="text-sm text-muted">Pas encore de phrase notée. Lance une série de répétition : la voix dit une phrase, tu la répètes, chaque mot est noté.</p>
            ) : (
              <>
                <p className="text-sm">
                  Moyenne sur 30 jours : <strong className={toneClass(data.pron.average)}>{data.pron.average ?? "–"}</strong> / 100, sur {data.pron.attempts} phrase{data.pron.attempts > 1 ? "s" : ""}.
                </p>
                <ul className="flex h-28 items-end gap-2" aria-label="Note moyenne de prononciation par semaine">
                  {pronWeeks.map((w) => (
                    <li key={w.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1" aria-label={`Semaine du ${w.label} : ${w.minutes || "pas de note"}`}>
                      <span className="text-[10px] text-muted">{w.minutes > 0 ? w.minutes : ""}</span>
                      <span className={`w-full rounded-t-md ${w.minutes >= 80 ? "bg-speaking" : w.minutes >= 60 ? "bg-listening" : w.minutes > 0 ? "bg-danger" : "bg-accent-soft"}`} style={{ height: `${Math.max(3, Math.round((w.minutes / 100) * 80))}px` }} aria-hidden />
                      <span className="text-[10px] text-muted">{w.label}</span>
                    </li>
                  ))}
                </ul>
                {data.pron.sounds.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">Sons les moins réussis</span>
                    <ul className="flex flex-wrap gap-2">
                      {data.pron.sounds.map((s) => (
                        <li key={`${s.language}-${s.phoneme}`} className={`rounded-full border px-2.5 py-1 font-mono text-xs ${s.score >= 80 ? "border-speaking/40 text-speaking" : s.score >= 60 ? "border-listening/40 text-listening" : "border-danger/40 text-danger"}`}>
                          {s.language.toUpperCase()} /{s.phoneme}/ {s.score}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>

          <QuotaLine quota={data.elevenQuota} monthFcfa={data.monthFcfa} source={data.monthFcfaSource} />
        </>
      )}
    </main>
  );
}

function toneClass(score: number | null) {
  if (score === null) return "";
  return score >= 80 ? "text-speaking" : score >= 60 ? "text-listening" : "text-danger";
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

/** Vrais crédits ElevenLabs du mois, et coût en FCFA (réel si le prix de l'abonnement est réglé). */
export function QuotaLine({ quota, monthFcfa, source }: { quota: ElevenQuota | null; monthFcfa: number; source: "quota" | "minutes" }) {
  const reset = formatReset(quota?.resetAt ?? null);
  const high = quota?.exhausted || (quota?.pct ?? 0) >= 80;
  return (
    <div className={`flex flex-col gap-1 rounded-2xl border px-4 py-3 text-xs ${high ? "border-listening/40 bg-listening/10 text-listening" : "border-line bg-elevated text-muted"}`}>
      {quota && quota.used != null && quota.limit != null ? (
        <p>
          ElevenLabs : <strong>{quota.used.toLocaleString("fr-FR")} / {quota.limit.toLocaleString("fr-FR")}</strong> crédits utilisés ({quota.pct} %)
          {reset ? `, remise à zéro le ${reset}` : ""}.{quota.exhausted ? " Crédit épuisé : les voix de secours prennent le relais." : ""}
        </p>
      ) : quota?.error ? (
        <p>Crédits ElevenLabs non lus : {quota.error}</p>
      ) : null}
      <p>
        Coût ce mois-ci : ≈ {monthFcfa} FCFA{source === "quota" ? " (d'après les vrais crédits)" : " (estimation par minute ; règle le prix de ton abonnement dans Réglages pour le vrai chiffre)"}.
      </p>
    </div>
  );
}

/** « B1 (estimé en séance) — fais le test pour confirmer » tant que le test n'a pas été passé. */
function LevelLine({ label, level, observed }: { label: string; level: string | null; observed: string | null }) {
  if (level) {
    return (
      <span className="text-sm">
        {label} : <strong>{level}</strong>
      </span>
    );
  }
  if (observed) {
    return (
      <span className="text-sm">
        {label} : <strong>{observed}</strong> <span className="text-xs text-muted">(estimé en séance — fais le test pour confirmer)</span>
      </span>
    );
  }
  return (
    <span className="text-sm">
      {label} : <strong>à tester</strong>
    </span>
  );
}
