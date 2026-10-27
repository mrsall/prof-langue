"use client";

import type { Language } from "@/config/personalities";
import { kokoroVoiceFor } from "@/config/kokoro-voices";
import { loadKokoro, splitSentences, synthesize, type KokoroProgress } from "@/lib/kokoro";
import { speakText, speechSynthesisAvailable, splitVoiceSegments, type SpeakHandle } from "@/lib/speech";

/**
 * Qui lit les répliques en mode éco et les phrases de prononciation :
 *  - "eleven" : ElevenLabs en lecture seule (voix naturelle, caractères de ton abonnement,
 *               bien moins chers que les minutes de conversation) ;
 *  - "kokoro" : voix libre dans le téléphone, gratuite, anglais seulement
 *               (le français bascule sur ElevenLabs) ;
 *  - "phone"  : voix de synthèse du téléphone, gratuite, de dépannage.
 */
export type VoiceChoice = "eleven" | "gemini" | "kokoro" | "phone";

export const VOICE_CHOICE_KEY = "prof-langue:voice-choice";

export const VOICE_CHOICES: { key: VoiceChoice; label: string; hint: string }[] = [
  { key: "eleven", label: "ElevenLabs", hint: "Voix naturelle des deux langues. Consomme des caractères de ton abonnement, bien moins chers que les minutes de conversation." },
  { key: "gemini", label: "Google (gratuite)", hint: "Voix Google naturelle, français et anglais, gratuite avec une clé Google AI Studio (Réglages). Si elle manque, ElevenLabs prend le relais." },
  { key: "kokoro", label: "Kokoro (anglais, gratuit)", hint: "Voix naturelle fabriquée dans le téléphone, zéro crédit. Anglais seulement : le français passe par ElevenLabs. 90 Mo à charger la première fois." },
  { key: "phone", label: "Téléphone", hint: "Voix de synthèse du téléphone, gratuite, moins agréable. Utile sans réseau rapide." },
];

export function parseVoiceChoice(raw: string | null | undefined): VoiceChoice {
  return raw === "kokoro" || raw === "phone" || raw === "gemini" ? raw : "eleven";
}

export type Speaker = {
  choice: VoiceChoice;
  /** Prépare ce qu'il faut (modèle Kokoro) ; peut être long la première fois. */
  preload: (onProgress?: (p: KokoroProgress) => void) => Promise<void>;
  speak: (text: string, rate: number) => SpeakHandle;
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
function playUrls(urls: string[], rate = 1): SpeakHandle {
  const a = getPlayer();
  const generation = ++playerGeneration;
  let cancelled = false;
  let release: (() => void) | null = null;
  const stale = () => cancelled || generation !== playerGeneration;
  const done = (async () => {
    for (const url of urls) {
      if (stale()) return;
      await new Promise<void>((resolve, reject) => {
        release = resolve;
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
    if (current && current.length + sentence.length + 1 > max) {
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
  return {
    choice: "phone",
    preload: async () => {
      if (!speechSynthesisAvailable()) throw new Error("Ce téléphone n'a pas de voix de synthèse.");
    },
    speak: (text, rate) => speakText(text, { language, rate: clampRate(rate, 0.5, 1.5) }),
  };
}

/** Voix fabriquée par le serveur (/api/tts) : ElevenLabs, ou Google avec repli ElevenLabs. */
function serverSpeaker(engine: "eleven" | "gemini", language: Language, personalityId: string | null): Speaker {
  const fallback = speechSynthesisAvailable() ? phoneSpeaker(language) : null;
  return {
    choice: engine,
    preload: async () => undefined,
    speak: (text, rate) => {
      // Une réplique longue part en plusieurs morceaux (le serveur coupe au-delà de 600 caractères).
      const segments = splitVoiceSegments(text).flatMap((seg) => chunkForTts(seg.text).map((part) => ({ text: part, alt: seg.alt })));
      let cancelled = false;
      let inner: SpeakHandle | null = null;
      const done = (async () => {
        let urls: string[];
        try {
          urls = await Promise.all(
            segments.map(async (seg) => {
              const q = new URLSearchParams({
                text: seg.text,
                lang: language,
                speed: String(clampRate(rate, 0.7, 1.2)),
                personality: personalityId ?? "",
                role: seg.alt ? "judge" : "main",
                engine,
              });
              let res = await fetch(`/api/tts?${q.toString()}`);
              if (!res.ok && engine === "gemini") {
                // Voix Google indisponible (clé absente, quota) : ElevenLabs lit cette réplique.
                console.warn("Voix Google indisponible, repli ElevenLabs");
                q.set("engine", "eleven");
                res = await fetch(`/api/tts?${q.toString()}`);
              }
              if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(data.error ?? `Voix indisponible (${res.status}).`);
              }
              return URL.createObjectURL(await res.blob());
            }),
          );
        } catch (error) {
          // ElevenLabs injoignable : la voix du téléphone prend le relais pour cette réplique.
          console.warn("Voix ElevenLabs indisponible, repli sur la voix du téléphone :", error instanceof Error ? error.message : error);
          if (!fallback || cancelled) throw error;
          inner = fallback.speak(text, rate);
          await inner.done;
          return;
        }
        if (cancelled) {
          urls.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        // ElevenLabs applique déjà la vitesse ; la voix Google est lue à vitesse réglée par le lecteur (hauteur conservée).
        inner = playUrls(urls, engine === "gemini" ? clampRate(rate, 0.7, 1.2) : 1);
        try {
          await inner.done;
        } finally {
          urls.forEach((u) => URL.revokeObjectURL(u));
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
}

function kokoroSpeaker(personalityId: string | null): Speaker {
  const language: Language = "en";
  return {
    choice: "kokoro",
    preload: async (onProgress) => {
      await loadKokoro({ onProgress });
    },
    speak: (text, rate) => {
      const segments = splitVoiceSegments(text);
      let cancelled = false;
      let inner: SpeakHandle | null = null;
      const done = (async () => {
        // Phrase par phrase : la suivante se fabrique pendant que la précédente se joue.
        const jobs: { voice: string; sentence: string }[] = [];
        for (const seg of segments) {
          const voice = kokoroVoiceFor(personalityId, seg.alt ? "judge" : "main");
          for (const sentence of splitSentences(seg.text)) jobs.push({ voice, sentence });
        }
        const speed = clampRate(rate, 0.6, 1.4);
        let next = jobs.length > 0 ? synthesize(jobs[0].sentence, { language, voice: jobs[0].voice, speed }) : null;
        for (let i = 0; i < jobs.length; i++) {
          const result = await next;
          if (!result || cancelled) return;
          next = i + 1 < jobs.length ? synthesize(jobs[i + 1].sentence, { language, voice: jobs[i + 1].voice, speed }) : null;
          const url = URL.createObjectURL(result.blob);
          inner = playUrls([url], 1);
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
}

export function createSpeaker(choice: VoiceChoice, options: { language: Language; personalityId?: string | null }): Speaker {
  const personalityId = options.personalityId ?? null;
  if (choice === "phone") return phoneSpeaker(options.language);
  if (choice === "kokoro" && options.language === "en") return kokoroSpeaker(personalityId);
  if (choice === "gemini") return serverSpeaker("gemini", options.language, personalityId);
  return serverSpeaker("eleven", options.language, personalityId);
}
