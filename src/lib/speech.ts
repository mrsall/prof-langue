"use client";

import type { Language } from "@/config/personalities";

/**
 * Oreille et voix du téléphone, gratuites : reconnaissance vocale (Web Speech
 * API, Google sur Android, Apple sur iPhone) et synthèse vocale du système.
 * Utilisées par l'écran Prononciation et par le mode éco de la conversation.
 */

type RecognitionAlternative = { transcript: string; confidence: number };
type RecognitionResult = { isFinal: boolean; length: number; [index: number]: RecognitionAlternative };
type RecognitionEvent = { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } };
type RecognitionErrorEvent = { error: string; message?: string };

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

export const LOCALES: Record<Language, string> = { en: "en-GB", fr: "fr-FR" };

export function getSpeechRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionAvailable() {
  return getSpeechRecognitionCtor() !== null;
}

export function speechSynthesisAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export type RecognizeOutcome = { text: string; durationMs: number | null; confidence: number | null; error?: string };

export type RecognizeHandle = {
  /** Termine l'écoute et renvoie ce qui a été compris. */
  stop: () => void;
  /** Abandonne sans rien renvoyer. */
  abort: () => void;
  done: Promise<RecognizeOutcome>;
};

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Autorise le micro pour ce site, puis réessaie.",
  "service-not-allowed": "La reconnaissance vocale est bloquée sur ce téléphone.",
  network: "La reconnaissance vocale a besoin d'internet. Vérifie ta connexion.",
  "audio-capture": "Aucun micro détecté.",
  "language-not-supported": "Cette langue n'est pas reconnue par ce téléphone.",
};

/**
 * Écoute une prise de parole. La reconnaissance du téléphone, laissée à elle-même,
 * s'arrête à la première pause d'une seconde : un débutant fait des pauses au
 * milieu de ses phrases, donc on écoute en continu et c'est nous qui décidons
 * de la fin, après `endSilenceMs` sans nouveau mot (`null` = jusqu'à `stop()`,
 * pour l'appui pour parler).
 */
export function recognizeOnce(options: { lang: string; onInterim?: (text: string) => void; maxMs?: number; endSilenceMs?: number | null; noSpeechMs?: number }): RecognizeHandle {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { stop: () => undefined, abort: () => undefined, done: Promise.resolve({ text: "", durationMs: null, confidence: null, error: "Pas de reconnaissance vocale sur ce téléphone." }) };
  }
  const endSilenceMs = options.endSilenceMs === undefined ? 1800 : options.endSilenceMs;
  const noSpeechMs = options.noSpeechMs ?? 9000;
  const rec = new Ctor();
  rec.lang = options.lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const finals: string[] = [];
  let interimText = "";
  let confidence: number | null = null;
  let speechStart: number | null = null;
  let lastActivity: number | null = null;
  let errorMessage: string | undefined;
  let settled = false;
  let wantStop = false;
  const startedAt = performance.now();
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  const currentText = () => `${finals.join(" ")} ${interimText}`.replace(/\s+/g, " ").trim();
  const requestStop = () => {
    wantStop = true;
    try {
      rec.stop();
    } catch {
      // déjà arrêté
    }
  };

  const done = new Promise<RecognizeOutcome>((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      if (maxTimer) clearTimeout(maxTimer);
      if (ticker) clearInterval(ticker);
      const text = currentText();
      const durationMs = speechStart !== null && lastActivity !== null ? Math.max(0, Math.round(lastActivity - speechStart)) : null;
      resolve({ text, durationMs, confidence, error: errorMessage });
    };
    rec.onspeechstart = () => {
      if (speechStart === null) speechStart = performance.now();
      lastActivity = performance.now();
    };
    rec.onspeechend = () => {
      lastActivity = performance.now();
    };
    rec.onresult = (event) => {
      const now = performance.now();
      if (speechStart === null) speechStart = now;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          const t = alt.transcript.trim();
          // Sur iPhone, le même résultat peut revenir plusieurs fois.
          if (t && finals.at(-1) !== t) finals.push(t);
          if (typeof alt.confidence === "number" && alt.confidence > 0) confidence = alt.confidence;
        } else {
          interim += alt.transcript;
        }
      }
      interimText = interim.trim();
      lastActivity = now;
      options.onInterim?.(currentText());
    };
    rec.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      errorMessage = ERROR_MESSAGES[event.error] ?? `Reconnaissance vocale : ${event.error}`;
    };
    rec.onend = () => {
      // Le téléphone s'arrête parfois tout seul en plein milieu : on repart tant qu'on n'a pas fini.
      if (!wantStop && !settled && !errorMessage && performance.now() - startedAt < (options.maxMs ?? 60000)) {
        try {
          rec.start();
          return;
        } catch {
          // impossible de relancer : on rend ce qu'on a
        }
      }
      finish();
    };
    ticker = setInterval(() => {
      const now = performance.now();
      if (lastActivity !== null && endSilenceMs !== null && currentText() && now - lastActivity >= endSilenceMs) requestStop();
      else if (lastActivity === null && endSilenceMs !== null && now - startedAt >= noSpeechMs) requestStop();
    }, 150);
    maxTimer = setTimeout(requestStop, options.maxMs ?? 60000);
    try {
      rec.start();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Impossible de démarrer l'écoute.";
      finish();
    }
  });

  return {
    stop: requestStop,
    abort: () => {
      wantStop = true;
      finals.length = 0;
      interimText = "";
      try {
        rec.abort();
      } catch {
        // déjà arrêté
      }
    },
    done,
  };
}

// ---- Synthèse vocale ----

const PREFERRED_VOICES: Record<Language, string[]> = {
  en: ["Daniel", "Google UK English Male", "Arthur", "Google UK English Female", "Samantha", "Google US English"],
  fr: ["Thomas", "Google français", "Amélie", "Amelie", "Audrey", "Aurélie", "Aurelie", "Daniel"],
};

let voicesCache: SpeechSynthesisVoice[] = [];

export function loadVoices(): SpeechSynthesisVoice[] {
  if (!speechSynthesisAvailable()) return [];
  const list = window.speechSynthesis.getVoices();
  if (list.length > 0) voicesCache = list;
  return voicesCache;
}

if (typeof window !== "undefined" && speechSynthesisAvailable()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => loadVoices());
}

/** Choisit une voix du téléphone pour la langue ; `alt` = une deuxième voix (le juge). */
export function pickVoice(language: Language, alt = false): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  const prefix = language === "en" ? "en" : "fr";
  const pool = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix));
  if (pool.length === 0) return null;
  const wanted = LOCALES[language].toLowerCase();
  const ranked = [...pool].sort((a, b) => {
    const pa = PREFERRED_VOICES[language].findIndex((n) => a.name.includes(n));
    const pb = PREFERRED_VOICES[language].findIndex((n) => b.name.includes(n));
    const ra = (pa === -1 ? 99 : pa) + (a.lang.toLowerCase().replace("_", "-") === wanted ? 0 : 10) + (a.localService ? 0 : 1);
    const rb = (pb === -1 ? 99 : pb) + (b.lang.toLowerCase().replace("_", "-") === wanted ? 0 : 10) + (b.localService ? 0 : 1);
    return ra - rb;
  });
  if (!alt) return ranked[0];
  return ranked.find((v) => v !== ranked[0]) ?? ranked[0];
}

export type SpeakSegment = { text: string; alt?: boolean };

/** Découpe une réplique selon les balises <voice name="…"> (juge = autre voix). */
export function splitVoiceSegments(text: string): SpeakSegment[] {
  const segments: SpeakSegment[] = [];
  const re = /<voice\s+name=["']?([^"'>]+)["']?\s*>([\s\S]*?)(?:<\/voice>|$)/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(last, match.index).replace(/<[^>]+>/g, "").trim();
    if (before) segments.push({ text: before });
    const inner = match[2].replace(/<[^>]+>/g, "").trim();
    if (inner) segments.push({ text: inner, alt: /^(judge|juge)$/i.test(match[1].trim()) });
    last = match.index + match[0].length;
  }
  const rest = text.slice(last).replace(/<[^>]+>/g, "").trim();
  if (rest) segments.push({ text: rest });
  return segments.length > 0 ? segments : [{ text: text.replace(/<[^>]+>/g, "").trim() }];
}

export type SpeakHandle = { cancel: () => void; done: Promise<void> };

/** Lit un texte avec la voix du téléphone. Résout quand tout est lu (ou annulé). */
export function speakText(text: string, options: { language: Language; rate?: number; onStart?: () => void }): SpeakHandle {
  if (!speechSynthesisAvailable()) {
    return { cancel: () => undefined, done: Promise.reject(new Error("Pas de voix sur ce téléphone.")) };
  }
  const synth = window.speechSynthesis;
  const segments = splitVoiceSegments(text);
  let cancelled = false;
  const rate = Math.max(0.5, Math.min(1.5, options.rate ?? 1));
  const done = (async () => {
    synth.cancel();
    // Petit délai : Chrome Android ignore parfois un speak() juste après cancel().
    await new Promise((r) => setTimeout(r, 60));
    let started = false;
    for (const segment of segments) {
      if (cancelled) return;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(segment.text);
        u.lang = LOCALES[options.language];
        const voice = pickVoice(options.language, Boolean(segment.alt));
        if (voice) u.voice = voice;
        u.rate = rate;
        u.pitch = segment.alt ? 0.9 : 1;
        let finished = false;
        const end = () => {
          if (finished) return;
          finished = true;
          clearTimeout(guard);
          resolve();
        };
        const guard = setTimeout(end, 4000 + segment.text.length * 120);
        u.onstart = () => {
          if (!started) {
            started = true;
            options.onStart?.();
          }
        };
        u.onend = end;
        u.onerror = end;
        synth.speak(u);
      });
    }
  })();
  return {
    cancel: () => {
      cancelled = true;
      synth.cancel();
    },
    done,
  };
}
