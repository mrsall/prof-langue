"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { VOICES, type VoiceOption } from "@/config/voices";
import { useLocalStorage } from "@/lib/use-local-storage";

/**
 * V0 — page de test des voix.
 *
 * But : Cherif choisit la voix la plus naturelle et vérifie le délai de
 * réponse. Tout le reste (modes, bilan, mémoire…) viendra dans les versions
 * suivantes.
 */

type ConnectionType = "webrtc" | "websocket";
type TranscriptLine = { id: number; role: "user" | "agent"; text: string };
type Samples = Record<string, number[]>;

const FAVORITE_KEY = "prof-langue:v0:favorite";
const CONNECTION_KEY = "prof-langue:v0:connection";

export function VoiceTest() {
  return (
    <ConversationProvider>
      <VoiceTestInner />
    </ConversationProvider>
  );
}

function VoiceTestInner() {
  const [voice, setVoice] = useState<VoiceOption>(VOICES[0]);
  const [showText, setShowText] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Samples>({});
  const [favorite, setFavorite] = useLocalStorage(FAVORITE_KEY);
  const [savedConnection, setSavedConnection] = useLocalStorage(CONNECTION_KEY);
  const connectionType: ConnectionType =
    savedConnection === "websocket" ? "websocket" : "webrtc";
  const [preparing, setPreparing] = useState(false);

  // Repères pour mesurer le délai (en ms, performance.now()).
  const speechEndAt = useRef<number | null>(null);
  const userTranscriptAt = useRef<number | null>(null);
  const vadActive = useRef(false);
  const activeVoiceKey = useRef(voice.key);
  const orbRef = useRef<HTMLDivElement>(null);

  const recordLatency = useCallback((ms: number) => {
    if (ms < 100 || ms > 20000) return;
    const key = activeVoiceKey.current;
    setSamples((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), Math.round(ms)] }));
  }, []);

  const conversation = useConversation({
    onConnect: () => {
      speechEndAt.current = null;
      userTranscriptAt.current = null;
      vadActive.current = false;
      setError(null);
      setTranscript([]);
      navigator.vibrate?.(30);
    },
    onDisconnect: (details) => {
      navigator.vibrate?.([20, 40, 20]);
      if (details.reason === "error") {
        setError(humanizeError(details.message));
      }
    },
    onError: (message) => setError(humanizeError(message)),
    onMessage: ({ role, message }) => {
      if (role === "user") userTranscriptAt.current = performance.now();
      setTranscript((prev) => [
        ...prev,
        { id: prev.length, role, text: message },
      ]);
    },
    onVadScore: ({ vadScore }) => {
      if (vadScore > 0.6) {
        if (!vadActive.current) speechEndAt.current = null;
        vadActive.current = true;
      } else if (vadActive.current && vadScore < 0.3) {
        vadActive.current = false;
        speechEndAt.current = performance.now();
      }
    },
    onModeChange: ({ mode }) => {
      if (mode !== "speaking") return;
      const start = speechEndAt.current ?? userTranscriptAt.current;
      if (start != null) recordLatency(performance.now() - start);
      speechEndAt.current = null;
      userTranscriptAt.current = null;
    },
  });

  const { status, isSpeaking, startSession, endSession } = conversation;
  const connected = status === "connected";
  const busy = preparing || status === "connecting";

  // Fait respirer l'orbe au rythme de la voix (sans re-render React).
  useEffect(() => {
    const orb = orbRef.current;
    if (!connected || !orb) return;
    let frame = 0;
    const tick = () => {
      const level = isSpeaking
        ? conversation.getOutputVolume()
        : conversation.getInputVolume();
      const scale = 1 + Math.min(level, 1) * 0.35;
      orb.style.transform = `scale(${scale.toFixed(3)})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      orb.style.transform = "";
    };
  }, [connected, isSpeaking, conversation]);

  const start = useCallback(async () => {
    setError(null);
    setPreparing(true);
    try {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        setError(
          "Le micro est refusé. Autorise le micro pour ce site dans les réglages du navigateur, puis réessaie.",
        );
        return;
      }

      const res = await fetch("/api/elevenlabs/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: voice.key, connectionType }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        connectionType?: ConnectionType;
        conversationToken?: string;
        signedUrl?: string;
        voiceId?: string | null;
        overrides?: Record<string, unknown>;
      };
      if (!res.ok) {
        setError(data.error ?? "Le serveur n'a pas répondu. Réessaie dans un instant.");
        return;
      }

      activeVoiceKey.current = voice.key;
      const overrides = data.overrides ?? (data.voiceId ? { tts: { voiceId: data.voiceId } } : undefined);

      if (data.connectionType === "websocket" && data.signedUrl) {
        startSession({ signedUrl: data.signedUrl, connectionType: "websocket", overrides });
      } else if (data.conversationToken) {
        startSession({
          conversationToken: data.conversationToken,
          connectionType: "webrtc",
          overrides,
        });
      } else {
        setError("Réponse du serveur incomplète. Réessaie.");
      }
    } catch {
      setError("Pas de connexion. Vérifie ton réseau puis réessaie.");
    } finally {
      setPreparing(false);
    }
  }, [voice, connectionType, startSession]);

  const stop = useCallback(() => {
    endSession();
  }, [endSession]);

  const toggleFavorite = (key: string) => setFavorite(favorite === key ? null : key);
  const chooseConnection = (type: ConnectionType) => setSavedConnection(type);

  const current = samples[voice.key] ?? [];
  const statusLabel = !connected
    ? busy
      ? "Connexion…"
      : "Choisis une voix, puis appuie sur Parler."
    : isSpeaking
      ? `${voice.name} parle… tu peux l'interrompre.`
      : "Je t'écoute. Parle en anglais !";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            Prof de langues · V0
          </p>
          <h1 className="text-2xl font-semibold">Test des voix</h1>
        </div>
        <span
          className={`h-3 w-3 rounded-full ${
            connected ? "bg-speaking" : busy ? "bg-listening" : "bg-muted/40"
          }`}
          aria-hidden
        />
      </header>

      {/* Choix de la voix */}
      <section aria-label="Choix de la voix" className="grid gap-3">
        {VOICES.map((v) => {
          const selected = v.key === voice.key;
          const stats = summarize(samples[v.key] ?? []);
          return (
            <div
              key={v.key}
              className={`relative rounded-2xl border bg-elevated transition ${
                selected ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line"
              } ${connected ? "opacity-70" : ""}`}
            >
              <button
                type="button"
                disabled={connected || busy}
                onClick={() => setVoice(v)}
                className="flex w-full items-center gap-4 p-4 text-left disabled:cursor-not-allowed"
              >
                <span className="text-4xl" aria-hidden>
                  {v.emoji}
                </span>
                <span className="flex-1">
                  <span className="flex items-center gap-2 text-lg font-semibold">
                    {v.name}
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      {v.accent} · {v.gender}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{v.description}</span>
                  {stats && (
                    <span className="mt-1 block text-xs text-muted">
                      {stats.count} tour{stats.count > 1 ? "s" : ""} · délai moyen{" "}
                      {formatMs(stats.avg)}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleFavorite(v.key)}
                aria-pressed={favorite === v.key}
                aria-label={
                  favorite === v.key ? `${v.name} est ma préférée` : `Choisir ${v.name} comme préférée`
                }
                className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-xl"
              >
                {favorite === v.key ? "⭐" : "☆"}
              </button>
            </div>
          );
        })}
      </section>

      {/* Orbe + statut */}
      <section className="flex flex-col items-center gap-4 py-2 text-center">
        <div
          ref={orbRef}
          className={`grid h-28 w-28 place-items-center rounded-full text-5xl transition-colors duration-300 ${
            connected
              ? isSpeaking
                ? "bg-speaking/20 animate-breathe"
                : "bg-listening/20"
              : "bg-accent-soft"
          }`}
          aria-hidden
        >
          {voice.emoji}
        </div>
        <p className="min-h-6 text-base" role="status" aria-live="polite">
          {statusLabel}
        </p>
        {error && (
          <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </section>

      {/* Délais */}
      <section
        aria-label="Délai de réponse"
        className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-elevated p-3 text-center"
      >
        <Stat label="Dernier" value={formatMs(current.at(-1))} />
        <Stat label="Moyen" value={formatMs(summarize(current)?.avg)} />
        <Stat label="Meilleur" value={formatMs(summarize(current)?.best)} />
        <p className="col-span-3 text-xs text-muted">
          Temps entre la fin de ta phrase et le début de la réponse. Objectif : moins de 2 s.
        </p>
      </section>

      {/* Commandes */}
      <section className="mt-auto grid gap-3">
        {!connected ? (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="h-16 rounded-2xl bg-accent text-lg font-semibold text-accent-contrast shadow-lg shadow-accent/30 transition active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Connexion…" : `🎙️ Parler avec ${voice.name}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="h-16 rounded-2xl bg-danger text-lg font-semibold text-white shadow-lg shadow-danger/30 transition active:scale-[0.98]"
          >
            ⏹ Terminer
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setShowText((s) => !s)}
            aria-pressed={showText}
            className="h-12 rounded-xl border border-line bg-elevated text-sm font-medium"
          >
            {showText ? "Masquer le texte" : "Afficher le texte"}
          </button>
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            aria-expanded={showAdvanced}
            className="h-12 rounded-xl border border-line bg-elevated text-sm font-medium"
          >
            Réglages
          </button>
        </div>

        {showAdvanced && (
          <div className="rounded-2xl border border-line bg-elevated p-4">
            <p className="mb-2 text-sm font-medium">Type de connexion</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {(["webrtc", "websocket"] as ConnectionType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={connectionType === type}
                  disabled={connected || busy}
                  onClick={() => chooseConnection(type)}
                  className={`h-11 rounded-xl border text-sm font-medium ${
                    connectionType === type
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line"
                  }`}
                >
                  {type === "webrtc" ? "WebRTC (conseillé)" : "WebSocket"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Si la voix coupe ou le délai est long, essaie l&apos;autre type puis compare.
            </p>
          </div>
        )}
      </section>

      {showText && (
        <section
          aria-label="Texte de la conversation"
          className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-3"
        >
          {transcript.length === 0 ? (
            <p className="text-center text-sm text-muted">
              Le texte de la conversation s&apos;affichera ici.
            </p>
          ) : (
            transcript.map((line) => (
              <p
                key={line.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  line.role === "user"
                    ? "self-end bg-accent text-accent-contrast"
                    : "self-start bg-accent-soft"
                }`}
              >
                {line.text}
              </p>
            ))
          )}
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-mono text-xl font-semibold">{value}</p>
    </div>
  );
}

function summarize(values: number[]) {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: sum / values.length,
    best: Math.min(...values),
  };
}

function formatMs(ms: number | undefined) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${(ms / 1000).toFixed(1)} s`;
}

function humanizeError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("permission") || m.includes("notallowed")) {
    return "Le micro est refusé. Autorise-le pour ce site, puis réessaie.";
  }
  if (m.includes("override")) {
    return "ElevenLabs refuse le changement de voix. Dans l'agent → Security, active l'override « TTS voice ».";
  }
  if (m.includes("network") || m.includes("failed to fetch") || m.includes("timeout")) {
    return "La connexion est trop faible. Rapproche-toi du réseau et réessaie.";
  }
  return `Problème : ${message}`;
}
