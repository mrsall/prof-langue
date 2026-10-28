"use client";

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
  history?: TranscriptLine[];
  firstMessage?: string | null;
  callbacks: EcoCallbacks;
};

type ServerEvent =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "user"; text: string }
  | { type: "delta"; text: string }
  | { type: "speak"; text: string; seq: number }
  | { type: "agent"; text: string }
  | { type: "interrupt" }
  | { type: "timing"; claudeMs: number; voiceMs: number }
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

  constructor(private readonly options: LiveOptions) {
    this.history = [...(options.history ?? [])];
    this.handsFree = options.handsFree;
    this.rate = options.rate;
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
      }, 12000);
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
            message: "La connexion avec le PC s'est coupée.",
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
          this.ws.send(pcm.buffer);
        },
        (level) => (this.level = level),
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
    this.send({ type: "interrupt" });
    this.setMode(this.muted ? "idle" : "listening");
  }

  repeatLast() {
    if (!this.lastAgentText || this.ended) return;
    this.send({ type: "repeat" });
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
        this.setMode("thinking");
        break;
      case "delta":
        this.draft += msg.text;
        cb.onDraft?.(
          this.draft
            .replace(/<\/?voice[^>]*>/gi, "")
            .replace(/\s+/g, " ")
            .trim(),
        );
        break;
      case "speak":
        this.pendingSpeak = { text: msg.text, seq: msg.seq };
        break;
      case "agent":
        cb.onDraft?.(null);
        this.draft = "";
        this.lastAgentText = msg.text;
        this.history.push({ role: "agent", text: msg.text });
        cb.onMessage({ role: "agent", message: msg.text });
        break;
      case "interrupt":
        this.stopPlayback();
        cb.onDraft?.(null);
        this.setMode(this.muted ? "idle" : "listening");
        break;
      case "timing":
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

  /** Un morceau de voix (WAV) : décodé puis calé juste après le précédent, sans trou. */
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
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.sources.push(source);
    this.setMode("speaking");
    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
      if (
        this.sources.length === 0 &&
        generation === this.generation &&
        !this.ended &&
        this.mode === "speaking"
      ) {
        this.setMode(this.muted ? "idle" : "listening");
      }
    };
  }
}
