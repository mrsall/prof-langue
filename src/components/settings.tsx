"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentStatus } from "@/app/api/elevenlabs/agent/route";
import type { FrenchVoicesStatus } from "@/app/api/elevenlabs/voices-fr/route";
import { SettingsV3 } from "@/components/settings-v3";

/**
 * Page Réglages (V1) : configure l'agent ElevenLabs en un bouton et montre
 * ce qui est prêt ou pas.
 */
type Loaded = { status: AgentStatus | null; error: string | null };

export function Settings() {
  const [agent, setAgent] = useState<Loaded>({ status: null, error: null });
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [bilanAvailable, setBilanAvailable] = useState<boolean | null>(null);
  const [frVoices, setFrVoices] = useState<FrenchVoicesStatus | null>(null);
  const [frError, setFrError] = useState<string | null>(null);
  const [frApplying, setFrApplying] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/elevenlabs/agent"), fetch("/api/bilan"), fetch("/api/elevenlabs/voices-fr")])
      .then(async ([agentRes, bilanRes, frRes]) => {
        const agentData = (await agentRes.json().catch(() => ({}))) as AgentStatus & { error?: string };
        const bilanData = (await bilanRes.json().catch(() => ({}))) as { available?: boolean };
        const frData = (await frRes.json().catch(() => ({}))) as FrenchVoicesStatus & { error?: string };
        if (!active) return;
        setAgent(agentRes.ok ? { status: agentData, error: null } : { status: null, error: agentData.error ?? "Erreur." });
        setBilanAvailable(Boolean(bilanData.available));
        if (frRes.ok) setFrVoices(frData);
        else setFrError(frData.error ?? "Erreur.");
      })
      .catch(() => {
        if (active) setAgent({ status: null, error: "Pas de connexion. Vérifie ton réseau puis réessaie." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const apply = async () => {
    setApplying(true);
    setDone(false);
    try {
      const res = await fetch("/api/elevenlabs/agent", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as AgentStatus & { error?: string };
      if (res.ok) {
        setAgent({ status: data, error: null });
        setDone(true);
      } else {
        setAgent((prev) => ({ ...prev, error: data.error ?? "Erreur." }));
      }
    } catch {
      setAgent((prev) => ({ ...prev, error: "Pas de connexion. Vérifie ton réseau puis réessaie." }));
    } finally {
      setApplying(false);
    }
  };

  const s = agent.status;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Réglages</h1>
        <Link href="/" className="h-10 rounded-xl border border-line bg-elevated px-4 text-sm font-semibold leading-10">
          Accueil
        </Link>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Agent ElevenLabs</h2>
          {loading ? (
            <span className="text-xs text-muted">Vérification…</span>
          ) : s ? (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.ok ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>
              {s.ok ? "Prêt" : "À configurer"}
            </span>
          ) : null}
        </div>

        {agent.error && (
          <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{agent.error}</p>
        )}

        {s && (
          <ul className="flex flex-col gap-1.5 text-sm">
            <Row ok={true} label={`Agent : ${s.name ?? "sans nom"}`} />
            <Row ok={s.llmOk} label={`Cerveau : ${s.llm ?? "inconnu"}${s.llmOk ? "" : " (Claude Haiku conseillé)"}`} />
            <Row ok={s.overrides.prompt} label="Consignes de Max envoyées par l'app" />
            <Row ok={s.overrides.firstMessage} label="Première phrase envoyée par l'app" />
            <Row ok={s.overrides.language} label="Langue choisie par l'app (anglais ou français)" />
            <Row ok={s.frenchReady} label="Français ajouté aux langues de l'agent" />
            <Row ok={s.ttsMultilingual} label={`Voix multilingue${s.ttsModel ? ` (${s.ttsModel})` : ""}`} />
            <Row ok={s.overrides.voiceId} label="Voix choisie par l'app" />
            <Row ok={s.overrides.speed} label="Vitesse choisie par l'app" />
          </ul>
        )}

        {s && !s.ok && (
          <button
            type="button"
            onClick={apply}
            disabled={applying}
            className="h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast disabled:opacity-60"
          >
            {applying ? "Réglage en cours…" : "Configurer l'agent automatiquement"}
          </button>
        )}
        {done && s?.ok && <p className="text-sm text-speaking">C&apos;est réglé. Tu peux lancer une séance avec Max.</p>}
        <p className="text-xs text-muted">
          Ce bouton autorise l&apos;agent à recevoir les consignes, la première phrase, la langue, la voix et la vitesse depuis l&apos;app, ajoute le français, passe sur une voix multilingue et choisit Claude Haiku comme cerveau. Il ne touche à rien d&apos;autre.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Voix françaises</h2>
          {frVoices && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${frVoices.ok ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>
              {frVoices.ok ? "Prêt" : "À ajouter"}
            </span>
          )}
        </div>
        {frError && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{frError}</p>}
        {frVoices && frVoices.voices.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {frVoices.voices.map((v) => (
              <li key={v.voiceId} className="rounded-full bg-accent-soft px-2.5 py-1">
                {v.name} · {v.gender === "female" ? "femme" : "homme"}
              </li>
            ))}
          </ul>
        ) : (
          frVoices && <p className="text-sm text-muted">Aucune voix française dans ton compte pour l&apos;instant.</p>
        )}
        {frVoices && !frVoices.ok && (
          <button
            type="button"
            disabled={frApplying}
            onClick={async () => {
              setFrApplying(true);
              setFrError(null);
              try {
                const res = await fetch("/api/elevenlabs/voices-fr", { method: "POST" });
                const data = (await res.json().catch(() => ({}))) as FrenchVoicesStatus & { error?: string };
                if (res.ok) setFrVoices(data);
                else setFrError(data.error ?? "Erreur.");
              } catch {
                setFrError("Pas de connexion. Réessaie.");
              } finally {
                setFrApplying(false);
              }
            }}
            className="h-12 rounded-2xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60"
          >
            {frApplying ? "Recherche en cours…" : "Ajouter des voix françaises (accent de France)"}
          </button>
        )}
        <p className="text-xs text-muted">
          En français, les personnages utilisent de vraies voix françaises de la bibliothèque ElevenLabs (accent de France, pas québécois). L&apos;app les ajoute à ton compte toute seule. Pour en imposer une : variable <code>ELEVENLABS_VOICE_FR_&lt;MODE&gt;</code>.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Mots du jour (Claude)</h2>
          {bilanAvailable != null && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${bilanAvailable ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>
              {bilanAvailable ? "Prêt" : "Facultatif"}
            </span>
          )}
        </div>
        <p className="text-sm text-muted">
          {bilanAvailable
            ? "La clé Anthropic est en place : le bilan relève les mots du jour."
            : "Sans clé Anthropic, le bilan n'affiche pas les mots du jour. Pour l'activer : Vercel → Settings → Environment Variables → ANTHROPIC_API_KEY, puis Redeploy."}
        </p>
      </section>

      <SettingsV3 />

      <p className="text-center text-xs text-muted">
        <Link href="/test-voix" className="underline">
          Test des voix (V0)
        </Link>
      </p>
    </main>
  );
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${ok ? "bg-speaking/20 text-speaking" : "bg-listening/20 text-listening"}`} aria-hidden>
        {ok ? "✓" : "!"}
      </span>
      <span>{label}</span>
    </li>
  );
}
