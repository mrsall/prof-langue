"use client";

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

  const [diag, setDiag] = useState<{ steps: { name: string; ok: boolean; detail: string; ms: number }[] } | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const runDiag = async () => {
    setDiagBusy(true);
    try {
      const res = await fetch("/api/diagnostic");
      setDiag((await res.json()) as { steps: { name: string; ok: boolean; detail: string; ms: number }[] });
    } catch {
      setDiag({ steps: [{ name: "Diagnostic", ok: false, detail: "impossible de joindre le serveur de l'app", ms: 0 }] });
    } finally {
      setDiagBusy(false);
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
        {state.db && state.dbError && (
          <div className="flex flex-col gap-2">
            <button type="button" disabled={diagBusy} onClick={runDiag} className="h-11 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
              {diagBusy ? "Diagnostic en cours (jusqu'à 30 s)…" : "Lancer le diagnostic détaillé"}
            </button>
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
          {state.db
            ? "Les séances, le carnet de mots, le niveau et les réglages sont enregistrés."
            : "Sans base de données, les séances restent seulement sur ce téléphone et le carnet, le suivi, le test de niveau et les rappels sont désactivés. Pour l'activer : crée un projet sur supabase.com, copie la chaîne de connexion (Connect → Transaction pooler) dans Vercel sous le nom DATABASE_URL, puis Redeploy. Les tables se créent toutes seules."}
        </p>
      </section>

      {state.db && (
        <>
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-base font-semibold">Dépenses</h2>
            <p className="text-sm text-muted">
              Aujourd&apos;hui : {state.todayMinutes} min sur {state.cost.dailyCapMinutes}. Ce mois-ci : ≈ {state.monthFcfa} FCFA (estimation ElevenLabs).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Coût par minute (FCFA)
                <input type="number" inputMode="numeric" min={0} value={perMinute} onChange={(e) => setPerMinute(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Plafond par jour (minutes)
                <input type="number" inputMode="numeric" min={1} value={cap} onChange={(e) => setCap(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg" />
              </label>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => save({ cost: { perMinuteFcfa: Number(perMinute), dailyCapMinutes: Number(cap) } })}
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
