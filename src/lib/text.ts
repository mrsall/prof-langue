/**
 * Nettoyage des textes affichés : les balises `<voice name="…">` servent à la
 * synthèse vocale (voix du juge) et ne doivent jamais apparaître à l'écran.
 * À appliquer sur tout texte montré à Cherif ; le texte envoyé à la voix garde ses balises.
 */
export function stripVoiceTags(text: string): string {
  return text
    .replace(/<\/?voice[^>]*>/gi, "")
    .replace(/<[^>]{1,40}>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
