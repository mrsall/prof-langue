import { connection } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { askClaude } from "@/lib/claude";
import { findPersonality, isLanguage, type Language } from "@/config/personalities";

export const maxDuration = 30;

/**
 * Bilan de fin de séance : mots utiles, 3 erreurs principales avec la bonne
 * forme, un encouragement, et s'il faut proposer une séance avec la prof.
 * Calculé par Claude côté serveur. Sans clé Anthropic, bilan vide et l'app
 * cache ces parties.
 */
type TranscriptLine = { role: "user" | "agent"; text: string };

type Body = {
  transcript?: TranscriptLine[];
  durationSeconds?: number;
  personality?: string;
  language?: string;
};

export type BilanResult = {
  available: boolean;
  words: { en: string; fr: string }[];
  errors: { wrong: string; right: string; tip: string }[];
  /** Lignes de Cherif à corriger : index dans le texte envoyé, version corrigée. */
  corrections: { index: number; corrected: string }[];
  /** Mots vagues ou maladroits qu'il a utilisés, et la version plus précise. */
  upgrades: { used: string; better: string; why: string }[];
  /** Verdict du juge (mode débat seulement). */
  debate: { winner: "cherif" | "leo" | "draw"; why: string; side: "for" | "against" | null; bestArgument: string; improvements: string[] } | null;
  encouragement: string | null;
  suggestTeacher: boolean;
  teacherFocus: string | null;
};


function emptyBilan(available: boolean): BilanResult {
  return { available, words: [], errors: [], corrections: [], upgrades: [], debate: null, encouragement: null, suggestTeacher: false, teacherFocus: null };
}

function systemPrompt(language: Language, name: string, recapHint: string | undefined) {
  const target = language === "en" ? "English" : "French";
  return `You help Cherif, a French speaker from Senegal, improve his spoken ${target}. You receive the transcript of a spoken conversation between Cherif and ${name}.

Return ONLY a JSON object, no prose, no code fences, with this exact shape:
{"words":[{"en":"...","fr":"..."}],"errors":[{"wrong":"...","right":"...","tip":"..."}],"corrections":[{"index":12,"corrected":"..."}],"upgrades":[{"used":"...","better":"...","why":"..."}],"debate":null,"encouragement":"...","suggestTeacher":false,"teacherFocus":"..."}

- "words": 3 to 5 useful ${target} words or short expressions from the conversation (ones ${name} introduced, ones Cherif asked for, or correct forms he can reuse). The key "en" holds the ${target} form, "fr" a short French translation or explanation. Beginner-friendly. No duplicates.
- "errors": up to 3 of Cherif's most useful mistakes to fix (grammar, vocabulary, word order), each with "wrong" (what he said), "right" (the correct form) and "tip" (one short sentence in French explaining the rule). Empty array if none. Never about accent or pronunciation (you only see text).
- "corrections": for each of Cherif's lines that contains a real mistake, its number (the [N] shown in the transcript) and the whole line rewritten correctly in natural ${target}, keeping his meaning and words as much as possible. Skip lines that are fine. At most 12 items. Speech-to-text glitches (missing punctuation, a misheard word that is obviously the transcriber's fault) are not mistakes.
- "upgrades": up to 3 places where Cherif used a vague, repetitive or clumsy word or phrase (thing, stuff, do, nice, very good, truc, chose, faire...) or struggled to express an idea: "used" (what he said), "better" (the precise ${target} word or phrase he was looking for, or a clearer way to say his idea), "why" (one short sentence in French: when to use it). This is his main difficulty, so make these useful.
- "debate": null, unless the extra guidance below says this was a debate; then {"winner":"cherif"|"leo"|"draw","why":"...","side":"for"|"against"|null,"bestArgument":"...","improvements":["..."]} as described there.
- "encouragement": one or two sentences in ${target}, in ${name}'s own voice and tone, pointing to one precise thing Cherif did well. Be honest: if the session was weak, say what he did well without inflating it, and name the one thing to work on. Never mention accent.
- "suggestTeacher": true only if there were many mistakes (roughly 4 or more clear recurring ones) and a lesson with a teacher would help.
- "teacherFocus": if suggestTeacher is true, a short French phrase naming the 1 or 2 points to work on (e.g. "le passé et les questions"), else null.
${recapHint ? `\nExtra guidance for this mode: ${recapHint}` : ""}`;
}

function parseResult(text: string): BilanResult {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return emptyBilan(true);
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const isStr = (v: unknown): v is string => typeof v === "string";
    const words = Array.isArray(parsed.words)
      ? parsed.words
          .filter((w): w is { en: string; fr: string } => typeof w === "object" && w !== null && isStr((w as { en?: unknown }).en) && isStr((w as { fr?: unknown }).fr))
          .slice(0, 5)
      : [];
    const corrections = Array.isArray(parsed.corrections)
      ? parsed.corrections
          .filter((c): c is { index: number; corrected: string } => typeof c === "object" && c !== null && typeof (c as { index?: unknown }).index === "number" && isStr((c as { corrected?: unknown }).corrected))
          .slice(0, 12)
      : [];
    const upgrades = Array.isArray(parsed.upgrades)
      ? parsed.upgrades
          .filter((u): u is { used: string; better: string; why: string } => typeof u === "object" && u !== null && isStr((u as { used?: unknown }).used) && isStr((u as { better?: unknown }).better))
          .map((u) => ({ used: u.used, better: u.better, why: isStr(u.why) ? u.why : "" }))
          .slice(0, 3)
      : [];
    const d = parsed.debate as Record<string, unknown> | null | undefined;
    const debate =
      d && typeof d === "object" && ["cherif", "leo", "draw"].includes(String(d.winner))
        ? {
            winner: String(d.winner) as "cherif" | "leo" | "draw",
            why: isStr(d.why) ? d.why : "",
            side: d.side === "for" ? ("for" as const) : d.side === "against" ? ("against" as const) : null,
            bestArgument: isStr(d.bestArgument) ? d.bestArgument : "",
            improvements: Array.isArray(d.improvements) ? d.improvements.filter((x): x is string => isStr(x)).slice(0, 3) : [],
          }
        : null;
    const errors = Array.isArray(parsed.errors)
      ? parsed.errors
          .filter(
            (e): e is { wrong: string; right: string; tip: string } =>
              typeof e === "object" && e !== null && isStr((e as { wrong?: unknown }).wrong) && isStr((e as { right?: unknown }).right),
          )
          .map((e) => ({ wrong: e.wrong, right: e.right, tip: isStr(e.tip) ? e.tip : "" }))
          .slice(0, 3)
      : [];
    return {
      available: true,
      words,
      errors,
      corrections,
      upgrades,
      debate,
      encouragement: isStr(parsed.encouragement) ? parsed.encouragement : null,
      suggestTeacher: parsed.suggestTeacher === true,
      teacherFocus: isStr(parsed.teacherFocus) ? parsed.teacherFocus : null,
    };
  } catch {
    return emptyBilan(true);
  }
}

/** Dit seulement si la clé Anthropic est en place (page Réglages). */
export async function GET() {
  await connection();
  return Response.json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
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

  const personality = findPersonality(body.personality) ?? findPersonality("ami")!;
  const language: Language = isLanguage(body.language) ? body.language : "en";
  const name = personality.id === "situation" ? "the role-play partner" : personality.name;

  const offset = Math.max(0, transcript.length - 80);
  const lines = transcript
    .slice(-80)
    .map((l, i) => `[${offset + i}] ${l.role === "user" ? "Cherif" : name}: ${l.text.trim().slice(0, 400)}`)
    .join("\n");

  const client = new Anthropic();
  try {
    const response = await askClaude(client, {
      maxTokens: 4096,
      effort: "low",
      thinking: "adaptive",
      system: systemPrompt(language, name, personality.recapHint?.[language]),
      messages: [
        {
          role: "user",
          content: `Conversation (${Math.round((body.durationSeconds ?? 0) / 60)} minutes):\n${lines}`,
        },
      ],
    });
    if (response.stopReason === "refusal") {
      return Response.json(emptyBilan(true));
    }
    if (response.truncated) console.warn("Bilan : réponse coupée par le plafond de sortie");
    return Response.json(parseResult(response.text));
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
