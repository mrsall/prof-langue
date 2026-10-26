import { isLanguage, type Language } from "@/config/personalities";

export const maxDuration = 30;

/**
 * Phonèmes pour la voix Kokoro du téléphone. Le phonétiseur embarqué dans
 * le navigateur ne connaît que l'anglais ; pour le français, le serveur
 * fait tourner eSpeak NG complet (compilé en WebAssembly, sans installation)
 * et renvoie l'alphabet phonétique attendu par Kokoro, ponctuation comprise
 * (elle donne les pauses et l'intonation).
 *
 *   POST { sentences: string[], language: "fr" | "en" } → { phonemes: string[] }
 */
const VOICE: Record<Language, string> = { en: "en-gb", fr: "fr-fr" };

/** Les signes sur lesquels eSpeak coupe une ligne : on les retire du texte et on les remet après. */
const CLAUSE_SPLIT = /([,;:.!?…]+)/;

/** Mêmes retouches que l'outil d'origine de Kokoro (misaki) sur la sortie d'eSpeak. */
const ESPEAK_TO_KOKORO: [string, string][] = (
  [
    ["ʔˌn̩", "tᵊn"],
    ["a^ɪ", "I"],
    ["a^ʊ", "W"],
    ["d^ʒ", "ʤ"],
    ["e^ɪ", "A"],
    ["t^ʃ", "ʧ"],
    ["ɔ^ɪ", "Y"],
    ["ə^l", "ᵊl"],
    ["ʔn", "tᵊn"],
    ["e", "A"],
    ["ʔ", "t"],
    ["ɚ", "əɹ"],
    ["r", "ɹ"],
    ["x", "k"],
    ["ɬ", "l"],
    ["ʲ", "j"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

function toKokoro(ipa: string) {
  let s = ipa
    .normalize("NFKC")
    // Marqueurs de changement de langue d'eSpeak, ex. (^e^n) … (^f^r) autour d'un mot anglais.
    .replace(/\((?:\^?[a-z]){2,}\)/g, " ")
    // Tirets d'élision (« ʒə- ») : pas des symboles pour Kokoro.
    .replace(/-/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const [from, to] of ESPEAK_TO_KOKORO) s = s.split(from).join(to);
  // Syllabique (n̩) → ᵊ devant la consonne, comme dans misaki.
  s = s.replace(/(\S)̩/g, "ᵊ$1").replace(/̩/g, "");
  return s.replace(/\^/g, "");
}

type Clause = { text: string; mark: string };

/** « Salut Cherif ! Alors, ça va ? » → [{Salut Cherif, !}, {Alors, ,}, {ça va, ?}] */
function clausesOf(sentence: string): Clause[] {
  const parts = sentence
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(CLAUSE_SPLIT);
  const out: Clause[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i].trim();
    const mark = (parts[i + 1] ?? "").trim();
    if (text) out.push({ text, mark });
    else if (mark && out.length > 0) out[out.length - 1].mark += mark;
  }
  return out;
}

/**
 * Un seul lancement d'eSpeak pour tout le lot. eSpeak écrit une ligne de
 * phonèmes par proposition (il coupe sur , ; : . ! ?), donc on sépare les
 * morceaux par un point d'exclamation pour obtenir exactement une ligne par
 * morceau (un point après un mot court est pris pour une abréviation).
 */
async function espeakLines(pieces: string[], voice: string) {
  const { default: ESpeakNg } = await import("espeak-ng");
  const instance = await ESpeakNg({
    arguments: ["--phonout", "out.txt", "-q", "--ipa", "--tie=^", "-v", voice, pieces.join("! ")],
    print: () => undefined,
    printErr: () => undefined,
  });
  return instance.FS.readFile("out.txt", { encoding: "utf8" }).split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

export async function POST(request: Request) {
  let body: { sentences?: unknown; language?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const language: Language = isLanguage(body.language) ? body.language : "fr";
  const sentences = Array.isArray(body.sentences) ? body.sentences.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 30).map((s) => s.slice(0, 400)) : [];
  if (sentences.length === 0) return Response.json({ error: "Aucune phrase." }, { status: 400 });
  try {
    const clauses = sentences.map(clausesOf);
    const flat = clauses.flat();
    let lines = await espeakLines(
      flat.map((c) => c.text),
      VOICE[language],
    );
    if (new URL(request.url).searchParams.get("debug") === "1") return Response.json({ sent: flat.map((c) => c.text), lines });
    if (lines.length !== flat.length) {
      // eSpeak a coupé autrement que nous : on recommence phrase par phrase, sans ponctuation.
      lines = [];
      for (const sentence of sentences) {
        const got = await espeakLines([sentence.replace(/<[^>]+>/g, " ")], VOICE[language]);
        lines.push(got.join(", "));
      }
      return Response.json({ phonemes: lines.map(toKokoro), aligned: false });
    }
    const phonemes: string[] = [];
    let index = 0;
    for (const group of clauses) {
      const pieces: string[] = [];
      for (const clause of group) {
        const ph = toKokoro(lines[index++]);
        pieces.push(ph + (clause.mark ? clause.mark[0] : ""));
      }
      phonemes.push(pieces.join(" ").trim());
    }
    return Response.json({ phonemes, aligned: true }, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (error) {
    return Response.json({ error: `Phonétisation impossible : ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
