import type { Language } from "@/config/personalities";

/**
 * V4 — évaluation de la prononciation avec Azure Speech (Pronunciation Assessment).
 * Côté serveur uniquement : la clé reste dans les variables d'environnement.
 *
 * Variables :
 *  - AZURE_SPEECH_KEY     : clé du service Speech (KEY 1 dans le portail Azure)
 *  - AZURE_SPEECH_REGION  : région de la ressource (ex. francecentral, westeurope)
 *  - AZURE_LOCALE_EN / AZURE_LOCALE_FR : facultatif, en-GB et fr-FR par défaut
 */

export type WordErrorType = "None" | "Omission" | "Insertion" | "Mispronunciation" | string;

export type PhonemeScore = { phoneme: string; score: number };

export type WordScore = {
  word: string;
  /** 0 à 100, null pour un mot inséré (absent de la phrase modèle). */
  score: number | null;
  errorType: WordErrorType;
  phonemes: PhonemeScore[];
};

export type PronunciationScores = {
  /** Note globale 0 à 100. */
  pron: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  /** Seulement en en-US ; null ailleurs. */
  prosody: number | null;
};

export type PronunciationResult = {
  reference: string;
  recognized: string;
  scores: PronunciationScores;
  words: WordScore[];
  /** Sons les moins bien réussis dans cette phrase (score < 60), du pire au moins pire. */
  weakSounds: PhonemeScore[];
};

export function pronunciationConfig(): { key: string; region: string } | null {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase();
  return key && region ? { key, region } : null;
}

export function pronunciationAvailable() {
  return pronunciationConfig() !== null;
}

export function localeFor(language: Language) {
  return language === "fr" ? process.env.AZURE_LOCALE_FR?.trim() || "fr-FR" : process.env.AZURE_LOCALE_EN?.trim() || "en-GB";
}

type AzureWord = {
  Word?: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
  Phonemes?: { Phoneme?: string; PronunciationAssessment?: { AccuracyScore?: number } }[];
};

type AzureResponse = {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: {
    Display?: string;
    Lexical?: string;
    PronunciationAssessment?: {
      AccuracyScore?: number;
      FluencyScore?: number;
      CompletenessScore?: number;
      PronScore?: number;
      ProsodyScore?: number;
    };
    Words?: AzureWord[];
  }[];
};

/**
 * Envoie un court enregistrement (WAV PCM 16 kHz mono, 60 s max) à Azure et renvoie
 * les notes par mot et par son. Lève une erreur avec un message en français.
 */
export async function assessPronunciation(options: {
  audio: ArrayBuffer;
  contentType?: string;
  referenceText: string;
  language: Language;
}): Promise<PronunciationResult> {
  const cfg = pronunciationConfig();
  if (!cfg) throw new Error("Prononciation non configurée : ajoute AZURE_SPEECH_KEY et AZURE_SPEECH_REGION dans Vercel.");
  const locale = localeFor(options.language);
  const reference = options.referenceText.replace(/\s+/g, " ").trim();
  if (!reference) throw new Error("Phrase modèle manquante.");
  if (options.audio.byteLength < 2000) throw new Error("Enregistrement trop court. Appuie, parle, puis appuie à nouveau.");

  const params = {
    ReferenceText: reference,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: true,
    ...(locale === "en-US" ? { EnableProsodyAssessment: true } : {}),
  };
  const url = `https://${cfg.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(locale)}&format=detailed`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": cfg.key,
        "Content-Type": options.contentType || "audio/wav; codecs=audio/pcm; samplerate=16000",
        Accept: "application/json",
        "Pronunciation-Assessment": Buffer.from(JSON.stringify(params), "utf8").toString("base64"),
      },
      body: options.audio,
      signal: controller.signal,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/abort/i.test(msg)) throw new Error("Azure n'a pas répondu à temps. Réessaie.");
    if (/ENOTFOUND|getaddrinfo/i.test(msg)) throw new Error(`Région Azure inconnue (« ${cfg.region} »). Vérifie AZURE_SPEECH_REGION, ex. francecentral.`);
    throw new Error(`Azure injoignable : ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) throw new Error("Clé Azure refusée. Vérifie AZURE_SPEECH_KEY et que la région correspond à la ressource.");
  if (res.status === 429) throw new Error("Trop de demandes pour le niveau gratuit Azure. Attends une minute.");
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Azure a répondu ${res.status}${text ? ` : ${text}` : ""}.`);
  }
  const data = (await res.json().catch(() => ({}))) as AzureResponse;
  if (data.RecognitionStatus && data.RecognitionStatus !== "Success") {
    if (data.RecognitionStatus === "NoMatch" || data.RecognitionStatus === "InitialSilenceTimeout") {
      throw new Error("Je n'ai rien entendu. Parle plus près du micro, dans un endroit plus calme.");
    }
    throw new Error(`Azure n'a pas pu analyser l'audio (${data.RecognitionStatus}).`);
  }
  const best = data.NBest?.[0];
  if (!best || !best.PronunciationAssessment) throw new Error("Réponse Azure incomplète. Réessaie.");

  const pa = best.PronunciationAssessment;
  const words: WordScore[] = (best.Words ?? []).map((w) => {
    const errorType = w.PronunciationAssessment?.ErrorType ?? "None";
    const raw = w.PronunciationAssessment?.AccuracyScore;
    return {
      word: w.Word ?? "",
      score: errorType === "Insertion" ? null : typeof raw === "number" ? Math.round(raw) : 0,
      errorType,
      phonemes: (w.Phonemes ?? [])
        .filter((p) => p.Phoneme)
        .map((p) => ({ phoneme: p.Phoneme as string, score: Math.round(p.PronunciationAssessment?.AccuracyScore ?? 0) })),
    };
  });

  const bySound = new Map<string, { sum: number; n: number }>();
  for (const w of words) {
    if (w.errorType === "Insertion") continue;
    for (const p of w.phonemes) {
      const cur = bySound.get(p.phoneme) ?? { sum: 0, n: 0 };
      cur.sum += p.score;
      cur.n += 1;
      bySound.set(p.phoneme, cur);
    }
  }
  const weakSounds = [...bySound.entries()]
    .map(([phoneme, v]) => ({ phoneme, score: Math.round(v.sum / v.n) }))
    .filter((s) => s.score < 60)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  return {
    reference,
    recognized: best.Display ?? data.DisplayText ?? best.Lexical ?? "",
    scores: {
      pron: Math.round(pa.PronScore ?? 0),
      accuracy: Math.round(pa.AccuracyScore ?? 0),
      fluency: Math.round(pa.FluencyScore ?? 0),
      completeness: Math.round(pa.CompletenessScore ?? 0),
      prosody: typeof pa.ProsodyScore === "number" ? Math.round(pa.ProsodyScore) : null,
    },
    words,
    weakSounds,
  };
}
