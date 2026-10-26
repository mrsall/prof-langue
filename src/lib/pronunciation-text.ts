import type { Language } from "@/config/personalities";
import type { PronunciationResult, WordScore } from "@/lib/pronunciation";

/**
 * Évaluation « gratuite » de la prononciation : on compare la phrase modèle
 * avec ce que la reconnaissance vocale a compris. Un mot bien reconnu est
 * vert, un mot déformé est orange ou rouge, un mot absent est « oublié ».
 * Ce n'est pas une note son par son comme Azure, mais c'est une mesure
 * honnête de « est-ce qu'on me comprend », l'objectif de Cherif.
 */

export type AlignedWord = WordScore & { heard: string | null };

const EXPECTED_WORDS_PER_SECOND: Record<Language, number> = { en: 2.3, fr: 2.5 };

const NUMBER_WORDS: Record<Language, Record<string, string>> = {
  en: { "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten", "20": "twenty", "100": "hundred" },
  fr: { "0": "zéro", "1": "un", "2": "deux", "3": "trois", "4": "quatre", "5": "cinq", "6": "six", "7": "sept", "8": "huit", "9": "neuf", "10": "dix", "20": "vingt", "100": "cent" },
};

export function normalizeWord(raw: string, language: Language) {
  let w = raw
    .toLowerCase()
    .replace(/[’´`]/g, "'")
    .replace(/[^\p{L}\p{N}'-]+/gu, "")
    .replace(/^['-]+|['-]+$/g, "");
  if (NUMBER_WORDS[language][w]) w = NUMBER_WORDS[language][w];
  return w.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function tokenize(text: string, language: Language) {
  const out: { raw: string; norm: string }[] = [];
  for (const piece of text.replace(/<[^>]+>/g, " ").split(/[\s ]+/)) {
    // En français, « j'ai » ou « l'école » comptent pour deux petits mots.
    const parts = language === "fr" ? piece.split(/(?<=\b[a-zA-ZÀ-ÿ])'/) : [piece];
    for (const part of parts) {
      const norm = normalizeWord(part, language);
      if (norm) out.push({ raw: part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, "") || part, norm });
    }
  }
  return out;
}

/** Ressemblance entre deux mots, 0 à 1 (distance d'édition sur les lettres). */
export function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[n] / Math.max(m, n);
}

function scoreForSimilarity(s: number) {
  if (s >= 0.999) return 100;
  if (s >= 0.8) return 78;
  if (s >= 0.6) return 58;
  if (s >= 0.4) return 38;
  return 20;
}

/** Aligne la phrase modèle et la phrase entendue mot à mot (programmation dynamique). */
export function alignWords(reference: string, recognized: string, language: Language): AlignedWord[] {
  const ref = tokenize(reference, language);
  const hyp = tokenize(recognized, language);
  const m = ref.length;
  const n = hyp.length;
  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) cost[i][0] = i;
  for (let j = 1; j <= n; j++) cost[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = 1 - similarity(ref[i - 1].norm, hyp[j - 1].norm);
      cost[i][j] = Math.min(cost[i - 1][j - 1] + sub, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const out: AlignedWord[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const sub = i > 0 && j > 0 ? 1 - similarity(ref[i - 1].norm, hyp[j - 1].norm) : Infinity;
    if (i > 0 && j > 0 && Math.abs(cost[i][j] - (cost[i - 1][j - 1] + sub)) < 1e-9) {
      const s = 1 - sub;
      out.push({ word: ref[i - 1].raw, heard: hyp[j - 1].raw, score: scoreForSimilarity(s), errorType: s >= 0.8 ? "None" : "Mispronunciation", phonemes: [] });
      i--;
      j--;
    } else if (i > 0 && Math.abs(cost[i][j] - (cost[i - 1][j] + 1)) < 1e-9) {
      out.push({ word: ref[i - 1].raw, heard: null, score: 0, errorType: "Omission", phonemes: [] });
      i--;
    } else {
      out.push({ word: hyp[j - 1].raw, heard: hyp[j - 1].raw, score: null, errorType: "Insertion", phonemes: [] });
      j--;
    }
  }
  return out.reverse();
}

export function scoreByText(options: { reference: string; recognized: string; language: Language; durationMs?: number | null }): PronunciationResult & { words: AlignedWord[] } {
  const reference = options.reference.replace(/\s+/g, " ").trim();
  const recognized = options.recognized.replace(/\s+/g, " ").trim();
  const words = alignWords(reference, recognized, options.language);
  const refWords = words.filter((w) => w.errorType !== "Insertion");
  const heardCount = refWords.filter((w) => w.errorType !== "Omission").length;
  const accuracy = refWords.length ? Math.round(refWords.reduce((s, w) => s + (w.score ?? 0), 0) / refWords.length) : 0;
  const completeness = refWords.length ? Math.round((heardCount / refWords.length) * 100) : 0;
  let fluency = completeness;
  if (options.durationMs && options.durationMs > 300 && refWords.length > 0) {
    const wps = heardCount / (options.durationMs / 1000);
    fluency = Math.round(Math.max(20, Math.min(100, (wps / EXPECTED_WORDS_PER_SECOND[options.language]) * 100)));
    // Une phrase à moitié dite n'est pas fluide, même rapide.
    fluency = Math.min(fluency, Math.max(completeness, 20));
  }
  // Un mot franchement raté doit se voir dans la note globale, même au milieu d'une phrase réussie.
  const badWords = refWords.filter((w) => (w.score ?? 0) < 60).length;
  const pron = Math.max(0, Math.round(accuracy * 0.6 + completeness * 0.25 + fluency * 0.15) - badWords * 10);
  return {
    reference,
    recognized,
    scores: { pron, accuracy, fluency, completeness, prosody: null },
    words,
    weakSounds: [],
  };
}
