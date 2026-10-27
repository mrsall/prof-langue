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

export type RecognizeOutcome = { text: string; durationMs: number | null; confidence: number | null; error?: string; /** Code brut du téléphone (not-allowed, network…) ou de l'app (unavailable, start-failed). */ errorCode?: string };

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
 * Fusionne ce que le téléphone a compris sans jamais doubler un mot.
 * Android renvoie souvent la phrase entière depuis le début à chaque fois
 * (« salut », « salut je », « salut je m'appelle »…) : un nouveau morceau qui
 * commence par ce qu'on a déjà remplace le tout ; sinon il s'ajoute.
 */
export function mergeTranscripts(pieces: string[]): string {
  const norm = (t: string) => t.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  let acc = "";
  for (const raw of pieces) {
    const piece = raw.replace(/\s+/g, " ").trim();
    if (!piece) continue;
    const a = norm(acc);
    const p = norm(piece);
    if (!a) acc = piece;
    else if (p === a || a.endsWith(p)) continue; // déjà entendu
    else if (p.startsWith(a)) acc = piece; // version cumulée plus longue
    else {
      // Chevauchement partiel (« je m'appelle Cherif » puis « Cherif et j'habite ») : on recolle.
      const aw = a.split(" ");
      const pw = p.split(" ");
      let overlap = 0;
      for (let k = Math.min(aw.length, pw.length, 6); k > 0; k--) {
        if (aw.slice(-k).join(" ") === pw.slice(0, k).join(" ")) {
          overlap = k;
          break;
        }
      }
      acc = overlap > 0 ? `${acc} ${piece.split(" ").slice(overlap).join(" ")}`.trim() : `${acc} ${piece}`;
    }
  }
  return acc;
}

/**
 * Écoute une prise de parole. La reconnaissance du téléphone, laissée à elle-même,
 * s'arrête à la première pause d'une seconde : un débutant fait des pauses au
 * milieu de ses phrases, donc on la relance tant qu'il n'y a pas eu
 * `endSilenceMs` sans nouveau mot (`null` = jusqu'à `stop()`, pour l'appui
 * pour parler). Les morceaux sont fusionnés sans doublon (voir mergeTranscripts).
 */
export function recognizeOnce(options: { lang: string; onInterim?: (text: string) => void; maxMs?: number; endSilenceMs?: number | null; noSpeechMs?: number }): RecognizeHandle {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return { stop: () => undefined, abort: () => undefined, done: Promise.resolve({ text: "", durationMs: null, confidence: null, error: "Pas de reconnaissance vocale sur ce téléphone.", errorCode: "unavailable" }) };
  }
  const endSilenceMs = options.endSilenceMs === undefined ? 1800 : options.endSilenceMs;
  const noSpeechMs = options.noSpeechMs ?? 9000;
  const maxMs = options.maxMs ?? 60000;
  const rec = new Ctor();
  rec.lang = options.lang;
  // Mode non continu : fiable sur Android et iPhone. C'est nous qui relançons.
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  /** Morceaux finalisés par le téléphone, dans l'ordre. */
  const finals: string[] = [];
  /** Dernier provisoire de la prise en cours. */
  let interimText = "";
  let confidence: number | null = null;
  let speechStart: number | null = null;
  let lastActivity: number | null = null;
  let errorMessage: string | undefined;
  let errorCode: string | undefined;
  let settled = false;
  let wantStop = false;
  let running = false;
  const startedAt = performance.now();
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let stopGuard: ReturnType<typeof setTimeout> | null = null;
  let finish: () => void = () => undefined;

  const currentText = () => mergeTranscripts([...finals, interimText]);
  const requestStop = () => {
    wantStop = true;
    try {
      rec.stop();
    } catch {
      // déjà arrêté
    }
    // Certains téléphones n'envoient jamais `onend` après stop() : on termine quand même.
    if (!stopGuard) stopGuard = setTimeout(() => finish(), 1500);
  };

  const done = new Promise<RecognizeOutcome>((resolve) => {
    finish = () => {
      if (settled) return;
      settled = true;
      if (maxTimer) clearTimeout(maxTimer);
      if (ticker) clearInterval(ticker);
      if (stopGuard) clearTimeout(stopGuard);
      const text = currentText();
      const durationMs = speechStart !== null && lastActivity !== null ? Math.max(0, Math.round(lastActivity - speechStart)) : null;
      resolve({ text, durationMs, confidence, error: errorMessage, errorCode });
    };
    const launch = () => {
      try {
        rec.start();
        running = true;
        return true;
      } catch {
        return false;
      }
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
      // On relit toute la liste : certains téléphones renvoient tout depuis le début.
      const finalPieces: string[] = [];
      const interimPieces: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          finalPieces.push(alt.transcript);
          if (typeof alt.confidence === "number" && alt.confidence > 0) confidence = alt.confidence;
        } else {
          interimPieces.push(alt.transcript);
        }
      }
      // Les finaux de cette prise remplacent ceux de la même prise (pas ceux des prises précédentes).
      finals.splice(takeIndex);
      finals.push(...finalPieces);
      // Les provisoires aussi sont souvent cumulés (« salut », « salut je »…) : jamais mis bout à bout.
      interimText = mergeTranscripts(interimPieces);
      if (currentText() !== lastText) lastActivity = now;
      lastText = currentText();
      options.onInterim?.(lastText);
    };
    rec.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      errorCode = event.error;
      errorMessage = ERROR_MESSAGES[event.error] ?? `Reconnaissance vocale : ${event.error}`;
    };
    rec.onend = () => {
      running = false;
      // Le provisoire d'une prise terminée sans final devient un morceau à part entière.
      if (interimText) {
        finals.push(interimText);
        interimText = "";
      }
      takeIndex = finals.length;
      const elapsed = performance.now() - startedAt;
      const keepGoing = !wantStop && !settled && !errorMessage && elapsed < maxMs;
      if (keepGoing && launch()) return;
      finish();
    };
    let takeIndex = 0;
    let lastText = "";
    ticker = setInterval(() => {
      const now = performance.now();
      if (settled) return;
      if (endSilenceMs !== null && lastActivity !== null && currentText() && now - lastActivity >= endSilenceMs) requestStop();
      else if (endSilenceMs !== null && lastActivity === null && now - startedAt >= noSpeechMs) requestStop();
      // Le téléphone a fini sa prise mais rien ne l'a relancé : on relance.
      else if (!running && !wantStop && now - startedAt < maxMs) launch();
    }, 150);
    maxTimer = setTimeout(requestStop, maxMs);
    if (!launch()) {
      errorCode = "start-failed";
      errorMessage = "Impossible de démarrer l'écoute.";
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
      finish();
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
        let guard: ReturnType<typeof setTimeout> | null = null;
        const end = () => {
          if (finished) return;
          finished = true;
          if (guard) clearTimeout(guard);
          resolve();
        };
        // Garde-fou si `onend` n'arrive jamais ; tant que le téléphone parle encore, on attend (90 s au plus).
        const startedAt = performance.now();
        const arm = (ms: number) => {
          guard = setTimeout(() => (synth.speaking && !cancelled && performance.now() - startedAt < 90000 ? arm(1000) : end()), ms);
        };
        arm(4000 + segment.text.length * 120);
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
