"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Page du code d'accès (variable APP_PIN). */
export function Acces() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/acces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Code incorrect.");
    } catch {
      setError("Pas de connexion. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-6">
      <h1 className="text-2xl font-bold">Prof de langues</h1>
      <p className="text-center text-sm text-muted">Entre ton code d&apos;accès. Ce téléphone s&apos;en souviendra.</p>
      <form onSubmit={submit} className="flex w-full flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Code</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-14 rounded-2xl border border-line bg-elevated px-4 text-center text-2xl tracking-[0.4em]"
            required
          />
        </label>
        {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className="h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast disabled:opacity-60">
          {busy ? "Vérification…" : "Entrer"}
        </button>
      </form>
    </main>
  );
}
