import type { Language } from "@/config/personalities";

/**
 * Voix Google (Gemini, via une clé Google AI Studio : gratuite, sans carte).
 * Utilisée en lecture seule comme ElevenLabs : on envoie le texte, on reçoit
 * l'audio. La clé reste côté serveur (GEMINI_API_KEY).
 */
const API_BASE = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

type ModelInfo = { name?: string; supportedGenerationMethods?: string[] };
let modelCache: { at: number; model: string } | null = null;

/**
 * Choisit le modèle de synthèse vocale disponible sur le compte : celui de
 * GEMINI_TTS_MODEL s'il est réglé, sinon le modèle « flash … tts » le plus
 * récent proposé par l'API (les noms changent au fil des versions).
 */
export async function geminiTtsModel(apiKey: string): Promise<string> {
  const forced = process.env.GEMINI_TTS_MODEL?.trim();
  if (forced) return forced.replace(/^models\//, "");
  if (modelCache && Date.now() - modelCache.at < 60 * 60_000) return modelCache.model;
  const res = await fetch(`${API_BASE}/v1beta/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
  if (!res.ok) throw new Error(`Google a répondu ${res.status} en listant les modèles${res.status === 400 || res.status === 403 ? " : clé refusée ?" : ""}.`);
  const data = (await res.json()) as { models?: ModelInfo[] };
  const candidates = (data.models ?? [])
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter((n) => /tts/i.test(n))
    .sort((a, b) => score(b) - score(a));
  const model = candidates[0];
  if (!model) throw new Error("Aucun modèle de voix (tts) disponible avec cette clé Google.");
  modelCache = { at: Date.now(), model };
  return model;
}

function score(name: string) {
  let s = 0;
  if (/flash/i.test(name)) s += 10;
  if (!/preview|exp/i.test(name)) s += 5;
  const version = name.match(/(\d+(?:\.\d+)?)/);
  if (version) s += Number(version[1]);
  return s;
}

const STYLE: Record<Language, (speed: number) => string> = {
  fr: (speed) => (speed < 0.9 ? "Lis ceci lentement et très clairement, comme un professeur patient : " : speed > 1.05 ? "Lis ceci d'un ton vif et naturel : " : "Lis ceci d'un ton naturel, comme dans une vraie conversation : "),
  en: (speed) => (speed < 0.9 ? "Read this slowly and very clearly, like a patient teacher: " : speed > 1.05 ? "Read this in a lively, natural tone: " : "Read this in a natural, conversational tone: "),
};

/** Fabrique un WAV 24 kHz à partir du texte. */
export async function geminiSpeak(options: { text: string; voice: string; language: Language; speed?: number }): Promise<{ wav: Buffer; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY manquante.");
  const model = await geminiTtsModel(apiKey);
  const prompt = `${STYLE[options.language](options.speed ?? 1)}${options.text}`;
  const res = await fetch(`${API_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } } },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 429) throw new Error("Quota gratuit Google atteint pour l'instant. Réessaie dans une minute.");
    throw new Error(`Google a répondu ${res.status}${detail ? ` : ${detail}` : ""}.`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Google n'a pas renvoyé d'audio.");
  const rate = Number(part.inlineData.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000) || 24000;
  const pcm = Buffer.from(part.inlineData.data, "base64");
  return { wav: pcmToWav(pcm, rate), model };
}

function pcmToWav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
