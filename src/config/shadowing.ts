import type { Language } from "@/config/personalities";

/**
 * Phrases de secours pour le shadowing (quand il n'y a pas encore de séance
 * enregistrée ni de son raté à retravailler). Courtes, utiles, proches de la vie
 * de Cherif. Les phrases tirées des vraies conversations passent avant celles-ci.
 */
export const SHADOWING_PHRASES: Record<Language, { beginner: string[]; intermediate: string[] }> = {
  en: {
    beginner: [
      "Nice to meet you. My name is Cherif.",
      "I work with a farming cooperative in Senegal.",
      "We grow bananas and sell them in Dakar.",
      "Can you say that again, please?",
      "I think this is a very good idea.",
      "What do you do on the weekend?",
      "I would like a table for two, please.",
      "How much is it? That is too expensive.",
      "I have a YouTube channel about technology.",
      "Yesterday I watched a great football match.",
      "To be honest, I am not sure about that.",
      "Let me give you an example.",
    ],
    intermediate: [
      "The main problem is that the delivery arrived three days late.",
      "In my opinion, video games can teach you how to solve problems.",
      "We need to organise a meeting with the buyer before Thursday.",
      "I used to play football every evening when I was younger.",
      "If I had more time, I would learn to code properly.",
      "What I mean is that the price should depend on the quality.",
      "Could you tell me more about the salary and the working hours?",
      "That is a fair point, but I still think the city is better.",
      "The cooperative produces around twenty tonnes a month.",
      "I would rather save money than spend it on a new phone.",
    ],
  },
  fr: {
    beginner: [
      "Bonjour, je m'appelle Cherif et j'habite à Thiès.",
      "Je travaille dans une coopérative agricole.",
      "Nous produisons des bananes pour le marché de Dakar.",
      "Vous pouvez répéter, s'il vous plaît ?",
      "Je pense que c'est une très bonne idée.",
      "Qu'est-ce que tu fais ce week-end ?",
      "Je voudrais une table pour deux personnes.",
      "C'est trop cher, vous pouvez baisser le prix ?",
      "J'ai une chaîne YouTube sur l'informatique.",
      "Hier, j'ai regardé un très bon match.",
      "Honnêtement, je ne suis pas sûr de ça.",
      "Je vais vous donner un exemple.",
    ],
    intermediate: [
      "Le vrai problème, c'est que la livraison est arrivée avec trois jours de retard.",
      "À mon avis, les jeux vidéo apprennent à résoudre des problèmes.",
      "Il faudrait organiser une réunion avec l'acheteur avant jeudi.",
      "Quand j'étais plus jeune, je jouais au foot tous les soirs.",
      "Si j'avais plus de temps, j'apprendrais vraiment à programmer.",
      "Ce que je veux dire, c'est que le prix doit dépendre de la qualité.",
      "Pourriez-vous m'en dire plus sur le salaire et les horaires ?",
      "C'est un bon argument, mais je pense quand même que la ville est mieux.",
      "La coopérative produit environ vingt tonnes par mois.",
      "Je préfère économiser plutôt que d'acheter un nouveau téléphone.",
    ],
  },
};

export type ScoreTone = "good" | "medium" | "bad";

/** Vert à partir de 80, orange à partir de 60, rouge en dessous. */
export function scoreTone(score: number | null): ScoreTone {
  if (score === null) return "bad";
  if (score >= 80) return "good";
  if (score >= 60) return "medium";
  return "bad";
}

/** Phrases de 4 à 14 mots, sans URL ni balise, pour le shadowing. */
export function usableForShadowing(text: string) {
  const clean = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!clean || /https?:\/\//i.test(clean)) return null;
  const words = clean.split(" ").length;
  if (words < 4 || words > 14) return null;
  return clean;
}

export function pickRandom<T>(items: T[], count: number, seed = Math.random()) {
  const copy = [...items];
  let s = Math.floor(seed * 2147483647) || 1;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
