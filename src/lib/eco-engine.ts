"use client";

import type { Language } from "@/config/personalities";
import type { TranscriptLine } from "@/lib/prompt";
import { startWavRecorder, type WavRecorder } from "@/lib/recorder";
import { LOCALES, recognizeOnce, speechRecognitionAvailable, type RecognizeHandle, type SpeakHandle } from "@/lib/speech";
import type { Speaker } from "@/lib/voice-engine";

/**
 * Mode éco : la conversation sans ElevenLabs Agents.
 *  - oreille : reconnaissance vocale du téléphone (ou Scribe en secours),
 *  - cerveau : Claude via /api/eco/reply (mêmes consignes que la séance normale),
 *  - voix : synthèse vocale du téléphone.
 * Zéro minute ElevenLabs. Moins naturel, mais gratuit.
 */

export type EcoMode = "speaking" | "listening" | "thinking" | "idle";

export type EcoCallbacks = {
  onConnect: () => void;
  onDisconnect: (details: { reason: "user" | "error"; message?: string }) => void;
  /** `fatal` : la séance ne peut pas continuer (sinon simple avertissement, la séance continue). */
  onError: (message: string, options?: { fatal?: boolean }) => void;
  onMessage: (message: { role: "user" | "agent"; message: string }) => void;
  onModeChange: (details: { mode: EcoMode }) => void;
  onInterim?: (text: string) => void;
};

export type EcoOptions = {
  /** Corps envoyé à /api/eco/reply (personnalité, langue, sujet…), sans le transcript. */
  body: Record<string, unknown>;
  language: Language;
  /** Qui lit les répliques (ElevenLabs, Kokoro ou le téléphone). */
  speaker: Speaker;
  rate: number;
  handsFree: boolean;
  /** Historique déjà échangé (reprise après changement de réglage). */
  history?: TranscriptLine[];
  /** Première réplique imposée (reprise) ; sinon le serveur la choisit. */
  firstMessage?: string | null;
  callbacks: EcoCallbacks;
};

// Quand c'est le serveur qui a flanché, on le dit : ce n'est jamais la faute de Cherif.
const RETRY_LINES: Record<Language, string> = {
  en: "Sorry, I had a small connection hiccup on my side. Can you say that again?",
  fr: "Pardon, j'ai eu un petit souci de connexion de mon côté. Tu peux redire ta phrase ?",
};

const SILENCE_MS = 1300;
const MAX_UTTERANCE_MS = 45000;

export class EcoEngine {
  private history: TranscriptLine[];
  private rate: number;
  private handsFree: boolean;
  private muted = false;
  private ended = false;
  private mode: EcoMode = "idle";
  private speaking: SpeakHandle | null = null;
  private recognizing: RecognizeHandle | null = null;
  private recorder: WavRecorder | null = null;
  private recorderStop: (() => void) | null = null;
  private lastAgentText: string | null = null;
  private level = 0;
  private listenToken = 0;
  readonly usesPhoneRecognition: boolean;

  constructor(private readonly options: EcoOptions) {
    this.history = [...(options.history ?? [])];
    this.rate = options.rate;
    this.handsFree = options.handsFree;
    this.usesPhoneRecognition = speechRecognitionAvailable();
  }

  get currentMode() {
    return this.mode;
  }

  get isSpeaking() {
    return this.mode === "speaking";
  }

  /** Niveau sonore approximatif pour animer l'avatar (0 à 1). */
  getLevel() {
    if (this.mode === "speaking") return 0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 180));
    if (this.mode === "listening") return this.usesPhoneRecognition ? 0.25 + 0.1 * Math.abs(Math.sin(performance.now() / 400)) : this.level;
    return 0;
  }

  async start() {
    let first = this.options.firstMessage?.trim() || null;
    if (!first) {
      const reply = await this.ask([]);
      if (reply === null) return false;
      first = reply;
    }
    if (this.ended) return false;
    this.options.callbacks.onConnect();
    void this.say(first);
    return true;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.cancelListening();
      if (this.mode === "listening") this.setMode("idle");
    } else if (this.handsFree && this.mode === "idle" && !this.ended) {
      void this.listen();
    }
  }

  setHandsFree(handsFree: boolean) {
    this.handsFree = handsFree;
  }

  /** Appui pour parler : `true` au début de l'appui, `false` au relâchement. */
  pushToTalk(holding: boolean) {
    if (holding) {
      if (this.mode === "speaking") this.speaking?.cancel();
      this.muted = false;
      void this.listen(true);
    } else {
      this.finishListening();
    }
  }

  /** Cherif coupe la parole : on se tait et on écoute. */
  interrupt() {
    if (this.mode !== "speaking") return;
    this.speaking?.cancel();
    this.speaking = null;
    this.setMode("idle");
    if (!this.muted) void this.listen();
  }

  repeatLast() {
    if (!this.lastAgentText || this.ended) return;
    this.cancelListening();
    void this.say(this.lastAgentText, Math.min(this.rate, 0.9));
  }

  setRate(rate: number) {
    this.rate = rate;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.speaking?.cancel();
    this.cancelListening();
    this.setMode("idle");
    this.options.callbacks.onDisconnect({ reason: "user" });
  }

  // ---- interne ----

  private setMode(mode: EcoMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.options.callbacks.onModeChange({ mode });
  }

  private async say(text: string, rate = this.rate) {
    if (this.ended) return;
    this.cancelListening();
    this.lastAgentText = text;
    this.history.push({ role: "agent", text });
    // Les balises <voice> servent à la voix, pas à l'affichage.
    this.options.callbacks.onMessage({ role: "agent", message: text.replace(/<\/?voice[^>]*>/gi, "").replace(/\s+/g, " ").trim() });
    this.setMode("speaking");
    const handle = this.options.speaker.speak(text, rate);
    this.speaking = handle;
    try {
      await handle.done;
    } catch (error) {
      this.options.callbacks.onError(error instanceof Error ? error.message : "Lecture impossible.", { fatal: false });
    }
    if (this.speaking !== handle || this.ended) return;
    this.speaking = null;
    this.setMode("idle");
    if (this.handsFree && !this.muted) void this.listen();
  }

  private async ask(history: TranscriptLine[]): Promise<string | null> {
    this.setMode("thinking");
    try {
      const res = await fetch("/api/eco/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.options.body, transcript: history.slice(-40) }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string | null; error?: string; fallback?: boolean };
      if (!res.ok || !data.text) {
        const fatal = res.status === 503 || res.status === 401 || res.status === 400;
        this.options.callbacks.onError(data.error ?? "Le personnage n'a pas pu répondre.", { fatal });
        this.setMode("idle");
        return fatal ? null : RETRY_LINES[this.options.language];
      }
      return data.text;
    } catch {
      this.options.callbacks.onError("Pas de connexion. Vérifie ton réseau.", { fatal: false });
      this.setMode("idle");
      return RETRY_LINES[this.options.language];
    }
  }

  private async handleUser(text: string) {
    if (this.ended) return;
    const clean = text.trim();
    if (!clean) {
      if (this.handsFree && !this.muted) void this.listen();
      return;
    }
    this.history.push({ role: "user", text: clean });
    this.options.callbacks.onMessage({ role: "user", message: clean });
    const reply = await this.ask(this.history);
    if (reply === null || this.ended) {
      if (!this.ended && this.handsFree && !this.muted) this.setMode("idle");
      return;
    }
    await this.say(reply);
  }

  private cancelListening() {
    this.listenToken += 1;
    this.recognizing?.abort();
    this.recognizing = null;
    this.recorder?.cancel();
    this.recorder = null;
    this.recorderStop = null;
  }

  private finishListening() {
    if (this.recognizing) {
      this.recognizing.stop();
      return;
    }
    this.recorderStop?.();
  }

  private async listen(manual = false) {
    if (this.ended || this.mode === "listening" || this.mode === "thinking") return;
    if (this.mode === "speaking") this.speaking?.cancel();
    const token = ++this.listenToken;
    this.setMode("listening");
    const lang = LOCALES[this.options.language];
    if (this.usesPhoneRecognition) {
      // Mains libres : fin de phrase après 1,8 s de silence ; appui pour parler : jusqu'au relâchement.
      const handle = recognizeOnce({ lang, onInterim: this.options.callbacks.onInterim, maxMs: manual ? 90000 : MAX_UTTERANCE_MS, endSilenceMs: manual ? null : 1800 });
      this.recognizing = handle;
      const outcome = await handle.done;
      if (token !== this.listenToken || this.ended) return;
      this.recognizing = null;
      if (outcome.error) {
        this.setMode("idle");
        this.options.callbacks.onError(outcome.error);
        return;
      }
      if (!outcome.text) {
        this.setMode("idle");
        // Mains libres : on se remet à écouter après un court silence.
        if (this.handsFree && !this.muted && !manual) setTimeout(() => void this.listen(), 300);
        return;
      }
      this.setMode("thinking");
      await this.handleUser(outcome.text);
      return;
    }
    // Secours : enregistrement WAV avec détection de silence, puis Scribe.
    try {
      let heard = false;
      let lastLoud = performance.now();
      const startedAt = performance.now();
      const recorder = await startWavRecorder((level) => {
        this.level = level;
        if (level > 0.12) {
          heard = true;
          lastLoud = performance.now();
        }
      });
      if (token !== this.listenToken || this.ended) {
        recorder.cancel();
        return;
      }
      this.recorder = recorder;
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearInterval(interval);
          resolve();
        };
        this.recorderStop = finish;
        const interval = setInterval(() => {
          if (token !== this.listenToken || this.ended) return finish();
          const now = performance.now();
          if (manual) return;
          if (heard && now - lastLoud > SILENCE_MS) return finish();
          if (!heard && now - startedAt > 8000 && this.handsFree) return finish();
          if (now - startedAt > MAX_UTTERANCE_MS) return finish();
        }, 100);
      });
      if (token !== this.listenToken || this.ended) return;
      this.recorder = null;
      this.recorderStop = null;
      const blob = await recorder.stop();
      if (!heard) {
        this.setMode("idle");
        if (this.handsFree && !this.muted && !manual) setTimeout(() => void this.listen(), 300);
        return;
      }
      this.setMode("thinking");
      const form = new FormData();
      form.append("audio", blob, "parole.wav");
      form.append("language", this.options.language);
      const res = await fetch("/api/stt", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (token !== this.listenToken || this.ended) return;
      if (!res.ok) {
        this.setMode("idle");
        this.options.callbacks.onError(data.error ?? "Transcription impossible.");
        return;
      }
      await this.handleUser(data.text ?? "");
    } catch (error) {
      if (token !== this.listenToken || this.ended) return;
      this.setMode("idle");
      this.options.callbacks.onError(error instanceof Error ? error.message : "Micro indisponible.");
    }
  }
}
