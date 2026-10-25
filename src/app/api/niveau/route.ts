import Anthropic from "@anthropic-ai/sdk";
import { isLanguage, type Language } from "@/config/personalities";
import { LEVELS, saveLevel, type LevelInfo } from "@/lib/settings";
import { dbAvailable } from "@/lib/db";

/**
 * Évalue le niveau (A1 à C2) à partir du texte du test de niveau, puis
 * l'enregistre. Le niveau est ensuite injecté dans les consignes des
 * personnages.
 */
type Body = { transcript?: { role: "user" | "agent"; text: string }[]; language?: string };

const DEFAULT_MODEL = "claude-haiku-5-5";

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "La clé Anthropic est nécessaire pour évaluer le niveau (voir Réglages)." }, { status: 400 });
  }
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // vide
  }
  const language: Language = isLanguage(body.language) ? body.language : "en";
  const transcript = (body.transcript ?? []).filter((l) => (l.role === "user" || l.role === "agent") && typeof l.text === "string");
  const userLines = transcript.filter((l) => l.role === "user");
  if (userLines.length < 3) {
    return Response.json({ error: "Le test est trop court pour évaluer le niveau. Parle au moins 3 ou 4 fois." }, { status: 400 });
  }
  const target = language === "en" ? "English" : "French";
  const lines = transcript.slice(-80).map((l) => `${l.role === "user" ? "Cherif" : "Emma"}: ${l.text.trim().slice(0, 400)}`).join("\n");
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 800,
      system: `You are a CEFR examiner for spoken ${target}. You receive the transcript (speech-to-text, so ignore punctuation and small transcription glitches) of a short placement chat between Cherif, a French speaker from Senegal, and Emma, his teacher. Judge ONLY Cherif's lines: range of vocabulary, grammar control, ability to narrate, give opinions, handle hypotheticals, and length of his turns.
Return ONLY a JSON object: {"level":"A1|A2|B1|B2|C1|C2","summary":"...","strengths":["..."],"toWorkOn":["..."]}
- "summary": two short sentences in French, encouraging and concrete.
- "strengths": 2 or 3 short items in French.
- "toWorkOn": 2 or 3 short items in French (grammar points or skills), never about accent.`,
      messages: [{ role: "user", content: lines }],
    });
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<LevelInfo>;
    const level = LEVELS.find((l) => l === String(parsed.level ?? "").toUpperCase()) ?? "A2";
    const info: LevelInfo = {
      level,
      date: new Date().toISOString(),
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s): s is string => typeof s === "string").slice(0, 3) : [],
      toWorkOn: Array.isArray(parsed.toWorkOn) ? parsed.toWorkOn.filter((s): s is string => typeof s === "string").slice(0, 3) : [],
    };
    const saved = dbAvailable() ? await saveLevel(language, info) : false;
    return Response.json({ ...info, saved });
  } catch (error) {
    console.error("Niveau : erreur", error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error);
    return Response.json({ error: "L'évaluation du niveau a échoué. Réessaie dans un instant." }, { status: 502 });
  }
}
