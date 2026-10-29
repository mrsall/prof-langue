/**
 * Dédoublonnage du carnet : deux entrées sont « les mêmes » si, une fois mises
 * en minuscules et débarrassées de la ponctuation et des politesses de fin
 * (« please », « s'il vous plaît »), elles sont identiques ou très proches
 * (distance d'édition ≤ 15 % de la longueur). Évite « Could you repeat that? »
 * et « Could you repeat that, please? » côte à côte.
 */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(please|s'il vous pla[iî]t|s'il te pla[iî]t|svp|stp)$/u, "")
    .replace(/^(please|s'il vous pla[iî]t|s'il te pla[iî]t)\s+/u, "")
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Vrai quand `a` et `b` désignent la même entrée du carnet. */
export function sameEntry(a: string, b: string): boolean {
  const na = normalizeWord(a);
  const nb = normalizeWord(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longest = Math.max(na.length, nb.length);
  if (longest < 6) return false;
  return editDistance(na, nb) <= Math.max(1, Math.floor(longest * 0.15));
}

/** Garde les entrées nouvelles par rapport à `existing` et sans doublon entre elles. */
export function dedupeWords<T extends { en: string }>(incoming: T[], existing: string[]): T[] {
  const kept: T[] = [];
  for (const w of incoming) {
    if (!w.en?.trim()) continue;
    if (existing.some((e) => sameEntry(e, w.en))) continue;
    if (kept.some((k) => sameEntry(k.en, w.en))) continue;
    kept.push(w);
  }
  return kept;
}
