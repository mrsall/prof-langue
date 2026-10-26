"use client";

import type { Language } from "@/config/personalities";

/**
 * Kokoro : une voix naturelle qui tourne entièrement dans le téléphone, sans
 * serveur ni clé. Modèle libre (Apache 2) de 82 millions de paramètres, chargé
 * une fois (≈ 90 Mo) puis gardé en cache par le navigateur.
 *
 * Les bibliothèques sont chargées à la demande depuis un CDN : elles ne pèsent
 * rien sur l'app tant qu'on ne s'en sert pas.
 */

const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const PHONEMIZER_URL = "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/+esm";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export type KokoroDevice = "webgpu" | "wasm";
export type KokoroProgress = { status: string; file?: string; progress?: number; loaded?: number; total?: number };

type RawAudio = { audio: Float32Array; sampling_rate: number; toBlob: () => Blob; toWav: () => ArrayBuffer };
type Tensor = { dims: number[] };
type KokoroModel = {
  generate: (text: string, options: { voice: string; speed?: number }) => Promise<RawAudio>;
  generate_from_ids: (ids: Tensor, options: { voice: string; speed?: number }) => Promise<RawAudio>;
  tokenizer: (text: string, options: { truncation: boolean }) => { input_ids: Tensor };
  list_voices: () => void;
};
type KokoroModule = {
  KokoroTTS: { from_pretrained: (id: string, options: { dtype: string; device: KokoroDevice; progress_callback?: (p: KokoroProgress) => void }) => Promise<KokoroModel> };
};
type PhonemizerModule = { phonemize: (text: string, language?: string) => Promise<string[] | string> };

/** Voix proposées, de la meilleure à la moins bonne selon la fiche du modèle. */
export const KOKORO_VOICES: Record<Language, { id: string; label: string }[]> = {
  en: [
    { id: "bm_george", label: "George (britannique, homme)" },
    { id: "bf_emma", label: "Emma (britannique, femme)" },
    { id: "bm_fable", label: "Fable (britannique, homme)" },
    { id: "af_heart", label: "Heart (américaine, femme)" },
    { id: "am_michael", label: "Michael (américain, homme)" },
  ],
  fr: [{ id: "ff_siwis", label: "Siwis (française, femme)" }],
};

// Chargement « hors bundler » : le navigateur va chercher le module lui-même.
const importFromUrl = new Function("u", "return import(u)") as (url: string) => Promise<unknown>;

let modelPromise: Promise<{ tts: KokoroModel; device: KokoroDevice }> | null = null;
let phonemizerPromise: Promise<PhonemizerModule> | null = null;

export function kokoroSupported() {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}

export function webgpuAvailable() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function kokoroLoaded() {
  return modelPromise !== null;
}

/** Charge le modèle (long la première fois : téléchargement, puis mise en cache). */
export function loadKokoro(options: { device?: KokoroDevice; onProgress?: (p: KokoroProgress) => void } = {}) {
  if (!modelPromise) {
    const device: KokoroDevice = options.device ?? (webgpuAvailable() ? "webgpu" : "wasm");
    modelPromise = (async () => {
      const mod = (await importFromUrl(KOKORO_URL)) as KokoroModule;
      const tts = await mod.KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device,
        progress_callback: options.onProgress,
      });
      return { tts, device };
    })().catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

async function phonemizer() {
  if (!phonemizerPromise) {
    phonemizerPromise = (importFromUrl(PHONEMIZER_URL) as Promise<PhonemizerModule>).catch((error) => {
      phonemizerPromise = null;
      throw error;
    });
  }
  return phonemizerPromise;
}

/** Découpe en phrases courtes : le modèle accepte au plus ~500 symboles d'un coup. */
export function splitSentences(text: string) {
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const parts = clean.match(/[^.!?…]+[.!?…]*/g) ?? [clean];
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (s.length <= 220) out.push(s);
    else for (const piece of s.split(/,\s*/)) if (piece.trim()) out.push(piece.trim());
  }
  return out;
}

export type KokoroResult = { blob: Blob; seconds: number; generationMs: number; phonemes?: string };

/** Fabrique l'audio (WAV 24 kHz) d'une phrase. */
export async function synthesize(text: string, options: { language: Language; voice?: string; speed?: number }): Promise<KokoroResult> {
  const { tts } = await loadKokoro();
  const voice = options.voice ?? KOKORO_VOICES[options.language][0].id;
  const speed = Math.max(0.6, Math.min(1.4, options.speed ?? 1));
  const start = performance.now();
  const chunks: Float32Array[] = [];
  let phonemesOut = "";
  for (const sentence of splitSentences(text)) {
    let audio: RawAudio;
    if (options.language === "fr") {
      // Le français n'est pas dans la liste de kokoro-js : on phonétise nous-mêmes (eSpeak NG).
      const { phonemize } = await phonemizer();
      const raw = await phonemize(sentence, "fr-fr");
      const phonemes = (Array.isArray(raw) ? raw.join(" ") : raw).trim();
      phonemesOut += (phonemesOut ? " " : "") + phonemes;
      const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
      audio = await tts.generate_from_ids(input_ids, { voice, speed });
    } else {
      audio = await tts.generate(sentence, { voice, speed });
    }
    chunks.push(audio.audio);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return { blob: encodeWav(merged, 24000), seconds: total / 24000, generationMs: Math.round(performance.now() - start), phonemes: phonemesOut || undefined };
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
