"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReglagesState } from "@/app/api/reglages/route";
import { QuotaLine } from "@/components/suivi";
import { TabBar } from "@/components/tab-bar";

/**
 * Réglages d'usage : objectif quotidien, niveau, anglais enseigné, dépenses
 * et plafond, rappel quotidien. Le diagnostic de l'installation (agent,
 * base, PC, clés) est dans /admin ; le choix détaillé des moteurs dans /reglages/avance.
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
  const [goal, setGoal] = useState("10");
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
        setGoal(String(data.goalMinutes ?? 10));
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Réglages</h1>
        <Link href="/admin" className="flex h-11 items-center rounded-xl border border-line bg-elevated px-4 text-sm font-semibold">
          Admin
        </Link>
      </header>

      {state === null ? (
        <p className="text-sm text-muted">{error ?? "Chargement des réglages…"}</p>
      ) : (
        <>
          {!state.db && (
            <section className="rounded-2xl border border-listening/40 bg-listening/10 p-4 text-sm text-listening">
              Sans base de données, les réglages ci-dessous ne peuvent pas être enregistrés. Voir <Link href="/admin" className="underline">Admin</Link>.
            </section>
          )}

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-base font-semibold">Objectif quotidien</h2>
            <p className="text-sm text-muted">Minutes de conversation par jour pour valider la journée (tout mode confondu). Aujourd&apos;hui : {state.todayAllMinutes} min.</p>
            <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-bg p-1" role="radiogroup" aria-label="Objectif quotidien">
              {[5, 10, 15, 20].map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={Number(goal) === m}
                  disabled={saving || !state.db}
                  onClick={() => {
                    setGoal(String(m));
                    void save({ goalMinutes: m });
                  }}
                  className={`h-11 rounded-lg text-sm font-medium ${Number(goal) === m ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-base font-semibold">Niveau</h2>
            <p className="text-sm">
              Anglais : <strong>{state.levels.en?.level ?? "pas encore testé"}</strong>
              {state.levels.en ? <span className="text-xs text-muted"> (test du {new Date(state.levels.en.date).toLocaleDateString("fr-FR")})</span> : null}
            </p>
            <p className="text-sm">
              Français : <strong>{state.levels.fr?.level ?? "pas encore testé"}</strong>
              {state.levels.fr ? <span className="text-xs text-muted"> (test du {new Date(state.levels.fr.date).toLocaleDateString("fr-FR")})</span> : null}
            </p>
            <p className="text-xs text-muted">Le test de niveau (5 minutes avec Emma) se lance depuis l&apos;accueil ; il est reproposé chaque mois. Le niveau monte aussi tout seul après trois séances jugées au-dessus.</p>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-base font-semibold">Anglais enseigné</h2>
            <p className="text-sm text-muted">Tous les personnages, le bilan et le carnet suivent la même variante (orthographe et vocabulaire).</p>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-bg p-1" role="radiogroup" aria-label="Variante d'anglais">
              {(
                [
                  { key: "us", label: "Américain" },
                  { key: "uk", label: "Britannique" },
                ] as const
              ).map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="radio"
                  aria-checked={state.englishVariant === v.key}
                  disabled={saving || !state.db}
                  onClick={() => save({ englishVariant: v.key })}
                  className={`h-11 rounded-lg text-sm font-medium ${state.englishVariant === v.key ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-base font-semibold">Dépenses</h2>
            <p className="text-sm text-muted">
              Aujourd&apos;hui : {state.todayMinutes} min ElevenLabs sur {state.cost.dailyCapMinutes}.
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
              disabled={saving || !state.db}
              onClick={() => save({ cost: { perMinuteFcfa: Number(perMinute), dailyCapMinutes: Number(cap), planFcfa: Number(plan) } })}
              className="h-11 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60"
            >
              Enregistrer
            </button>
            <p className="text-xs text-muted">Au-delà du plafond, l&apos;app te prévient avant de lancer une séance ElevenLabs et pendant la discussion. Le mode éco ne compte pas.</p>
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
            {pushSupported === false && <p className="text-xs text-muted">Ce navigateur ne gère pas les notifications. Installe l&apos;app sur l&apos;écran d&apos;accueil puis reviens ici.</p>}
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
                <button type="button" disabled={pushBusy || pushSupported === false || !state.db} onClick={enablePush} className="col-span-2 h-11 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
                  {pushBusy ? "Activation…" : "Activer les rappels sur ce téléphone"}
                </button>
              )}
            </div>
            {state.reminder.enabled && state.reminder.subscribed && (
              <button type="button" disabled={pushBusy} onClick={testPush} className="h-11 text-xs text-muted underline">
                Envoyer une notification de test
              </button>
            )}
            {pushMessage && <p className="text-xs text-muted">{pushMessage}</p>}
            <p className="text-xs text-muted">Une notification par jour avec un sujet, le matin vers 8 h ou le soir vers 18 h (heure de Dakar).</p>
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
            <h2 className="text-base font-semibold">Plus loin</h2>
            <Link href="/reglages/avance" className="flex h-11 items-center justify-between rounded-xl border border-line bg-bg px-4 text-sm font-semibold">
              Réglages avancés (conversation, voix, oreille) <span aria-hidden>›</span>
            </Link>
            <Link href="/admin" className="flex h-11 items-center justify-between rounded-xl border border-line bg-bg px-4 text-sm font-semibold">
              Admin (diagnostic de l&apos;installation) <span aria-hidden>›</span>
            </Link>
          </section>

          {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </>
      )}
      <TabBar />
    </main>
  );
}
