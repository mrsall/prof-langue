"use client";

import { stripVoiceTags } from "@/lib/text";
import type { Language } from "@/config/personalities";
import type { TranscriptLine } from "@/lib/prompt";
import type { LiveSession } from "@/app/api/live/session/route";
import type { EcoCallbacks, EcoMode } from "@/lib/eco-engine";
import { startMicStream, type MicStream } from "@/lib/mic-stream";

/**
 * V5 : conversation en temps réel avec le PC de Cherif. Le téléphone envoie le
 * micro en continu par WebSocket ; le PC détecte tout seul la fin de la phrase
 * (détection de voix), transcrit (Whisper), fait répondre Claude en flux et
 * renvoie la voix (Chatterbox) phrase par phrase, jouée sans trou. Si Cherif
 * parle pendant que le personnage parle, le PC le coupe (« barge-in »).
 * Même interface que EcoEngine pour l'écran de séance.
 */
export type LiveOptions = {
  body: Record<string, unknown>;
  language: Language;
  rate: number;
  handsFree: boolean;
  /**
   * Mains libres : laisser le PC écouter pendant que le personnage parle, pour le couper à la voix.
   * Faux par défaut (haut-parleur du téléphone : le micro entend le personnage) : le micro ne part pas
   * pendant la réponse, et Cherif coupe en appuyant sur le micro. Vrai conseillé avec des écouteurs.
   */
  voiceBargeIn?: boolean;
  history?: TranscriptLine[];
  firstMessage?: string | null;
  callbacks: EcoCallbacks;
};

/** Réserve d'audio avant de lancer la lecture d'une réplique (voir `maybeStartPlayback`). */
const RESERVE_CHUNKS = 2;
const WAIT_FAST_MS = 2500;
const WAIT_SLOW_MS = 12000;
/** Durée typique d'une réplique entière (1 à 3 phrases) : sert à dimensionner la réserve quand le RTF dépasse 1. */
const REPLY_ESTIMATE_S = 20;
/** Marge ajoutée à la réserve (réseau, décodage). */
const RESERVE_MARGIN_S = 0.6;
/** Sans nouveau son pendant ce temps au milieu d'une réplique, on rend la main (PC muet, réseau coupé). */
const GAP_GIVE_UP_MS = 15000;

type ServerEvent =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "user"; text: string }
  | { type: "delta"; text: string }
  | { type: "speak"; text: string; seq: number }
  | { type: "agent"; text: string }
  | { type: "interrupt" }
  | { type: "timing"; claudeMs: number | null; voiceMs: number; seq?: number; audioMs?: number; rtf?: number | null }
  | { type: "playback"; playing: boolean }
  | { type: "error"; message: string; fatal?: boolean }
  | { type: "end" };

export class LiveEngine {
  private ws: WebSocket | null = null;
  private mic: MicStream | null = null;
  private audio: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private nextStart = 0;
  private pendingSpeak: { text: string; seq: number } | null = null;
  private mode: EcoMode = "idle";
  private muted = false;
  private holding = false;
  private handsFree: boolean;
  private ended = false;
  private level = 0;
  private draft = "";
  private lastAgentText: string | null = null;
  private history: TranscriptLine[];
  private rate: number;
  private generation = 0;
  /** Nombre de répliques échangées : distingue une coupure immédiate d'une coupure en cours de séance. */
  private exchanges = 0;
  private voiceBargeIn: boolean;
  /** Vitesse de fabrication mesurée par le PC : temps de fabrication / durée de l'audio (moyenne glissante). */
  private rtf: number | null = null;
  // ---- réplique en cours : réserve avant de parler, pas de bascule en « écoute » entre deux morceaux
  private replyActive = false;
  private agentDone = true;
  private playbackStarted = false;
  private pendingBuffers: AudioBuffer[] = [];
  private firstChunkAt = 0;
  private startTimer: number | null = null;
  private gapTimer: number | null = null;
  private playingReported = false;

  constructor(private readonly options: LiveOptions) {
    this.history = [...(options.history ?? [])];
    this.handsFree = options.handsFree;
    this.rate = options.rate;
    this.voiceBargeIn = Boolean(options.voiceBargeIn);
  }

  /** Mains libres : couper le personnage à la voix (oui) ou seulement en appuyant sur le micro (non). */
  setVoiceBargeIn(enabled: boolean) {
    this.voiceBargeIn = enabled;
  }

  /** Une réponse est en cours (Claude écrit, voix en fabrication ou en lecture). */
  get agentBusy() {
    return this.replyActive;
  }

  readonly usesPhoneRecognition = false;

  get currentMode() {
    return this.mode;
  }

  get isSpeaking() {
    return this.mode === "speaking";
  }

  getLevel() {
    if (this.mode === "speaking")
      return 0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 180));
    if (this.mode === "listening") return this.level;
    return 0;
  }

  async start(): Promise<boolean> {
    const cb = this.options.callbacks;
    let session: LiveSession;
    try {
      const res = await fetch("/api/live/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.options.body),
      });
      const data = (await res.json().catch(() => ({}))) as LiveSession & {
        error?: string;
      };
      if (!res.ok || !data.url) {
        cb.onError(data.error ?? "Le mode temps réel n'est pas disponible.", {
          fatal: true,
        });
        return false;
      }
      session = data;
    } catch {
      cb.onError("Pas de connexion. Vérifie ton réseau.", { fatal: true });
      return false;
    }
    if (this.ended) return false;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) {
      cb.onError("Ce navigateur ne sait pas jouer le son en temps réel.", {
        fatal: true,
      });
      return false;
    }
    this.audio = new Ctx();
    if (this.audio.state === "suspended")
      await this.audio.resume().catch(() => undefined);

    const opened = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(session.url);
      } catch {
        return done(false);
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) {
          cb.onError(
            "Le PC ne répond pas (éteint, ou tunnel Tailscale arrêté).",
            { fatal: true },
          );
          ws.close();
          done(false);
        }
      }, 8000);
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "start",
            ticket: session.ticket,
            prompt: session.prompt,
            firstMessage:
              this.options.firstMessage?.trim() || session.firstMessage,
            language: session.language,
            voice: session.voice,
            history: this.history.slice(-40),
          }),
        );
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          const msg = JSON.parse(event.data) as ServerEvent;
          if (msg.type === "ready" && !settled) {
            clearTimeout(timer);
            done(true);
            return;
          }
          if (msg.type === "error" && !settled) {
            clearTimeout(timer);
            cb.onError(msg.message, { fatal: true });
            done(false);
            return;
          }
          this.handleEvent(msg);
        } else {
          void this.handleAudio(event.data as ArrayBuffer);
        }
      };
      ws.onerror = () => {
        if (!settled) {
          clearTimeout(timer);
          cb.onError(
            "Impossible de joindre le PC. Vérifie que Docker et Tailscale tournent.",
            { fatal: true },
          );
          done(false);
        }
      };
      ws.onclose = () => {
        if (!settled) {
          clearTimeout(timer);
          done(false);
          return;
        }
        if (!this.ended) {
          this.ended = true;
          this.teardown();
          cb.onDisconnect({
            reason: "error",
            message:
              this.exchanges === 0
                ? "Le PC a coupé la connexion tout de suite : regarde ses journaux (docker compose logs --tail 100) ou repasse en mode éco sur l'accueil."
                : "La connexion avec le PC s'est coupée (PC en veille, Tailscale ou réseau). Reprends, ou repasse en mode éco sur l'accueil.",
          });
        }
      };
    });
    if (!opened || this.ended) return false;
    try {
      this.mic = await startMicStream(
        (pcm) => {
          if (this.ended || !this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
          if (this.muted || (!this.handsFree && !this.holding)) return;
          // Haut-parleur : le micro entend le personnage. Sans « couper à la voix », rien ne part pendant la réponse.
          if (this.handsFree && !this.voiceBargeIn && this.replyActive) return;
          this.ws.send(pcm.buffer);
        },
        (level) => (this.level = level),
        // Même AudioContext que la lecture : l'annulation d'écho du navigateur reconnaît mieux le son joué.
        this.audio ?? undefined,
      );
    } catch (error) {
      cb.onError(
        error instanceof Error ? error.message : "Micro indisponible.",
        { fatal: true },
      );
      this.ws?.close();
      return false;
    }
    cb.onConnect();
    this.setMode("listening");
    return true;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.mode === "listening" || this.mode === "idle")
      this.setMode(muted ? "idle" : "listening");
  }

  setHandsFree(handsFree: boolean) {
    this.handsFree = handsFree;
  }

  /** Appui pour parler : les trames partent pendant l'appui ; au relâchement, le PC termine la phrase tout de suite. */
  pushToTalk(holding: boolean): boolean {
    if (this.ended) return false;
    this.holding = holding;
    if (holding) {
      this.muted = false;
      if (this.mode === "speaking") this.interrupt();
      else this.setMode("listening");
    } else {
      this.send({ type: "flush" });
    }
    return true;
  }

  /** Cherif coupe la parole : on arrête le son ici et on prévient le PC. */
  interrupt() {
    this.stopPlayback();
    this.endReply();
    this.send({ type: "interrupt" });
    this.setMode(this.muted ? "idle" : "listening");
  }

  repeatLast() {
    if (!this.lastAgentText || this.ended) return;
    this.stopPlayback();
    this.endReply();
    this.send({ type: "repeat" });
  }

  /** Cherif écrit au lieu de parler : le PC traite le texte comme une phrase entendue. */
  sendText(text: string): boolean {
    const clean = text.trim();
    if (!clean || this.ended || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.stopPlayback();
    this.endReply();
    this.send({ type: "text", text: clean });
    return true;
  }

  setRate(rate: number) {
    this.rate = rate;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.send({ type: "end" });
    this.teardown();
    this.setMode("idle");
    this.options.callbacks.onDisconnect({ reason: "user" });
  }

  // ---- interne ----

  private send(message: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(message));
  }

  private setMode(mode: EcoMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.options.callbacks.onModeChange({ mode });
  }

  private teardown() {
    this.stopPlayback();
    this.mic?.stop();
    this.mic = null;
    try {
      this.ws?.close();
    } catch {
      // déjà fermé
    }
    this.ws = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }

  private stopPlayback() {
    this.generation += 1;
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        // déjà arrêté
      }
    }
    this.sources = [];
    this.nextStart = 0;
    this.pendingSpeak = null;
    this.pendingBuffers = [];
    this.playbackStarted = false;
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    this.reportPlayback(false);
  }

  // ---- réplique : réserve avant de parler, puis lecture continue jusqu'à la fin

  private beginReply() {
    this.replyActive = true;
    this.agentDone = false;
    this.playbackStarted = false;
    this.pendingBuffers = [];
    this.firstChunkAt = 0;
  }

  private endReply() {
    this.replyActive = false;
    this.agentDone = true;
    this.pendingBuffers = [];
    this.playbackStarted = false;
    this.firstChunkAt = 0;
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    this.reportPlayback(false);
  }

  /** Dit au PC ce que le téléphone joue vraiment (plus fiable que son estimation). */
  private reportPlayback(playing: boolean) {
    if (this.playingReported === playing) return;
    this.playingReported = playing;
    this.send({ type: "playback", playing });
  }

  private reserveSeconds() {
    return this.pendingBuffers.reduce((n, b) => n + b.duration, 0);
  }

  /**
   * Première lecture d'une réplique : on attend une réserve d'audio pour ne jamais commencer une phrase
   * qu'on devrait interrompre en attendant la suivante. Le PC envoie des morceaux de durée semblable :
   * le suivant se fabrique pendant que le précédent se lit, et le déficit par morceau vaut (RTF − 1) × sa
   * durée. La réserve nécessaire est donc (RTF − 1) × durée estimée de la réplique + une marge :
   * à RTF 1,02 moins d'une seconde (la première phrase suffit), à RTF 1,7 toute la réponse.
   * RTF inconnu (début de séance) : 2 morceaux ou la fin de la réponse. Pendant l'attente, le
   * personnage « réfléchit ».
   */
  private maybeStartPlayback() {
    if (this.playbackStarted || this.pendingBuffers.length === 0) return;
    const waited = this.firstChunkAt ? performance.now() - this.firstChunkAt : 0;
    const need =
      this.rtf == null
        ? null
        : Math.max(0, this.rtf - 1) * REPLY_ESTIMATE_S + RESERVE_MARGIN_S;
    const slow = need == null || need > 6;
    const ready =
      this.agentDone ||
      (need != null && this.reserveSeconds() >= need) ||
      (need == null && this.pendingBuffers.length >= RESERVE_CHUNKS) ||
      waited >= (slow ? WAIT_SLOW_MS : WAIT_FAST_MS);
    if (!ready) {
      if (!this.startTimer) {
        const delay = Math.max(50, (slow ? WAIT_SLOW_MS : WAIT_FAST_MS) - waited);
        this.startTimer = window.setTimeout(() => {
          this.startTimer = null;
          this.maybeStartPlayback();
        }, delay);
      }
      return;
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.playbackStarted = true;
    for (const buffer of this.pendingBuffers.splice(0)) this.schedule(buffer);
  }

  private schedule(buffer: AudioBuffer) {
    const ctx = this.audio;
    if (!ctx || this.ended) return;
    const generation = this.generation;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.sources.push(source);
    this.setMode("speaking");
    this.reportPlayback(true);
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
      if (generation !== this.generation || this.ended) return;
      if (this.sources.length === 0) {
        this.reportPlayback(false);
        this.maybeFinishReply();
      }
    };
  }

  /** Tout est joué et la réponse est finie : on rend la main. Entre deux morceaux, on reste « en train de parler ». */
  private maybeFinishReply() {
    if (this.sources.length > 0 || this.pendingBuffers.length > 0) return;
    if (!this.agentDone) {
      // Trou au milieu de la réplique : la suite arrive. Si rien ne vient, on finit par rendre la main.
      if (!this.gapTimer) {
        this.gapTimer = window.setTimeout(() => {
          this.gapTimer = null;
          if (this.sources.length === 0 && this.pendingBuffers.length === 0) {
            this.endReply();
            if (this.mode === "speaking") this.setMode(this.muted ? "idle" : "listening");
          }
        }, GAP_GIVE_UP_MS);
      }
      return;
    }
    if (!this.playbackStarted && this.replyActive) return;
    this.endReply();
    if (this.mode === "speaking" || this.mode === "thinking")
      this.setMode(this.muted ? "idle" : "listening");
  }

  private handleEvent(msg: ServerEvent) {
    const cb = this.options.callbacks;
    switch (msg.type) {
      case "partial":
        cb.onInterim?.(msg.text);
        break;
      case "user":
        cb.onInterim?.("");
        this.history.push({ role: "user", text: msg.text });
        cb.onMessage({ role: "user", message: msg.text });
        this.draft = "";
        this.beginReply();
        this.setMode("thinking");
        break;
      case "delta":
        this.draft += msg.text;
        cb.onDraft?.(stripVoiceTags(this.draft));
        break;
      case "speak":
        this.pendingSpeak = { text: msg.text, seq: msg.seq };
        break;
      case "agent":
        this.exchanges += 1;
        cb.onDraft?.(null);
        this.draft = "";
        this.lastAgentText = msg.text;
        this.history.push({ role: "agent", text: msg.text });
        cb.onMessage({ role: "agent", message: msg.text });
        // Fin de la réponse : tout ce qui est en réserve part maintenant.
        this.agentDone = true;
        this.maybeStartPlayback();
        this.maybeFinishReply();
        break;
      case "interrupt":
        this.stopPlayback();
        this.endReply();
        cb.onDraft?.(null);
        this.setMode(this.muted ? "idle" : "listening");
        break;
      case "timing":
        // Étape 0 : RTF mesuré par le PC (fabrication / durée), moyenne glissante pour décider de la réserve.
        if (typeof msg.rtf === "number" && msg.rtf > 0)
          this.rtf = this.rtf == null ? msg.rtf : this.rtf * 0.6 + msg.rtf * 0.4;
        if (msg.claudeMs != null)
          cb.onTiming?.({ claudeMs: msg.claudeMs, voiceMs: msg.voiceMs });
        break;
      case "error":
        cb.onError(msg.message, { fatal: Boolean(msg.fatal) });
        if (msg.fatal) this.end();
        break;
      case "end":
        this.end();
        break;
      default:
        break;
    }
  }

  /** Un morceau de voix (WAV) : décodé, mis en réserve ou calé juste après le précédent, sans trou. */
  private async handleAudio(data: ArrayBuffer) {
    const ctx = this.audio;
    if (!ctx || this.ended) return;
    const generation = this.generation;
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(data.slice(0));
    } catch {
      return;
    }
    if (generation !== this.generation || this.ended) return;
    if (!this.replyActive) {
      // Première réplique de la séance (pas de « user » avant) ou « Répète ».
      this.beginReply();
    }
    if (this.playbackStarted) {
      this.schedule(buffer);
      return;
    }
    if (this.pendingBuffers.length === 0) {
      this.firstChunkAt = performance.now();
      this.setMode("thinking");
    }
    this.pendingBuffers.push(buffer);
    this.maybeStartPlayback();
  }
}
