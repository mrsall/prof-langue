import type { Language } from "@/config/personalities";

/**
 * Sujets de secours (si Claude n'est pas disponible) et réservoir pour
 * « Surprends-moi ». Les sujets proposés à l'écran sont normalement générés
 * par l'IA selon le mode, le niveau et l'historique.
 */
export const TOPICS: Record<string, Record<Language, string[]>> = {
  ami: {
    en: [
      "How your day went",
      "A new app or gadget you tried",
      "The anime or series you're watching right now",
      "The last football match you saw",
      "A movie you'd recommend",
      "A funny memory with friends",
      "Your plans for the weekend",
    ],
    fr: [
      "Ta journée",
      "Une appli ou un gadget que tu as testé",
      "L'animé ou la série du moment",
      "Le dernier match que tu as vu",
      "Un film à recommander",
      "Un souvenir drôle entre amis",
      "Tes plans pour le week-end",
    ],
  },
  "grand-frere": {
    en: [
      "A difficult choice you have to make",
      "How work is going these days",
      "Money, saving and spending wisely",
      "Family and the people you care about",
      "Your ambitions for the next five years",
      "Your YouTube channel",
    ],
    fr: [
      "Un choix difficile à faire",
      "Le travail en ce moment",
      "L'argent, l'épargne et les dépenses",
      "La famille et les proches",
      "Tes ambitions pour les cinq prochaines années",
      "Ta chaîne YouTube",
    ],
  },
  debatteur: {
    en: [
      "Video games are a waste of time",
      "PCs are better than consoles",
      "AI will create more jobs than it destroys",
      "Life in the village is better than life in the city",
      "Orwell's 1984 describes today's world",
      "Social media does more harm than good",
      "School should teach coding before literature",
      "Money is the key to a happy life",
      "Anime is the best storytelling of our time",
      "Football has become too commercial",
    ],
    fr: [
      "Les jeux vidéo sont une perte de temps",
      "Le PC vaut mieux que la console",
      "L'IA créera plus d'emplois qu'elle n'en détruira",
      "La vie au village vaut mieux que la vie en ville",
      "1984 d'Orwell décrit le monde d'aujourd'hui",
      "Les réseaux sociaux font plus de mal que de bien",
      "L'école devrait enseigner le code avant la littérature",
      "L'argent est la clé d'une vie heureuse",
      "L'animé est la meilleure forme de récit de notre époque",
      "Le foot est devenu trop commercial",
    ],
  },
  prof: {
    en: [
      "Introduce yourself",
      "Describe your job and a typical day",
      "Tell a story in the past: what you did yesterday",
      "Give your opinion on something you like",
      "Describe your city",
      "Explain a concept you know well (what, why, example)",
      "Explain how your YouTube channel works",
    ],
    fr: [
      "Te présenter",
      "Décrire ton travail et une journée type",
      "Raconter au passé : ce que tu as fait hier",
      "Donner ton avis sur quelque chose que tu aimes",
      "Décrire ta ville",
      "Expliquer un concept que tu connais bien (quoi, pourquoi, exemple)",
      "Expliquer comment fonctionne ta chaîne YouTube",
    ],
  },
  collegue: {
    en: [
      "Present your company and the farmers' cooperative",
      "Explain how banana production works",
      "Set up a meeting with a client",
      "Deal with a delivery problem",
      "Negotiate the price of a shipment",
    ],
    fr: [
      "Présenter l'entreprise et la coopérative agricole",
      "Expliquer la production de bananes",
      "Organiser un rendez-vous avec un client",
      "Gérer un problème de livraison",
      "Négocier le prix d'une livraison",
    ],
  },
  situation: {
    en: [
      "At the restaurant: ordering a meal",
      "At the airport: check-in and security",
      "At the market: negotiating a price",
      "A job interview",
      "Calling a supplier about an order",
      "Checking in at a hotel",
      "At the doctor's: explaining a problem",
    ],
    fr: [
      "Au restaurant : commander un repas",
      "À l'aéroport : enregistrement et sécurité",
      "Au marché : négocier un prix",
      "Un entretien d'embauche",
      "Appeler un fournisseur pour une commande",
      "Arriver à l'hôtel",
      "Chez le médecin : expliquer un problème",
    ],
  },
};

export function fallbackTopics(personalityId: string, language: Language, exclude: string[] = []) {
  const all = TOPICS[personalityId]?.[language] ?? [];
  const fresh = all.filter((t) => !exclude.includes(t));
  return (fresh.length >= 3 ? fresh : all).slice(0, 4);
}

export function randomTopic(personalityId: string, language: Language, exclude: string[] = []) {
  const all = TOPICS[personalityId]?.[language] ?? [];
  const fresh = all.filter((t) => !exclude.includes(t));
  const pool = fresh.length > 0 ? fresh : all;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}
