"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { MaxAvatar } from "@/components/max-avatar";
import { PushToTalkButton } from "@/components/push-to-talk-button";
import { PERSONALITIES, type Personality } from "@/config/personalities";
import {
  SPEEDS,
  SPEED_ORDER,
  SPEED_RESUME_MESSAGES,
  isSpeedKey,
  type SpeedKey,
} from "@/config/speeds";
import { useLocalStorage } from "@/lib/use-local-storage";
import { useProgress, useToday } from "@/lib/progress";
import type { BilanResult } from "@/app/api/bilan/route";

/**
 * V1 — mode ami, anglais, appui pour parler.
 * Trois écrans dans un seul composant pour garder l'état de la séance :
 * accueil → conversation → fin de séance.
 */

type Phase = "home" | "live" | "bilan";
type TranscriptLine = { id: number; role: "user" | "agent"; text: string };
type ConnectionType = "webrtc" | "websocket";

const SPEED_KEY = "prof-langue:speed";
const CONNECTION_KEY = "prof-langue:v0:connection";
const SHOW_TEXT_KEY = "prof-langue:show-text";
const REPEAT_COMMAND = "Please say your last sentence again, a little slower.";

const personality: Personality = PERSONALITIES[0];

export function App() {
  return (
    <ConversationProvider>
      <AppInner />
    </ConversationProvider>
  );
}

function AppInner() {
  const [phase, setPhase] = useState<Phase>("home");
  const [savedSpeed, setSavedSpeed] = useLocalStorage(SPEED_KEY);
  const speed: SpeedKey = isSpeedKey(savedSpeed) ? savedSpeed : "normal";
  const [savedConnection] = useLocalStorage(CONNECTION_KEY);
  const connectionType: ConnectionType = savedConnection === "websocket" ? "websocket" : "webrtc";
  const [savedShowText, setSavedShowText] = useLocalStorage(SHOW_TEXT_KEY);
  const showText = savedShowText === "1";

  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bilan, setBilan] = useState<BilanResult | null>(null);
  const [bilanLoading, setBilanLoading] = useState(false);
  const [summary, setSummary] = useState<{
    seconds: number;
    userTurns: number;
    userShare: number;
    streak: number;
    minutesToday: number;
    goalReached: boolean;
  } | null>(null);

  const progress = useProgress();

  // Mesures de la séance (sans re-render).
  const connectAt = useRef<number | null>(null);
  const userTalkMs = useRef(0);
  const holdStart = useRef<number | null>(null);
  const agentTalkMs = useRef(0);
  const agentSpeakStart = useRef<number | null>(null);
  const userTurns = useRef(0);
  const pendingCommand = useRef<string | null>(null);
  const restarting = useRef(false);
  const everConnected = useRef(false);
  const attemptType = useRef<ConnectionType>("webrtc");
  const fallbackTried = useRef(false);
  const lastContext = useRef<{ resumeMessage: string } | undefined>(undefined);
  const agentReady = useRef(false);
  const startRef = useRef<(context?: { resumeMessage: string }, force?: ConnectionType) => Promise<boolean>>(
    async () => false,
  );
  const ending = useRef(false);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const orbRef = useRef<HTMLDivElement>(null);
  const transcriptBox = useRef<HTMLDivElement>(null);

  const pushLine = useCallback((role: "user" | "agent", text: string) => {
    setTranscript((prev) => {
      const next = [...prev, { id: prev.length, role, text }];
      transcriptRef.current = next;
      return next;
    });
  }, []);

  const conversation = useConversation({
    micMuted: !holding,
    onConnect: () => {
      everConnected.current = true;
      setError(null);
      setNotice(null);
      if (!restarting.current) {
        connectAt.current = performance.now();
        userTalkMs.current = 0;
        agentTalkMs.current = 0;
        userTurns.current = 0;
        setElapsed(0);
        setTranscript([]);
        transcriptRef.current = [];
      }
      restarting.current = false;
      navigator.vibrate?.(30);
    },
    onDisconnect: (details) => {
      setHolding(false);
      if (agentSpeakStart.current != null) {
        agentTalkMs.current += performance.now() - agentSpeakStart.current;
        agentSpeakStart.current = null;
      }
      if (ending.current || restarting.current) return;
      if (details.reason === "error") {
        // WebRTC coupé avant même d'être connecté : on retente une fois en
        // WebSocket, plus robuste sur certains réseaux mobiles et plus
        // explicite sur les erreurs de réglage de l'agent.
        if (!everConnected.current && attemptType.current === "webrtc" && !fallbackTried.current) {
          fallbackTried.current = true;
          setNotice("La connexion audio a été coupée. Nouvel essai avec une autre méthode…");
          void startRef.current(lastContext.current, "websocket");
          return;
        }
        setError(humanizeError(details.message));
      } else {
        setNotice("La discussion s'est coupée. Tu peux reprendre là où vous en étiez, ou terminer.");
      }
    },
    onError: (message) => setError(humanizeError(message)),
    onMessage: ({ role, message }) => {
      if (role === "user" && pendingCommand.current && message.trim() === pendingCommand.current) {
        pendingCommand.current = null;
        return;
      }
      if (role === "user") userTurns.current += 1;
      pushLine(role, message);
    },
    onModeChange: ({ mode }) => {
      const now = performance.now();
      if (mode === "speaking") {
        agentSpeakStart.current = now;
      } else if (agentSpeakStart.current != null) {
        agentTalkMs.current += now - agentSpeakStart.current;
        agentSpeakStart.current = null;
      }
    },
  });

  const { status, isSpeaking, startSession, endSession, sendUserMessage } = conversation;
  const connected = status === "connected";
  const busy = preparing || status === "connecting";

  // Chrono de la séance.
  useEffect(() => {
    if (phase !== "live" || !connected) return;
    const id = setInterval(() => {
      if (connectAt.current != null) {
        setElapsed(Math.floor((performance.now() - connectAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, connected]);

  // L'avatar respire au rythme de la voix.
  useEffect(() => {
    const orb = orbRef.current;
    if (!connected || !orb) return;
    let frame = 0;
    const tick = () => {
      const level = isSpeaking ? conversation.getOutputVolume() : conversation.getInputVolume();
      orb.style.transform = `scale(${(1 + Math.min(level, 1) * 0.12).toFixed(3)})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      orb.style.transform = "";
    };
  }, [connected, isSpeaking, conversation]);

  // Le texte suit la conversation.
  useEffect(() => {
    const box = transcriptBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [transcript, showText]);

  // Vérifie que l'agent ElevenLabs accepte nos consignes ; sinon le règle
  // automatiquement (même chose que le bouton de la page Réglages).
  const ensureAgentConfigured = useCallback(async () => {
    if (agentReady.current) return true;
    try {
      const res = await fetch("/api/elevenlabs/agent");
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) return true; // la route session donnera un message plus précis
      if (data.ok) {
        agentReady.current = true;
        return true;
      }
      const fix = await fetch("/api/elevenlabs/agent", { method: "POST" });
      const fixed = (await fix.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (fix.ok && fixed.ok) {
        agentReady.current = true;
        return true;
      }
      setError(
        `L'agent ElevenLabs n'accepte pas encore les réglages de l'app. ${fixed.error ?? ""} Ouvre Réglages pour voir ce qui manque.`.trim(),
      );
      return false;
    } catch {
      return true;
    }
  }, []);

  const start = useCallback(
    async (context?: { resumeMessage: string }, force?: ConnectionType) => {
      setError(null);
      if (!force) {
        setNotice(null);
        fallbackTried.current = false;
      }
      setPreparing(true);
      try {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          setError("Le micro est refusé. Autorise le micro pour ce site dans les réglages du navigateur, puis réessaie.");
          return false;
        }
        if (!(await ensureAgentConfigured())) return false;
        const type = force ?? connectionType;
        attemptType.current = type;
        everConnected.current = false;
        lastContext.current = context;
        const res = await fetch("/api/elevenlabs/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personality: personality.id,
            speed,
            connectionType: type,
            context: context
              ? {
                  resumeMessage: context.resumeMessage,
                  transcript: transcriptRef.current.map((l) => ({ role: l.role, text: l.text })),
                }
              : undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          connectionType?: ConnectionType;
          conversationToken?: string;
          signedUrl?: string;
          overrides?: Record<string, unknown>;
        };
        if (!res.ok) {
          setError(data.error ?? "Le serveur n'a pas répondu. Réessaie dans un instant.");
          return false;
        }
        restarting.current = Boolean(context);
        ending.current = false;
        if (data.connectionType === "websocket" && data.signedUrl) {
          startSession({ signedUrl: data.signedUrl, connectionType: "websocket", overrides: data.overrides });
        } else if (data.conversationToken) {
          startSession({ conversationToken: data.conversationToken, connectionType: "webrtc", overrides: data.overrides });
        } else {
          setError("Réponse du serveur incomplète. Réessaie.");
          return false;
        }
        return true;
      } catch {
        setError("Pas de connexion. Vérifie ton réseau puis réessaie.");
        return false;
      } finally {
        setPreparing(false);
      }
    },
    [speed, connectionType, startSession, ensureAgentConfigured],
  );

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const begin = useCallback(async () => {
    setPhase("live");
    setBilan(null);
    setSummary(null);
    const ok = await start();
    if (!ok) {
      // on reste sur l'écran de conversation avec le message d'erreur et un bouton Réessayer
    }
  }, [start]);

  const onHoldChange = useCallback(
    (next: boolean) => {
      if (!connected && next) return;
      setHolding(next);
      if (next) {
        holdStart.current = performance.now();
        navigator.vibrate?.(30);
      } else if (holdStart.current != null) {
        userTalkMs.current += performance.now() - holdStart.current;
        holdStart.current = null;
        navigator.vibrate?.(20);
      }
    },
    [connected],
  );

  const repeat = useCallback(() => {
    if (!connected) return;
    pendingCommand.current = REPEAT_COMMAND;
    sendUserMessage(REPEAT_COMMAND);
  }, [connected, sendUserMessage]);

  const startWithSpeed = useCallback(
    async (nextSpeed: SpeedKey, resumeMessage: string) => {
      setPreparing(true);
      attemptType.current = connectionType;
      everConnected.current = false;
      lastContext.current = { resumeMessage };
      try {
        const res = await fetch("/api/elevenlabs/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personality: personality.id,
            speed: nextSpeed,
            connectionType,
            context: {
              resumeMessage,
              transcript: transcriptRef.current.map((l) => ({ role: l.role, text: l.text })),
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          connectionType?: ConnectionType;
          conversationToken?: string;
          signedUrl?: string;
          overrides?: Record<string, unknown>;
        };
        if (!res.ok) {
          restarting.current = false;
          setError(data.error ?? "Le serveur n'a pas répondu. Réessaie.");
          return;
        }
        if (data.connectionType === "websocket" && data.signedUrl) {
          startSession({ signedUrl: data.signedUrl, connectionType: "websocket", overrides: data.overrides });
        } else if (data.conversationToken) {
          startSession({ conversationToken: data.conversationToken, connectionType: "webrtc", overrides: data.overrides });
        }
      } catch {
        restarting.current = false;
        setError("Pas de connexion. Vérifie ton réseau puis réessaie.");
      } finally {
        setPreparing(false);
      }
    },
    [connectionType, startSession],
  );

  const cycleSpeed = useCallback(async () => {
    const next = SPEED_ORDER[(SPEED_ORDER.indexOf(speed) + 1) % SPEED_ORDER.length];
    setSavedSpeed(next);
    if (!connected) return;
    // Changer la vitesse demande une nouvelle connexion : on reprend la
    // discussion là où elle en était.
    restarting.current = true;
    setHolding(false);
    endSession();
    await new Promise((r) => setTimeout(r, 400));
    // `speed` est encore l'ancienne valeur dans cette closure : on appelle le
    // serveur avec la nouvelle directement.
    await startWithSpeed(next, SPEED_RESUME_MESSAGES[next]);
  }, [speed, connected, endSession, setSavedSpeed, startWithSpeed]);

  const resume = useCallback(() => {
    start({ resumeMessage: "Sorry, the line dropped for a second. Where were we?" });
  }, [start]);

  const finish = useCallback(async () => {
    ending.current = true;
    setHolding(false);
    if (holdStart.current != null) {
      userTalkMs.current += performance.now() - holdStart.current;
      holdStart.current = null;
    }
    if (agentSpeakStart.current != null) {
      agentTalkMs.current += performance.now() - agentSpeakStart.current;
      agentSpeakStart.current = null;
    }
    if (connected || status === "connecting") endSession();
    navigator.vibrate?.([20, 40, 20]);

    const seconds = connectAt.current != null ? Math.round((performance.now() - connectAt.current) / 1000) : 0;
    const total = userTalkMs.current + agentTalkMs.current;
    const userShare = total > 0 ? Math.round((userTalkMs.current / total) * 100) : 0;
    const recorded = seconds >= 30 ? progress.recordSession(seconds) : { streak: progress.streak, minutesToday: progress.minutesToday };
    setSummary({
      seconds,
      userTurns: userTurns.current,
      userShare,
      streak: recorded.streak,
      minutesToday: recorded.minutesToday,
      goalReached: recorded.minutesToday >= progress.goalMinutes,
    });
    setPhase("bilan");

    const lines = transcriptRef.current;
    if (lines.length >= 2) {
      setBilanLoading(true);
      try {
        const res = await fetch("/api/bilan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: lines.map((l) => ({ role: l.role, text: l.text })), durationSeconds: seconds }),
        });
        if (res.ok) setBilan((await res.json()) as BilanResult);
      } catch {
        // pas de bilan : l'écran reste utile sans
      } finally {
        setBilanLoading(false);
      }
    }
  }, [connected, status, endSession, progress]);

  if (phase === "home") {
    return (
      <HomeScreen
        speed={speed}
        onSpeedChange={setSavedSpeed}
        streak={progress.streak}
        minutesToday={progress.minutesToday}
        goalMinutes={progress.goalMinutes}
        onStart={begin}
      />
    );
  }

  if (phase === "bilan") {
    return (
      <BilanScreen
        summary={summary}
        bilan={bilan}
        loading={bilanLoading}
        onAgain={begin}
        onHome={() => setPhase("home")}
      />
    );
  }

  const statusLabel = error
    ? null
    : notice
      ? null
      : busy
        ? "Connexion…"
        : !connected
          ? "Appuie sur Reprendre pour continuer."
          : holding
            ? "Je t'écoute…"
            : isSpeaking
              ? `${personality.name} parle…`
              : "À toi de parler";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${connected ? (isSpeaking ? "bg-speaking" : "bg-listening") : busy ? "bg-listening" : "bg-muted/40"}`}
            aria-hidden
          />
          <div className="flex flex-col">
            <span className="text-base font-bold">{personality.name}</span>
            <span className="text-xs text-muted">{personality.modeLabel} · anglais</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-muted tabular-nums">{formatClock(elapsed)}</span>
          <button
            type="button"
            onClick={finish}
            className="h-10 rounded-xl bg-danger/15 px-4 text-sm font-semibold text-danger"
          >
            Terminer
          </button>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div
          ref={orbRef}
          className={`grid place-items-center rounded-full p-5 transition-colors duration-300 ${
            connected ? (isSpeaking ? "bg-speaking/15" : holding ? "bg-listening/20" : "bg-accent-soft") : "bg-accent-soft"
          }`}
        >
          <MaxAvatar size={showText ? 96 : 170} speaking={isSpeaking} label={`${personality.name}`} />
        </div>
        {statusLabel && (
          <p className="text-xl font-semibold" role="status" aria-live="polite">
            {statusLabel}
          </p>
        )}
        {!error && !notice && connected && !holding && (
          <p className="max-w-xs text-sm text-muted">
            {isSpeaking
              ? "Appuie sur le micro pour l'interrompre."
              : "Maintiens le bouton pendant que tu parles, relâche pour envoyer."}
          </p>
        )}
        {error && (
          <div className="flex flex-col items-center gap-3">
            <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => start()} className="h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast">
                Réessayer
              </button>
              <Link href="/reglages" className="h-11 rounded-xl border border-line bg-elevated px-5 text-sm font-semibold leading-[44px]">
                Réglages
              </Link>
            </div>
          </div>
        )}
        {notice && !error && (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-xs text-sm text-muted">{notice}</p>
            <button type="button" onClick={resume} className="h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast">
              Reprendre
            </button>
          </div>
        )}
        {!error && !notice && connected && (
          <p className="flex items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2 text-xs text-muted">
            Bloqué ? Dis « comment on dit… » en français, {personality.name} te donne le mot.
          </p>
        )}
      </section>

      {showText && (
        <section
          ref={transcriptBox}
          aria-label="Texte de la conversation"
          className="flex max-h-64 min-h-24 flex-col gap-2 overflow-y-auto rounded-2xl border border-line bg-elevated p-3"
        >
          {transcript.length === 0 ? (
            <p className="text-center text-sm text-muted">Le texte de la conversation s&apos;affichera ici.</p>
          ) : (
            transcript.map((line) => (
              <p
                key={line.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  line.role === "user" ? "self-end bg-accent text-accent-contrast" : "self-start bg-accent-soft"
                }`}
              >
                {line.text}
              </p>
            ))
          )}
        </section>
      )}

      <section className="grid grid-cols-3 gap-2">
        <ToolButton label="Répète" onClick={repeat} disabled={!connected}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </ToolButton>
        <ToolButton
          label={`Vitesse · ${SPEEDS.find((s) => s.key === speed)?.label ?? "Normal"}`}
          onClick={cycleSpeed}
          disabled={busy}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </ToolButton>
        <ToolButton label={showText ? "Masquer" : "Texte"} onClick={() => setSavedShowText(showText ? "0" : "1")} pressed={showText}>
          <path d="M4 6h16M4 12h10M4 18h14" />
        </ToolButton>
      </section>

      <PushToTalkButton holding={holding} disabled={!connected} interrupting={isSpeaking} onHoldChange={onHoldChange} />
    </main>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-medium disabled:opacity-50 ${
        pressed ? "border-accent bg-accent-soft text-accent" : "border-line bg-elevated"
      }`}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span>{label}</span>
    </button>
  );
}

function HomeScreen({
  speed,
  onSpeedChange,
  streak,
  minutesToday,
  goalMinutes,
  onStart,
}: {
  speed: SpeedKey;
  onSpeedChange: (s: SpeedKey) => void;
  streak: number;
  minutesToday: number;
  goalMinutes: number;
  onStart: () => void;
}) {
  const today = useToday();
  const dateLabel = today
    ? today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    : "";
  const greeting = personality.firstMessages[(today?.getDate() ?? 0) % personality.firstMessages.length];
  const pct = Math.min(100, Math.round((minutesToday / goalMinutes) * 100));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted first-letter:uppercase">{dateLabel}</p>
          <h1 className="text-2xl font-bold">Salut Cherif !</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-listening/15 px-3 py-2 text-sm font-semibold text-listening">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 1-3s1 2 2 2c0-4 2-7 2-10z" />
          </svg>
          <span>
            {streak} jour{streak > 1 ? "s" : ""}
          </span>
        </div>
      </header>

      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Objectif du jour</span>
          <span className="text-sm text-muted">
            {minutesToday} / {goalMinutes} min
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-accent-soft">
          <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border border-line bg-elevated p-5 text-center">
        <MaxAvatar size={150} label={`${personality.name}, ${personality.modeLabel.toLowerCase()}`} />
        <div>
          <p className="text-xl font-bold">{personality.name}</p>
          <p className="text-sm text-muted">
            {personality.modeLabel} · anglais · voix George
          </p>
        </div>
        <p className="max-w-xs rounded-2xl bg-accent-soft px-4 py-3 text-base leading-snug">{greeting}</p>
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-sm text-muted">Vitesse de la voix</span>
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-elevated p-1" role="radiogroup" aria-label="Vitesse de la voix">
          {SPEEDS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={speed === s.key}
              onClick={() => onSpeedChange(s.key)}
              className={`h-10 rounded-xl text-sm font-medium ${speed === s.key ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={onStart}
        className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-accent text-lg font-bold text-accent-contrast shadow-lg shadow-accent/30 transition active:scale-[0.98]"
      >
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        Commencer
      </button>
      <p className="text-center text-xs text-muted">
        Mode ami · anglais. Les autres modes et le français arrivent en V2. ·{" "}
        <Link href="/reglages" className="underline">
          Réglages
        </Link>
      </p>
    </main>
  );
}

function BilanScreen({
  summary,
  bilan,
  loading,
  onAgain,
  onHome,
}: {
  summary: { seconds: number; userTurns: number; userShare: number; streak: number; minutesToday: number; goalReached: boolean } | null;
  bilan: BilanResult | null;
  loading: boolean;
  onAgain: () => void;
  onHome: () => void;
}) {
  const minutes = summary ? Math.round(summary.seconds / 60) : 0;
  const tooShort = !summary || summary.seconds < 30;
  const encouragement =
    bilan?.encouragement ?? (tooShort ? "That was quick! Next time, let's chat a bit longer." : "Nice chat, Cherif! Same time tomorrow?");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-speaking/15 text-speaking">
          <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">{tooShort ? "Séance éclair" : "Bien joué, Cherif !"}</h1>
        <p className="text-sm text-muted">
          {summary?.goalReached
            ? `Objectif du jour atteint. Ta série est à ${summary.streak} jour${summary.streak > 1 ? "s" : ""}.`
            : summary
              ? `${summary.minutesToday} min aujourd'hui sur ${GOAL_LABEL}. Série : ${summary.streak} jour${summary.streak > 1 ? "s" : ""}.`
              : ""}
        </p>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <Tile value={summary && summary.seconds < 60 ? "< 1" : String(minutes)} label={minutes > 1 ? "minutes" : "minute"} />
        <Tile value={String(summary?.userTurns ?? 0)} label="fois où tu as parlé" />
        <Tile value={`${summary?.userShare ?? 0} %`} label="du temps de parole à toi" />
      </section>

      <section className="flex items-center gap-3 rounded-2xl border border-line bg-elevated p-3">
        <MaxAvatar size={56} label={personality.name} />
        <p className="text-sm leading-snug">{encouragement}</p>
      </section>

      <section className="flex flex-1 flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Mots du jour</span>
          {bilan && bilan.words.length > 0 && <span className="text-xs text-muted">{bilan.words.length} nouveaux</span>}
        </div>
        {loading ? (
          <p className="text-sm text-muted">{personality.name} relit la discussion…</p>
        ) : bilan && bilan.words.length > 0 ? (
          bilan.words.map((w) => (
            <div key={w.en} className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2">
              <span className="font-semibold">{w.en}</span>
              <span className="text-right text-sm text-muted">{w.fr}</span>
            </div>
          ))
        ) : bilan && !bilan.available ? (
          <p className="text-sm text-muted">Les mots du jour s&apos;activent avec la clé Anthropic (voir le README).</p>
        ) : (
          <p className="text-sm text-muted">Pas assez de discussion pour relever des mots cette fois.</p>
        )}
        <p className="mt-auto pt-2 text-xs text-muted">Le bilan complet (erreurs, sons à travailler, carnet avec révisions) arrive en V3.</p>
      </section>

      <div className="flex flex-col gap-2">
        <button type="button" onClick={onAgain} className="h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast">
          Nouvelle séance
        </button>
        <button type="button" onClick={onHome} className="h-12 rounded-2xl border border-line bg-elevated text-sm font-semibold">
          Retour à l&apos;accueil
        </button>
      </div>
    </main>
  );
}

const GOAL_LABEL = "10";

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-elevated px-2 py-3 text-center">
      <span className="font-mono text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function humanizeError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("permission") || m.includes("notallowed")) {
    return "Le micro est refusé. Autorise-le pour ce site, puis réessaie.";
  }
  if (m.includes("override")) {
    return "ElevenLabs refuse une consigne. Dans l'agent → Security → Overrides, active System prompt, First message, Voice ID et Speed.";
  }
  if (m.includes("livekit") || m.includes("disconnected") || m.includes("closed")) {
    return "ElevenLabs a coupé la connexion. Le plus souvent, l'agent n'accepte pas encore les réglages de l'app : ouvre Réglages et vérifie qu'il est « Prêt ». Sinon, réessaie dans un instant.";
  }
  if (m.includes("network") || m.includes("failed to fetch") || m.includes("timeout")) {
    return "La connexion est trop faible. Rapproche-toi du réseau et réessaie.";
  }
  return `Problème : ${message}`;
}
