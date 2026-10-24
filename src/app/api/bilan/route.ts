import Anthropic from "@anthropic-ai/sdk";

/**
 * Bilan de fin de séance (V1, version simple) : quelques mots utiles tirés de
 * la discussion et un encouragement, calculés par Claude côté serveur.
 * Sans clé Anthropic, on renvoie un bilan vide et l'app cache la section.
 */
type TranscriptLine = { role: "user" | "agent"; text: string };

type Body = { transcript?: TranscriptLine[]; durationSeconds?: number };

export type BilanResult = {
  available: boolean;
  words: { en: string; fr: string }[];
  encouragement: string | null;
};

const DEFAULT_MODEL = "claude-haiku-5-5";

const SYSTEM = `You help Cherif, a French speaker from Senegal, learn to speak English. You receive the transcript of a casual spoken conversation between Cherif and his AI friend Max.

Return ONLY a JSON object, no prose, no code fences, with this exact shape:
{"words":[{"en":"...","fr":"..."}],"encouragement":"..."}

- "words": 3 to 5 useful English words or short expressions that appeared in the conversation (prefer ones Max introduced, ones Cherif asked for, or correct forms Cherif can reuse). "fr" is a short French translation. Beginner level. No duplicates.
- "encouragement": one or two sentences in English, in Max's casual friendly voice, pointing to one precise thing Cherif did well in this conversation. Never mention mistakes, errors or accent.`;

function emptyBilan(available: boolean): BilanResult {
  return { available, words: [], encouragement: null };
}

function parseResult(text: string): BilanResult {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return emptyBilan(true);
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      words?: unknown;
      encouragement?: unknown;
    };
    const words = Array.isArray(parsed.words)
      ? parsed.words
          .filter(
            (w): w is { en: string; fr: string } =>
              typeof w === "object" &&
              w !== null &&
              typeof (w as { en?: unknown }).en === "string" &&
              typeof (w as { fr?: unknown }).fr === "string",
          )
          .slice(0, 5)
      : [];
    return {
      available: true,
      words,
      encouragement:
        typeof parsed.encouragement === "string" ? parsed.encouragement : null,
    };
  } catch {
    return emptyBilan(true);
  }
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(emptyBilan(false));
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // corps vide
  }

  const transcript = (body.transcript ?? []).filter(
    (l) => (l.role === "user" || l.role === "agent") && typeof l.text === "string",
  );
  if (transcript.length < 2) {
    return Response.json(emptyBilan(true));
  }

  const lines = transcript
    .slice(-60)
    .map((l) => `${l.role === "user" ? "Cherif" : "Max"}: ${l.text.trim().slice(0, 400)}`)
    .join("\n");

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Conversation (${Math.round((body.durationSeconds ?? 0) / 60)} minutes):\n${lines}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return Response.json(emptyBilan(true));
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return Response.json(parseResult(text));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Bilan : clé Anthropic refusée");
    } else if (error instanceof Anthropic.RateLimitError) {
      console.error("Bilan : limite de requêtes Anthropic atteinte");
    } else if (error instanceof Anthropic.APIError) {
      console.error("Bilan : erreur Anthropic", error.status, error.message);
    } else {
      console.error("Bilan : erreur", error);
    }
    return Response.json(emptyBilan(true));
  }
}
