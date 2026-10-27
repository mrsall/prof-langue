/**
 * Voix françaises : on cherche dans la bibliothèque du compte ElevenLabs les
 * voix marquées « fr », et s'il en manque on en ajoute depuis la bibliothèque
 * partagée (accent de France, pas québécois ni belge). Les voix anglaises
 * lisant du français donnent un accent étranger : c'est ce qu'on évite ici.
 */
import { ELEVENLABS_API_BASE } from "@/lib/elevenlabs-api";

const API = `${ELEVENLABS_API_BASE}/v1`;
const LABEL = "prof-langue-fr";

export type FrenchVoice = { voiceId: string; name: string; gender: "male" | "female" };

type LibraryVoice = {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string;
};

type SharedVoice = {
  public_owner_id: string;
  voice_id: string;
  name: string;
  accent: string;
  gender: string;
  age: string;
  language?: string;
  category: string;
  free_users_allowed: boolean;
  fiat_rate?: number | null;
  rate?: number | null;
  usage_character_count_1y: number;
  is_added_by_user?: boolean;
};

const BAD_ACCENTS = ["canad", "qu[eé]b", "belg", "suisse", "swiss", "afric", "haiti", "maghreb"];
const GOOD_ACCENTS = ["paris", "standard", "neutral", "french", "france", "fran"];

const WANTED: { gender: "male" | "female"; count: number }[] = [
  { gender: "male", count: 3 },
  { gender: "female", count: 2 },
];

let cache: { at: number; voices: FrenchVoice[] } | null = null;

function genderOf(label: string | undefined): "male" | "female" | null {
  const g = (label ?? "").toLowerCase();
  if (g.startsWith("m") || g.includes("homme")) return "male";
  if (g.startsWith("f") || g.includes("femme")) return "female";
  return null;
}

/** Voix françaises déjà présentes dans la bibliothèque du compte. */
export async function listFrenchVoices(apiKey: string, force = false): Promise<FrenchVoice[]> {
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.voices;
  const res = await fetch(`${API}/voices?show_legacy=false`, { headers: { "xi-api-key": apiKey }, cache: "no-store" });
  if (!res.ok) throw new Error(`ElevenLabs a répondu ${res.status} en listant les voix.`);
  const data = (await res.json()) as { voices?: LibraryVoice[] };
  const voices: FrenchVoice[] = [];
  for (const v of data.voices ?? []) {
    const labels = v.labels ?? {};
    const lang = (labels.language ?? labels.lang ?? "").toLowerCase();
    const marked = labels.app === LABEL || v.name.startsWith("FR · ");
    if (!marked && !lang.startsWith("fr")) continue;
    const gender = genderOf(labels.gender) ?? (v.name.toLowerCase().includes("emma") ? "female" : "male");
    voices.push({ voiceId: v.voice_id, name: v.name.replace(/^FR · /, ""), gender });
  }
  voices.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), voices };
  return voices;
}

function accentScore(accent: string) {
  const a = accent.toLowerCase();
  if (BAD_ACCENTS.some((b) => new RegExp(b).test(a))) return -1;
  if (GOOD_ACCENTS.some((g) => a.includes(g))) return 2;
  return 1;
}

async function searchShared(apiKey: string, gender: "male" | "female"): Promise<SharedVoice[]> {
  const params = new URLSearchParams({
    language: "fr",
    gender,
    page_size: "60",
    sort: "usage_character_count_1y",
    include_custom_rates: "false",
  });
  const res = await fetch(`${API}/shared-voices?${params}`, { headers: { "xi-api-key": apiKey }, cache: "no-store" });
  if (!res.ok) throw new Error(`ElevenLabs a répondu ${res.status} en cherchant des voix françaises.`);
  const data = (await res.json()) as { voices?: SharedVoice[] };
  return (data.voices ?? [])
    .filter((v) => v.free_users_allowed !== false && !v.fiat_rate && (v.language ?? "fr").toLowerCase().startsWith("fr"))
    .filter((v) => accentScore(v.accent ?? "") > 0)
    .filter((v) => !/(child|enfant|old|âgé|elderly)/i.test(v.age ?? ""))
    .sort((a, b) => accentScore(b.accent ?? "") - accentScore(a.accent ?? "") || b.usage_character_count_1y - a.usage_character_count_1y);
}

/** Ajoute les voix françaises manquantes au compte. Renvoie la liste finale. */
export async function ensureFrenchVoices(apiKey: string): Promise<{ voices: FrenchVoice[]; added: string[] }> {
  const existing = await listFrenchVoices(apiKey, true);
  const added: string[] = [];
  for (const want of WANTED) {
    const have = existing.filter((v) => v.gender === want.gender).length;
    if (have >= want.count) continue;
    const candidates = await searchShared(apiKey, want.gender);
    let missing = want.count - have;
    for (const c of candidates) {
      if (missing <= 0) break;
      if (existing.some((v) => v.voiceId === c.voice_id)) continue;
      const res = await fetch(`${API}/voices/add/${encodeURIComponent(c.public_owner_id)}/${encodeURIComponent(c.voice_id)}`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: `FR · ${c.name}` }),
      });
      if (!res.ok) {
        console.error("Ajout voix FR refusé", res.status, await res.text().catch(() => ""));
        continue;
      }
      const data = (await res.json()) as { voice_id?: string };
      const voiceId = data.voice_id ?? c.voice_id;
      // On étiquette la voix pour la retrouver, même si le nom est changé plus tard.
      await fetch(`${API}/voices/${encodeURIComponent(voiceId)}/edit`, {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: (() => {
          const form = new FormData();
          form.append("name", `FR · ${c.name}`);
          form.append("labels", JSON.stringify({ language: "fr", gender: want.gender, accent: c.accent, app: LABEL }));
          return form;
        })(),
      }).catch(() => undefined);
      existing.push({ voiceId, name: c.name, gender: want.gender });
      added.push(c.name);
      missing -= 1;
    }
  }
  cache = { at: Date.now(), voices: existing.sort((a, b) => a.name.localeCompare(b.name)) };
  return { voices: cache.voices, added };
}

/**
 * Choisit la voix française d'un personnage : variable d'environnement
 * ELEVENLABS_VOICE_FR_<ID> si présente, sinon une voix du bon genre, stable
 * d'une séance à l'autre.
 */
export function pickFrenchVoice(voices: FrenchVoice[], personalityId: string, gender: "male" | "female", index: number): string | null {
  const override = process.env[`ELEVENLABS_VOICE_FR_${personalityId.toUpperCase().replace(/-/g, "_")}`];
  if (override) return override;
  const pool = voices.filter((v) => v.gender === gender);
  const fallback = voices;
  const list = pool.length > 0 ? pool : fallback;
  if (list.length === 0) return null;
  return list[index % list.length].voiceId;
}
