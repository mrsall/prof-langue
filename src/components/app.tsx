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
import {
  SPEEDS,
  SPEED_ORDER,
  SPEED_RESUME_MESSAGES,
  isSpeedKey,
  speedValue,
  type SpeedKey,
} from "@/config/speeds";
import {
  EcoEngine,
  type EcoCallbacks,
  type EcoMode,
  type EcoTiming,
} from "@/lib/eco-engine";
import { LiveEngine } from "@/lib/live-engine";
import {
  VOICE_CHOICES,
  VOICE_CHOICE_KEY,
  createSpeaker,
  parseVoiceChoice,
  unlockAudio,
  type VoiceChoice,
  VOICE_LABELS,
  type VoiceFallback,
} from "@/lib/voice-engine";
import {
  CORRECTION_LEVELS,
  CORRECTION_ORDER,
  isCorrectionLevel,
  type CorrectionLevel,
} from "@/config/correction";
import { randomTopic } from "@/config/topics";
import { usableForShadowing } from "@/config/shadowing";
import { useLocalStorage, useMounted } from "@/lib/use-local-storage";
import { useProgress, useToday } from "@/lib/progress";
import { stripVoiceTags } from "@/lib/text";
import { TabBar } from "@/components/tab-bar";
import { kokoroLoaded } from "@/lib/kokoro";
import { useHistory } from "@/lib/history";
import type { BilanResult } from "@/app/api/bilan/route";
import type { Progression } from "@/app/api/sessions/route";
import {
  EAR_CHOICES,
  EAR_CHOICE_KEY,
  parseEarChoice,
  type EarChoice,
} from "@/lib/ear";
import type { ReglagesState } from "@/app/api/reglages/route";
import { formatReset, type ElevenQuota } from "@/lib/quota-format";
import type { SessionKind, ReviewWord, Rematch } from "@/lib/prompt";
import { levelIsStale, type LevelInfo } from "@/lib/levels";

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
/** Qui fait la voix : ElevenLabs (naturelle, minutes payantes) ou le téléphone (éco, gratuit). */
type Engine = "elevenlabs" | "eco" | "live";
type TopicChoice = { title: string | null; own: boolean };

type SessionParams = {
  personality: Personality;
  language: Language;
  correction: CorrectionLevel;
  speed: SpeedKey;
  topic: TopicChoice;
  kind: SessionKind;
  reviewWords?: ReviewWord[];
  /** Revanche d'un débat : même motion, mêmes camps, remarques du juge à vérifier. */
  rematch?: Rematch | null;
  engine?: Engine;
};

const TEST_MAX_SECONDS = 330;

/** 1 234 ms → « 1,2 s ». */
function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}
const REVISION_STORAGE_KEY = "prof-langue:revision-words";

const SPEED_KEY = "prof-langue:speed";
const CONNECTION_KEY = "prof-langue:v0:connection";
const SHOW_TEXT_KEY = "prof-langue:show-text";
const TALK_MODE_KEY = "prof-langue:talk-mode";
const LANGUAGE_KEY = "prof-langue:language";
const MODE_KEY = "prof-langue:mode";
const ENGINE_KEY = "prof-langue:engine";
const AUTO_KEY = "prof-langue:auto";

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
  const connectionType: ConnectionType =
    savedConnection === "websocket" ? "websocket" : "webrtc";
  const [savedShowText, setSavedShowText] = useLocalStorage(SHOW_TEXT_KEY);
  const showText = savedShowText === "1";
  const [savedTalkMode, setSavedTalkMode] = useLocalStorage(TALK_MODE_KEY);
  const talkMode: TalkMode =
    savedTalkMode === "appui" ? "appui" : "mains-libres";
  const handsFree = talkMode === "mains-libres";
  const [savedEngine, setSavedEngine] = useLocalStorage(ENGINE_KEY);
  const engine: Engine =
    savedEngine === "eco" || savedEngine === "live"
      ? savedEngine
      : "elevenlabs";
  // « Économique (auto) » : l'app choisit la voix et l'oreille du mode éco au début de chaque séance.
  const [savedAuto, setSavedAuto] = useLocalStorage(AUTO_KEY);
  const autoEco = savedAuto === "1";
  // Voix et oreille détaillées : réglées dans /reglages/avance (mêmes clés de stockage).
  const [savedVoiceChoice] = useLocalStorage(VOICE_CHOICE_KEY);
  const voiceChoice: VoiceChoice = parseVoiceChoice(savedVoiceChoice);
  const [savedEarChoice] = useLocalStorage(EAR_CHOICE_KEY);
  const earChoice: EarChoice = parseEarChoice(savedEarChoice);
  const [savedLanguage, setSavedLanguage] = useLocalStorage(LANGUAGE_KEY);
  const language: Language = isLanguage(savedLanguage) ? savedLanguage : "en";
  const [savedMode, setSavedMode] = useLocalStorage(MODE_KEY);
  const personality = findPersonality(savedMode) ?? PERSONALITIES[0];
  const [savedCorrection, setSavedCorrection] = useLocalStorage(
    `prof-langue:correction:${personality.id}`,
  );
  const correction: CorrectionLevel = isCorrectionLevel(savedCorrection)
    ? savedCorrection
    : personality.correction;

  // Séance en cours.
  const [live, setLive] = useState<SessionParams | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bandeau « Voix de secours » : une autre voix que celle choisie a pris la parole. */
  const [voiceFallback, setVoiceFallback] = useState<VoiceFallback | null>(
    null,
  );
  const [preparing, setPreparing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bilan, setBilan] = useState<BilanResult | null>(null);
  const [bilanLoading, setBilanLoading] = useState(false);
  const [remote, setRemote] = useState<ReglagesState | null>(null);
  const [levelResult, setLevelResult] = useState<
    (LevelInfo & { error?: string }) | null
  >(null);
  const [capPrompt, setCapPrompt] = useState<Partial<SessionParams> | null>(
    null,
  );
  const [savedCost, setSavedCost] = useState<number | null>(null);
  // Courbe de progression renvoyée par le serveur après l'enregistrement de la séance.
  const [progression, setProgression] = useState<Progression | null>(null);
  const [summary, setSummary] = useState<{
    seconds: number;
    userTurns: number;
    userShare: number;
    streak: number;
    minutesToday: number;
    goalReached: boolean;
    /** Faux quand Cherif n'a pas parlé : rien n'est compté (ni minutes, ni série, ni bilan). */
    counted: boolean;
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
  const startRef = useRef<(opts: StartOptions) => Promise<boolean>>(
    async () => false,
  );
  const finishRef = useRef<() => void>(() => {});
  const autoFinishTimer = useRef<number | null>(null);
  // Mode éco : moteur côté téléphone, à la place de la conversation ElevenLabs.
  const ecoRef = useRef<EcoEngine | LiveEngine | null>(null);
  const [ecoStatus, setEcoStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [ecoMode, setEcoMode] = useState<EcoMode>("idle");
  const [interim, setInterim] = useState("");
  // Réplique du personnage en train de s'écrire (mode éco, flux).
  const [agentDraft, setAgentDraft] = useState<string | null>(null);
  // Temps de la dernière réplique en mode éco (pour repérer ce qui traîne : Claude ou la voix).
  const [timing, setTiming] = useState<EcoTiming | null>(null);
  // Avertissement passager (la séance continue), effacé tout seul.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 7000);
  }, []);

  type StartOptions = {
    params?: Partial<SessionParams>;
    context?: { resumeMessage: string };
    force?: ConnectionType;
  };

  const refreshRemote = useCallback(() => {
    fetch("/api/reglages")
      .then(async (res) =>
        res.ok ? ((await res.json()) as ReglagesState) : null,
      )
      .then((data) => {
        if (data) setRemote(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshRemote();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);
    }
  }, [refreshRemote]);

  const pushLine = useCallback((role: "user" | "agent", raw: string) => {
    const text = stripVoiceTags(raw);
    if (!text) return;
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
        if (vadStart.current != null)
          userTalkMs.current += now - vadStart.current;
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
        if (
          !everConnected.current &&
          attemptType.current === "webrtc" &&
          !fallbackTried.current
        ) {
          fallbackTried.current = true;
          setNotice(
            "La connexion audio a été coupée. Nouvel essai avec une autre méthode…",
          );
          void startRef.current({
            context: lastContext.current,
            force: "websocket",
          });
          return;
        }
        setError(humanizeError(details.message));
      } else {
        setNotice(
          "La discussion s'est coupée. Tu peux reprendre là où vous en étiez, ou terminer.",
        );
      }
    },
    onError: (message) => setError(humanizeError(message)),
    onMessage: ({ role, message }) => {
      if (
        role === "user" &&
        pendingCommand.current &&
        message.trim() === pendingCommand.current
      ) {
        pendingCommand.current = null;
        return;
      }
      if (role === "user") userTurns.current += 1;
      pushLine(role, message);
      if (
        role === "agent" &&
        liveRef.current?.kind === "test" &&
        /test (is|est) (finished|over|termin)|test is done|fin du test/i.test(
          message,
        )
      ) {
        if (autoFinishTimer.current)
          window.clearTimeout(autoFinishTimer.current);
        autoFinishTimer.current = window.setTimeout(
          () => finishRef.current(),
          6000,
        );
      }
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

  const {
    status: elStatus,
    isSpeaking: elSpeaking,
    startSession,
    endSession: endElSession,
    sendUserMessage,
  } = conversation;
  const isEco = (live?.engine ?? engine) !== "elevenlabs";
  const status = isEco ? ecoStatus : elStatus;
  const isSpeaking = isEco ? ecoMode === "speaking" : elSpeaking;
  const endSession = useCallback(() => {
    const eco = ecoRef.current;
    if (eco) {
      ecoRef.current = null;
      eco.end();
    } else {
      endElSession();
    }
  }, [endElSession]);
  const connected = status === "connected";
  const busy = preparing || status === "connecting";

  // Chrono de la séance, fin automatique du test de niveau.
  useEffect(() => {
    if (phase !== "live" || !connected) return;
    const id = setInterval(() => {
      if (connectAt.current == null) return;
      const secs = Math.floor((performance.now() - connectAt.current) / 1000);
      setElapsed(secs);
      if (liveRef.current?.kind === "test" && secs >= TEST_MAX_SECONDS)
        finishRef.current();
    }, 1000);
    return () => clearInterval(id);
  }, [phase, connected]);

  useEffect(() => {
    ecoRef.current?.setHandsFree(handsFree);
  }, [handsFree]);

  // Plafond du jour (dérivé, pas d'état). Le mode éco ne consomme pas de minutes.
  const capReached =
    !isEco &&
    Boolean(remote?.db) &&
    remote != null &&
    phase === "live" &&
    remote.todayMinutes * 60 + elapsed >= remote.cost.dailyCapMinutes * 60;

  // L'avatar respire au rythme de la voix.
  useEffect(() => {
    const orb = orbRef.current;
    if (!connected || !orb) return;
    let frame = 0;
    const tick = () => {
      const level = ecoRef.current
        ? ecoRef.current.getLevel()
        : isSpeaking
          ? conversation.getOutputVolume()
          : conversation.getInputVolume();
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
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) return true; // la route session donnera un message plus précis
      if (data.ok) {
        agentReady.current = true;
        return true;
      }
      const fix = await fetch("/api/elevenlabs/agent", { method: "POST" });
      const fixed = (await fix.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
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
      const base: SessionParams = liveRef.current ?? {
        personality,
        language,
        correction,
        speed,
        topic: { title: null, own: true },
        kind: "conversation",
      };
      const p: SessionParams = {
        ...base,
        ...params,
        engine: params?.engine ?? base.engine ?? engine,
      };
      liveRef.current = p;
      setLive(p);
      setError(null);
      if (!force) {
        setNotice(null);
        fallbackTried.current = false;
      }
      setPreparing(true);
      // Dans le geste d'appui : autorise le lecteur audio à démarrer tout seul ensuite (iPhone).
      if (p.engine !== "elevenlabs") unlockAudio();
      try {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          setError(
            "Le micro est refusé. Autorise le micro pour ce site dans les réglages du navigateur, puis réessaie.",
          );
          return false;
        }
        if (p.engine === "eco" || p.engine === "live") {
          restarting.current = Boolean(context);
          ending.current = false;
          setEcoStatus("connecting");
          const past = context
            ? transcriptRef.current.map((l) => ({ role: l.role, text: l.text }))
            : [];
          const body = {
            personality: p.personality.id,
            language: p.language,
            correction: p.correction,
            topic: p.topic.title,
            ownTopic: p.topic.own,
            memory: history.memoryFor(
              p.personality.id,
              p.personality.modeLabel,
            ),
            kind: p.kind,
            reviewWords: p.reviewWords,
            rematch: p.rematch ?? null,
            context: context ? { transcript: past } : undefined,
          };
          const callbacks: EcoCallbacks = {
            onConnect: () => {
              everConnected.current = true;
              setEcoStatus("connected");
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
              setEcoStatus("disconnected");
              setEcoMode("idle");
              setInterim("");
              setAgentDraft(null);
              setHolding(false);
              if (agentSpeakStart.current != null) {
                agentTalkMs.current +=
                  performance.now() - agentSpeakStart.current;
                agentSpeakStart.current = null;
              }
              if (ending.current || restarting.current) return;
              if (details.reason === "error")
                setError(details.message ?? "La discussion s'est coupée.");
            },
            onError: (message, options) => {
              if (options?.fatal === false) showToast(message);
              else setError(message);
            },
            onMessage: ({ role, message }) => {
              if (role === "user") userTurns.current += 1;
              pushLine(role, message);
              if (
                role === "agent" &&
                liveRef.current?.kind === "test" &&
                /test (is|est) (finished|over|termin)|test is done|fin du test/i.test(
                  message,
                )
              ) {
                if (autoFinishTimer.current)
                  window.clearTimeout(autoFinishTimer.current);
                autoFinishTimer.current = window.setTimeout(
                  () => finishRef.current(),
                  6000,
                );
              }
            },
            onModeChange: ({ mode }) => {
              setEcoMode(mode);
              if (mode !== "listening") setInterim("");
              const now = performance.now();
              if (mode === "speaking") {
                agentSpeakStart.current = now;
              } else if (agentSpeakStart.current != null) {
                agentTalkMs.current += now - agentSpeakStart.current;
                agentSpeakStart.current = null;
              }
            },
            onInterim: (text) => setInterim(text),
            onTiming: setTiming,
            onDraft: setAgentDraft,
          };
          const common = {
            body,
            language: p.language,
            rate: speedValue(p.speed),
            handsFree,
            history: past,
            firstMessage: context?.resumeMessage ?? null,
            callbacks,
          };
          let eng: EcoEngine | LiveEngine;
          if (p.engine === "live") {
            // Temps réel : oreille, Claude et voix tournent sur le PC de Cherif ; le téléphone envoie le micro en continu.
            eng = new LiveEngine(common);
          } else {
            // Voix ou oreille « Mon PC » : on vérifie le PC en 3 s, sinon repli immédiat plutôt qu'une attente à chaque phrase.
            let voiceForSession = voiceChoice;
            let earForSession = earChoice;
            const pcConfigured = Boolean(remote?.pc?.configured);
            const pingPc = () =>
              fetch("/api/pc/ping")
                .then((r) => r.json() as Promise<{ ok: boolean }>)
                .catch(() => ({ ok: false }));
            if (autoEco) {
              // Mode auto : la meilleure voix et la meilleure oreille gratuites du moment.
              const pcUp = pcConfigured ? (await pingPc()).ok : false;
              if (pcUp) {
                voiceForSession = "pc";
                earForSession = "pc";
              } else {
                voiceForSession = remote?.gemini?.configured
                  ? "gemini"
                  : p.language === "en" && kokoroLoaded()
                    ? "kokoro"
                    : "phone";
                earForSession = remote?.ears?.groq ? "groq" : "phone";
              }
              showToast(
                `Mode auto : voix ${VOICE_LABELS[voiceForSession]}, oreille ${EAR_CHOICES.find((e) => e.key === earForSession)?.label.toLowerCase() ?? earForSession}.`,
              );
            } else if (voiceChoice === "pc" || earChoice === "pc") {
              const ping = await pingPc();
              if (!ping.ok) {
                if (voiceChoice === "pc") voiceForSession = "eleven";
                if (earChoice === "pc") earForSession = "groq";
                showToast(
                  "Ton PC ne répond pas : voix ElevenLabs et oreille Groq pour cette séance.",
                );
              }
            }
            setVoiceFallback(null);
            let speaker = createSpeaker(voiceForSession, {
              language: p.language,
              personalityId: p.personality.id,
              onFallback: setVoiceFallback,
            });
            try {
              if (speaker.choice === "kokoro")
                setNotice(
                  "Chargement de la voix Kokoro (90 Mo la première fois)…",
                );
              await speaker.preload((prog) => {
                if (
                  prog.status === "progress" &&
                  typeof prog.progress === "number"
                )
                  setNotice(
                    `Chargement de la voix Kokoro : ${Math.round(prog.progress)} %`,
                  );
              });
              setNotice(null);
            } catch (error) {
              // Voix choisie indisponible : on continue avec ElevenLabs (ou le téléphone).
              console.error("Voix indisponible", error);
              speaker = createSpeaker("eleven", {
                language: p.language,
                personalityId: p.personality.id,
                onFallback: setVoiceFallback,
              });
              setNotice(
                `La voix ${VOICE_CHOICES.find((v) => v.key === voiceChoice)?.label ?? ""} n'a pas pu se charger : ElevenLabs prend le relais.`,
              );
            }
            eng = new EcoEngine({ ...common, speaker, ear: earForSession });
          }
          ecoRef.current = eng;
          const ok = await eng.start();
          if (!ok) {
            setEcoStatus("disconnected");
            if (ecoRef.current === eng) ecoRef.current = null;
            if (p.engine === "live" && !ending.current) {
              // PC éteint, en veille ou injoignable : on ne laisse pas Cherif sans séance.
              setError(null);
              const fallbackOk = await startRef.current({
                params: { ...params, engine: "eco" },
                context,
                force,
              });
              if (fallbackOk)
                showToast(
                  "Ton PC ne répond pas : la séance continue en mode éco. Rallume le PC, Docker et Tailscale pour retrouver le temps réel.",
                );
              return fallbackOk;
            }
            return false;
          }
          return true;
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
            memory: history.memoryFor(
              p.personality.id,
              p.personality.modeLabel,
            ),
            kind: p.kind,
            reviewWords: p.reviewWords,
            rematch: p.rematch ?? null,
            connectionType: type,
            context: context
              ? {
                  resumeMessage: context.resumeMessage,
                  transcript: transcriptRef.current.map((l) => ({
                    role: l.role,
                    text: l.text,
                  })),
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
          setError(
            data.error ??
              "Le serveur n'a pas répondu. Réessaie dans un instant.",
          );
          return false;
        }
        restarting.current = Boolean(context);
        ending.current = false;
        if (data.connectionType === "websocket" && data.signedUrl) {
          startSession({
            signedUrl: data.signedUrl,
            connectionType: "websocket",
            overrides: data.overrides,
          });
        } else if (data.conversationToken) {
          startSession({
            conversationToken: data.conversationToken,
            connectionType: "webrtc",
            overrides: data.overrides,
          });
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
    [
      personality,
      language,
      correction,
      speed,
      connectionType,
      startSession,
      ensureAgentConfigured,
      ensureFrenchVoices,
      history,
      engine,
      handsFree,
      pushLine,
      voiceChoice,
      earChoice,
      showToast,
      autoEco,
      remote,
    ],
  );

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  /** Lance une nouvelle séance (depuis le choix du sujet ou le bilan). */
  const launch = useCallback(
    (params: Partial<SessionParams>) => {
      liveRef.current = null;
      setPhase("live");
      setBilan(null);
      setSummary(null);
      setLevelResult(null);
      setSavedCost(null);
      setProgression(null);
      void start({ params });
    },
    [start],
  );

  /** Lance une séance, après un avertissement si le plafond du jour est atteint. */
  const begin = useCallback(
    (params: Partial<SessionParams>) => {
      if (
        remote &&
        remote.db &&
        (params.engine ?? engine) === "elevenlabs" &&
        remote.todayMinutes >= remote.cost.dailyCapMinutes
      ) {
        setCapPrompt(params);
        return;
      }
      launch(params);
    },
    [remote, launch, engine],
  );

  // Révision à la voix lancée depuis le carnet (/?start=revision).
  const revisionChecked = useRef(false);
  useEffect(() => {
    if (revisionChecked.current) return;
    revisionChecked.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("start") !== "revision") return;
    window.history.replaceState(null, "", "/");
    let words: ReviewWord[] = [];
    try {
      words = JSON.parse(
        sessionStorage.getItem(REVISION_STORAGE_KEY) ?? "[]",
      ) as ReviewWord[];
    } catch {
      words = [];
    }
    if (words.length === 0) return;
    const lang: Language = params.get("lang") === "fr" ? "fr" : "en";
    const prof = findPersonality("prof") ?? personality;
    const id = window.setTimeout(
      () =>
        launch({
          personality: prof,
          language: lang,
          correction: "legere",
          speed,
          topic: { title: null, own: false },
          kind: "revision",
          reviewWords: words,
        }),
      50,
    );
    return () => window.clearTimeout(id);
  }, [launch, personality, speed]);

  /** Change un réglage en pleine discussion : reconnexion et reprise. */
  const restart = useCallback(
    async (params: Partial<SessionParams>, resumeMessage: string) => {
      if (!connected) {
        liveRef.current = liveRef.current
          ? { ...liveRef.current, ...params }
          : null;
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
      const eco = ecoRef.current;
      if (eco && !eco.pushToTalk(next)) {
        // Le personnage prépare sa réponse : l'appui ne lance pas d'écoute, on le dit.
        if (next)
          showToast("Attends une seconde : le personnage prépare sa réponse.");
        return;
      }
      setHolding(next);
      navigator.vibrate?.(next ? 30 : 20);
    },
    [connected, showToast],
  );

  const repeat = useCallback(() => {
    if (!connected || !live) return;
    if (ecoRef.current) {
      ecoRef.current.repeatLast();
      return;
    }
    pendingCommand.current = REPEAT_COMMAND[live.language];
    sendUserMessage(REPEAT_COMMAND[live.language]);
  }, [connected, live, sendUserMessage]);

  const cycleSpeed = useCallback(() => {
    const current = liveRef.current?.speed ?? speed;
    const next =
      SPEED_ORDER[(SPEED_ORDER.indexOf(current) + 1) % SPEED_ORDER.length];
    setSavedSpeed(next);
    void restart(
      { speed: next },
      SPEED_RESUME_MESSAGES[liveRef.current?.language ?? language][next],
    );
  }, [speed, language, setSavedSpeed, restart]);

  const cycleCorrection = useCallback(() => {
    const current = liveRef.current?.correction ?? correction;
    const next =
      CORRECTION_ORDER[
        (CORRECTION_ORDER.indexOf(current) + 1) % CORRECTION_ORDER.length
      ];
    setSavedCorrection(next);
    void restart(
      { correction: next },
      RESUME_AFTER_CORRECTION[liveRef.current?.language ?? language],
    );
  }, [correction, language, setSavedCorrection, restart]);

  const resume = useCallback(() => {
    void start({
      context: {
        resumeMessage: RESUME_AFTER_DROP[liveRef.current?.language ?? language],
      },
    });
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
    const seconds =
      connectAt.current != null
        ? Math.round((performance.now() - connectAt.current) / 1000)
        : 0;
    // Si la détection de voix n'a rien remonté (cas WebRTC), on estime le
    // temps de parole à partir du nombre de mots prononcés.
    const wordsOf = (role: "user" | "agent") =>
      transcriptRef.current
        .filter((l) => l.role === role)
        .reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
    const userMs =
      userTalkMs.current > 0 ? userTalkMs.current : wordsOf("user") * 450;
    const agentMs =
      agentTalkMs.current > 0 ? agentTalkMs.current : wordsOf("agent") * 380;
    const total = userMs + agentMs;
    const userShare = total > 0 ? Math.round((userMs / total) * 100) : 0;
    // Avec une base, la série et les minutes font foi côté serveur (/api/sessions les renvoie) ;
    // la mémoire du téléphone ne sert qu'en mode téléphone seul.
    const hasDb = Boolean(remote?.db);
    // Une séance où Cherif n'a pas parlé ne compte nulle part.
    const counted = userTurns.current > 0;
    const recorded = hasDb
      ? {
          streak: remote?.streak ?? 0,
          minutesToday: remote?.todayAllMinutes ?? 0,
        }
      : counted && seconds >= 30
        ? progress.recordSession(seconds)
        : { streak: progress.streak, minutesToday: progress.minutesToday };
    if (p && counted && seconds >= 30) {
      history.add({
        date: new Date().toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
        }),
        personality: p.personality.id,
        language: p.language,
        topic:
          p.topic.title ??
          (p.language === "en"
            ? "a topic Cherif chose"
            : "un sujet choisi par Cherif"),
        seconds,
      });
    }
    setSummary({
      seconds,
      userTurns: userTurns.current,
      userShare,
      streak: recorded.streak,
      minutesToday: recorded.minutesToday,
      goalReached:
        recorded.minutesToday >= (remote?.goalMinutes ?? progress.goalMinutes),
      counted,
    });
    setPhase("bilan");

    const lines = transcriptRef.current;
    const plain = lines.map((l) => ({ role: l.role, text: l.text }));
    let result: BilanResult | null = null;
    let level: (LevelInfo & { error?: string }) | null = null;
    if (counted && lines.length >= 2 && p) {
      setBilanLoading(true);
      try {
        if (p.kind === "test") {
          const res = await fetch("/api/niveau", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: plain, language: p.language }),
          });
          const data = (await res.json().catch(() => ({}))) as LevelInfo & {
            error?: string;
          };
          level = res.ok
            ? data
            : {
                level: "",
                date: "",
                summary: "",
                strengths: [],
                toWorkOn: [],
                error: data.error ?? "L'évaluation a échoué.",
              };
          setLevelResult(level);
        } else {
          const res = await fetch("/api/bilan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: plain,
              durationSeconds: seconds,
              personality: p.personality.id,
              language: p.language,
            }),
          });
          if (res.ok) {
            result = (await res.json()) as BilanResult;
            setBilan(result);
          }
        }
      } catch {
        // pas de bilan : l'écran reste utile sans
      } finally {
        setBilanLoading(false);
      }
    }
    if (p && counted && seconds >= 20) {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: p.kind,
            engine: p.engine ?? "elevenlabs",
            language: p.language,
            personality: p.personality.id,
            topic: p.topic.title,
            seconds,
            userTurns: userTurns.current,
            userShare,
            transcript: plain,
            corrections: result?.corrections ?? [],
            errors: result?.errors ?? [],
            words: [
              ...(result?.words ?? []),
              ...(result?.upgrades ?? []).map((u) => ({
                en: u.better,
                fr: `${u.why ? `${u.why} ` : "Plus naturel "}(plutôt que « ${u.used} »)`,
                kind: "plus-naturel",
              })),
            ],
            encouragement: result?.encouragement ?? null,
            level: level?.level || null,
            observedLevel: result?.level ?? null,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          saved?: boolean;
          costFcfa?: number;
          progression?: Progression | null;
          streak?: number | null;
          todayAllMinutes?: number | null;
        };
        if (data.saved && typeof data.costFcfa === "number")
          setSavedCost(data.costFcfa);
        if (data.saved) setProgression(data.progression ?? null);
        if (data.saved && typeof data.streak === "number") {
          const streak = data.streak;
          const minutesToday = data.todayAllMinutes ?? recorded.minutesToday;
          setSummary((prev) =>
            prev
              ? {
                  ...prev,
                  streak,
                  minutesToday,
                  goalReached:
                    minutesToday >=
                    (remote?.goalMinutes ?? progress.goalMinutes),
                }
              : prev,
          );
        }
      } catch {
        // la séance reste dans l'historique du téléphone
      }
      refreshRemote();
    }
  }, [connected, status, endSession, progress, history, refreshRemote, remote]);

  useEffect(() => {
    finishRef.current = () => void finish();
  }, [finish]);

  const capSheet = capPrompt ? (
    <CapSheet
      todayMinutes={remote?.todayMinutes ?? 0}
      capMinutes={remote?.cost.dailyCapMinutes ?? 30}
      onContinue={() => {
        const params = capPrompt;
        setCapPrompt(null);
        launch(params);
      }}
      onCancel={() => setCapPrompt(null)}
    />
  ) : null;

  if (phase === "home") {
    const currentLevel = remote?.levels[language] ?? null;
    const needsTest = Boolean(remote?.db) && levelIsStale(currentLevel);
    return (
      <>
        {capSheet}
        <HomeScreen
          language={language}
          onLanguageChange={setSavedLanguage}
          personality={personality}
          onModeChange={setSavedMode}
          speed={speed}
          onSpeedChange={setSavedSpeed}
          talkMode={talkMode}
          onTalkModeChange={setSavedTalkMode}
          engine={engine}
          autoEco={autoEco}
          onQualityChange={(q) => {
            if (q === "max") setSavedEngine("elevenlabs");
            else {
              setSavedEngine("eco");
              setSavedAuto("1");
            }
          }}
          voiceChoice={voiceChoice}
          earChoice={earChoice}
          pcReady={Boolean(remote?.pc?.configured)}
          streak={remote?.db ? (remote.streak ?? 0) : progress.streak}
          minutesToday={
            remote?.db ? remote.todayAllMinutes : progress.minutesToday
          }
          goalMinutes={remote?.goalMinutes ?? progress.goalMinutes}
          onStart={() => setPhase("topic")}
          level={currentLevel?.level ?? null}
          needsTest={needsTest}
          onTest={() =>
            begin({
              personality: findPersonality("prof") ?? personality,
              language,
              correction: "aucune",
              speed,
              topic: { title: null, own: false },
              kind: "test",
            })
          }
          dueWords={remote?.dueByLanguage?.[language] ?? 0}
          quota={remote?.elevenQuota ?? null}
          dbReady={Boolean(remote?.db)}
        />
      </>
    );
  }

  if (phase === "topic") {
    return (
      <>
        {capSheet}
        <TopicScreen
          personality={personality}
          language={language}
          recent={history.recentTopics(personality.id, language)}
          onBack={() => setPhase("home")}
          onPick={(topic) =>
            begin({
              personality,
              language,
              correction,
              speed,
              topic,
              kind: "conversation",
            })
          }
        />
      </>
    );
  }

  if (phase === "bilan") {
    return (
      <>
        {capSheet}
        <BilanScreen
          summary={summary}
          goalMinutes={remote?.goalMinutes ?? progress.goalMinutes}
          bilan={bilan}
          loading={bilanLoading}
          personality={live?.personality ?? personality}
          language={live?.language ?? language}
          kind={live?.kind ?? "conversation"}
          levelResult={levelResult}
          transcript={transcript}
          costFcfa={savedCost}
          progression={progression}
          onAgain={() => setPhase("topic")}
          onHome={() => setPhase("home")}
          onRematch={(rematch) => {
            const base = live ?? {
              personality,
              language,
              correction,
              speed,
              topic: { title: null, own: false },
              kind: "conversation" as SessionKind,
            };
            begin({ ...base, kind: "conversation", rematch });
          }}
          onTeacher={(focus) => {
            const prof = findPersonality("prof") ?? personality;
            setSavedMode(prof.id);
            begin({
              personality: prof,
              language: live?.language ?? language,
              correction: "active",
              speed,
              topic: { title: focus, own: false },
              kind: "conversation",
            });
          }}
        />
      </>
    );
  }

  const p = live ?? {
    personality,
    language,
    correction,
    speed,
    topic: { title: null, own: true },
    kind: "conversation" as SessionKind,
  };
  const displayName =
    p.personality.id === "situation" ? "Ton partenaire" : p.personality.name;

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
              ? `${displayName} parle…${isEco && timing ? ` (Claude ${seconds(timing.claudeMs)}, voix ${seconds(timing.voiceMs)})` : ""}`
              : isEco && ecoMode === "thinking"
                ? `${displayName} réfléchit…`
                : isEco && interim
                  ? `« ${interim} »`
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
              {p.kind === "test"
                ? "Test de niveau"
                : p.kind === "revision"
                  ? "Révision de vocabulaire"
                  : p.personality.modeLabel}{" "}
              · {LANGUAGE_LABELS[p.language].toLowerCase()}
              {p.topic.title ? ` · ${p.topic.title}` : ""}
              {isEco
                ? (live?.engine ?? engine) === "live"
                  ? " · temps réel (mon PC)"
                  : ` · éco (${VOICE_CHOICES.find((v) => v.key === voiceChoice)?.label.split(" ")[0] ?? "voix"})`
                : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-muted tabular-nums">
            {formatClock(elapsed)}
          </span>
          <button
            type="button"
            onClick={finish}
            className="h-10 rounded-xl bg-danger/15 px-4 text-sm font-semibold text-danger"
          >
            Terminer
          </button>
        </div>
      </header>

      {toast && (
        <p
          role="status"
          className="rounded-xl border border-listening/40 bg-listening/10 px-3 py-2 text-center text-xs text-listening"
        >
          {toast}
        </p>
      )}
      {voiceFallback && (
        <p
          role="status"
          className="rounded-xl border border-listening/40 bg-listening/10 px-3 py-2 text-center text-xs text-listening"
        >
          Voix de secours : {VOICE_LABELS[voiceFallback.engine]} ·{" "}
          {voiceFallback.reason}.
        </p>
      )}
      {capReached && (
        <p className="rounded-xl border border-listening/40 bg-listening/10 px-3 py-2 text-center text-xs text-listening">
          Plafond du jour atteint ({remote?.cost.dailyCapMinutes ?? 30} min). Tu
          peux terminer quand tu veux.
        </p>
      )}
      <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div
          ref={orbRef}
          className={`grid place-items-center rounded-full p-5 transition-colors duration-300 ${
            connected
              ? isSpeaking
                ? "bg-speaking/15"
                : holding
                  ? "bg-listening/20"
                  : "bg-accent-soft"
              : "bg-accent-soft"
          }`}
        >
          <PersonaAvatar
            style={p.personality.avatar}
            size={showText ? 96 : 170}
            speaking={isSpeaking}
            label={displayName}
          />
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
                ? isEco
                  ? "Appuie sur le micro pour l'interrompre."
                  : "Parle par-dessus pour l'interrompre."
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
            <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => start({})}
                className="h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast"
              >
                Réessayer
              </button>
              <Link
                href="/reglages"
                className="h-11 rounded-xl border border-line bg-elevated px-5 text-sm font-semibold leading-[44px]"
              >
                Réglages
              </Link>
            </div>
          </div>
        )}
        {notice && !error && (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-xs text-sm text-muted">{notice}</p>
            {!busy && (
              <button
                type="button"
                onClick={resume}
                className="h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast"
              >
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
          {transcript.length === 0 && !agentDraft ? (
            <p className="text-center text-sm text-muted">
              Le texte de la conversation s&apos;affichera ici.
            </p>
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
          {agentDraft && (
            <p
              aria-live="polite"
              className="max-w-[85%] self-start rounded-2xl bg-accent-soft px-3 py-2 text-sm opacity-70"
            >
              {agentDraft}
            </p>
          )}
        </section>
      )}

      <section className="grid grid-cols-4 gap-2">
        <ToolButton label="Répète" onClick={repeat} disabled={!connected}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </ToolButton>
        <ToolButton
          label={SPEEDS.find((s) => s.key === p.speed)?.label ?? "Normal"}
          sublabel="Vitesse"
          onClick={cycleSpeed}
          disabled={busy}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </ToolButton>
        <ToolButton
          label={
            CORRECTION_LEVELS.find((c) => c.key === p.correction)?.short ??
            "Aucune"
          }
          sublabel="Correction"
          onClick={cycleCorrection}
          disabled={busy}
        >
          <path d="M20 6 9 17l-5-5" />
        </ToolButton>
        <ToolButton
          label={showText ? "Masquer" : "Texte"}
          onClick={() => setSavedShowText(showText ? "0" : "1")}
          pressed={showText}
        >
          <path d="M4 6h16M4 12h10M4 18h14" />
        </ToolButton>
      </section>

      {handsFree ? (
        <HandsFreeMic
          muted={muted}
          disabled={!connected}
          speaking={isSpeaking}
          onToggle={() => {
            const eco = ecoRef.current;
            if (eco?.isSpeaking) {
              eco.interrupt();
              navigator.vibrate?.(20);
              return;
            }
            eco?.setMuted(!muted);
            setMuted((m) => !m);
            navigator.vibrate?.(20);
          }}
        />
      ) : (
        <PushToTalkButton
          holding={holding}
          disabled={!connected}
          interrupting={isSpeaking}
          onHoldChange={onHoldChange}
        />
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
        {handsFree
          ? "Passer en appui pour parler (endroit bruyant)"
          : "Passer en mains libres"}
      </button>
    </main>
  );
}

function HandsFreeMic({
  muted,
  disabled,
  speaking,
  onToggle,
}: {
  muted: boolean;
  disabled: boolean;
  speaking: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!muted}
        aria-label={
          muted
            ? "Micro coupé, appuie pour le rouvrir"
            : "Micro ouvert, appuie pour le couper"
        }
        onClick={onToggle}
        className={`grid h-28 w-28 place-items-center rounded-full transition-all duration-150 disabled:opacity-50 ${
          muted
            ? "border-[3px] border-line bg-elevated text-muted"
            : speaking
              ? "border-[3px] border-speaking bg-elevated text-fg"
              : "bg-listening text-fg shadow-[0_0_0_14px_rgba(255,160,92,0.22)] animate-breathe"
        }`}
      >
        <svg
          aria-hidden="true"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          {muted && <path d="M4 4l16 16" />}
        </svg>
      </button>
      <span className="text-sm font-semibold text-muted">
        {muted ? "Micro coupé" : "Micro ouvert"}
      </span>
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
        pressed
          ? "border-accent bg-accent-soft text-accent"
          : "border-line bg-elevated"
      }`}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      {sublabel && <span className="text-[10px] text-muted">{sublabel}</span>}
      <span>{label}</span>
    </button>
  );
}

type PcStatus =
  | { state: "checking" }
  | { state: "online"; live: boolean; claudeOk: boolean | null }
  | { state: "offline"; error: string | null };

/**
 * Voyant du PC de Cherif sur l'accueil : un ping de 3 s au chargement, et un bouton
 * « Revérifier » qui force la question même si le PC vient d'échouer (disjoncteur serveur).
 * Évite d'ouvrir PowerShell pour savoir si Docker tourne.
 */
function usePcStatus(enabled: boolean) {
  const [status, setStatus] = useState<PcStatus>({ state: "checking" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/pc/ping${tick > 0 ? "?force=1" : ""}`)
      .then(
        (r) =>
          r.json() as Promise<{
            ok: boolean;
            live?: boolean;
            claudeOk?: boolean | null;
            error?: string | null;
          }>,
      )
      .then((ping) => {
        if (cancelled) return;
        setStatus(
          ping.ok
            ? {
                state: "online",
                live: Boolean(ping.live),
                claudeOk: ping.claudeOk ?? null,
              }
            : { state: "offline", error: ping.error ?? null },
        );
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "offline", error: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);
  const retry = useCallback(() => {
    setStatus({ state: "checking" });
    setTick((t) => t + 1);
  }, []);
  return { status, retry };
}

function PcIndicator({
  status,
  onRetry,
}: {
  status: PcStatus;
  onRetry: () => void;
}) {
  const online = status.state === "online";
  const ready = online && status.live;
  const dot =
    status.state === "checking"
      ? "bg-muted animate-pulse"
      : ready
        ? "bg-speaking"
        : online
          ? "bg-listening"
          : "bg-danger";
  const text =
    status.state === "checking"
      ? "PC : vérification…"
      : ready
        ? "PC en ligne : temps réel prêt."
        : online
          ? status.claudeOk === false
            ? "PC en ligne, mais la clé Anthropic est refusée : corrige ANTHROPIC_API_KEY dans pc-voix/.env puis relance Docker."
            : "PC en ligne, mais le temps réel n'est pas prêt (Whisper ou clé Claude) : regarde la carte « Voix de mon PC » dans Réglages."
          : "PC hors ligne : lance Docker Desktop, puis « docker compose up -d » dans pc-voix. En attendant, le temps réel repasse en mode éco.";
  return (
    <div
      className="flex items-start gap-2 rounded-2xl border border-line bg-elevated px-4 py-3 text-sm"
      role="status"
      aria-live="polite"
    >
      <span
        className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-full ${dot}`}
        aria-hidden
      />
      <span className="flex-1 text-muted">{text}</span>
      {status.state !== "checking" && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-2 flex min-h-11 shrink-0 items-center rounded-xl px-3 font-semibold text-accent"
        >
          Revérifier
        </button>
      )}
    </div>
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
  engine,
  autoEco,
  onQualityChange,
  voiceChoice,
  earChoice,
  pcReady,
  streak,
  minutesToday,
  goalMinutes,
  onStart,
  level,
  needsTest,
  onTest,
  dueWords,
  dbReady,
  quota,
}: {
  language: Language;
  onLanguageChange: (l: Language) => void;
  personality: Personality;
  onModeChange: (id: string) => void;
  speed: SpeedKey;
  onSpeedChange: (s: SpeedKey) => void;
  talkMode: TalkMode;
  onTalkModeChange: (m: TalkMode) => void;
  engine: Engine;
  /** Mode éco en choix automatique (voix et oreille choisies au début de la séance). */
  autoEco: boolean;
  onQualityChange: (q: "max" | "eco") => void;
  voiceChoice: VoiceChoice;
  earChoice: EarChoice;
  /** Le PC de Cherif est configuré (voix et oreille locales, mode temps réel). */
  pcReady: boolean;
  streak: number;
  minutesToday: number;
  goalMinutes: number;
  onStart: () => void;
  level: string | null;
  needsTest: boolean;
  onTest: () => void;
  dueWords: number;
  dbReady: boolean;
  /** Crédits ElevenLabs du mois (avertissement au-delà de 80 %). */
  quota: ElevenQuota | null;
}) {
  const today = useToday();
  const pc = usePcStatus(pcReady);
  const mounted = useMounted();
  const dateLabel = today
    ? today.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";
  const greeting = stripVoiceTags(personality.ownTopicMessages[language]);
  const pct = Math.min(100, Math.round((minutesToday / goalMinutes) * 100));
  const displayName =
    personality.id === "situation" ? personality.modeLabel : personality.name;

  if (!mounted) {
    // Les choix enregistrés (langue, personnage, micro, vitesse) ne sont pas encore lus :
    // un squelette plutôt que des sélecteurs par défaut qu'un appui rendrait caducs.
    return (
      <main
        className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]"
        aria-busy="true"
      >
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Salut Cherif !</h1>
        </header>
        {[72, 56, 96, 320, 56, 56].map((h, i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-line bg-elevated"
            style={{ height: h }}
          />
        ))}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted first-letter:uppercase">
            {dateLabel}
          </p>
          <h1 className="text-2xl font-bold">Salut Cherif !</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-listening/15 px-3 py-2 text-sm font-semibold text-listening">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
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
          <div
            className="h-2 rounded-full bg-accent transition-all"
            style={{ width: pct > 0 ? `${Math.max(4, pct)}%` : "0%" }}
          />
        </div>
      </section>

      {dbReady && (needsTest || dueWords > 0) && (
        <section className="flex flex-col gap-2">
          {needsTest && (
            <button
              type="button"
              onClick={onTest}
              className="flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-soft px-4 py-3 text-left"
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold">
                  {level
                    ? `Refaire le test de niveau (${LANGUAGE_LABELS[language].toLowerCase()})`
                    : `Test de niveau en ${LANGUAGE_LABELS[language].toLowerCase()}`}
                </span>
                <span className="text-xs text-muted">
                  {level
                    ? `Niveau actuel ${level}, à réévaluer ce mois-ci. 5 minutes avec Emma.`
                    : "5 minutes de discussion avec Emma pour situer ton niveau (A1 à C2)."}
                </span>
              </span>
              <span className="rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-accent-contrast">
                5 min
              </span>
            </button>
          )}
          {dueWords > 0 && (
            <Link
              href="/carnet"
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-elevated px-4 py-3"
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold">
                  {dueWords} mot{dueWords > 1 ? "s" : ""} à réviser ·{" "}
                  {LANGUAGE_LABELS[language].toLowerCase()}
                </span>
                <span className="text-xs text-muted">
                  Deux minutes dans le carnet, ou une révision à la voix avec
                  Emma.
                </span>
              </span>
              <span className="text-xl text-muted" aria-hidden>
                ›
              </span>
            </Link>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div
          className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-elevated p-1"
          role="radiogroup"
          aria-label="Langue"
        >
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
        <div className="relative -mx-4">
          {/* Fondu à droite : montre qu'on peut faire défiler (« Mise en situation » est au bout). */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-elevated to-transparent"
          />
          <div
            className="flex gap-2 overflow-x-auto px-4 py-1 pr-10"
            role="radiogroup"
            aria-label="Mode"
          >
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
                    selected
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-elevated text-muted"
                  }`}
                >
                  <PersonaAvatar
                    style={pers.avatar}
                    size={44}
                    label={pers.name}
                  />
                  <span>{pers.modeLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border border-line bg-elevated p-5 text-center">
        <PersonaAvatar
          style={personality.avatar}
          size={130}
          label={displayName}
        />
        <div>
          <p className="text-xl font-bold">{displayName}</p>
          <p className="text-sm text-muted">{personality.tagline}</p>
        </div>
        <p className="max-w-xs rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-snug">
          {greeting}
        </p>
      </section>

      {quota && (quota.exhausted || (quota.pct ?? 0) >= 80) && (
        <p
          role="status"
          className="rounded-2xl border border-listening/40 bg-listening/10 px-4 py-3 text-sm text-listening"
        >
          {quota.exhausted
            ? "Crédit ElevenLabs épuisé"
            : `Crédit ElevenLabs à ${quota.pct} %`}
          {quota.used != null && quota.limit != null
            ? ` (${quota.used.toLocaleString("fr-FR")} / ${quota.limit.toLocaleString("fr-FR")})`
            : ""}
          {formatReset(quota.resetAt)
            ? `, remise à zéro le ${formatReset(quota.resetAt)}`
            : ""}
          .{" "}
          {quota.exhausted
            ? "Les séances parlent avec une voix de secours (ton PC, Kokoro ou le téléphone)."
            : "Préfère le mode éco pour finir le mois."}
        </p>
      )}
      {pcReady && <PcIndicator status={pc.status} onRetry={pc.retry} />}
      <details className="rounded-2xl border border-line bg-elevated px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Micro et vitesse{" "}
          <span className="font-normal text-muted">
            ·{" "}
            {talkMode === "mains-libres" ? "mains libres" : "appui pour parler"}{" "}
            · {SPEEDS.find((s) => s.key === speed)?.label.toLowerCase()} ·{" "}
            {engine === "elevenlabs"
              ? "Max (ElevenLabs)"
              : engine === "live"
                ? "temps réel (mon PC)"
                : autoEco
                  ? "Économique (auto)"
                  : `Économique · ${VOICE_LABELS[voiceChoice]} / ${EAR_CHOICES.find((e) => e.key === earChoice)?.label ?? earChoice}`}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="px-1 text-xs font-semibold text-muted">Micro</span>
            <div
              className="grid grid-cols-2 gap-1.5 rounded-xl bg-bg p-1"
              role="radiogroup"
              aria-label="Façon de parler"
            >
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
                  className={`h-11 rounded-lg text-sm font-medium ${talkMode === m.key ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="px-1 text-xs font-semibold text-muted">
              Qualité
            </span>
            <div
              className="grid grid-cols-2 gap-1.5 rounded-xl bg-bg p-1"
              role="radiogroup"
              aria-label="Qualité"
            >
              {(
                [
                  { key: "max", label: "Max (ElevenLabs)" },
                  { key: "eco", label: "Économique (auto)" },
                ] as { key: "max" | "eco"; label: string }[]
              ).map((q) => {
                const selected =
                  q.key === "max"
                    ? engine === "elevenlabs"
                    : engine !== "elevenlabs";
                return (
                  <button
                    key={q.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onQualityChange(q.key)}
                    className={`h-11 rounded-lg text-sm font-medium ${selected ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
            <p className="px-1 text-xs text-muted">
              {engine === "elevenlabs"
                ? "Conversation en temps réel ElevenLabs : voix très naturelle et interruption fluide. Consomme tes minutes de conversation."
                : engine === "live"
                  ? "Temps réel sur ton PC (réglé dans Réglages avancés) : gratuit, le PC doit être allumé."
                  : autoEco
                    ? "L'app choisit au début de chaque séance la meilleure voix et la meilleure oreille gratuites : ton PC s'il est en ligne, sinon les autres. Zéro minute ElevenLabs."
                    : `Mode éco avec tes choix manuels : voix ${VOICE_LABELS[voiceChoice]}, oreille ${EAR_CHOICES.find((e) => e.key === earChoice)?.label.toLowerCase() ?? earChoice}.`}{" "}
              <Link href="/reglages/avance" className="underline">
                Réglages avancés
              </Link>
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="px-1 text-xs font-semibold text-muted">
              Vitesse
            </span>
            <div
              className="grid grid-cols-3 gap-1.5 rounded-xl bg-bg p-1"
              role="radiogroup"
              aria-label="Vitesse de la voix"
            >
              {SPEEDS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="radio"
                  aria-checked={speed === s.key}
                  onClick={() => onSpeedChange(s.key)}
                  className={`h-11 rounded-lg text-sm font-medium ${speed === s.key ? "bg-accent font-semibold text-accent-contrast" : "text-muted"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>

      <button
        type="button"
        onClick={onStart}
        className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-accent text-lg font-bold text-accent-contrast shadow-lg shadow-accent/30 transition active:scale-[0.98]"
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        Commencer
      </button>
      <TabBar
        badges={{
          "/carnet": dueWords > 0 ? String(dueWords) : undefined,
          "/suivi": level ?? undefined,
        }}
      />
    </main>
  );
}

function CapSheet({
  todayMinutes,
  capMinutes,
  onContinue,
  onCancel,
}: {
  todayMinutes: number;
  capMinutes: number;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cap-title"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-3xl border border-line bg-elevated p-5">
        <h2 id="cap-title" className="text-lg font-bold">
          Plafond du jour atteint
        </h2>
        <p className="text-sm text-muted">
          Tu as déjà parlé {todayMinutes} min aujourd&apos;hui, pour un plafond
          de {capMinutes} min. Continuer coûtera des minutes ElevenLabs en plus.
          Le plafond se règle dans Réglages.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="h-12 rounded-2xl bg-accent text-sm font-bold text-accent-contrast"
        >
          Continuer quand même
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-2xl border border-line text-sm font-semibold"
        >
          Arrêter pour aujourd&apos;hui
        </button>
      </div>
    </div>
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
      body: JSON.stringify({
        personality: personality.id,
        language,
        recent: recentKey ? recentKey.split("|") : [],
      }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          topics?: string[];
        };
        if (active) setTopics(Array.isArray(data.topics) ? data.topics : []);
      })
      .catch(() => {
        if (active) setTopics([]);
      });
    return () => {
      active = false;
    };
  }, [personality.id, language, recentKey]);

  const displayName =
    personality.id === "situation" ? personality.modeLabel : personality.name;
  const list =
    topics && topics.length > 0
      ? topics
      : topics
        ? randomList(personality.id, language)
        : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-elevated"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <PersonaAvatar
            style={personality.avatar}
            size={40}
            label={displayName}
          />
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
          ? [0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl border border-line bg-elevated"
              />
            ))
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
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          J&apos;ai mon propre sujet
        </button>
        <button
          type="button"
          onClick={() =>
            onPick({
              title: randomTopic(personality.id, language, recent),
              own: false,
            })
          }
          className="h-14 rounded-2xl border border-line bg-elevated text-base font-semibold"
        >
          Surprends-moi
        </button>
        <p className="text-center text-xs text-muted">
          « Mon propre sujet » : tu le dis à voix haute dès que {displayName} te
          le demande.
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
  goalMinutes,
  bilan,
  loading,
  personality,
  language,
  kind,
  levelResult,
  transcript,
  costFcfa,
  progression,
  onAgain,
  onHome,
  onRematch,
  onTeacher,
}: {
  summary: {
    seconds: number;
    userTurns: number;
    userShare: number;
    streak: number;
    minutesToday: number;
    goalReached: boolean;
    counted: boolean;
  } | null;
  bilan: BilanResult | null;
  loading: boolean;
  personality: Personality;
  language: Language;
  kind: SessionKind;
  levelResult: (LevelInfo & { error?: string }) | null;
  transcript: TranscriptLine[];
  costFcfa: number | null;
  goalMinutes: number;
  progression: Progression | null;
  onAgain: () => void;
  onHome: () => void;
  onRematch: (rematch: Rematch) => void;
  onTeacher: (focus: string) => void;
}) {
  const [showCorrected, setShowCorrected] = useState(false);
  const minutes = summary ? Math.round(summary.seconds / 60) : 0;
  const tooShort = !summary || summary.seconds < 30;
  const notCounted = Boolean(summary && !summary.counted);
  const displayName =
    personality.id === "situation" ? "Ton partenaire" : personality.name;
  const fallbackEncouragement =
    language === "en"
      ? tooShort
        ? "That was quick! Next time, let's chat a bit longer."
        : "Nice chat, Cherif! Same time tomorrow?"
      : tooShort
        ? "C'était rapide ! La prochaine fois, on discute un peu plus longtemps."
        : "Belle discussion, Cherif ! On remet ça demain ?";
  const encouragement = stripVoiceTags(
    bilan?.encouragement ?? fallbackEncouragement,
  );
  const showTeacher = Boolean(
    bilan?.suggestTeacher && bilan.teacherFocus && personality.id !== "prof",
  );
  // Phrases pour le shadowing : d'abord ses phrases corrigées, sinon des phrases du personnage.
  const shadowingPhrases = (() => {
    const own = (bilan?.corrections ?? [])
      .map((c) => usableForShadowing(c.corrected))
      .filter((t): t is string => t !== null);
    const theirs = transcript
      .filter((l) => l.role === "agent")
      .map((l) => usableForShadowing(l.text))
      .filter((t): t is string => t !== null);
    return [...new Set([...own, ...theirs])].slice(0, 5);
  })();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-speaking/15 text-speaking">
          <svg
            aria-hidden="true"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">
          {kind === "test"
            ? "Test terminé"
            : notCounted
              ? "Séance non comptée"
              : tooShort
                ? "Séance éclair"
                : "Bien joué, Cherif !"}
        </h1>
        <p className="text-sm text-muted">
          {notCounted
            ? "Tu n'as pas parlé : cette séance n'est pas comptée (ni minutes, ni série, ni bilan)."
            : summary?.goalReached
              ? `Objectif du jour atteint. Ta série est à ${summary.streak} jour${summary.streak > 1 ? "s" : ""}.`
              : summary
                ? `${summary.minutesToday} min aujourd'hui sur ${goalMinutes}. Série : ${summary.streak} jour${summary.streak > 1 ? "s" : ""}.`
                : ""}
        </p>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <Tile
          value={summary && summary.seconds < 60 ? "< 1" : String(minutes)}
          label={minutes > 1 ? "minutes" : "minute"}
        />
        <Tile
          value={String(summary?.userTurns ?? 0)}
          label="fois où tu as parlé"
        />
        <Tile
          value={`${summary?.userShare ?? 0} %`}
          label="du temps de parole à toi"
        />
      </section>

      {kind === "test" && (
        <section className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent-soft p-4">
          {loading ? (
            <p className="text-sm text-muted">Emma évalue ton niveau…</p>
          ) : levelResult?.error ? (
            <p className="text-sm text-danger">{levelResult.error}</p>
          ) : levelResult ? (
            <>
              <div className="flex items-center gap-3">
                <span className="rounded-2xl bg-accent px-4 py-2 font-mono text-3xl font-bold text-accent-contrast">
                  {levelResult.level}
                </span>
                <span className="text-sm font-semibold">
                  Ton niveau en {LANGUAGE_LABELS[language].toLowerCase()}
                </span>
              </div>
              {levelResult.summary && (
                <p className="text-sm">{levelResult.summary}</p>
              )}
              {levelResult.strengths.length > 0 && (
                <p className="text-xs text-muted">
                  <strong>Points forts :</strong>{" "}
                  {levelResult.strengths.join(" · ")}
                </p>
              )}
              {levelResult.toWorkOn.length > 0 && (
                <p className="text-xs text-muted">
                  <strong>À travailler :</strong>{" "}
                  {levelResult.toWorkOn.join(" · ")}
                </p>
              )}
              <p className="text-xs text-muted">
                Les personnages adaptent maintenant leur vocabulaire à ce
                niveau. Le test se refait tous les mois.
              </p>
            </>
          ) : null}
        </section>
      )}

      {kind !== "test" && !notCounted && (
        <section className="flex items-center gap-3 rounded-2xl border border-line bg-elevated p-3">
          <PersonaAvatar
            style={personality.avatar}
            size={56}
            label={displayName}
          />
          <p className="text-sm leading-snug">{encouragement}</p>
        </section>
      )}

      {kind !== "test" && (progression || bilan?.level) && (
        <section
          className={`flex flex-col gap-1 rounded-2xl border p-4 ${progression?.promoted ? "border-speaking/50 bg-speaking/10" : "border-line bg-elevated"}`}
        >
          {progression?.promoted ? (
            <>
              <p className="text-base font-bold">
                Tu passes au niveau {progression.promoted} en{" "}
                {language === "en" ? "anglais" : "français"} !
              </p>
              <p className="text-sm text-muted">
                Trois séances de suite au-dessus de{" "}
                {progression.current ?? "ton niveau de départ"} : les
                personnages montent d&apos;un cran dès la prochaine fois.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">
                Niveau observé aujourd&apos;hui :{" "}
                <strong>{progression?.observed ?? bilan?.level}</strong>
                {progression?.current ? (
                  <>
                    {" "}
                    · niveau enregistré : <strong>{progression.current}</strong>
                  </>
                ) : null}
              </p>
              {bilan?.levelWhy && (
                <p className="text-xs text-muted">{bilan.levelWhy}</p>
              )}
              {progression &&
                progression.streak > 0 &&
                progression.streak < progression.needed && (
                  <p className="text-xs text-muted">
                    Encore {progression.needed - progression.streak} séance
                    {progression.needed - progression.streak > 1
                      ? "s"
                      : ""}{" "}
                    comme celle-ci et tu montes d&apos;un niveau.
                  </p>
                )}
              {progression &&
                progression.streak === 0 &&
                progression.current && (
                  <p className="text-xs text-muted">
                    Trois séances de suite jugées au-dessus de{" "}
                    {progression.current} font monter ton niveau.
                  </p>
                )}
            </>
          )}
        </section>
      )}

      {showTeacher && bilan?.teacherFocus && (
        <section className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent-soft p-4">
          <p className="text-sm">
            {displayName} te conseille une petite séance avec Emma, la prof, sur{" "}
            <strong>{bilan.teacherFocus}</strong>.
          </p>
          <button
            type="button"
            onClick={() => onTeacher(bilan.teacherFocus!)}
            className="h-12 rounded-xl bg-accent text-sm font-bold text-accent-contrast"
          >
            Travailler ça avec Emma
          </button>
        </section>
      )}

      {loading ? (
        <section className="rounded-2xl border border-line bg-elevated p-4">
          <p className="text-sm text-muted">
            {displayName} relit la discussion…
          </p>
        </section>
      ) : (
        <>
          {bilan?.debate && (
            <section className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-elevated p-4">
              <div className="flex items-center gap-2">
                <span
                  className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent"
                  aria-hidden
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v18M5 7l7-4 7 4M3 13l2-6 2 6a2 2 0 0 1-4 0zM17 13l2-6 2 6a2 2 0 0 1-4 0zM8 21h8" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Verdict du juge</span>
                  <span className="text-xs text-muted">
                    {bilan.debate.winner === "cherif"
                      ? "Tu as gagné ce débat."
                      : bilan.debate.winner === "leo"
                        ? "Leo a gagné ce débat."
                        : "Match nul."}
                    {bilan.debate.side
                      ? ` Tu défendais le ${bilan.debate.side === "for" ? "pour" : "contre"}.`
                      : ""}
                  </span>
                </div>
              </div>
              {bilan.debate.why && (
                <p className="text-sm leading-snug">{bilan.debate.why}</p>
              )}
              {bilan.debate.bestArgument && (
                <div className="rounded-xl bg-bg px-3 py-2 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Ton meilleur argument
                  </span>
                  <p className="mt-1 leading-snug">
                    {bilan.debate.bestArgument}
                  </p>
                </div>
              )}
              {bilan.debate.improvements.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {bilan.debate.improvements.map((imp) => (
                    <li key={imp} className="flex gap-2">
                      <span className="text-accent" aria-hidden>
                        •
                      </span>
                      <span className="leading-snug">{imp}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() =>
                  onRematch({
                    side: bilan.debate?.side ?? null,
                    notes: [
                      ...(bilan.debate?.improvements ?? []),
                      ...bilan.errors.map((e) => `${e.wrong} → ${e.right}`),
                    ].slice(0, 6),
                  })
                }
                className="h-12 rounded-xl bg-accent text-sm font-bold text-accent-contrast"
              >
                Refaire le débat
              </button>
              <span className="text-center text-xs text-muted">
                Même sujet, mêmes camps. Le juge vérifiera si tu as corrigé ses
                remarques.
              </span>
            </section>
          )}
          {bilan && bilan.upgrades.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl border border-accent/30 bg-elevated p-4">
              <span className="text-sm font-semibold">
                Dire plus précisément
              </span>
              {bilan.upgrades.map((u) => (
                <div
                  key={u.used}
                  className="flex flex-col gap-1 rounded-xl bg-bg px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="text-muted">{u.used}</span>
                    <span className="text-muted" aria-hidden>
                      →
                    </span>
                    <span className="font-semibold text-accent">
                      {u.better}
                    </span>
                  </div>
                  {u.why && <span className="text-xs text-muted">{u.why}</span>}
                </div>
              ))}
            </section>
          )}
          {bilan && bilan.errors.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
              <span className="text-sm font-semibold">À retenir</span>
              {bilan.errors.map((e) => (
                <div
                  key={e.wrong}
                  className="flex flex-col gap-1 rounded-xl bg-bg px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="text-muted line-through">{e.wrong}</span>
                    <span className="font-semibold text-speaking">
                      {e.right}
                    </span>
                  </div>
                  {e.tip && <span className="text-xs text-muted">{e.tip}</span>}
                </div>
              ))}
            </section>
          )}
          {kind !== "test" && !notCounted && (
            <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Mots du jour</span>
                {bilan && bilan.words.length > 0 && (
                  <span className="text-xs text-muted">
                    {bilan.words.length} nouveaux
                  </span>
                )}
              </div>
              {bilan && bilan.words.length > 0 ? (
                bilan.words.map((w) => (
                  <div
                    key={w.en}
                    className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2"
                  >
                    <span className="font-semibold">{w.en}</span>
                    <span className="text-right text-sm text-muted">
                      {w.fr}
                    </span>
                  </div>
                ))
              ) : bilan && !bilan.available ? (
                <p className="text-sm text-muted">
                  Les mots du jour s&apos;activent avec la clé Anthropic (voir
                  Réglages).
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Pas assez de discussion pour relever des mots cette fois.
                </p>
              )}
              {(costFcfa != null || (bilan && bilan.words.length > 0)) && (
                <p className="pt-1 text-xs text-muted">
                  {bilan && bilan.words.length > 0
                    ? "Mots ajoutés au carnet. "
                    : ""}
                  {costFcfa != null
                    ? `Coût estimé de la séance : ≈ ${costFcfa} FCFA.`
                    : ""}
                </p>
              )}
            </section>
          )}

          {transcript.length > 0 && kind !== "test" && (
            <section className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated p-4">
              <button
                type="button"
                onClick={() => setShowCorrected((v) => !v)}
                aria-expanded={showCorrected}
                className="flex items-center justify-between text-left text-sm font-semibold"
              >
                <span>
                  Texte de la séance
                  {bilan && bilan.corrections.length > 0
                    ? ` · ${bilan.corrections.length} correction${bilan.corrections.length > 1 ? "s" : ""}`
                    : ""}
                </span>
                <span className="text-muted">
                  {showCorrected ? "Masquer" : "Voir"}
                </span>
              </button>
              {showCorrected && (
                <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                  {transcript.map((line, i) => {
                    const fix = bilan?.corrections.find((c) => c.index === i);
                    return (
                      <div
                        key={line.id}
                        className={`flex max-w-[92%] flex-col gap-1 rounded-2xl px-3 py-2 text-sm ${line.role === "user" ? "self-end bg-accent-soft" : "self-start bg-bg"}`}
                      >
                        <span className={fix ? "text-muted line-through" : ""}>
                          {line.text}
                        </span>
                        {fix && (
                          <span className="font-semibold text-speaking">
                            {fix.corrected}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {kind === "conversation" && !tooShort && shadowingPhrases.length > 0 && (
        <Link
          href="/prononciation?from=seance"
          onClick={() => {
            try {
              sessionStorage.setItem(
                "prof-langue:shadowing",
                JSON.stringify({ language, phrases: shadowingPhrases }),
              );
            } catch {
              // stockage indisponible : la page prendra ses propres phrases
            }
          }}
          className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-elevated px-4 py-3"
        >
          <span className="flex flex-col">
            <span className="text-sm font-semibold">
              Répéter {shadowingPhrases.length} phrase
              {shadowingPhrases.length > 1 ? "s" : ""} de la séance
            </span>
            <span className="text-xs text-muted">
              Prononciation notée mot par mot
            </span>
          </span>
          <span className="text-muted" aria-hidden>
            ›
          </span>
        </Link>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAgain}
          className="h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast"
        >
          Nouvelle séance
        </button>
        <button
          type="button"
          onClick={onHome}
          className="h-12 rounded-2xl border border-line bg-elevated text-sm font-semibold"
        >
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
  if (
    m.includes("livekit") ||
    m.includes("disconnected") ||
    m.includes("closed")
  ) {
    return "ElevenLabs a coupé la connexion. Le plus souvent, l'agent n'accepte pas encore les réglages de l'app : ouvre Réglages et vérifie qu'il est « Prêt ». Sinon, réessaie dans un instant.";
  }
  if (
    m.includes("network") ||
    m.includes("failed to fetch") ||
    m.includes("timeout")
  ) {
    return "La connexion est trop faible. Rapproche-toi du réseau et réessaie.";
  }
  return `Problème : ${message}`;
}
