"use client";

import type { Language } from "@/config/personalities";
import type { TranscriptLine } from "@/lib/prompt";
import { startWavRecorder, type WavRecorder } from "@/lib/recorder";
import { LOCALES, recognizeOnce, speechRecognitionAvailable, type RecognizeHandle, type SpeakHandle } from "@/lib/speech";
import type { PreparedClip, Speaker } from "@/lib/voice-engine";
import type { EarChoice } from "@/lib/ear";

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
  /** Temps de la dernière réplique : réponse de Claude, puis fabrication de la voix jusqu'au premier son. */
  onTiming?: (timing: EcoTiming) => void;
  /** Réplique du personnage en train de s'écrire (flux), `null` quand elle est terminée. */
  onDraft?: (text: string | null) => void;
};

/**
 * Découpe un texte qui arrive par morceaux en phrases complètes, sans jamais
 * couper à l'intérieur d'une balise <voice> (le juge) ni sur une abréviation.
 */
export class SentenceBuffer {
  private pending = "";

  push(delta: string): string[] {
    this.pending += delta;
    const out: string[] = [];
    const re = /[.!?…]+["»”)]?\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.pending)) !== null) {
      const end = m.index + m[0].length;
      const candidate = this.pending.slice(0, end);
      const open = candidate.lastIndexOf("<voice");
      if (open !== -1 && open > candidate.lastIndexOf("</voice>")) break; // balise ouverte : on attend sa fermeture
      if (candidate.trim().length < 15 || /\b(M|Mme|Mlle|Dr|St|etc|ex|cf|p)\.\s*$/i.test(candidate.trimEnd())) continue;
      out.push(candidate.trim());
      this.pending = this.pending.slice(end);
      re.lastIndex = 0;
    }
    return out;
  }

  flush(): string | null {
    const rest = this.pending.trim();
    this.pending = "";
    return rest || null;
  }
}

export type EcoTiming = { claudeMs: number; voiceMs: number };

export type EcoOptions = {
  /** Corps envoyé à /api/eco/reply (personnalité, langue, sujet…), sans le transcript. */
  body: Record<string, unknown>;
  language: Language;
  /** Qui lit les répliques (ElevenLabs, Kokoro ou le téléphone). */
  speaker: Speaker;
  /** Qui écoute : le téléphone, ou enregistrement + transcription (Groq, Scribe). */
  ear?: EarChoice;
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
/** Mains libres : fin de phrase après ce silence (1,8 s coupait trop tard ; en dessous de 1,2 s, on coupe quelqu'un qui cherche un mot). */
const END_SILENCE_MS = 1300;
const MAX_UTTERANCE_MS = 45000;
/** Au-delà, on considère que Claude ne répondra pas et le personnage relance. */
const REPLY_TIMEOUT_MS = 25000;
/**
 * Codes d'erreur de la reconnaissance du téléphone qui veulent dire « pas ici »
 * (iPhone en app installée, service bloqué) : on passe à l'enregistrement + Scribe.
 */
const EAR_UNAVAILABLE = new Set(["service-not-allowed", "not-allowed", "language-not-supported", "start-failed", "unavailable"]);

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
  private phoneEar: boolean;
  private claudeMs = 0;

  constructor(private readonly options: EcoOptions) {
    this.history = [...(options.history ?? [])];
    this.rate = options.rate;
    this.handsFree = options.handsFree;
    this.ear = options.ear ?? "phone";
    this.phoneEar = this.ear === "phone" && speechRecognitionAvailable();
  }

  private readonly ear: EarChoice;

  /** Oreille du téléphone (sinon enregistrement WAV + Scribe). Peut basculer en cours de séance. */
  get usesPhoneRecognition() {
    return this.phoneEar;
  }

  get currentMode() {
    return this.mode;
  }

  /** Une voix est en cours (en fabrication ou en lecture) : un appui doit la couper. */
  get isSpeaking() {
    return this.speaking !== null;
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

  /**
   * Appui pour parler : `true` au début de l'appui, `false` au relâchement.
   * Renvoie `false` quand l'appui est refusé (le personnage prépare sa réponse).
   */
  pushToTalk(holding: boolean): boolean {
    if (!holding) {
      this.finishListening();
      return true;
    }
    if (this.ended || (this.mode === "thinking" && !this.speaking)) return false;
    this.stopSpeaking();
    this.muted = false;
    void this.listen(true);
    return true;
  }

  /** Cherif coupe la parole : on se tait et on écoute. */
  interrupt() {
    if (!this.speaking) return;
    this.stopSpeaking();
    this.setMode("idle");
    if (!this.muted) void this.listen();
  }

  /** Relit la dernière réplique (un peu plus lentement), sans la rajouter au texte de la séance. */
  repeatLast() {
    if (!this.lastAgentText || this.ended || this.mode === "thinking") return;
    this.stopSpeaking();
    this.cancelListening();
    void this.say(this.lastAgentText, Math.min(this.rate, 0.9), false);
  }

  setRate(rate: number) {
    this.rate = rate;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.stopSpeaking();
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

  /** Coupe la voix en cours ; la suite de `say()` ou `respond()` qui l'attendait ne fera plus rien. */
  private stopSpeaking() {
    this.speaking?.cancel();
    this.speaking = null;
    this.turn?.abort();
    this.turn = null;
  }

  /** Réplique en cours de fabrication phrase par phrase (flux). */
  private turn: { abort: () => void } | null = null;

  /** Mains libres : on se remet à écouter après un court silence, sauf si autre chose a pris la main entre-temps. */
  private relistenSoon() {
    const token = this.listenToken;
    setTimeout(() => {
      if (token === this.listenToken && !this.ended && this.mode === "idle" && this.handsFree && !this.muted) void this.listen();
    }, 300);
  }

  private async say(text: string, rate = this.rate, record = true) {
    if (this.ended) return;
    this.cancelListening();
    this.stopSpeaking();
    this.lastAgentText = text;
    if (record) {
      this.history.push({ role: "agent", text });
      // Les balises <voice> servent à la voix, pas à l'affichage.
      this.options.callbacks.onMessage({ role: "agent", message: text.replace(/<\/?voice[^>]*>/gi, "").replace(/\s+/g, " ").trim() });
    }
    // Tant que la voix se fabrique (ElevenLabs, Google), le personnage « réfléchit » ; il « parle » au premier son.
    this.setMode("thinking");
    const askedAt = performance.now();
    let handle: SpeakHandle | null = null;
    const started = () => {
      if (!handle || this.speaking !== handle || this.ended) return;
      this.options.callbacks.onTiming?.({ claudeMs: this.claudeMs, voiceMs: Math.round(performance.now() - askedAt) });
      this.setMode("speaking");
    };
    handle = this.options.speaker.speak(text, rate, started);
    this.speaking = handle;
    try {
      await handle.done;
    } catch (error) {
      if (this.speaking === handle && !this.ended) this.options.callbacks.onError(error instanceof Error ? error.message : "Lecture impossible.", { fatal: false });
    }
    if (this.speaking !== handle || this.ended) return;
    this.speaking = null;
    this.setMode("idle");
    if (this.handsFree && !this.muted) {
      // Petit délai : le haut-parleur finit de se taire avant que le micro s'ouvre.
      await new Promise((r) => setTimeout(r, 250));
      if (this.ended || this.mode !== "idle" || this.speaking) return;
      void this.listen();
    }
  }

  private async ask(history: TranscriptLine[]): Promise<string | null> {
    this.setMode("thinking");
    const startedAt = performance.now();
    this.claudeMs = 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
    try {
      const res = await fetch("/api/eco/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.options.body, transcript: history.slice(-40) }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string | null; error?: string; fallback?: boolean; reason?: string };
      this.claudeMs = Math.round(performance.now() - startedAt);
      if (res.ok && data.text && data.fallback) {
        // La séance continue, mais on le dit : utile pour comprendre ce qui se passe chez Cherif.
        this.options.callbacks.onError(`Claude a eu un raté (${data.reason ?? "?"}). Réglages → Tester Claude pour voir le détail.`, { fatal: false });
      }
      if (!res.ok || !data.text) {
        const fatal = res.status === 503 || res.status === 401 || res.status === 400;
        this.options.callbacks.onError(data.error ?? "Le personnage n'a pas pu répondre.", { fatal });
        this.setMode("idle");
        return fatal ? null : RETRY_LINES[this.options.language];
      }
      return data.text;
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      this.options.callbacks.onError(timedOut ? "Claude met trop de temps à répondre ; le personnage relance." : "Pas de connexion. Vérifie ton réseau.", { fatal: false });
      this.setMode("idle");
      return RETRY_LINES[this.options.language];
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleUser(text: string) {
    if (this.ended) return;
    const clean = text.trim();
    if (!clean) {
      this.setMode("idle");
      this.relistenSoon();
      return;
    }
    this.history.push({ role: "user", text: clean });
    this.options.callbacks.onMessage({ role: "user", message: clean });
    await this.respond(this.history);
  }

  /**
   * Réponse en flux : Claude écrit, et dès qu'une phrase est complète sa voix se
   * fabrique ; la suivante se prépare pendant que la précédente se joue. Le son
   * démarre donc après la première phrase, pas après toute la réponse.
   */
  private async respond(history: TranscriptLine[]) {
    if (this.ended) return;
    this.cancelListening();
    this.stopSpeaking();
    this.setMode("thinking");
    const startedAt = performance.now();
    this.claudeMs = 0;
    const cb = this.options.callbacks;
    const controller = new AbortController();
    let watchdog = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
    const touch = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
    };

    // File des phrases prêtes à jouer, consommée par le lecteur.
    const queue: PreparedClip[] = [];
    let producerDone = false;
    const waker: { fn: (() => void) | null } = { fn: null };
    let aborted = false;
    let spoken = "";
    let full = "";
    let firstSentenceAt: number | null = null;
    const turn = {
      abort: () => {
        aborted = true;
        controller.abort();
        queue.splice(0).forEach((c) => c.dispose());
        waker.fn?.();
        // Coupé par Cherif : on garde dans le texte ce qui a été dit.
        const said = spoken.trim();
        cb.onDraft?.(null);
        if (said) {
          this.lastAgentText = said;
          this.history.push({ role: "agent", text: said });
          cb.onMessage({ role: "agent", message: said.replace(/<\/?voice[^>]*>/gi, "").replace(/\s+/g, " ").trim() });
        }
      },
    };
    this.turn = turn;
    const pushSentence = (sentence: string) => {
      if (aborted) return;
      if (firstSentenceAt === null) {
        firstSentenceAt = performance.now();
        this.claudeMs = Math.round(firstSentenceAt - startedAt);
      }
      queue.push(this.options.speaker.prepare(sentence, this.rate));
      waker.fn?.();
    };
    const finish = (text: string) => {
      if (this.turn !== turn) return;
      this.turn = null;
      cb.onDraft?.(null);
      const clean = text.replace(/<\/?voice[^>]*>/gi, "").replace(/\s+/g, " ").trim();
      if (clean) {
        this.lastAgentText = text;
        this.history.push({ role: "agent", text });
        cb.onMessage({ role: "agent", message: clean });
      }
    };

    const player = (async () => {
      while (!aborted && !this.ended) {
        const clip = queue.shift();
        if (!clip) {
          if (producerDone) break;
          await new Promise<void>((r) => (waker.fn = r));
          waker.fn = null;
          continue;
        }
        let handle: SpeakHandle | null = null;
        const started = () => {
          if (!handle || this.speaking !== handle || this.ended) return;
          if (this.mode !== "speaking") {
            cb.onTiming?.({ claudeMs: this.claudeMs, voiceMs: Math.round(performance.now() - (firstSentenceAt ?? startedAt)) });
            this.setMode("speaking");
          }
        };
        handle = clip.play(started);
        this.speaking = handle;
        try {
          await handle.done;
        } catch (error) {
          if (this.speaking === handle && !this.ended && !aborted) cb.onError(error instanceof Error ? error.message : "Lecture impossible.", { fatal: false });
        }
        if (this.speaking !== handle || this.ended) return; // coupé par Cherif
        spoken += `${clip.text} `;
        this.speaking = null;
      }
    })();

    const buffer = new SentenceBuffer();
    let error: string | null = null;
    let fatal = false;
    try {
      const res = await fetch("/api/eco/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.options.body, transcript: history.slice(-40), stream: true }),
        signal: controller.signal,
      });
      touch();
      if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) {
        const data = (await res.json().catch(() => ({}))) as { text?: string | null; error?: string };
        if (res.ok && data.text) {
          for (const s of buffer.push(`${data.text} `)) pushSentence(s);
          full = data.text;
        } else {
          error = data.error ?? "Le personnage n'a pas pu répondre.";
          fatal = res.status === 503 || res.status === 401 || res.status === 400;
        }
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let partial = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          touch();
          partial += decoder.decode(value, { stream: true });
          const lines = partial.split("\n");
          partial = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type: string; text?: string; message?: string; fatal?: boolean; fallback?: boolean; reason?: string };
            if (event.type === "delta" && event.text) {
              full += event.text;
              cb.onDraft?.(full.replace(/<\/?voice[^>]*>/gi, "").replace(/\s+/g, " ").trim());
              for (const s of buffer.push(event.text)) pushSentence(s);
            } else if (event.type === "done") {
              if (event.text) full = event.text;
              if (event.fallback) cb.onError(`Claude a eu un raté (${event.reason ?? "?"}). Réglages → Tester Claude pour voir le détail.`, { fatal: false });
            } else if (event.type === "error") {
              error = event.message ?? "Le personnage n'a pas pu répondre.";
              fatal = Boolean(event.fatal);
            }
          }
        }
      }
    } catch (err) {
      if (!aborted) {
        const timedOut = err instanceof DOMException && err.name === "AbortError";
        error = timedOut ? "Claude met trop de temps à répondre ; le personnage relance." : "Pas de connexion. Vérifie ton réseau.";
      }
    } finally {
      clearTimeout(watchdog);
    }
    if (aborted || this.ended) return;
    if (error && !full.trim()) {
      cb.onError(error, { fatal });
      producerDone = true;
      waker.fn?.();
      await player;
      finish("");
      if (fatal) {
        this.setMode("idle");
        return;
      }
      await this.say(RETRY_LINES[this.options.language]);
      return;
    }
    const rest = buffer.flush();
    if (rest) pushSentence(rest);
    producerDone = true;
    waker.fn?.();
    await player;
    if (aborted || this.ended) return;
    if (this.turn !== turn) {
      // Coupé pendant la lecture : on garde ce qui a été dit.
      return;
    }
    finish(full.trim() || spoken.trim());
    this.setMode("idle");
    if (this.handsFree && !this.muted) {
      await new Promise((r) => setTimeout(r, 250));
      if (this.ended || this.mode !== "idle" || this.speaking) return;
      void this.listen();
    }
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
    if (this.mode === "speaking") this.stopSpeaking();
    const token = ++this.listenToken;
    this.setMode("listening");
    const lang = LOCALES[this.options.language];
    if (this.phoneEar) {
      // Mains libres : fin de phrase après 1,8 s de silence ; appui pour parler : jusqu'au relâchement.
      const handle = recognizeOnce({ lang, onInterim: this.options.callbacks.onInterim, maxMs: manual ? 90000 : MAX_UTTERANCE_MS, endSilenceMs: manual ? null : END_SILENCE_MS });
      this.recognizing = handle;
      const outcome = await handle.done;
      if (token !== this.listenToken || this.ended) return;
      this.recognizing = null;
      if (outcome.error) {
        this.setMode("idle");
        if (EAR_UNAVAILABLE.has(outcome.errorCode ?? "") && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices)) {
          // iPhone en app installée : la reconnaissance existe mais refuse de tourner. On change d'oreille pour la séance.
          this.phoneEar = false;
          this.options.callbacks.onError("La reconnaissance vocale du téléphone ne marche pas ici : je passe par l'enregistrement et la transcription ElevenLabs.", { fatal: false });
          void this.listen(manual);
          return;
        }
        this.options.callbacks.onError(outcome.error);
        return;
      }
      if (!outcome.text) {
        this.setMode("idle");
        if (!manual) this.relistenSoon();
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
        if (!manual) this.relistenSoon();
        return;
      }
      this.setMode("thinking");
      const form = new FormData();
      form.append("audio", blob, "parole.wav");
      form.append("language", this.options.language);
      form.append("engine", this.ear === "phone" ? "auto" : this.ear);
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
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      this.options.callbacks.onError(denied ? "Autorise le micro pour ce site, puis réessaie." : error instanceof Error ? error.message : "Micro indisponible.");
    }
  }
}
