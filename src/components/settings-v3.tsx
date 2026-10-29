"use client";

import { QuotaLine } from "@/components/suivi";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReglagesState } from "@/app/api/reglages/route";

/**
 * Réglages V3 : base de données, plafond et coût, rappel quotidien, code d'accès.
 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function SettingsV3() {
  const [state, setState] = useState<ReglagesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perMinute, setPerMinute] = useState("");
  const [cap, setCap] = useState("");
  const [plan, setPlan] = useState("");
  const [hour, setHour] = useState("18");
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushSupported, setPushSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/reglages")
      .then(async (res) => (await res.json()) as ReglagesState)
      .then((data) => {
        if (!active) return;
        setState(data);
        setPerMinute(String(data.cost.perMinuteFcfa));
        setCap(String(data.cost.dailyCapMinutes));
        setPlan(String(data.cost.planFcfa ?? 0));
        setHour(String(data.reminder.hour));
        setPushSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
      })
      .catch(() => {
        if (active) setError("Pas de connexion. Réessaie.");
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reglages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as ReglagesState & { error?: string };
      if (res.ok) setState(data);
      else setError(data.error ?? "Erreur.");
    } catch {
      setError("Pas de connexion. Réessaie.");
    } finally {
      setSaving(false);
    }
  };

  const enablePush = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushMessage("Les notifications sont refusées sur ce téléphone. Autorise-les dans les réglages du navigateur.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/rappels");
      const keyData = (await keyRes.json()) as { publicKey?: string | null };
      if (!keyData.publicKey) {
        setPushMessage("Impossible de préparer les rappels (base de données ?).");
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) });
      const res = await fetch("/api/rappels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) {
        setPushMessage("L'enregistrement du rappel a échoué.");
        return;
      }
      await save({ reminder: { enabled: true, hour: Number(hour) } });
      setPushMessage("Rappels activés. Une notification de test vient d'être envoyée.");
    } catch {
      setPushMessage("Les rappels ne sont pas disponibles ici. Sur iPhone, installe d'abord l'app sur l'écran d'accueil.");
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
      await fetch("/api/rappels", { method: "DELETE" });
      await save({ reminder: { enabled: false } });
      setPushMessage("Rappels désactivés.");
    } finally {
      setPushBusy(false);
    }
  };

  const testPush = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/rappels/envoyer?force=1");
      const data = (await res.json().catch(() => ({}))) as { sent?: boolean; reason?: string };
      setPushMessage(data.sent ? "Notification de test envoyée." : `Pas envoyée : ${data.reason ?? "inconnu"}.`);
    } finally {
      setPushBusy(false);
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

  const [gemini, setGemini] = useState<{ ok: boolean; model: string | null; ms: number; error: string | null } | null>(null);
  const [pc, setPc] = useState<{ ok: boolean; gpu: string | null; model: string | null; voices: string[]; stt?: string | null; live?: boolean; claude?: string | null; ms: number; generationMs: number | null; error: string | null } | null>(null);
  const [pcBusy, setPcBusy] = useState(false);
  const testPc = async () => {
    setPcBusy(true);
    try {
      const res = await fetch("/api/diagnostic/pc");
      const data = (await res.json()) as { ok: boolean; gpu: string | null; model: string | null; voices: string[]; stt?: string | null; live?: boolean; claude?: string | null; ms: number; generationMs: number | null; error: string | null };
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

  if (state === null) {
    return <p className="text-sm text-muted">{error ?? "Chargement des réglages…"}</p>;
  }

  return (
    <>
      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Base de données</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.db && !state.dbError ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>
            {state.db ? (state.dbError ? "Erreur" : "Prête") : "À configurer"}
          </span>
        </div>
        {state.dbError && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{state.dbError}</p>}
        {state.dbInfo && (
          <p className="rounded-xl bg-bg px-3 py-2 font-mono text-xs text-muted">
            Lu dans DATABASE_URL : utilisateur {state.dbInfo.user} · hôte {state.dbInfo.host} · port {state.dbInfo.port}
            {state.dbInfo.pooler ? " · pooler ✓" : " · pas le pooler ✗ (prends l'onglet Transaction pooler)"}
            {state.dbInfo.passwordPlaceholder ? " · mot de passe non remplacé ✗" : ""}
          </p>
        )}
        {state.db && (
          <div id="diagnostic" className="flex flex-col gap-2">
            <button type="button" disabled={diagBusy} onClick={runDiag} className={`h-11 rounded-xl text-sm font-bold disabled:opacity-60 ${state.dbError ? "bg-accent text-accent-contrast" : "border border-line bg-bg"}`}>
              {diagBusy ? "Diagnostic en cours (jusqu'à 60 s)…" : state.dbError ? "Lancer le diagnostic détaillé" : "Vérifier la base (diagnostic)"}
            </button>
            {diag && (diag.region || diag.host) && (
              <p className="text-xs text-muted">
                Serveur Vercel : {diag.region ?? "?"} · base : {diag.host ?? "?"}
                {diag.region && diag.host && !diag.host.includes("eu-") && !diag.host.includes("localhost") ? " · la base n'est pas en Europe : chaque requête traverse l'océan, d'où la lenteur." : ""}
              </p>
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
        {state.db && (
          <details className="rounded-xl bg-bg px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold">SQL de secours (si la création des tables bloque)</summary>
            <p className="mt-2 text-xs text-muted">
              Dans Supabase → SQL Editor → New query, colle ce texte et clique sur Run. Chaque ligne est sans danger si la table existe déjà. Puis reviens ici et appuie sur Réessayer.
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(state.schemaSql).then(
                  () => setPushMessage("SQL copié. Colle-le dans l'éditeur SQL de Supabase."),
                  () => setPushMessage("Copie impossible : sélectionne le texte à la main."),
                );
              }}
              className="mt-2 h-10 w-full rounded-xl border border-line bg-elevated text-sm font-semibold"
            >
              Copier le SQL
            </button>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted">{state.schemaSql}</pre>
          </details>
        )}
        <p className="text-sm text-muted">
          {state.db
            ? "Les séances, le carnet de mots, le niveau et les réglages sont enregistrés."
            : "Sans base de données, les séances restent seulement sur ce téléphone et le carnet, le suivi, le test de niveau et les rappels sont désactivés. Pour l'activer : crée un projet sur supabase.com, copie la chaîne de connexion (Connect → Transaction pooler) dans Vercel sous le nom DATABASE_URL, puis Redeploy. Les tables se créent toutes seules."}
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Claude (le cerveau)</h2>
          {claude && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${claude.ok ? "bg-speaking/15 text-speaking" : "bg-danger/10 text-danger"}`}>{claude.ok ? "Répond" : "Problème"}</span>}
        </div>
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
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Voix de mon PC (gratuite)</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.pc.configured ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>{state.pc.configured ? "Configurée" : "À configurer"}</span>
        </div>
        {state.pc.configured ? (
          <>
            <p className="text-sm text-muted">
              Chatterbox (voix) et Whisper (oreille) sur ta carte NVIDIA, joints sur <span className="font-mono text-xs">{state.pc.host}</span>. Sur l&apos;accueil, choisis « Mon PC » comme voix et comme oreille du mode éco. PC éteint : ElevenLabs et Groq prennent le relais tout seuls.
            </p>
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
              <li>Dans Vercel → Settings → Environment Variables : <code className="font-mono">PC_TTS_URL</code> (adresse Tailscale du PC) et <code className="font-mono">PC_TTS_TOKEN</code> (le mot de passe choisi), puis Redeploy.</li>
              <li>Reviens ici : la carte passe à « Configurée » et un bouton te fait entendre la voix.</li>
            </ol>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Oreille Groq (gratuite)</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.ears.groq ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>{state.ears.groq ? "Clé présente" : "À configurer"}</span>
        </div>
        {state.ears.groq ? (
          <p className="text-sm text-muted">Choisis « Groq (gratuite) » comme oreille du mode éco sur l&apos;accueil : le téléphone enregistre, Whisper transcrit. Bien meilleure compréhension de l&apos;accent qu&apos;avec la reconnaissance du téléphone, pour une seconde de plus.</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Une oreille qui comprend bien l&apos;accent, en français et en anglais, gratuite, sans carte bancaire (environ 8 heures d&apos;audio par jour) :</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Va sur console.groq.com, crée un compte (adresse e-mail ou compte Google).</li>
              <li>Menu « API Keys » → « Create API Key », copie la clé (elle commence par gsk_).</li>
              <li>Dans Vercel → Settings → Environment Variables : ajoute <code className="font-mono">GROQ_API_KEY</code>, puis Redeploy.</li>
              <li>Reviens ici : la carte passe à « Clé présente », puis choisis l&apos;oreille Groq sur l&apos;accueil.</li>
            </ol>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Voix Google (gratuite)</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.gemini.configured ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>{state.gemini.configured ? "Clé présente" : "À configurer"}</span>
        </div>
        {state.gemini.configured ? (
          <>
            <p className="text-sm text-muted">Choisis « Google (gratuite) » comme voix du mode éco sur l&apos;accueil, ou dans Prononciation. Si Google ne répond pas, ElevenLabs prend le relais tout seul.</p>
            <button type="button" disabled={geminiBusy} onClick={testGemini} className="h-11 rounded-xl border border-line bg-bg text-sm font-bold disabled:opacity-60">
              {geminiBusy ? "Test en cours…" : "Tester la voix Google (elle parle)"}
            </button>
            {gemini && (
              <p className={`rounded-xl bg-bg px-3 py-2 font-mono text-xs ${gemini.ok ? "text-muted" : "text-danger"}`}>
                {gemini.ok ? `modèle ${gemini.model} · ${gemini.ms} ms` : gemini.error}
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Une voix naturelle en français et en anglais, gratuite, sans carte bancaire :</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Va sur aistudio.google.com avec ton compte Google, puis « Get API key » → « Create API key ».</li>
              <li>Copie la clé (elle commence par AIza).</li>
              <li>Dans Vercel → Settings → Environment Variables : ajoute <code className="font-mono">GEMINI_API_KEY</code>, puis Redeploy.</li>
              <li>Reviens ici : la carte passe à « Clé présente » et un bouton te fait entendre la voix.</li>
            </ol>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Prononciation</h2>
          <span className="rounded-full bg-speaking/15 px-2.5 py-1 text-xs font-semibold text-speaking">{state.pronunciation.configured ? "Azure" : "Téléphone (gratuit)"}</span>
        </div>
        <p className="text-sm text-muted">
          Voix gratuite à l&apos;essai : <Link href="/test-kokoro" className="underline">tester Kokoro</Link>, une voix naturelle qui tourne dans le téléphone, sans serveur ni abonnement.
        </p>
        {state.pronunciation.configured ? (
          <p className="text-sm text-muted">
            Région {state.pronunciation.region} · anglais {state.pronunciation.locales.en} · français {state.pronunciation.locales.fr}. Les notes se trouvent dans{" "}
            <Link href="/prononciation" className="underline">Prononciation</Link> et dans le suivi. Seuls le texte et les notes sont gardés, jamais l&apos;audio.
          </p>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>
              Par défaut, la prononciation est notée avec la reconnaissance vocale du téléphone, gratuite : un mot compris est vert, un mot déformé orange ou rouge, et Claude explique le son raté. Rien à configurer.
            </p>
            <p>Facultatif, pour une note son par son plus fine : Azure Speech (5 heures gratuites par mois, carte bancaire demandée à l&apos;inscription) :</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Va sur portal.azure.com, crée un compte gratuit si besoin.</li>
              <li>« Créer une ressource » → cherche <strong>Speech</strong> (Azure AI services) → Créer.</li>
              <li>Région : <strong>France Central</strong> (ou West Europe). Niveau tarifaire : <strong>Free F0</strong>.</li>
              <li>Une fois créée, ouvre « Clés et point de terminaison » : copie <strong>KEY 1</strong> et la <strong>Région</strong> (ex. francecentral).</li>
              <li>Dans Vercel → Settings → Environment Variables : ajoute <code className="font-mono">AZURE_SPEECH_KEY</code> et <code className="font-mono">AZURE_SPEECH_REGION</code>, puis Redeploy.</li>
            </ol>
          </div>
        )}
      </section>

      {state.db && (
        <>
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-base font-semibold">Dépenses</h2>
            <p className="text-sm text-muted">
              Aujourd&apos;hui : {state.todayMinutes} min sur {state.cost.dailyCapMinutes}.
            </p>
            <QuotaLine quota={state.elevenQuota} monthFcfa={state.monthFcfa} source={state.monthFcfaSource} />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Coût par minute (FCFA)
                <input type="number" inputMode="numeric" min={0} value={perMinute} onChange={(e) => setPerMinute(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Plafond par jour (minutes)
                <input type="number" inputMode="numeric" min={1} value={cap} onChange={(e) => setCap(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg" />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
                Prix mensuel de ton abonnement ElevenLabs (FCFA) — sert à calculer le vrai coût d&apos;après les crédits consommés
                <input type="number" inputMode="numeric" min={0} value={plan} onChange={(e) => setPlan(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg" />
              </label>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => save({ cost: { perMinuteFcfa: Number(perMinute), dailyCapMinutes: Number(cap), planFcfa: Number(plan) } })}
              className="h-11 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60"
            >
              Enregistrer
            </button>
            <p className="text-xs text-muted">Au-delà du plafond, l&apos;app te prévient avant de lancer une séance et pendant la discussion. Le coût par minute dépend de ton abonnement ElevenLabs : ajuste-le d&apos;après ta facture.</p>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Rappel quotidien</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.reminder.enabled && state.reminder.subscribed ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>
                {state.reminder.enabled && state.reminder.subscribed ? "Activé" : "Désactivé"}
              </span>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Heure du rappel</span>
              <select value={hour} onChange={(e) => setHour(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg">
                <option value="8">Le matin (vers 8 h)</option>
                <option value="18">Le soir (vers 18 h)</option>
              </select>
            </label>
            {pushSupported === false && <p className="text-xs text-muted">Ce navigateur ne gère pas les notifications. Sur iPhone, installe l&apos;app sur l&apos;écran d&apos;accueil puis reviens ici.</p>}
            <div className="grid grid-cols-2 gap-2">
              {state.reminder.enabled && state.reminder.subscribed ? (
                <>
                  <button type="button" disabled={pushBusy || saving} onClick={() => save({ reminder: { hour: Number(hour) } })} className="h-11 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
                    Enregistrer l&apos;heure
                  </button>
                  <button type="button" disabled={pushBusy} onClick={disablePush} className="h-11 rounded-xl border border-line text-sm font-semibold disabled:opacity-60">
                    Désactiver
                  </button>
                </>
              ) : (
                <button type="button" disabled={pushBusy || pushSupported === false} onClick={enablePush} className="col-span-2 h-11 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
                  {pushBusy ? "Activation…" : "Activer les rappels sur ce téléphone"}
                </button>
              )}
            </div>
            {state.reminder.enabled && state.reminder.subscribed && (
              <button type="button" disabled={pushBusy} onClick={testPush} className="h-10 text-xs text-muted underline">
                Envoyer une notification de test
              </button>
            )}
            {pushMessage && <p className="text-xs text-muted">{pushMessage}</p>}
            <p className="text-xs text-muted">Une notification par jour avec un sujet, le matin vers 8 h ou le soir vers 18 h (heure de Dakar).</p>
          </section>
        </>
      )}

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Code d&apos;accès</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.pinEnabled ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>{state.pinEnabled ? "Activé" : "Désactivé"}</span>
        </div>
        <p className="text-sm text-muted">
          {state.pinEnabled
            ? "L'app demande un code une fois par appareil. Pour le changer : variable APP_PIN dans Vercel, puis Redeploy."
            : "Sans code, n'importe qui ayant l'adresse peut utiliser tes minutes ElevenLabs. Pour protéger l'app : ajoute la variable APP_PIN (un code de ton choix) dans Vercel, puis Redeploy."}
        </p>
      </section>

      {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <p className="text-center text-xs text-muted">
        <Link href="/suivi" className="underline">
          Suivi
        </Link>{" "}
        ·{" "}
        <Link href="/carnet" className="underline">
          Carnet
        </Link>
      </p>
    </>
  );
}
