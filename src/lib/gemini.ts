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

/**
 * Fabrique un WAV 24 kHz à partir du texte.
 * On envoie le texte seul, sans consigne de style : le modèle lisait parfois
 * la consigne à voix haute (« Lis ceci lentement… ») avant la phrase. La
 * vitesse se règle côté téléphone, à la lecture (hauteur de voix conservée).
 */
export async function geminiSpeak(options: { text: string; voice: string; language: Language }): Promise<{ wav: Buffer; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY manquante.");
  const model = await geminiTtsModel(apiKey);
  const res = await fetch(`${API_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: options.text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } } },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 429) throw new Error("Quota gratuit Google atteint pour l'instant. Réessaie dans une minute.");
    throw new Error(`Google a répondu ${res.status}${detail ? ` : ${detail}` : ""}.`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
  // L'audio peut arriver en plusieurs morceaux : on les recolle tous, dans l'ordre.
  const parts = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => p.inlineData?.data);
  if (parts.length === 0) throw new Error("Google n'a pas renvoyé d'audio.");
  const rate = Number(parts[0].inlineData?.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000) || 24000;
  const pcm = tidyPcm(Buffer.concat(parts.map((p) => Buffer.from(p.inlineData!.data!, "base64"))), rate);
  return { wav: pcmToWav(pcm, rate), model };
}

/**
 * Nettoie le son brut (16 bits mono) : octet orphelin retiré, queue de silence
 * (ou de parasites très faibles) coupée, fondu de 20 ms au début et à la fin
 * pour éviter le « clic » quand le lecteur démarre ou s'arrête net.
 */
export function tidyPcm(raw: Buffer, sampleRate: number) {
  let pcm = raw.length % 2 === 1 ? raw.subarray(0, raw.length - 1) : raw;
  const samples = pcm.length / 2;
  if (samples < sampleRate / 10) return pcm;
  // Fin : on garde 120 ms après le dernier échantillon audible.
  const threshold = 300;
  let last = samples - 1;
  while (last > 0 && Math.abs(pcm.readInt16LE(last * 2)) < threshold) last--;
  const keep = Math.min(samples, last + 1 + Math.round(sampleRate * 0.12));
  pcm = Buffer.from(pcm.subarray(0, keep * 2));
  const total = pcm.length / 2;
  const fade = Math.min(Math.round(sampleRate * 0.02), Math.floor(total / 2));
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    pcm.writeInt16LE(Math.round(pcm.readInt16LE(i * 2) * gain), i * 2);
    const j = total - 1 - i;
    pcm.writeInt16LE(Math.round(pcm.readInt16LE(j * 2) * gain), j * 2);
  }
  return pcm;
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
