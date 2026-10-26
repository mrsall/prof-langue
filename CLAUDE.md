# CLAUDE.md — Prof de langues IA (app vocale mobile)

Lis ce fichier en entier avant d'écrire du code. Pose tes questions sur ce qui n'est pas clair avant de commencer.

## Le projet en une phrase

Une web app mobile (installable sur l'écran d'accueil) où l'on parle anglais ou français à voix haute avec une IA qui répond avec une voix humaine naturelle, comme un vrai interlocuteur, pour gagner en aisance, en vocabulaire et en prononciation.

## L'utilisateur

- Cherif, francophone, au Sénégal (Dakar / Thiès).
- Français courant avec un accent marqué ; anglais débutant, il bloque dès qu'il faut parler.
- Usage : sur téléphone, partout, séances de 10 à 20 minutes, souvent dehors ou dans le bruit, connexion mobile moyenne.
- Il ne code pas : explique-lui tout en français simple, surtout comment tester sur son téléphone.

## Choix techniques imposés

- **Front** : web app installable (PWA), React / Next.js, pensée mobile d'abord (une main, gros boutons).
- **Hébergement** : Vercel, déploiement automatique depuis ce dépôt GitHub.
- **Voix et conversation** : ElevenLabs Agents (Cherif a déjà un abonnement) — transcription, voix et conversation temps réel avec interruption.
- **Cerveau** : Claude via l'API Anthropic (Cherif a déjà un compte). Modèle rapide et économique par défaut (famille Haiku), configurable.
- **Mémoire** : base de données simple (ex. Supabase) pour le niveau, les erreurs, le carnet de mots, les statistiques.
- **Prononciation (V4)** : service d'évaluation spécialisé (Azure Pronunciation Assessment ou Speechace, à comparer).
- **Clés API** : uniquement en variables d'environnement côté serveur (Vercel). Jamais dans le code client, jamais dans le dépôt. Fournis un `.env.example`.

## Parcours utilisateur

1. Accueil : bouton « Commencer », série de jours, objectif du jour (10 min). Le personnage du moment salue Cherif.
2. Choix de la langue : anglais ou français.
3. Choix du mode (voir personnalités).
4. Choix du sujet : l'IA propose 3 ou 4 sujets adaptés au mode + « J'ai mon propre sujet » (dit à voix haute) + « Surprends-moi ».
5. Conversation vocale fluide. Écran : gros bouton micro, « Répète », vitesse de la voix, « Afficher le texte », « Terminer ».
   - Appui pour parler (bruit) ou mains libres (détection de fin de phrase).
   - Si Cherif parle pendant que l'IA parle, elle s'arrête et écoute.
6. Fin de séance : bilan, mots ajoutés au carnet, proposition d'exercice de répétition.

Lancer une séance = 3 touches maximum.

## Expérience et design (très important)

L'app doit donner envie de rester : moderne, vivante, rapide, jamais scolaire ni vieillotte.

- Design épuré, mode sombre et clair, couleurs vives mais sobres, grandes cartes, typographie lisible.
- Chaque personnalité a un avatar illustré original qui s'anime quand elle parle et réagit ; le micro pulse au rythme de la voix.
- Transitions douces, légère vibration au début/fin d'enregistrement, pas d'écran de chargement long. Objectif : réponse perçue en moins de 2 secondes.
- Motivation sans excès : série de jours, petites célébrations, quelques badges.
- Premier lancement : 1 minute de prise en main max, puis une vraie conversation.
- Avant le code de la V1 : proposer une maquette des écrans principaux et attendre la validation de Cherif.

## Personnalités (dans un fichier de configuration, pas en dur dans le code)

| Mode | Qui c'est | Ton | Correction pendant la discussion |
| --- | --- | --- | --- |
| Ami | Pote de son âge, détendu, passionné d'informatique, d'animés et de jeux vidéo ; aime aussi le foot et les films (liste de hobbies extensible) | Familier, blagues | Aucune ; tout va au bilan |
| Grand frère | Plus âgé, conseille sur la vie, le travail, l'argent, la famille | Chaleureux, direct | Légère : reformule sans insister |
| Débatteur | Adore débattre, prend souvent le contre-pied de Cherif pour l'obliger à argumenter | Vif, taquin, respectueux | Légère ; bilan sur l'argumentation |
| Professeur | Patient, encourageant, explique quand c'est utile | Clair, un peu plus lent | Active : corrige, fait répéter, explique en une phrase |
| Collègue | Professionnel du commerce et de l'agriculture | Poli, vocabulaire du travail | Légère |
| Situation | Rôle joué : serveur, agent d'aéroport, acheteur de bananes, recruteur… | Selon le rôle | Légère, puis bilan détaillé |

- Voix : en anglais, accent américain ou britannique ; voix d'homme ou de femme.
- Niveau de correction réglable à tout moment (aucune / légère / active).
- Chaque personnalité garde son caractère et se souvient des séances précédentes.

## Sujets proposés (générés par l'IA selon mode, niveau, historique ; pas deux jours de suite le même)

- Ami : sa journée, informatique et tech, un animé ou jeu vidéo du moment, le dernier match, un film, un souvenir drôle, le week-end.
- Grand frère : un choix difficile, le travail, l'argent et l'épargne, la famille, les ambitions, sa chaîne YouTube.
- Débatteur : PC ou console, les jeux vidéo (perte de temps ou compétence), l'IA et les métiers, ville ou village, le meilleur animé ; ou un débat proposé par Cherif.
- Professeur : se présenter, décrire son travail, raconter au passé, donner son avis.
- Collègue : présenter l'entreprise et la coopérative agricole, la production de bananes, organiser un rendez-vous, un problème de livraison.
- Situation : restaurant, aéroport, négocier un prix, entretien d'embauche, appeler un fournisseur, hôtel, médecin.

## Règles de conversation (à mettre dans les consignes système)

1. Réponses courtes : 1 à 3 phrases, puis une question ou une relance. Cherif doit parler plus que l'IA.
2. Vocabulaire et vitesse adaptés au niveau mesuré, en montant progressivement.
3. Le français est autorisé : sur « comment on dit… », donner le mot, le faire répéter une fois, reprendre.
4. Blocage ou silence : proposer un début de phrase ou deux réponses possibles.
5. Correction douce : reprendre la bonne forme naturellement dans la réponse, sans dire « erreur ».
6. Correction active (prof) : une seule erreur à la fois, la plus utile, expliquée en une phrase.
7. Jamais décourageant, jamais moqueur sur l'accent ; au plus une correction par réplique.
8. Réaliste : expressions naturelles, contractions, humour en mode ami.
9. Toutes les erreurs sont enregistrées en silence pour le bilan.
10. **Orientation vers le prof** : en mode ami, grand frère ou débatteur, si beaucoup d'erreurs, le personnage le conseille à la fin, dans son style, et le bilan propose un bouton qui lance une séance prof sur ces points. Jamais pendant la discussion.

Règles du débatteur : prend la position opposée et le dit ; demande arguments et exemples ; reste respectueux et peut changer d'avis s'il est convaincu ; pas de sujets blessants ou haineux, politique et religion seulement si Cherif les propose ; au bilan, expressions pour argumenter et meilleur argument de la séance.

## Prononciation (V4)

- L'IA de conversation ne reçoit que du texte : elle ne juge pas l'accent. Utiliser un service d'évaluation qui note chaque mot et chaque son.
- Shadowing : l'IA dit une phrase, Cherif répète, mots colorés (vert / orange / rouge), le mot raté rejoué lentement.
- Phrases tirées de la conversation et des sons ratés le plus souvent.
- Objectif en français : être compris facilement, pas effacer l'accent.

## Progression

- Test de niveau (A1 à C2) de 5 minutes au premier lancement, par langue ; réévalué chaque mois.
- Bilan de fin de séance lisible en 30 secondes : temps de parole, 3 erreurs principales avec la bonne forme, 5 mots nouveaux, sons à travailler, un encouragement précis.
- Texte de la conversation consultable avec corrections surlignées.
- Carnet de mots automatique avec révision espacée (J+1, J+3, J+7, J+21), possible à la voix.
- Écran de suivi : minutes par semaine, série, notes de prononciation, niveau.
- Une notification par jour à l'heure choisie, avec un sujet du jour.

## Coûts et limites

- Plafond de dépense quotidien réglable ; au-delà, prévenir et proposer de s'arrêter.
- Coût estimé de la séance et du mois visible dans les réglages.
- App légère en données (audio compressé, pas de vidéo).
- Hors ligne non prévu : message clair si la connexion est trop faible.
- Les enregistrements audio ne sont pas conservés après analyse ; seuls le texte et les statistiques.

## Plan de construction — une version à la fois

| Version | Contenu | Validation par Cherif |
| --- | --- | --- |
| V0 | Page de test : 2 ou 3 voix ElevenLabs en conversation temps réel | Il choisit la voix la plus naturelle et le délai le plus court |
| V1 | Mode ami, anglais, appui pour parler, réponse vocale, Répète, vitesse | 10 minutes sans bug, délai naturel |
| V2 | Six modes, FR et EN, sujets, mon propre sujet, mains libres, interruption, niveau de correction, mots en français | Une séance complète dans chaque mode |
| V3 | Test de niveau, bilan, texte corrigé, carnet, révisions, rappels, plafond | Une semaine d'usage quotidien |
| V4 | Prononciation, shadowing, suivi des sons | Notes cohérentes avec son ressenti |

Plus tard : discussion à partir d'une vidéo YouTube ; app native avec Expo.

## Méthode de travail

1. Ne jamais commencer une version avant que Cherif ait validé la précédente.
2. Au début de chaque version : un plan court (fichiers, services, ce que Cherif devra tester).
3. Personnalités, sujets et règles de correction dans des fichiers de configuration.
4. Commits propres et fréquents, avec des messages clairs en français.
5. À la fin de chaque version : instructions simples en français pour tester sur téléphone, et mise à jour de la section « État du projet » ci-dessous.

## Questions ouvertes

- ~~Voix retenue (choix en V0).~~ Réglé : **George** (britannique, homme, `JBFqnCBsobJjWmhhKeHm`).
- ~~Prénoms et caractère détaillé de chaque personnalité.~~ Proposés en V2 : Max (ami), Ibrahim (grand frère), Leo (débatteur), Emma (prof), Thomas (collègue), rôle de situation. À confirmer par Cherif.
- ~~Plafond de dépense quotidien.~~ Réglable dans l'app (défaut 30 min/jour, 60 FCFA/min).
- ~~Heure du rappel quotidien.~~ Réglable dans l'app (défaut 18 h ; le cron Vercel tourne à 18 h UTC, à décaler dans `vercel.json` si Cherif choisit plus tard).

## État du projet

- **V0 validée (24 oct. 2026)** : voix George, délai sous 2 s, interruption OK. Page conservée sur `/test-voix`.
- **V1 validée (25 oct. 2026)** : mode ami avec Max, mains libres par défaut (appui pour parler en option), Répète, vitesse, bilan simple, page `/reglages` qui configure l'agent ElevenLabs par l'API.
- **V2 validée (25 oct. 2026)** : six personnalités (`src/config/personalities.ts`), anglais et français, sujets (`/api/sujets`), correction réglable, souvenirs, bilan enrichi. Voix françaises de la bibliothèque ElevenLabs ajoutées automatiquement (`src/lib/french-voices.ts`) après le retour « accent québécois ».
- **V3 validée (26 oct. 2026)** après l'audit « honnêteté + juge » (deux voix entendues en débat, OK).
  - Base Postgres (`DATABASE_URL`, ex. Supabase) avec schéma auto (`src/lib/db.ts`) ; sans elle, l'app fonctionne en mode téléphone seul.
  - Test de niveau (`kind: "test"`, 5 min avec Emma, `/api/niveau`), niveau injecté dans les consignes, réévaluation après 30 jours.
  - Bilan complet avec corrections par ligne (`/api/bilan`), texte de la séance corrigé, séances enregistrées (`/api/sessions`), carnet alimenté.
  - Carnet `/carnet` (révision espacée J+1/3/7/21 puis 60, `/api/mots`), révision à la voix (`kind: "revision"`).
  - Suivi `/suivi`, réglages V3 (coût/minute, plafond, rappel), rappels push (`public/sw.js`, clés VAPID en base, crons `vercel.json` à 8 h 05 et 18 h 05 UTC, l'app n'envoie qu'au passage qui suit l'heure choisie ; région `fra1`), code d'accès `APP_PIN` via `src/proxy.ts`.
  - Cherif doit créer la base Supabase et renseigner `DATABASE_URL` (et `APP_PIN` conseillé) dans Vercel.
  - Méthode pédagogique documentée dans `docs/methode-apprentissage.md` (production poussée, tournures toutes faites, tours de fluidité 4/3/2, incitations avant reformulations, aide à trouver ses mots : reformuler, mot exact, redire ; trame quoi/pourquoi/exemple). Bilan avec rubrique « Dire plus précisément ». Mots du carnet recyclés dans les discussions.
  - **Honnêteté (audit du 25 oct.)** : règle commune « pas de flatterie » dans `src/lib/prompt.ts` ; Emma est directe et exigeante (`correction.ts` niveau actif : « Non, pas comme ça, on dit… »), les autres restent francs sur le fond et ne félicitent jamais une phrase fausse.
  - **Débat à trois** : un juge neutre (voix distincte via `tts.supported_voices` de l'agent, balises `<voice name="judge">` / `<voice name="juge">`, voix réglables par `ELEVENLABS_VOICE_JUDGE_EN/FR`) pose la motion, demande le camp de Cherif, Leo prend l'autre camp et ne corrige jamais sa langue, le juge rend un verdict honnête. Le bilan affiche le verdict (`debate` dans `/api/bilan`), toutes les erreurs, et un bouton « Refaire le débat » (`rematch` dans `SessionParams` → `/api/elevenlabs/session` → bloc REMATCH du prompt : même motion, mêmes camps, le juge vérifie point par point si les remarques ont été corrigées).
  - Emma et le juge reçoivent les erreurs récentes de la table `errors` (`pastErrors`) pour vérifier qu'elles ne reviennent pas. Série de jours : la base fait foi quand elle est là (`streak` dans `/api/reglages`).
  - Réglages affiche ce qui est lu dans `DATABASE_URL` (utilisateur, hôte, port, pooler) et une cause probable en cas d'échec.
- **V4 construite, en attente de validation par Cherif (notes cohérentes avec son ressenti).**
  - Service retenu : **Azure Speech Pronunciation Assessment** (en-GB et fr-FR pris en charge, 5 h gratuites par mois puis ≈ 1 $/h ; Speechace écarté : pas de tarif public, ≈ 40 $/mois d'après des tiers). Clé et région dans Vercel : `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` ; sans elles, la page explique quoi faire et permet d'écouter/répéter sans note.
  - `src/lib/pronunciation.ts` : appel REST court (WAV PCM 16 kHz, en-tête `Pronunciation-Assessment` en base64, `format=detailed`), notes globales (PronScore, Accuracy, Fluency, Completeness ; Prosody seulement en en-US), mots avec `ErrorType` (Omission, Insertion, Mispronunciation), phonèmes, sons faibles (< 60).
  - `src/lib/recorder.ts` : enregistreur WAV côté téléphone (Web Audio → 16 kHz mono 16 bits), compatible iPhone.
  - Page `/prononciation` (`src/components/shadowing.tsx`) : la voix lit la phrase (`/api/tts`, ElevenLabs, GET pour jouer dans le geste d'appui ; « Lentement » = vitesse 0,75), Cherif répète (appui / appui, 15 s max, vibration), mots colorés vert ≥ 80 / orange ≥ 60 / rouge, appui sur un mot = relecture lente, résumé de série (moyenne, mots à refaire, sons à soigner).
  - Phrases (`/api/prononciation/phrases`) : ses phrases corrigées et des phrases des personnages (4 dernières séances), phrases où il a raté des mots (`pron_attempts`), puis réserve par niveau (`src/config/shadowing.ts`). Le bilan propose « Répéter N phrases de la séance » (passage par `sessionStorage`).
  - Base : tables `pron_attempts` (notes, mots, jamais l'audio) et `pron_sounds` (par langue et phonème : essais, échecs, somme des notes). Suivi : moyenne 30 jours, barres par semaine, sons les moins réussis. Réglages : carte « Prononciation (Azure Speech) » avec la marche à suivre.
- Plus tard : discussion à partir d'une vidéo YouTube ; app native avec Expo.
