"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentStatus } from "@/app/api/elevenlabs/agent/route";
import type { FrenchVoicesStatus } from "@/app/api/elevenlabs/voices-fr/route";
import type { ReglagesState } from "@/app/api/reglages/route";
import { TabBar } from "@/components/tab-bar";

/**
 * Admin : tout ce qui sert à diagnostiquer l'installation (agent ElevenLabs,
 * base, Claude, PC, Groq, Google, prononciation, code d'accès). Les réglages
 * d'usage (objectif, niveau, anglais, rappels, plafond) sont dans /reglages.
 * On n'affiche ni l'hôte de la base, ni l'adresse du PC, ni le SQL : « OK » suffit.
 */
type Loaded = { status: AgentStatus | null; error: string | null };

export function Admin() {
  const [state, setState] = useState<ReglagesState | null>(null);
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
    Promise.all([fetch("/api/elevenlabs/agent"), fetch("/api/bilan"), fetch("/api/elevenlabs/voices-fr"), fetch("/api/reglages")])
      .then(async ([agentRes, bilanRes, frRes, regRes]) => {
        const agentData = (await agentRes.json().catch(() => ({}))) as AgentStatus & { error?: string };
        const bilanData = (await bilanRes.json().catch(() => ({}))) as { available?: boolean };
        const frData = (await frRes.json().catch(() => ({}))) as FrenchVoicesStatus & { error?: string };
        const regData = (await regRes.json().catch(() => null)) as ReglagesState | null;
        if (!active) return;
        setAgent(agentRes.ok ? { status: agentData, error: null } : { status: null, error: agentData.error ?? "Erreur." });
        setBilanAvailable(Boolean(bilanData.available));
        if (frRes.ok) setFrVoices(frData);
        else setFrError(frData.error ?? "Erreur.");
        if (regData) setState(regData);
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

  const [diag, setDiag] = useState<{ steps: { name: string; ok: boolean; detail: string; ms: number }[]; region?: string | null; host?: string } | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const runDiag = async () => {
    setDiagBusy(true);
    try {
      const res = await fetch("/api/diagnostic");
      setDiag((await res.json()) as { steps: { name: string; ok: boolean; detail: string; ms: number }[]; region?: string | null; host?: string });
    } catch {
      setDiag({ steps: [{ name: "Diagnostic", ok: false, detail: "impossible de joindre le serveur de l'app", ms: 0 }] });
    } finally {
      setDiagBusy(false);
    }
  };

  const [claude, setClaude] = useState<{ ok: boolean; model: string; ms: number; stopReason: string | null; textLength: number; sample: string; error: string | null } | null>(null);
  const [claudeBusy, setClaudeBusy] = useState(false);
  const testClaude = async () => {
    setClaudeBusy(true);
    try {
      const res = await fetch("/api/diagnostic/claude");
      setClaude((await res.json()) as typeof claude);
    } catch {
      setClaude({ ok: false, model: "?", ms: 0, stopReason: null, textLength: 0, sample: "", error: "impossible de joindre le serveur de l'app" });
    } finally {
      setClaudeBusy(false);
    }
  };

  type PcDiag = { ok: boolean; gpu: string | null; model: string | null; voices: string[]; stt?: string | null; live?: boolean; claude?: string | null; ms: number; generationMs: number | null; error: string | null };
  const [pc, setPc] = useState<PcDiag | null>(null);
  const [pcBusy, setPcBusy] = useState(false);
  const testPc = async () => {
    setPcBusy(true);
    try {
      const res = await fetch("/api/diagnostic/pc");
      const data = (await res.json()) as PcDiag;
      setPc(data);
      if (data.ok) {
        const audio = new Audio(`/api/tts?engine=pc&lang=fr&personality=prof&text=${encodeURIComponent("Bonjour Cherif, je suis la voix de ton PC. On commence quand tu veux.")}`);
        void audio.play().catch(() => undefined);
      }
    } catch {
      setPc({ ok: false, gpu: null, model: null, voices: [], ms: 0, generationMs: null, error: "impossible de joindre le serveur de l'app" });
    } finally {
      setPcBusy(false);
    }
  };

  const [gemini, setGemini] = useState<{ ok: boolean; model: string | null; ms: number; error: string | null } | null>(null);
  const [geminiBusy, setGeminiBusy] = useState(false);
  const testGemini = async () => {
    setGeminiBusy(true);
    try {
      const res = await fetch("/api/diagnostic/gemini");
      const data = (await res.json()) as { ok: boolean; model: string | null; ms: number; error: string | null };
      setGemini(data);
      if (data.ok) {
        const audio = new Audio(`/api/tts?engine=gemini&lang=fr&personality=prof&text=${encodeURIComponent("Bonjour Cherif, je suis la voix Google. On commence quand tu veux.")}`);
        void audio.play().catch(() => undefined);
      }
    } catch {
      setGemini({ ok: false, model: null, ms: 0, error: "impossible de joindre le serveur de l'app" });
    } finally {
      setGeminiBusy(false);
    }
  };

  const s = agent.status;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Link href="/reglages" className="flex h-11 items-center rounded-xl border border-line bg-elevated px-4 text-sm font-semibold">
          Réglages
        </Link>
      </header>
      <p className="text-sm text-muted">Diagnostic de l&apos;installation. Les clés se changent dans Vercel (Settings → Environment Variables), jamais ici.</p>

      <Card title="Agent ElevenLabs" badge={loading ? { label: "Vérification…", tone: "muted" } : s ? { label: s.ok ? "Prêt" : "À configurer", tone: s.ok ? "ok" : "warn" } : null}>
        {agent.error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{agent.error}</p>}
        {s && (
          <ul className="flex flex-col gap-1.5 text-sm">
            <Row ok={true} label={`Agent : ${s.name ?? "sans nom"}`} />
            <Row ok={s.llmOk} label={`Cerveau : ${s.llm ?? "inconnu"}${s.llmOk ? "" : " (Claude Haiku conseillé)"}`} />
            <Row ok={s.overrides.prompt} label="Consignes envoyées par l'app" />
            <Row ok={s.overrides.firstMessage} label="Première phrase envoyée par l'app" />
            <Row ok={s.overrides.language} label="Langue choisie par l'app (anglais ou français)" />
            <Row ok={s.frenchReady} label="Français ajouté aux langues de l'agent" />
            <Row ok={s.ttsMultilingual} label={`Voix multilingue${s.ttsModel ? ` (${s.ttsModel})` : ""}`} />
            <Row ok={s.overrides.voiceId} label="Voix choisie par l'app" />
            <Row ok={s.overrides.speed} label="Vitesse choisie par l'app" />
          </ul>
        )}
        {s && !s.ok && (
          <button type="button" onClick={apply} disabled={applying} className="h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast disabled:opacity-60">
            {applying ? "Réglage en cours…" : "Configurer l'agent automatiquement"}
          </button>
        )}
        {done && s?.ok && <p className="text-sm text-speaking">C&apos;est réglé.</p>}
      </Card>

      <Card title="Voix françaises" badge={frVoices ? { label: frVoices.ok ? "Prêt" : "À ajouter", tone: frVoices.ok ? "ok" : "warn" } : null}>
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
        <p className="text-xs text-muted">En français, les personnages utilisent de vraies voix françaises de la bibliothèque ElevenLabs (accent de France). Pour en imposer une : variable <code>ELEVENLABS_VOICE_FR_&lt;MODE&gt;</code>.</p>
      </Card>

      <Card title="Base de données" badge={state ? { label: state.db ? (state.dbError ? "Erreur" : "Base OK") : "À configurer", tone: state.db && !state.dbError ? "ok" : "warn" } : null}>
        {state?.dbError && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{state.dbError}</p>}
        {state?.db && (
          <div id="diagnostic" className="flex flex-col gap-2">
            <button type="button" disabled={diagBusy} onClick={runDiag} className={`h-11 rounded-xl text-sm font-bold disabled:opacity-60 ${state.dbError ? "bg-accent text-accent-contrast" : "border border-line bg-bg"}`}>
              {diagBusy ? "Diagnostic en cours (jusqu'à 60 s)…" : state.dbError ? "Lancer le diagnostic détaillé" : "Vérifier la base (diagnostic)"}
            </button>
            {diag && diag.region && diag.host && !diag.host.includes("eu-") && !diag.host.includes("localhost") && (
              <p className="text-xs text-muted">La base n&apos;est pas en Europe : chaque requête traverse l&apos;océan, d&apos;où la lenteur.</p>
            )}
            {diag && (
              <ul className="flex flex-col gap-1 rounded-xl bg-bg p-3 text-xs">
                {diag.steps.map((st) => (
                  <li key={st.name} className="flex gap-2">
                    <span className={st.ok ? "text-speaking" : "text-danger"} aria-hidden>
                      {st.ok ? "✓" : "✗"}
                    </span>
                    <span>
                      <strong>{st.name}</strong> ({st.ms} ms) : {st.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="text-sm text-muted">
          {state?.db
            ? "Les séances, le carnet de mots, le niveau et les réglages sont enregistrés."
            : "Sans base de données, les séances restent sur ce téléphone et le carnet, le suivi, le test de niveau et les rappels sont désactivés. Pour l'activer : crée un projet sur supabase.com ou neon.tech, copie la chaîne de connexion dans Vercel sous le nom DATABASE_URL, puis Redeploy. Les tables se créent toutes seules."}
        </p>
      </Card>

      <Card title="Claude (le cerveau)" badge={claude ? { label: claude.ok ? "Répond" : "Problème", tone: claude.ok ? "ok" : "danger" } : bilanAvailable != null ? { label: bilanAvailable ? "Clé présente" : "Clé absente", tone: bilanAvailable ? "ok" : "warn" } : null}>
        <p className="text-sm text-muted">Envoie une phrase de test à Claude, exactement comme en mode éco, et montre ce qu&apos;il répond. Utile si un personnage reste muet.</p>
        <button type="button" disabled={claudeBusy} onClick={testClaude} className="h-11 rounded-xl border border-line bg-bg text-sm font-bold disabled:opacity-60">
          {claudeBusy ? "Test en cours…" : "Tester Claude"}
        </button>
        {claude && (
          <div className="rounded-xl bg-bg px-3 py-2 text-xs">
            <p className="font-mono text-muted">
              modèle {claude.model} · {claude.ms} ms · arrêt {claude.stopReason ?? "?"} · {claude.textLength} caractères
            </p>
            {claude.sample && <p className="mt-1">« {claude.sample} »</p>}
            {claude.error && <p className="mt-1 text-danger">{claude.error}</p>}
          </div>
        )}
      </Card>

      <Card title="Mon PC (voix, oreille, temps réel)" badge={state ? { label: state.pc.configured ? (pc ? (pc.ok ? "PC OK" : "Injoignable") : "Configuré") : "À configurer", tone: state.pc.configured ? (pc && !pc.ok ? "danger" : "ok") : "warn" } : null}>
        {state?.pc.configured ? (
          <>
            <p className="text-sm text-muted">Chatterbox (voix) et Whisper (oreille) sur ta carte NVIDIA. PC éteint : les autres voix et oreilles prennent le relais toutes seules, et le temps réel repasse en mode éco.</p>
            <button type="button" disabled={pcBusy} onClick={testPc} className="h-11 rounded-xl border border-line bg-bg text-sm font-bold disabled:opacity-60">
              {pcBusy ? "Test en cours…" : "Tester la voix de mon PC (elle parle)"}
            </button>
            {pc && (
              <p className={`rounded-xl bg-bg px-3 py-2 font-mono text-xs ${pc.ok ? "text-muted" : "text-danger"}`}>
                {pc.ok ? `${pc.gpu ?? "GPU ?"} · ${pc.model ?? "modèle ?"} · ${pc.generationMs ?? "?"} ms de synthèse, ${pc.ms} ms au total${pc.voices.length ? ` · ${pc.voices.length} voix` : " · voix par défaut"}${pc.stt ? ` · oreille : ${pc.stt}` : " · oreille Whisper absente"}${pc.claude ? ` · Claude sur le PC : ${pc.claude}` : ""}${pc.live ? " · temps réel prêt" : " · temps réel pas prêt"}` : pc.error}
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Une voix naturelle, illimitée et gratuite, fabriquée par la carte graphique de ton PC à la maison (Windows, NVIDIA) :</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Sur le PC, suis le guide <code className="font-mono">pc-voix/README.md</code> du dépôt : Docker Desktop, Tailscale, puis <code className="font-mono">docker compose up -d --build</code>.</li>
              <li>Dans Vercel : <code className="font-mono">PC_TTS_URL</code> et <code className="font-mono">PC_TTS_TOKEN</code>, puis Redeploy.</li>
            </ol>
          </div>
        )}
      </Card>

      <Card title="Oreille Groq (gratuite)" badge={state ? { label: state.ears.groq ? "Clé présente" : "À configurer", tone: state.ears.groq ? "ok" : "warn" } : null}>
        {state?.ears.groq ? (
          <p className="text-sm text-muted">Whisper transcrit ce que tu dis : bien meilleure compréhension de l&apos;accent que la reconnaissance du téléphone. Choisie automatiquement en mode « Économique (auto) » quand le PC est éteint.</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Une oreille qui comprend bien l&apos;accent, gratuite, sans carte bancaire (environ 8 heures d&apos;audio par jour) :</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Va sur console.groq.com, crée un compte.</li>
              <li>Menu « API Keys » → « Create API Key », copie la clé (gsk_…).</li>
              <li>Dans Vercel : <code className="font-mono">GROQ_API_KEY</code>, puis Redeploy.</li>
            </ol>
          </div>
        )}
      </Card>

      <Card title="Voix Google (gratuite)" badge={state ? { label: state.gemini.configured ? "Clé présente" : "À configurer", tone: state.gemini.configured ? "ok" : "warn" } : null}>
        {state?.gemini.configured ? (
          <>
            <p className="text-sm text-muted">Voix Google gratuite, choisie automatiquement en mode « Économique (auto) » quand le PC est éteint. Si Google ne répond pas en 4 s, ElevenLabs puis le PC prennent le relais.</p>
            <button type="button" disabled={geminiBusy} onClick={testGemini} className="h-11 rounded-xl border border-line bg-bg text-sm font-bold disabled:opacity-60">
              {geminiBusy ? "Test en cours…" : "Tester la voix Google (elle parle)"}
            </button>
            {gemini && <p className={`rounded-xl bg-bg px-3 py-2 font-mono text-xs ${gemini.ok ? "text-muted" : "text-danger"}`}>{gemini.ok ? `modèle ${gemini.model} · ${gemini.ms} ms` : gemini.error}</p>}
          </>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Une voix naturelle en français et en anglais, gratuite, sans carte bancaire :</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Va sur aistudio.google.com, « Get API key » → « Create API key » (AIza…).</li>
              <li>Dans Vercel : <code className="font-mono">GEMINI_API_KEY</code>, puis Redeploy.</li>
            </ol>
          </div>
        )}
      </Card>

      <Card title="Prononciation" badge={state ? { label: state.pronunciation.configured ? "Azure" : "Téléphone (gratuit)", tone: "ok" } : null}>
        <p className="text-sm text-muted">
          {state?.pronunciation.configured
            ? `Azure Speech, région ${state.pronunciation.region} · anglais ${state.pronunciation.locales.en} · français ${state.pronunciation.locales.fr}. Seuls le texte et les notes sont gardés, jamais l'audio.`
            : "Notée avec la reconnaissance vocale du téléphone, gratuite, et Claude explique le son raté. Rien à configurer. L'option Azure (note son par son) est décrite dans le README du dépôt, section « 2 ter »."}
        </p>
        <p className="text-sm text-muted">
          Voix gratuite à l&apos;essai : <Link href="/test-kokoro" className="underline">tester Kokoro</Link>. Test des voix ElevenLabs (V0) : <Link href="/test-voix" className="underline">test-voix</Link>.
        </p>
      </Card>

      <Card title="Code d'accès" badge={state ? { label: state.pinEnabled ? "Activé" : "Désactivé", tone: state.pinEnabled ? "ok" : "warn" } : null}>
        <p className="text-sm text-muted">
          {state?.pinEnabled
            ? "L'app demande un code une fois par appareil ; 5 codes faux bloquent l'adresse 15 minutes. Pour le changer : variable APP_PIN dans Vercel, puis Redeploy."
            : "Sans code, n'importe qui ayant l'adresse peut utiliser tes minutes ElevenLabs. Pour protéger l'app : ajoute la variable APP_PIN dans Vercel, puis Redeploy."}
        </p>
      </Card>
      <TabBar />
    </main>
  );
}

function Card({ title, badge, children }: { title: string; badge: { label: string; tone: "ok" | "warn" | "danger" | "muted" } | null; children: React.ReactNode }) {
  const tone = badge?.tone === "ok" ? "bg-speaking/15 text-speaking" : badge?.tone === "danger" ? "bg-danger/10 text-danger" : badge?.tone === "warn" ? "bg-listening/15 text-listening" : "text-muted";
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{badge.label}</span>}
      </div>
      {children}
    </section>
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
