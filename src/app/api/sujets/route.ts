import Anthropic from "@anthropic-ai/sdk";
import { findPersonality, isLanguage, type Language } from "@/config/personalities";
import { fallbackTopics, TOPICS } from "@/config/topics";

export const maxDuration = 30;

/**
 * Propose 3 ou 4 sujets adaptés au mode, à la langue et à l'historique.
 * Générés par Claude ; sans clé, liste de secours depuis src/config/topics.ts.
 */
type Body = { personality?: string; language?: string; recent?: string[] };

const DEFAULT_MODEL = "claude-haiku-5-5";

function parseTopics(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
    return Array.isArray(arr)
      ? arr.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim().slice(0, 80)).slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // corps vide
  }
  const personality = findPersonality(body.personality) ?? findPersonality("ami")!;
  const language: Language = isLanguage(body.language) ? body.language : "en";
  const recent = Array.isArray(body.recent) ? body.recent.filter((t): t is string => typeof t === "string").slice(0, 10) : [];
  const fallback = fallbackTopics(personality.id, language, recent);

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ topics: fallback, generated: false });
  }

  const examples = TOPICS[personality.id]?.[language] ?? [];
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 400,
      system: `You suggest conversation topics for a language-learning app. The learner is Cherif, a French speaker from Senegal who runs a banana farming business, likes tech, anime, video games, football, movies, and has a YouTube channel. Return ONLY a JSON array of 4 short topic titles (max 8 words each), in ${language === "en" ? "English" : "French"}, no prose.`,
      messages: [
        {
          role: "user",
          content: `Mode: ${personality.modeLabel} (${personality.character[language].slice(0, 300)}).
Typical topics for this mode: ${examples.join("; ")}.
Topics already used recently (do not repeat them, vary the angle): ${recent.length > 0 ? recent.join("; ") : "none"}.
${personality.id === "debatteur" ? "For this mode, each topic must be a MOTION: one clear, debatable statement with two defensible sides (not a question). Mix books and ideas, technology, AI, society, sport, daily life. Avoid politics, religion and wars." : ""}
Give 4 fresh, concrete topics adapted to this mode and to a beginner-to-intermediate speaker.`,
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const topics = parseTopics(text);
    if (topics.length >= 3) return Response.json({ topics, generated: true });
    return Response.json({ topics: fallback, generated: false });
  } catch (error) {
    console.error("Sujets : erreur Anthropic", error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error);
    return Response.json({ topics: fallback, generated: false });
  }
}
