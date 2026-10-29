"use client";

import type { Language } from "@/config/personalities";
import { kokoroVoiceFor } from "@/config/kokoro-voices";
import { kokoroLoaded, loadKokoro, splitSentences, synthesize, type KokoroProgress } from "@/lib/kokoro";
import { speakText, speechSynthesisAvailable, splitVoiceSegments, type SpeakHandle } from "@/lib/speech";

/**
 * Qui lit les répliques en mode éco et les phrases de prononciation :
 *  - "eleven" : ElevenLabs en lecture seule (voix naturelle, caractères de ton abonnement,
 *               bien moins chers que les minutes de conversation) ;
 *  - "kokoro" : voix libre dans le téléphone, gratuite, anglais seulement
 *               (le français bascule sur ElevenLabs) ;
 *  - "phone"  : voix de synthèse du téléphone, gratuite, de dépannage.
 */
export type VoiceChoice = "eleven" | "gemini" | "pc" | "kokoro" | "phone";

export const VOICE_CHOICE_KEY = "prof-langue:voice-choice";

export const VOICE_CHOICES: { key: VoiceChoice; label: string; hint: string }[] = [
  { key: "eleven", label: "ElevenLabs", hint: "Voix naturelle des deux langues. Consomme des caractères de ton abonnement, bien moins chers que les minutes de conversation." },
  { key: "gemini", label: "Google (gratuite)", hint: "Voix Google naturelle, français et anglais, gratuite avec une clé Google AI Studio (Réglages). Si elle manque, ElevenLabs prend le relais." },
  { key: "pc", label: "Mon PC (gratuite)", hint: "Chatterbox sur la carte graphique de ton PC à la maison (dossier pc-voix) : naturelle, illimitée, français et anglais. PC éteint ou injoignable : ElevenLabs prend le relais." },
  { key: "kokoro", label: "Kokoro (anglais, gratuit)", hint: "Voix naturelle fabriquée dans le téléphone, zéro crédit. Anglais seulement : le français passe par ElevenLabs. 90 Mo à charger la première fois." },
  { key: "phone", label: "Téléphone", hint: "Voix de synthèse du téléphone, gratuite, moins agréable. Utile sans réseau rapide." },
];

export function parseVoiceChoice(raw: string | null | undefined): VoiceChoice {
  return raw === "kokoro" || raw === "phone" || raw === "gemini" || raw === "pc" ? raw : "eleven";
}

/** Un morceau de voix dont la fabrication a déjà commencé ; `play` le joue quand c'est son tour. */
export type PreparedClip = {
  text: string;
  /** Résolu quand le début du morceau est prêt à être joué (sert à constituer une petite réserve). */
  ready: Promise<void>;
  play: (onStart?: () => void) => SpeakHandle;
  /** À appeler si on ne le jouera finalement pas (libère les fichiers audio). */
  dispose: () => void;
};

/** Une voix de secours a pris la parole : `engine` = qui parle vraiment, `reason` = pourquoi (« crédit ElevenLabs épuisé »…). */
export type VoiceFallback = { engine: VoiceChoice; reason: string };

export const VOICE_LABELS: Record<VoiceChoice, string> = {
  eleven: "ElevenLabs",
  gemini: "Google",
  pc: "ton PC",
  kokoro: "Kokoro",
  phone: "le téléphone",
};

export type Speaker = {
  choice: VoiceChoice;
  /** Prépare ce qu'il faut (modèle Kokoro) ; peut être long la première fois. */
  preload: (onProgress?: (p: KokoroProgress) => void) => Promise<void>;
  /** Lance la fabrication d'un texte sans le jouer : la phrase suivante se prépare pendant que la précédente se joue. */
  prepare: (text: string, rate: number) => PreparedClip;
  /** `onStart` est appelé quand le son commence vraiment (après la fabrication de la voix). */
  speak: (text: string, rate: number, onStart?: () => void) => SpeakHandle;
};

// ---- lecteur audio partagé ----

let player: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

function getPlayer() {
  if (!player) {
    player = new Audio();
    player.preload = "auto";
  }
  return player;
}

function silentWav() {
  if (silentUrl) return silentUrl;
  const samples = 2400;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return silentUrl;
}

/**
 * À appeler pendant un appui de Cherif (avant toute attente) : sur iPhone, un
 * lecteur audio n'a le droit de démarrer tout seul plus tard que s'il a déjà
 * joué une fois dans un geste de l'utilisateur.
 */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    const a = getPlayer();
    a.src = silentWav();
    void a.play().catch(() => undefined);
  } catch {
    // pas de lecteur audio
  }
  // Même règle pour la voix de synthèse sur iPhone : une première lecture dans le geste.
  try {
    if (speechSynthesisAvailable()) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch {
    // pas de voix
  }
}

/** Numéro de la lecture en cours : une lecture annulée ne touche plus au lecteur partagé. */
let playerGeneration = 0;

/** Joue des fichiers à la suite ; `cancel` arrête net. */
function playUrls(urls: string[], rate = 1, onStart?: () => void): SpeakHandle {
  const a = getPlayer();
  const generation = ++playerGeneration;
  let cancelled = false;
  let started = false;
  let release: (() => void) | null = null;
  const stale = () => cancelled || generation !== playerGeneration;
  const done = (async () => {
    for (const url of urls) {
      if (stale()) return;
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        a.onplaying = () => {
          if (started || stale()) return;
          started = true;
          onStart?.();
        };
        a.onended = () => resolve();
        a.onerror = () => (stale() ? resolve() : reject(new Error("Lecture audio impossible.")));
        a.src = url;
        a.playbackRate = rate;
        try {
          (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
        } catch {
          // navigateur sans réglage
        }
        // Une lecture interrompue (pause, nouvelle source) rejette avec AbortError : ce n'est pas une panne.
        a.play().catch((error) => (stale() ? resolve() : reject(error)));
      });
    }
  })().finally(() => {
    if (generation === playerGeneration) {
      a.onended = null;
      a.onerror = null;
      a.onplaying = null;
    }
    release = null;
  });
  return {
    cancel: () => {
      cancelled = true;
      a.pause();
      release?.();
    },
    done,
  };
}

function clampRate(rate: number, min: number, max: number) {
  return Math.max(min, Math.min(max, rate));
}

/** Regroupe les phrases d'un segment en morceaux courts : une requête /api/tts chacun, rien n'est coupé. */
export function chunkForTts(text: string, max = 260): string[] {
  const out: string[] = [];
  let current = "";
  for (const sentence of splitSentences(text)) {
    if (current && (max <= 1 || current.length + sentence.length + 1 > max)) {
      out.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) out.push(current);
  return out.length > 0 ? out : [text.trim()].filter(Boolean);
}

// ---- haut-parleurs ----

function phoneSpeaker(language: Language): Speaker {
  const prepare = (text: string, rate: number): PreparedClip => ({
    text,
    ready: Promise.resolve(),
    play: (onStart) => {
      const handle = speakText(text, { language, rate: clampRate(rate, 0.5, 1.5) });
      // Voix locale : elle démarre tout de suite (et certains téléphones n'annoncent pas le début).
      onStart?.();
      return handle;
    },
    dispose: () => undefined,
  });
  return {
    choice: "phone",
    preload: async () => {
      if (!speechSynthesisAvailable()) throw new Error("Ce téléphone n'a pas de voix de synthèse.");
    },
    prepare,
    speak: (text, rate, onStart) => prepare(text, rate).play(onStart),
  };
}

/**
 * Voix fabriquée par le serveur (/api/tts). Le serveur applique lui-même la chaîne
 * de secours (moteur demandé → ElevenLabs → PC, 4 s par moteur) et dit qui a parlé
 * (`X-Voice-Engine`). S'il n'a aucune voix, le téléphone enchaîne : Kokoro s'il est
 * déjà chargé (anglais), sinon la voix de synthèse du téléphone. Chaque bascule est
 * annoncée une fois par `onFallback` pour afficher un bandeau « Voix de secours ».
 */
function serverSpeaker(engine: "eleven" | "gemini" | "pc", language: Language, personalityId: string | null, onFallback?: (info: VoiceFallback) => void): Speaker {
  let announced: VoiceChoice | null = null;
  const announce = (actual: VoiceChoice, reason: string) => {
    if (actual === engine || actual === announced) return;
    announced = actual;
    console.warn(`Voix de secours : ${VOICE_LABELS[actual]} (${reason})`);
    onFallback?.({ engine: actual, reason });
  };
  /** Voix locale de secours : Kokoro déjà chargé (anglais), sinon le téléphone. */
  const localFallback = (): Speaker | null => {
    if (language === "en" && kokoroLoaded()) return kokoroSpeaker(personalityId);
    return speechSynthesisAvailable() ? phoneSpeaker(language) : null;
  };
  class ServerVoiceError extends Error {
    reason: string;
    constructor(message: string, reason: string) {
      super(message);
      this.reason = reason;
    }
  }
  const fetchPart = async (seg: { text: string; alt?: boolean }, rate: number) => {
    const q = new URLSearchParams({
      text: seg.text,
      lang: language,
      speed: String(clampRate(rate, 0.7, 1.2)),
      personality: personalityId ?? "",
      role: seg.alt ? "judge" : "main",
      engine,
    });
    const res = await fetch(`/api/tts?${q.toString()}`);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string | null };
      throw new ServerVoiceError(data.error ?? `Voix indisponible (${res.status}).`, data.reason ?? "aucune voix serveur ne répond");
    }
    const actual = res.headers.get("x-voice-engine");
    if (actual && actual !== engine && (actual === "eleven" || actual === "pc" || actual === "gemini")) {
      announce(actual, decodeURIComponent(res.headers.get("x-voice-fallback") ?? "") || `${VOICE_LABELS[engine]} indisponible`);
    }
    return URL.createObjectURL(await res.blob());
  };
  const prepare = (text: string, rate: number): PreparedClip => {
    // Une réplique longue part en plusieurs morceaux (le serveur coupe au-delà de 600 caractères) ;
    // le premier morceau est une seule phrase pour que le son démarre au plus vite.
    const segments = splitVoiceSegments(text).flatMap((seg, i) => chunkForTts(seg.text, i === 0 ? 1 : 260).map((part) => ({ text: part, alt: seg.alt })));
    // Tous les morceaux se fabriquent en même temps, dès maintenant.
    const jobs = segments.map((seg) => fetchPart(seg, rate).then((url) => ({ url }), (error: unknown) => ({ error })));
    const dropFrom = (from: number) => jobs.slice(from).forEach((j) => void j.then((r) => "url" in r && URL.revokeObjectURL(r.url)));
    let played = false;
    return {
      text,
      ready: jobs.length > 0 ? jobs[0].then(() => undefined) : Promise.resolve(),
      dispose: () => {
        if (!played) dropFrom(0);
      },
      play: (onStart) => {
        played = true;
        let cancelled = false;
        let inner: SpeakHandle | null = null;
        const done = (async () => {
          // ElevenLabs applique déjà la vitesse ; Google et le PC sont lus à vitesse réglée par le lecteur (hauteur conservée).
          const playbackRate = engine === "eleven" ? 1 : clampRate(rate, 0.7, 1.2);
          for (let i = 0; i < jobs.length; i++) {
            const result = await jobs[i];
            if (cancelled) return dropFrom(i);
            if ("error" in result) {
              // Aucune voix serveur : Kokoro (s'il est chargé) ou le téléphone prend le relais pour ce qui reste à dire.
              dropFrom(i + 1);
              const fallback = localFallback();
              if (!fallback) throw result.error;
              announce(fallback.choice, result.error instanceof ServerVoiceError ? result.error.reason : "aucune voix serveur ne répond");
              inner = fallback.speak(
                segments
                  .slice(i)
                  .map((s) => s.text)
                  .join(" "),
                rate,
                onStart,
              );
              await inner.done;
              return;
            }
            inner = playUrls([result.url], playbackRate, onStart);
            try {
              await inner.done;
            } finally {
              URL.revokeObjectURL(result.url);
            }
          }
        })();
        return {
          cancel: () => {
            cancelled = true;
            inner?.cancel();
          },
          done,
        };
      },
    };
  };
  return { choice: engine, preload: async () => undefined, prepare, speak: (text, rate, onStart) => prepare(text, rate).play(onStart) };
}

function kokoroSpeaker(personalityId: string | null): Speaker {
  const language: Language = "en";
  const prepare = (text: string, rate: number): PreparedClip => {
    const segments = splitVoiceSegments(text);
    const jobs: { voice: string; sentence: string }[] = [];
    for (const seg of segments) {
      const voice = kokoroVoiceFor(personalityId, seg.alt ? "judge" : "main");
      for (const sentence of splitSentences(seg.text)) jobs.push({ voice, sentence });
    }
    const speed = clampRate(rate, 0.6, 1.4);
    // La première phrase se fabrique dès maintenant ; les suivantes pendant que la précédente se joue.
    let next = jobs.length > 0 ? synthesize(jobs[0].sentence, { language, voice: jobs[0].voice, speed }).catch(() => null) : null;
    return {
      text,
      ready: next ? next.then(() => undefined) : Promise.resolve(),
      dispose: () => undefined,
      play: (onStart) => {
        let cancelled = false;
        let inner: SpeakHandle | null = null;
        const done = (async () => {
          for (let i = 0; i < jobs.length; i++) {
            const result = await next;
            if (!result || cancelled) return;
            next = i + 1 < jobs.length ? synthesize(jobs[i + 1].sentence, { language, voice: jobs[i + 1].voice, speed }).catch(() => null) : null;
            const url = URL.createObjectURL(result.blob);
            inner = playUrls([url], 1, onStart);
            try {
              await inner.done;
            } finally {
              URL.revokeObjectURL(url);
            }
            if (cancelled) return;
          }
        })();
        return {
          cancel: () => {
            cancelled = true;
            inner?.cancel();
          },
          done,
        };
      },
    };
  };
  return {
    choice: "kokoro",
    preload: async (onProgress) => {
      await loadKokoro({ onProgress });
    },
    prepare,
    speak: (text, rate, onStart) => prepare(text, rate).play(onStart),
  };
}

export function createSpeaker(choice: VoiceChoice, options: { language: Language; personalityId?: string | null; onFallback?: (info: VoiceFallback) => void }): Speaker {
  const personalityId = options.personalityId ?? null;
  if (choice === "phone") return phoneSpeaker(options.language);
  if (choice === "kokoro" && options.language === "en") return kokoroSpeaker(personalityId);
  if (choice === "gemini" || choice === "pc") return serverSpeaker(choice, options.language, personalityId, options.onFallback);
  return serverSpeaker("eleven", options.language, personalityId, options.onFallback);
}
