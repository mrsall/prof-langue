"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { PersonaAvatar } from "@/components/persona-avatar";
import { PushToTalkButton } from "@/components/push-to-talk-button";
import {
  PERSONALITIES,
  LANGUAGE_LABELS,
  findPersonality,
  isLanguage,
  type Language,
  type Personality,
} from "@/config/personalities";
import { SPEEDS, SPEED_ORDER, SPEED_RESUME_MESSAGES, isSpeedKey, type SpeedKey } from "@/config/speeds";
import { CORRECTION_LEVELS, CORRECTION_ORDER, isCorrectionLevel, type CorrectionLevel } from "@/config/correction";
import { randomTopic } from "@/config/topics";
import { useLocalStorage } from "@/lib/use-local-storage";
import { useProgress, useToday } from "@/lib/progress";
import { useHistory } from "@/lib/history";
import type { BilanResult } from "@/app/api/bilan/route";

/**
 * V2 — six personnalités, anglais et français, choix du sujet, niveau de
 * correction réglable, mains libres ou appui pour parler.
 * Quatre écrans dans un seul composant pour garder l'état de la séance :
 * accueil → sujet → conversation → fin de séance.
 */

type Phase = "home" | "topic" | "live" | "bilan";
type TranscriptLine = { id: number; role: "user" | "agent"; text: string };
type ConnectionType = "webrtc" | "websocket";
type TalkMode = "mains-libres" | "appui";
type TopicChoice = { title: string | null; own: boolean };

type SessionParams = {
  personality: Personality;
  language: Language;
  correction: CorrectionLevel;
  speed: SpeedKey;
  topic: TopicChoice;
};

const SPEED_KEY = "prof-langue:speed";
const CONNECTION_KEY = "prof-langue:v0:connection";
const SHOW_TEXT_KEY = "prof-langue:show-text";
const TALK_MODE_KEY = "prof-langue:talk-mode";
const LANGUAGE_KEY = "prof-langue:language";
const MODE_KEY = "prof-langue:mode";

const REPEAT_COMMAND: Record<Language, string> = {
  en: "Please say your last sentence again, a little slower.",
  fr: "Peux-tu redire ta dernière phrase, un peu plus lentement ?",
};
const RESUME_AFTER_DROP: Record<Language, string> = {
  en: "Sorry, the line dropped for a second. Where were we?",
  fr: "Pardon, ça a coupé une seconde. Où en étions-nous ?",
};
const RESUME_AFTER_CORRECTION: Record<Language, string> = {
  en: "Okay, noted. So, where were we?",
  fr: "D'accord, c'est noté. Où en étions-nous ?",
};

export function App() {
  return (
    <ConversationProvider>
      <AppInner />
    </ConversationProvider>
  );
}

function AppInner() {
  const [phase, setPhase] = useState<Phase>("home");

  // Préférences gardées sur le téléphone.
  const [savedSpeed, setSavedSpeed] = useLocalStorage(SPEED_KEY);
  const speed: SpeedKey = isSpeedKey(savedSpeed) ? savedSpeed : "normal";
  const [savedConnection] = useLocalStorage(CONNECTION_KEY);
  const connectionType: ConnectionType = savedConnection === "websocket" ? "websocket" : "webrtc";
  const [savedShowText, setSavedShowText] = useLocalStorage(SHOW_TEXT_KEY);
  const showText = savedShowText === "1";
  const [savedTalkMode, setSavedTalkMode] = useLocalStorage(TALK_MODE_KEY);
  const talkMode: TalkMode = savedTalkMode === "appui" ? "appui" : "mains-libres";
  const handsFree = talkMode === "mains-libres";
  const [savedLanguage, setSavedLanguage] = useLocalStorage(LANGUAGE_KEY);
  const language: Language = isLanguage(savedLanguage) ? savedLanguage : "en";
  const [savedMode, setSavedMode] = useLocalStorage(MODE_KEY);
  const personality = findPersonality(savedMode) ?? PERSONALITIES[0];
  const [savedCorrection, setSavedCorrection] = useLocalStorage(`prof-langue:correction:${personality.id}`);
  const correction: CorrectionLevel = isCorrectionLevel(savedCorrection) ? savedCorrection : personality.correction;

  // Séance en cours.
  const [live, setLive] = useState<SessionParams | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [muted, setMuted] = useState(false);
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
  const history = useHistory();

  // Mesures et drapeaux de la séance (sans re-render).
  const connectAt = useRef<number | null>(null);
  const userTalkMs = useRef(0);
  const agentTalkMs = useRef(0);
  const agentSpeakStart = useRef<number | null>(null);
  const vadActive = useRef(false);
  const vadStart = useRef<number | null>(null);
  const userTurns = useRef(0);
  const pendingCommand = useRef<string | null>(null);
  const restarting = useRef(false);
  const ending = useRef(false);
  const everConnected = useRef(false);
  const attemptType = useRef<ConnectionType>("webrtc");
  const fallbackTried = useRef(false);
  const agentReady = useRef(false);
  const liveRef = useRef<SessionParams | null>(null);
  const lastContext = useRef<{ resumeMessage: string } | undefined>(undefined);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const orbRef = useRef<HTMLDivElement>(null);
  const transcriptBox = useRef<HTMLDivElement>(null);
  const startRef = useRef<(opts: StartOptions) => Promise<boolean>>(async () => false);

  type StartOptions = {
    params?: Partial<SessionParams>;
    context?: { resumeMessage: string };
    force?: ConnectionType;
  };

  const pushLine = useCallback((role: "user" | "agent", text: string) => {
    setTranscript((prev) => {
      const next = [...prev, { id: prev.length, role, text }];
      transcriptRef.current = next;
      return next;
    });
  }, []);

  const conversation = useConversation({
    micMuted: handsFree ? muted : !holding,
    onVadScore: ({ vadScore }) => {
      const now = performance.now();
      if (vadScore > 0.6 && !vadActive.current) {
        vadActive.current = true;
        vadStart.current = now;
      } else if (vadScore < 0.3 && vadActive.current) {
        vadActive.current = false;
        if (vadStart.current != null) userTalkMs.current += now - vadStart.current;
        vadStart.current = null;
      }
    },
    onConnect: () => {
      everConnected.current = true;
      setMuted(false);
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
        if (!everConnected.current && attemptType.current === "webrtc" && !fallbackTried.current) {
          fallbackTried.current = true;
          setNotice("La connexion audio a été coupée. Nouvel essai avec une autre méthode…");
          void startRef.current({ context: lastContext.current, force: "websocket" });
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
      if (connectAt.current != null) setElapsed(Math.floor((performance.now() - connectAt.current) / 1000));
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
      setError(`L'agent ElevenLabs n'accepte pas encore les réglages de l'app. ${fixed.error ?? ""} Ouvre Réglages pour voir ce qui manque.`.trim());
      return false;
    } catch {
      return true;
    }
  }, []);

  const frenchVoicesReady = useRef(false);
  const ensureFrenchVoices = useCallback(async () => {
    if (frenchVoicesReady.current) return;
    try {
      const res = await fetch("/api/elevenlabs/voices-fr");
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && data.ok) {
        frenchVoicesReady.current = true;
        return;
      }
      const fix = await fetch("/api/elevenlabs/voices-fr", { method: "POST" });
      const fixed = (await fix.json().catch(() => ({}))) as { ok?: boolean };
      if (fix.ok && fixed.ok) frenchVoicesReady.current = true;
    } catch {
      // sans voix française, la séance se fait avec la voix habituelle
    }
  }, []);

  const start = useCallback(
    async ({ params, context, force }: StartOptions) => {
      const base: SessionParams = liveRef.current ?? { personality, language, correction, speed, topic: { title: null, own: true } };
      const p: SessionParams = { ...base, ...params };
      liveRef.current = p;
      setLive(p);
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
        if (p.language === "fr") await ensureFrenchVoices();
        const type = force ?? connectionType;
        attemptType.current = type;
        everConnected.current = false;
        lastContext.current = context;
        const res = await fetch("/api/elevenlabs/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personality: p.personality.id,
            language: p.language,
            correction: p.correction,
            speed: p.speed,
            topic: p.topic.title,
            ownTopic: p.topic.own,
            memory: history.memoryFor(p.personality.id, p.personality.modeLabel),
            connectionType: type,
            context: context
              ? { resumeMessage: context.resumeMessage, transcript: transcriptRef.current.map((l) => ({ role: l.role, text: l.text })) }
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
    [personality, language, correction, speed, connectionType, startSession, ensureAgentConfigured, ensureFrenchVoices, history],
  );

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  /** Lance une nouvelle séance (depuis le choix du sujet ou le bilan). */
  const begin = useCallback(
    (params: Partial<SessionParams>) => {
      liveRef.current = null;
      setPhase("live");
      setBilan(null);
      setSummary(null);
      void start({ params });
    },
    [start],
  );

  /** Change un réglage en pleine discussion : reconnexion et reprise. */
  const restart = useCallback(
    async (params: Partial<SessionParams>, resumeMessage: string) => {
      if (!connected) {
        liveRef.current = liveRef.current ? { ...liveRef.current, ...params } : null;
        if (liveRef.current) setLive(liveRef.current);
        return;
      }
      restarting.current = true;
      setHolding(false);
      endSession();
      await new Promise((r) => setTimeout(r, 400));
      await start({ params, context: { resumeMessage } });
    },
    [connected, endSession, start],
  );

  const onHoldChange = useCallback(
    (next: boolean) => {
      if (!connected && next) return;
      setHolding(next);
      navigator.vibrate?.(next ? 30 : 20);
    },
    [connected],
  );

  const repeat = useCallback(() => {
    if (!connected || !live) return;
    pendingCommand.current = REPEAT_COMMAND[live.language];
    sendUserMessage(REPEAT_COMMAND[live.language]);
  }, [connected, live, sendUserMessage]);

  const cycleSpeed = useCallback(() => {
    const current = liveRef.current?.speed ?? speed;
    const next = SPEED_ORDER[(SPEED_ORDER.indexOf(current) + 1) % SPEED_ORDER.length];
    setSavedSpeed(next);
    void restart({ speed: next }, SPEED_RESUME_MESSAGES[liveRef.current?.language ?? language][next]);
  }, [speed, language, setSavedSpeed, restart]);

  const cycleCorrection = useCallback(() => {
    const current = liveRef.current?.correction ?? correction;
    const next = CORRECTION_ORDER[(CORRECTION_ORDER.indexOf(current) + 1) % CORRECTION_ORDER.length];
    setSavedCorrection(next);
    void restart({ correction: next }, RESUME_AFTER_CORRECTION[liveRef.current?.language ?? language]);
  }, [correction, language, setSavedCorrection, restart]);

  const resume = useCallback(() => {
    void start({ context: { resumeMessage: RESUME_AFTER_DROP[liveRef.current?.language ?? language] } });
  }, [start, language]);

  const finish = useCallback(async () => {
    ending.current = true;
    setHolding(false);
    if (vadActive.current && vadStart.current != null) {
      userTalkMs.current += performance.now() - vadStart.current;
      vadActive.current = false;
      vadStart.current = null;
    }
    if (agentSpeakStart.current != null) {
      agentTalkMs.current += performance.now() - agentSpeakStart.current;
      agentSpeakStart.current = null;
    }
    if (connected || status === "connecting") endSession();
    navigator.vibrate?.([20, 40, 20]);

    const p = liveRef.current;
    const seconds = connectAt.current != null ? Math.round((performance.now() - connectAt.current) / 1000) : 0;
    const total = userTalkMs.current + agentTalkMs.current;
    const userShare = total > 0 ? Math.round((userTalkMs.current / total) * 100) : 0;
    const recorded = seconds >= 30 ? progress.recordSession(seconds) : { streak: progress.streak, minutesToday: progress.minutesToday };
    if (p && seconds >= 30) {
      history.add({
        date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" }),
        personality: p.personality.id,
        language: p.language,
        topic: p.topic.title ?? (p.language === "en" ? "a topic Cherif chose" : "un sujet choisi par Cherif"),
        seconds,
      });
    }
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
    if (lines.length >= 2 && p) {
      setBilanLoading(true);
      try {
        const res = await fetch("/api/bilan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: lines.map((l) => ({ role: l.role, text: l.text })),
            durationSeconds: seconds,
            personality: p.personality.id,
            language: p.language,
          }),
        });
        if (res.ok) setBilan((await res.json()) as BilanResult);
      } catch {
        // pas de bilan : l'écran reste utile sans
      } finally {
        setBilanLoading(false);
      }
    }
  }, [connected, status, endSession, progress, history]);

  if (phase === "home") {
    return (
      <HomeScreen
        language={language}
        onLanguageChange={setSavedLanguage}
        personality={personality}
        onModeChange={setSavedMode}
        speed={speed}
        onSpeedChange={setSavedSpeed}
        talkMode={talkMode}
        onTalkModeChange={setSavedTalkMode}
        streak={progress.streak}
        minutesToday={progress.minutesToday}
        goalMinutes={progress.goalMinutes}
        onStart={() => setPhase("topic")}
      />
    );
  }

  if (phase === "topic") {
    return (
      <TopicScreen
        personality={personality}
        language={language}
        recent={history.recentTopics(personality.id, language)}
        onBack={() => setPhase("home")}
        onPick={(topic) => begin({ personality, language, correction, speed, topic })}
      />
    );
  }

  if (phase === "bilan") {
    return (
      <BilanScreen
        summary={summary}
        bilan={bilan}
        loading={bilanLoading}
        personality={live?.personality ?? personality}
        language={live?.language ?? language}
        onAgain={() => setPhase("topic")}
        onHome={() => setPhase("home")}
        onTeacher={(focus) => {
          const prof = findPersonality("prof") ?? personality;
          setSavedMode(prof.id);
          begin({ personality: prof, language: live?.language ?? language, correction: "active", speed, topic: { title: focus, own: false } });
        }}
      />
    );
  }

  const p = live ?? { personality, language, correction, speed, topic: { title: null, own: true } };
  const displayName = p.personality.id === "situation" ? "Ton partenaire" : p.personality.name;

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
              ? `${displayName} parle…`
              : handsFree
                ? muted
                  ? "Micro coupé"
                  : "Je t'écoute, parle quand tu veux"
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
            <span className="text-base font-bold">{displayName}</span>
            <span className="text-xs text-muted">
              {p.personality.modeLabel} · {LANGUAGE_LABELS[p.language].toLowerCase()}
              {p.topic.title ? ` · ${p.topic.title}` : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-muted tabular-nums">{formatClock(elapsed)}</span>
          <button type="button" onClick={finish} className="h-10 rounded-xl bg-danger/15 px-4 text-sm font-semibold text-danger">
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
          <PersonaAvatar style={p.personality.avatar} size={showText ? 96 : 170} speaking={isSpeaking} label={displayName} />
        </div>
        {statusLabel && (
          <p className="text-xl font-semibold" role="status" aria-live="polite">
            {statusLabel}
          </p>
        )}
        {!error && !notice && connected && !holding && (
          <p className="max-w-xs text-sm text-muted">
            {handsFree
              ? isSpeaking
                ? "Parle par-dessus pour l'interrompre."
                : muted
                  ? "Appuie sur le micro pour le rouvrir."
                  : `${displayName} détecte la fin de ta phrase tout seul.`
              : isSpeaking
                ? "Appuie sur le micro pour l'interrompre."
                : "Maintiens le bouton pendant que tu parles, relâche pour envoyer."}
          </p>
        )}
        {error && (
          <div className="flex flex-col items-center gap-3">
            <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => start({})} className="h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast">
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
            {!busy && (
              <button type="button" onClick={resume} className="h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast">
                Reprendre
              </button>
            )}
          </div>
        )}
        {!error && !notice && connected && (
          <p className="flex items-center gap-2 rounded-xl border border-line bg-elevated px-3 py-2 text-xs text-muted">
            {p.language === "en"
              ? `Bloqué ? Dis « comment on dit… » en français, ${displayName} te donne le mot.`
              : `Tu cherches un mot ? Demande-le, ${displayName} te le donne.`}
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
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${line.role === "user" ? "self-end bg-accent text-accent-contrast" : "self-start bg-accent-soft"}`}
              >
                {line.text}
              </p>
            ))
          )}
        </section>
      )}

      <section className="grid grid-cols-4 gap-2">
        <ToolButton label="Répète" onClick={repeat} disabled={!connected}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </ToolButton>
        <ToolButton label={SPEEDS.find((s) => s.key === p.speed)?.label ?? "Normal"} sublabel="Vitesse" onClick={cycleSpeed} disabled={busy}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </ToolButton>
        <ToolButton
          label={CORRECTION_LEVELS.find((c) => c.key === p.correction)?.short ?? "Aucune"}
          sublabel="Correction"
          onClick={cycleCorrection}
          disabled={busy}
        >
          <path d="M20 6 9 17l-5-5" />
        </ToolButton>
        <ToolButton label={showText ? "Masquer" : "Texte"} onClick={() => setSavedShowText(showText ? "0" : "1")} pressed={showText}>
          <path d="M4 6h16M4 12h10M4 18h14" />
        </ToolButton>
      </section>

      {handsFree ? (
        <HandsFreeMic
          muted={muted}
          disabled={!connected}
          speaking={isSpeaking}
          onToggle={() => {
            setMuted((m) => !m);
            navigator.vibrate?.(20);
          }}
        />
      ) : (
        <PushToTalkButton holding={holding} disabled={!connected} interrupting={isSpeaking} onHoldChange={onHoldChange} />
      )}
      <button
        type="button"
        onClick={() => {
          setSavedTalkMode(handsFree ? "appui" : "mains-libres");
          setHolding(false);
          setMuted(false);
        }}
        className="mx-auto text-xs text-muted underline"
      >
        {handsFree ? "Passer en appui pour parler (endroit bruyant)" : "Passer en mains libres"}
      </button>
    </main>
  );
}

function HandsFreeMic({ muted, disabled, speaking, onToggle }: { muted: boolean; disabled: boolean; speaking: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!muted}
        aria-label={muted ? "Micro coupé, appuie pour le rouvrir" : "Micro ouvert, appuie pour le couper"}
        onClick={onToggle}
        className={`grid h-28 w-28 place-items-center rounded-full transition-all duration-150 disabled:opacity-50 ${
          muted
            ? "border-[3px] border-line bg-elevated text-muted"
            : speaking
              ? "border-[3px] border-speaking bg-elevated text-fg"
              : "bg-listening text-fg shadow-[0_0_0_14px_rgba(255,160,92,0.22)] animate-breathe"
        }`}
      >
        <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          {muted && <path d="M4 4l16 16" />}
        </svg>
      </button>
      <span className="text-sm font-semibold text-muted">{muted ? "Micro coupé" : "Micro ouvert"}</span>
    </div>
  );
}

function ToolButton({
  label,
  sublabel,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  sublabel?: string;
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
      aria-label={sublabel ? `${sublabel} : ${label}` : label}
      className={`flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[11px] font-medium leading-tight disabled:opacity-50 ${
        pressed ? "border-accent bg-accent-soft text-accent" : "border-line bg-elevated"
      }`}
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {sublabel && <span className="text-[10px] text-muted">{sublabel}</span>}
      <span>{label}</span>
    </button>
  );
}

function HomeScreen({
  language,
  onLanguageChange,
  personality,
  onModeChange,
  speed,
  onSpeedChange,
  talkMode,
  onTalkModeChange,
  streak,
  minutesToday,
  goalMinutes,
  onStart,
}: {
  language: Language;
  onLanguageChange: (l: Language) => void;
  personality: Personality;
  onModeChange: (id: string) => void;
  speed: SpeedKey;
  onSpeedChange: (s: SpeedKey) => void;
  talkMode: TalkMode;
  onTalkModeChange: (m: TalkMode) => void;
  streak: number;
  minutesToday: number;
  goalMinutes: number;
  onStart: () => void;
}) {
  const today = useToday();
  const dateLabel = today ? today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
  const greeting = personality.ownTopicMessages[language];
  const pct = Math.min(100, Math.round((minutesToday / goalMinutes) * 100));
  const displayName = personality.id === "situation" ? personality.modeLabel : personality.name;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
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

      <section className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-elevated p-1" role="radiogroup" aria-label="Langue">
          {(["en", "fr"] as Language[]).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={language === l}
              onClick={() => onLanguageChange(l)}
              className={`h-11 rounded-xl text-sm font-medium ${language === l ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
            >
              {LANGUAGE_LABELS[l]}
            </button>
          ))}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1" role="radiogroup" aria-label="Mode">
          {PERSONALITIES.map((pers) => {
            const selected = pers.id === personality.id;
            return (
              <button
                key={pers.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onModeChange(pers.id)}
                className={`flex shrink-0 flex-col items-center gap-1 rounded-2xl border px-3 py-2 text-xs font-medium ${
                  selected ? "border-accent bg-accent-soft text-accent" : "border-line bg-elevated text-muted"
                }`}
              >
                <PersonaAvatar style={pers.avatar} size={44} label={pers.name} />
                <span>{pers.modeLabel}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border border-line bg-elevated p-5 text-center">
        <PersonaAvatar style={personality.avatar} size={130} label={displayName} />
        <div>
          <p className="text-xl font-bold">{displayName}</p>
          <p className="text-sm text-muted">{personality.tagline}</p>
        </div>
        <p className="max-w-xs rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-snug">{greeting}</p>
      </section>

      <details className="rounded-2xl border border-line bg-elevated px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Micro et vitesse{" "}
          <span className="font-normal text-muted">
            · {talkMode === "mains-libres" ? "mains libres" : "appui pour parler"} · {SPEEDS.find((s) => s.key === speed)?.label.toLowerCase()}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-bg p-1" role="radiogroup" aria-label="Façon de parler">
            {(
              [
                { key: "mains-libres", label: "Mains libres" },
                { key: "appui", label: "Appui pour parler" },
              ] as { key: TalkMode; label: string }[]
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={talkMode === m.key}
                onClick={() => onTalkModeChange(m.key)}
                className={`h-10 rounded-lg text-sm font-medium ${talkMode === m.key ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-bg p-1" role="radiogroup" aria-label="Vitesse de la voix">
            {SPEEDS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={speed === s.key}
                onClick={() => onSpeedChange(s.key)}
                className={`h-10 rounded-lg text-sm font-medium ${speed === s.key ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </details>

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
        <Link href="/reglages" className="underline">
          Réglages
        </Link>
      </p>
    </main>
  );
}

function TopicScreen({
  personality,
  language,
  recent,
  onBack,
  onPick,
}: {
  personality: Personality;
  language: Language;
  recent: string[];
  onBack: () => void;
  onPick: (topic: TopicChoice) => void;
}) {
  const [topics, setTopics] = useState<string[] | null>(null);
  const recentKey = recent.join("|");

  useEffect(() => {
    let active = true;
    fetch("/api/sujets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personality: personality.id, language, recent: recentKey ? recentKey.split("|") : [] }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { topics?: string[] };
        if (active) setTopics(Array.isArray(data.topics) ? data.topics : []);
      })
      .catch(() => {
        if (active) setTopics([]);
      });
    return () => {
      active = false;
    };
  }, [personality.id, language, recentKey]);

  const displayName = personality.id === "situation" ? personality.modeLabel : personality.name;
  const list = topics && topics.length > 0 ? topics : topics ? randomList(personality.id, language) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Retour" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-elevated">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <PersonaAvatar style={personality.avatar} size={40} label={displayName} />
          <div className="flex flex-col">
            <span className="text-base font-bold">De quoi on parle ?</span>
            <span className="text-xs text-muted">
              {displayName} · {LANGUAGE_LABELS[language].toLowerCase()}
            </span>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-2">
        {list === null
          ? [0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-line bg-elevated" />)
          : list.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onPick({ title: t, own: false })}
                className="min-h-16 rounded-2xl border border-line bg-elevated px-4 py-3 text-left text-base font-medium transition active:scale-[0.99]"
              >
                {t}
              </button>
            ))}
      </section>

      <section className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onPick({ title: null, own: true })}
          className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-accent text-base font-bold text-accent-contrast"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          J&apos;ai mon propre sujet
        </button>
        <button
          type="button"
          onClick={() => onPick({ title: randomTopic(personality.id, language, recent), own: false })}
          className="h-14 rounded-2xl border border-line bg-elevated text-base font-semibold"
        >
          Surprends-moi
        </button>
        <p className="text-center text-xs text-muted">
          « Mon propre sujet » : tu le dis à voix haute dès que {displayName} te le demande.
        </p>
      </section>
    </main>
  );
}

function randomList(personalityId: string, language: Language) {
  const out: string[] = [];
  for (let i = 0; i < 8 && out.length < 4; i++) {
    const t = randomTopic(personalityId, language, out);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function BilanScreen({
  summary,
  bilan,
  loading,
  personality,
  language,
  onAgain,
  onHome,
  onTeacher,
}: {
  summary: { seconds: number; userTurns: number; userShare: number; streak: number; minutesToday: number; goalReached: boolean } | null;
  bilan: BilanResult | null;
  loading: boolean;
  personality: Personality;
  language: Language;
  onAgain: () => void;
  onHome: () => void;
  onTeacher: (focus: string) => void;
}) {
  const minutes = summary ? Math.round(summary.seconds / 60) : 0;
  const tooShort = !summary || summary.seconds < 30;
  const displayName = personality.id === "situation" ? "Ton partenaire" : personality.name;
  const fallbackEncouragement =
    language === "en"
      ? tooShort
        ? "That was quick! Next time, let's chat a bit longer."
        : "Nice chat, Cherif! Same time tomorrow?"
      : tooShort
        ? "C'était rapide ! La prochaine fois, on discute un peu plus longtemps."
        : "Belle discussion, Cherif ! On remet ça demain ?";
  const encouragement = bilan?.encouragement ?? fallbackEncouragement;
  const showTeacher = Boolean(bilan?.suggestTeacher && bilan.teacherFocus && personality.id !== "prof");

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
              ? `${summary.minutesToday} min aujourd'hui sur 10. Série : ${summary.streak} jour${summary.streak > 1 ? "s" : ""}.`
              : ""}
        </p>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <Tile value={summary && summary.seconds < 60 ? "< 1" : String(minutes)} label={minutes > 1 ? "minutes" : "minute"} />
        <Tile value={String(summary?.userTurns ?? 0)} label="fois où tu as parlé" />
        <Tile value={`${summary?.userShare ?? 0} %`} label="du temps de parole à toi" />
      </section>

      <section className="flex items-center gap-3 rounded-2xl border border-line bg-elevated p-3">
        <PersonaAvatar style={personality.avatar} size={56} label={displayName} />
        <p className="text-sm leading-snug">{encouragement}</p>
      </section>

      {showTeacher && bilan?.teacherFocus && (
        <section className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent-soft p-4">
          <p className="text-sm">
            {displayName} te conseille une petite séance avec Emma, la prof, sur <strong>{bilan.teacherFocus}</strong>.
          </p>
          <button type="button" onClick={() => onTeacher(bilan.teacherFocus!)} className="h-12 rounded-xl bg-accent text-sm font-bold text-accent-contrast">
            Travailler ça avec Emma
          </button>
        </section>
      )}

      {loading ? (
        <section className="rounded-2xl border border-line bg-elevated p-4">
          <p className="text-sm text-muted">{displayName} relit la discussion…</p>
        </section>
      ) : (
        <>
          {bilan && bilan.errors.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
              <span className="text-sm font-semibold">À retenir</span>
              {bilan.errors.map((e) => (
                <div key={e.wrong} className="flex flex-col gap-1 rounded-xl bg-bg px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="text-muted line-through">{e.wrong}</span>
                    <span className="font-semibold text-speaking">{e.right}</span>
                  </div>
                  {e.tip && <span className="text-xs text-muted">{e.tip}</span>}
                </div>
              ))}
            </section>
          )}
          <section className="flex flex-1 flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Mots du jour</span>
              {bilan && bilan.words.length > 0 && <span className="text-xs text-muted">{bilan.words.length} nouveaux</span>}
            </div>
            {bilan && bilan.words.length > 0 ? (
              bilan.words.map((w) => (
                <div key={w.en} className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2">
                  <span className="font-semibold">{w.en}</span>
                  <span className="text-right text-sm text-muted">{w.fr}</span>
                </div>
              ))
            ) : bilan && !bilan.available ? (
              <p className="text-sm text-muted">Les mots du jour s&apos;activent avec la clé Anthropic (voir Réglages).</p>
            ) : (
              <p className="text-sm text-muted">Pas assez de discussion pour relever des mots cette fois.</p>
            )}
            <p className="mt-auto pt-2 text-xs text-muted">Le carnet de mots avec révisions et le texte corrigé arrivent en V3.</p>
          </section>
        </>
      )}

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
    return "ElevenLabs refuse une consigne. Ouvre Réglages et appuie sur « Configurer l'agent automatiquement ».";
  }
  if (m.includes("livekit") || m.includes("disconnected") || m.includes("closed")) {
    return "ElevenLabs a coupé la connexion. Le plus souvent, l'agent n'accepte pas encore les réglages de l'app : ouvre Réglages et vérifie qu'il est « Prêt ». Sinon, réessaie dans un instant.";
  }
  if (m.includes("network") || m.includes("failed to fetch") || m.includes("timeout")) {
    return "La connexion est trop faible. Rapproche-toi du réseau et réessaie.";
  }
  return `Problème : ${message}`;
}
