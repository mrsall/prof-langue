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
6. **Jamais de livraison sans banc de test vert.** Avant chaque commit poussé : `npx tsc --noEmit`, `npx eslint src --max-warnings=0`, puis `DATABASE_URL=<base locale> npm run test:e2e` (Claude, ElevenLabs, micro et voix simulés ; parcours complet : séance éco, réponse vide, bilan, prononciation, suivi, débat avec juge, repli de voix, appui pour parler, routes serveur). Toute étape rouge se corrige avant de livrer. Ce que le banc ne couvre pas (vraies voix, vrai Claude, iPhone) se dit explicitement à Cherif.

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
- **V4 validée (26 oct. 2026)** : prononciation gratuite avec le téléphone et mode éco testés sur téléphone, OK.
  - **Notation gratuite par défaut** (Cherif n'a pas pu ouvrir de compte Azure : cartes refusées) : la reconnaissance vocale du téléphone (`src/lib/speech.ts`, Web Speech API) transcrit la répétition, le serveur aligne mot à mot avec la phrase modèle (`src/lib/pronunciation-text.ts` : distance d'édition, vert ≥ 80 / orange ≥ 60 / rouge, « pas entendu », insertions) et Claude explique en une phrase le son probablement raté (`tips`, étiquettes de sons agrégées dans `pron_sounds`). Secours quand le téléphone n'a pas de reconnaissance (app installée sur iPhone) : enregistrement WAV + Scribe ElevenLabs (`src/lib/stt.ts`, `/api/stt`, compris dans l'abonnement).
  - Option plus fine : **Azure Speech Pronunciation Assessment** (en-GB et fr-FR, 5 h gratuites par mois puis ≈ 1 $/h, carte bancaire exigée ; Speechace écarté : pas de tarif public). Si `AZURE_SPEECH_KEY` et `AZURE_SPEECH_REGION` sont réglées, `/api/prononciation` l'utilise automatiquement (`engine: "azure"`).
  - **Voix du mode éco et de la prononciation** (`prof-langue:voice-choice`, `src/lib/voice-engine.ts`) : `eleven` = ElevenLabs en lecture seule (`/api/tts` avec `personality` et `role=judge|main`, voix résolues par `src/lib/tts-voices.ts` ; caractères Flash bien moins chers que les minutes d'agent), `kokoro` = modèle libre dans le navigateur (`src/lib/kokoro.ts`, chargé depuis un CDN, WebGPU ou WASM ; anglais seulement, voix par personnage dans `src/config/kokoro-voices.ts` ; le français bascule sur ElevenLabs car la voix française de Kokoro est jugée inutilisable par Cherif ; `/api/phonemes` garde eSpeak NG complet côté serveur pour un usage futur), `phone` = synthèse du téléphone. Lecteur audio partagé débloqué dans le geste d'appui (`unlockAudio`, iPhone), lecture phrase par phrase pour Kokoro, repli automatique sur ElevenLabs puis téléphone. Page `/test-kokoro` conservée pour mesurer la vitesse.
  - **Mode éco** (choix sur l'accueil, `prof-langue:engine`) : conversation sans ElevenLabs Agents. `src/lib/eco-engine.ts` enchaîne écoute (reconnaissance du téléphone ou WAV + Scribe avec détection de silence), réponse de Claude (`/api/eco/reply`, consignes identiques via `src/lib/session-prompt.ts`, partagé avec `/api/elevenlabs/session`), lecture par la synthèse vocale du téléphone (voix distincte pour le juge via les balises `<voice>`). Mains libres et appui pour parler, « Répète » sans appel réseau, interruption par appui sur le micro. Séances enregistrées avec `engine = 'eco'`, coût 0, hors plafond quotidien.
  - `src/lib/pronunciation.ts` : appel REST court (WAV PCM 16 kHz, en-tête `Pronunciation-Assessment` en base64, `format=detailed`), notes globales (PronScore, Accuracy, Fluency, Completeness ; Prosody seulement en en-US), mots avec `ErrorType` (Omission, Insertion, Mispronunciation), phonèmes, sons faibles (< 60).
  - `src/lib/recorder.ts` : enregistreur WAV côté téléphone (Web Audio → 16 kHz mono 16 bits), compatible iPhone.
  - Page `/prononciation` (`src/components/shadowing.tsx`) : la voix lit la phrase (`/api/tts`, ElevenLabs, GET pour jouer dans le geste d'appui ; « Lentement » = vitesse 0,75), Cherif répète (appui / appui, 15 s max, vibration), mots colorés vert ≥ 80 / orange ≥ 60 / rouge, appui sur un mot = relecture lente, résumé de série (moyenne, mots à refaire, sons à soigner).
  - Phrases (`/api/prononciation/phrases`) : ses phrases corrigées et des phrases des personnages (4 dernières séances), phrases où il a raté des mots (`pron_attempts`), puis réserve par niveau (`src/config/shadowing.ts`). Le bilan propose « Répéter N phrases de la séance » (passage par `sessionStorage`).
  - Base : tables `pron_attempts` (notes, mots, jamais l'audio) et `pron_sounds` (par langue et phonème : essais, échecs, somme des notes). Suivi : moyenne 30 jours, barres par semaine, sons les moins réussis. Réglages : carte « Prononciation (Azure Speech) » avec la marche à suivre.
- **Oreille continue (27 oct.)** : `recognizeOnce` écoute en mode continu et termine après `endSilenceMs` (1,8 s mains libres, 1,5 s en prononciation, `null` en appui pour parler), relance la reconnaissance si le téléphone s'arrête seul, déduplique les résultats iPhone. Cause du « je n'ai pas compris » en boucle : la reconnaissance coupait à la première pause et envoyait des morceaux de phrase. Les phrases de relance disent désormais « souci de mon côté », jamais « je n'ai pas compris ».
- **Voix Google (Gemini)** (`src/lib/gemini.ts`, `src/config/gemini-voices.ts`, `/api/tts?engine=gemini`, `/api/diagnostic/gemini`, choix `gemini` dans `voice-engine.ts`) : clé Google AI Studio `GEMINI_API_KEY` (gratuite, sans carte), modèle « tts » choisi automatiquement parmi ceux du compte (ou `GEMINI_TTS_MODEL`), audio PCM 24 kHz converti en WAV, voix par personnage et pour le juge, repli ElevenLabs puis téléphone. **Retour du 27 oct.** : le modèle lisait parfois la consigne de style à voix haute (« Lis ceci lentement… ») → on envoie le texte seul et la vitesse se règle à la lecture (`playbackRate`, hauteur conservée) ; bruit en fin de phrase → `tidyPcm` recolle tous les morceaux audio renvoyés, retire l'octet orphelin, coupe la queue de silence et applique un fondu aux deux bouts ; le « grrrss » décrit par Cherif est un défaut connu de Gemini TTS (friture en fin de clip, sans correctif Google) → `noiseTailStart` repère une queue de bruit blanc (taux de passages par zéro > 0,3 sur des fenêtres de 10 ms, au-delà de 300 ms) et la coupe en gardant 150 ms fondus, sans toucher à un « s » final (à confirmer à l'oreille par Cherif). Piste suivante si Cherif valide : Gemini Live comme conversation temps réel moins chère qu'ElevenLabs.
- **Banc de test automatique** (`scripts/test/`) : `mock-services.mjs` imite l'API Claude et ElevenLabs (voix, TTS, STT, agent, jeton) ; `e2e.mjs` pilote l'app dans Chromium avec faux micro (`SpeechRecognition`), fausse synthèse, faux lecteur audio et faux `getUserMedia` ; `run-e2e.mjs` lance tout (`npm run test:e2e`, `SKIP_BUILD=1` pour rejouer sans reconstruire). 57 étapes, code d'accès actif pendant tout le banc. Réglages → « Tester Claude » (`/api/diagnostic/claude`) montre modèle, raison d'arrêt et extrait. Le mode éco ne casse plus sur une réponse vide de Claude : nouvelle tentative, puis le personnage relance ; les erreurs de réplique sont des avertissements passagers, pas un écran bloquant.
- **Audit du 27 oct. (après les retours « réponse vide » et « mots ajoutés »)** : revue complète du mode éco, 11 défauts corrigés, banc étendu à 28 étapes.
  - **Cause des réponses vides** : Haiku 5.5 réfléchit avant de répondre et cette réflexion compte dans `max_tokens` ; avec un plafond de 260, aucun texte ne sortait. Tous les appels passent par `src/lib/claude.ts` (`askClaude`) : plafond large (1 024 à 4 096), `output_config.effort: "low"`, réflexion coupée pour les répliques courtes (`thinking: disabled`), gardée en adaptatif pour le bilan et le niveau, repli automatique sans ces réglages si le modèle les refuse (400). Le faux Claude du banc reproduit le piège (petit plafond sans réflexion coupée → bloc `thinking` seul, arrêt `max_tokens`) et refuse `disabled` pour un modèle Opus/Sonnet.
  - **Mots ajoutés** : les résultats provisoires d'Android sont cumulés ; ils sont désormais fusionnés comme les finaux (`mergeTranscripts`) au lieu d'être mis bout à bout.
  - Moteur éco : l'appui pour parler et « Répète » coupent proprement la voix en cours (plus de double écoute ni de bascule en « idle » par une ancienne lecture), « Répète » ne rajoute plus la réplique au texte, appui pendant la réflexion refusé avec un message, délai de 250 ms entre la fin de la voix et l'ouverture du micro, réponse de Claude limitée à 25 s côté téléphone (`maxDuration` 60 côté serveur, deux tentatives au plus), bascule automatique sur enregistrement + Scribe quand la reconnaissance du téléphone existe mais refuse de tourner (iPhone installé), garde-fou si le téléphone n'envoie jamais `onend`, lecteur audio partagé protégé par un numéro de lecture.
  - Voix serveur : une réplique longue est découpée en morceaux de 260 caractères côté téléphone (`chunkForTts`), plafond serveur `/api/tts` à 600 ; la synthèse du téléphone attend tant qu'elle parle encore ; `unlockAudio` débloque aussi la synthèse vocale sur iPhone.
  - **Délai perçu** (retour « la bouche bouge mais rien ne sort ») : le personnage reste en « réfléchit » tant que le premier son n'a pas commencé (`Speaker.speak(text, rate, onStart)`), les morceaux de voix se fabriquent en parallèle et le premier se joue dès qu'il est prêt (plus d'attente de toute la réplique), et l'état affiche les temps mesurés « (Claude 1,2 s, voix 2,8 s) » (`onTiming`) pour savoir qui traîne. Un appui pendant la fabrication de la voix coupe la voix (`isSpeaking` = une lecture est en cours ou se prépare).
- **Retours du 28 oct. (personnages trop « profs », oreille, progression)** :
  - **Consignes par niveau de correction** (`src/lib/prompt.ts`) : les règles communes ne parlent plus que de conversation (répliques courtes, vraie personne, réagir au fond, suivre le niveau et monter la barre, honnêteté sans flatterie). La méthode d'enseignement (pousser à développer, tournures à réutiliser, tours de fluidité, reformuler, précision, trame quoi/pourquoi/exemple) est dosée par `TEACHING_RULES` : « aucune » (Max) = aucun enseignement pendant la discussion, tout au bilan ; « légère » = une tournure seulement quand il bloque ; « active » (Emma) = la méthode complète. Cause du retour « tout le monde me corrige » : cette méthode était commune à tous.
  - **Niveau et progression** : la consigne de niveau dit de parler un cran au-dessus et de monter encore si les réponses sont longues et justes ; sans test, le français part de B2 (il est francophone). Le bilan renvoie `level` + `levelWhy` (niveau observé sur ses lignes), enregistré dans `sessions.observed_level` ; `/api/sessions` (`updateProgression`) fait monter le niveau d'un cran après 3 séances de suite (≥ 3 min, ≥ 6 prises de parole) jugées au-dessus du niveau enregistré et postérieures à sa date, jamais redescendre (le test mensuel s'en charge) ; sans test, le premier palier est le plus bas des 3 niveaux observés. Le bilan affiche « Niveau observé aujourd'hui… encore N séances », et une célébration au passage de niveau ; Suivi montre les derniers niveaux observés.
  - **Oreille au choix du mode éco** (`src/lib/ear.ts`, `prof-langue:ear-choice`, choix sur l'accueil) : `phone` (reconnaissance du téléphone), `groq` (enregistrement WAV + Whisper `whisper-large-v3-turbo` via `src/lib/groq-stt.ts`, clé `GROQ_API_KEY` gratuite sans carte, ≈ 8 h/jour), `scribe` (ElevenLabs). `/api/stt` prend `engine=groq|scribe|auto` et renvoie `engine`. Réglages : carte « Oreille Groq ». Claude en mode éco passe à `effort: "medium"` (réponses plus riches, toujours sans réflexion longue).
  - Banc : faux Groq, faux `AudioContext` (niveau micro piloté par `window.__micLevel`), étapes « oreille Groq », « progression du niveau » (3 séances → B1), niveau dans le bilan : 30 étapes ; voix du PC simulée : 32 étapes.
- **Voix « Mon PC » (28 oct.)** : Cherif a un PC Windows avec RTX 4070 et Starlink. Dossier `pc-voix/` : serveur FastAPI (`server.py`, Chatterbox Multilingue `ChatterboxMultilingualTTS`, `t3_model="v3"`, français et anglais, une phrase à la fois sur le GPU, chauffe au démarrage, voix de référence facultatives dans `voix/<personnage>[.<lang>].wav`, mot de passe `PC_TTS_TOKEN` en Bearer), `Dockerfile` (python 3.11 + `chatterbox-tts`), `docker-compose.yml` (GPU NVIDIA, cache des modèles), guide Windows en français (`README.md` : pilote NVIDIA, Docker Desktop WSL 2, Tailscale Funnel `tailscale funnel --bg 8765`, variables Vercel). Côté app : `src/lib/pc-tts.ts` (`/health`, `/tts`, délai 20 s), `/api/tts?engine=pc`, `/api/diagnostic/pc`, choix `pc` dans `voice-engine.ts` (repli ElevenLabs puis téléphone, vitesse à la lecture), Prononciation, carte « Voix de mon PC » dans Réglages. **Installé et validé par Cherif sur sa 4070 (28 oct.)** : `/health` OK ; retour « français à l'anglaise » → Chatterbox copie l'accent de la référence, voix intégrée anglophone. Références livrées dans `pc-voix/voix/` (14 mp3 de `rhasspy/piper-samples`, voix de synthèse Piper issues de corpus libres, choisies par licence et hauteur mesurée : `default/prof/ami/grand-frere/debatteur/collegue/juge` × `fr/en`, crédits dans `CREDITS.md`), formats wav/mp3/m4a/ogg/flac, ordre `<personnage>.<lang>` > `<personnage>` > `default.<lang>` > `default`, image construite depuis le dépôt officiel (v3). Seule la machine ne peut pas atteindre archive.org/LibriVox ni Hugging Face (réseau du bac à sable) : seuls GitHub et PyPI passent. Le banc simule le PC (`/pc/health`, `/pc/tts`, panne sur « PANNE ») ; Cherif valide sur sa machine. Piste suivante : l'oreille Whisper sur le même PC.
- **Quatre gains rapides sur le délai du mode éco (28 oct.)** :
  - **Claude en flux** : `/api/eco/reply` avec `stream: true` renvoie du NDJSON (`delta` / `done` / `error`) via `streamClaude` (`src/lib/claude.ts`, mêmes replis que `askClaude`). Côté téléphone, `EcoEngine.respond()` découpe le texte en phrases au fil de l'eau (`SentenceBuffer` : jamais à l'intérieur d'une balise `<voice>`, ni sur une abréviation, phrase ≥ 15 caractères), prépare la voix de chaque phrase dès qu'elle est complète et joue la première pendant que Claude écrit la suite ; la bulle du personnage s'affiche en brouillon (`onDraft`) puis en définitif. Coupé par Cherif : seul ce qui a été dit entre dans le texte et l'historique. `claudeMs` = temps jusqu'à la première phrase complète.
  - **`Speaker.prepare(text, rate)` → `PreparedClip` (`play`, `dispose`)** dans `voice-engine.ts` : la fabrication démarre à la préparation, la lecture attend son tour ; `speak` = `prepare().play()`. Premier morceau d'une réplique = une seule phrase (`chunkForTts(text, 1)`), les suivants 260 caractères.
  - **Silence de fin mains libres 1,8 s → 1,3 s** (`END_SILENCE_MS`).
  - **Oreille « Mon PC »** : `faster-whisper large-v3-turbo` sur le GPU dans le même conteneur (`/stt`, `WHISPER_MODEL`, `entrypoint.sh` expose cuBLAS/cuDNN de PyTorch à CTranslate2, repli CPU int8), `pcTranscribe` dans `src/lib/pc-tts.ts`, `/api/stt?engine=pc` avec repli Groq/Scribe si le PC ne répond pas, choix `pc` dans `src/lib/ear.ts`. Naturel de Chatterbox réglable : `CHATTERBOX_EXAGGERATION` (0,6) et `CHATTERBOX_CFG` (0,4) dans `docker-compose.yml`.
  - Retour « voix encore robotique » : causes probables = références Piper synthétiques (remplacer par un enregistrement humain) et ancien modèle multilingue ; Dockerfile = version publiée 0.1.7 puis code récent (v3) par-dessus sans casser la construction (`resemble-perth` ne se compile pas chez Cherif depuis git).
  - Banc : faux Claude en flux SSE, faux `/pc/stt`, étapes « réplique éco en flux », oreille PC : 33 étapes.
  - Retour « la voix se coupe puis reprend » : la deuxième phrase n'était pas prête à la fin de la première (voix lente). `PreparedClip.ready` + `bufferBeforeFirst` : avant la toute première phrase, on attend que la deuxième soit prête (ou que Claude ait fini), au plus 2,5 s, sauf voix du téléphone. Grésillements : `tidy()` côté PC (silence rogné, fondu 15 ms, crête à -1 dB) et réglages Chatterbox revenus à 0,5 / 0,5 (les plus stables).
- **V5 (28 oct.) : mode « Temps réel (mon PC) »**, livré, à valider par Cherif sur sa machine.
  - **PC** (`pc-voix/server.py`, point `/live` WebSocket) : ticket HMAC-SHA256 (`exp.sig`, signé par Vercel avec `PC_TTS_TOKEN`, 3 h), trames PCM 16 kHz 16 bits en continu, VAD Silero (`silero-vad`, fenêtres de 512 échantillons ; départ ≈ 100 ms de voix, fin ≈ 700 ms de silence, 45 s max, 320 ms de marge avant le début), transcriptions partielles toutes les secondes (`partial`), fin de phrase → Whisper → `user` → Claude en flux (`AsyncAnthropic`, `thinking: disabled`, `output_config.effort: medium` avec repli `TypeError`) → `SentenceBuffer` Python (mêmes règles que le téléphone) → Chatterbox phrase par phrase (`speak` + trame binaire WAV) → `agent` ; `timing` après la première phrase ; barge-in : voix nette ≥ 250 ms pendant que le personnage parle (`speaking_until` estimé à partir de la durée des WAV envoyés) → annulation de la réponse + `interrupt` ; commandes `interrupt`, `flush` (appui relâché), `repeat`, `end` ; chien de garde 800 ms sans trame ; `ANTHROPIC_API_KEY` dans `pc-voix/.env` (le PC appelle Claude lui-même). Historique envoyé par le téléphone au `start` (reprise après changement de réglage).
  - **Vercel** : `/api/live/session` (`prepareSession` + `SPOKEN_RULES` déplacées dans `session-prompt.ts`, ticket, URL `ws(s)://…/live`). Séances `engine = 'live'`, coût 0, hors plafond.
  - **Téléphone** : `src/lib/live-engine.ts` (même interface que `EcoEngine` : `start/setMuted/setHandsFree/pushToTalk/interrupt/repeatLast/end`, `onDraft`, `onTiming`), `src/lib/mic-stream.ts` (micro → Int16 16 kHz par morceaux de 4096, annulation d'écho activée), lecture Web Audio calée sans trou (`decodeAudioData`, `nextStart`), `interrupt` local + serveur, appui pour parler = trames pendant l'appui + `flush`. `app.tsx` : moteur `live` (troisième choix « Temps réel (mon PC) » affiché si `remote.pc.configured`), branche commune éco/live (`body`, `callbacks`, `common`), en-tête « temps réel (mon PC) ».
  - Banc : faux PC WebSocket (`ws` en dépendance de dev, `/pc/live` : `ready`, première réplique, énergie des trames → `partial`/`user`/`delta`/`speak`/`agent`/`timing`, `repeat`, `flush`), faux `AudioContext` avec `decodeAudioData`/`createBufferSource` : 36 étapes. Non vérifié ici : VAD/Whisper/Claude réels sur le GPU, l'écho micro/haut-parleur du téléphone, le ressenti de latence.
  - **Retours du 29 oct.** : « clé Anthropic refusée » → `clean_env` (guillemets, espaces, CR), `check_claude()` au démarrage, `/health.claude` (ok, indice de clé, erreur) et `/health.live`, affichés par `/api/diagnostic/pc` et la carte Réglages. « Connexion au PC coupée » → quand le PC ne répond pas au démarrage d'une séance temps réel, `start()` relance la même séance en mode éco (`startRef`, avis « continue en mode éco » posé après le redémarrage pour ne pas être effacé) ; messages de coupure distincts (immédiate = voir les journaux, en cours = veille/réseau) ; côté PC, une trame ou commande qui lève une exception est ignorée au lieu de fermer la séance (octet orphelin, tableau contigu pour le VAD). Banc : interrupteur `POST /__pc {down}` du faux PC, étape « PC éteint → repli éco » : 37 étapes. Guide : veille Windows, relance Docker/Tailscale, journaux.
  - **Disjoncteur PC** (`src/lib/pc-tts.ts`) : après un échec réseau ou un `/health` en erreur, le PC est tenu pour éteint 60 s (`markPcDown`, `pcLikelyDown`) et `pcSpeak`/`pcTranscribe` échouent tout de suite (repli ElevenLabs/Groq immédiat au lieu d'un délai par phrase : cause de la voix lente et hachée vue par Cherif avec la voix « Mon PC » et le PC éteint). `/api/pc/ping` (3 s) ; au début d'une séance éco avec voix ou oreille « pc », l'app pingue et bascule la séance sur ElevenLabs/Groq avec un avis passager ; `/api/live/session` vérifie `/health` (3 s, `live`, clé Claude) avant de donner un ticket → 503 immédiat → repli éco ; délai de connexion WebSocket 8 s ; l'avis de repli est un toast, plus un écran « Reprendre ».
  - **Voyant « PC » sur l'accueil (29 oct.)** : après le retour « pourtant le PC est allumé » (PC sous tension mais Docker Desktop arrêté après un redémarrage Windows, visible seulement dans PowerShell), une carte `PcIndicator` (`usePcStatus`, affichée quand `remote.pc.configured`) pingue `/api/pc/ping` au chargement : vert « PC en ligne : temps réel prêt », orange « en ligne mais temps réel pas prêt » (clé Anthropic refusée → message dédié grâce à `claudeOk`), rouge « PC hors ligne : lance Docker Desktop puis docker compose up -d ; le temps réel repasse en mode éco ». Bouton « Revérifier » → `/api/pc/ping?force=1` passe outre le disjoncteur de 60 s. Banc : voyant hors ligne pendant la panne simulée, puis Revérifier → en ligne (38 étapes) ; le faux `/pc/health` renvoie `live` et `claude`.
- **Rapport de test du 29 oct. (23 points, tous traités, un commit par point, PR #43 à #46)** :
  - **P0** : chaîne de secours unique de la voix côté serveur (`src/lib/tts-chain.ts` : moteur demandé → ElevenLabs → PC, Google seulement si choisi, 4 s par moteur, 6 s pour le PC ; `quota_exceeded` mémorisé 10 min ; en-têtes `X-Voice-Engine` / `X-Voice-Fallback` ; côté téléphone Kokoro déjà chargé puis voix du téléphone, bandeau « Voix de secours : … · crédit ElevenLabs épuisé », `onFallback` dans `createSpeaker`). Frein du code d'accès (`src/lib/access-limit.ts`, table `acces_tentatives` : 5 essais faux par adresse ou 15 au total → 429 pendant 15 min, bon code refusé aussi, `timingSafeEqual`). Vrais crédits ElevenLabs (`src/lib/elevenlabs-quota.ts`, `GET /v1/user/subscription`, `/api/elevenlabs/quota`, mémoire 1 min, efface le quota mémorisé quand le crédit revient) dans Suivi, Réglages et l'accueil (≥ 80 %) ; réglage `planFcfa` (prix de l'abonnement) pour un coût du mois réel.
  - **P1** : `stripVoiceTags()` (`src/lib/text.ts`) sur tout texte affiché ; série de jours par UNE fonction serveur (`src/lib/streak.ts`, `dayStats`, fuseau Africa/Dakar) pour accueil, suivi et bilan (`/api/sessions` la renvoie), mémoire du téléphone ignorée quand la base existe, `todayAllMinutes` (objectif, tout moteur) distinct de `todayMinutes` (plafond ElevenLabs) ; accueil en squelette tant que les préférences ne sont pas lues (`useMounted`) ; compteurs de mots par langue et par la même requête (`counts`, `dueByLanguage`, `wordsByLanguage`) ; séance sans prise de parole non comptée (`counted`, ni bilan, ni enregistrement) ; niveau « estimé en séance » dans le suivi ; garde-fou 10 s du bouton Écouter ; barre d'objectif vide à 0, theme-color sombre par défaut, `not-found.tsx`.
  - **P2** : sujets et messages relus, sujet en minuscule au milieu d'une phrase (`fillTemplate`) ; variante d'anglais (`english_variant`, `englishVariantNote()` dans conversation, bilan, sujets) ; fiches `words.kind = 'plus-naturel'` distinctes des corrections, dédoublonnage (`src/lib/words-dedupe.ts`, distance ≤ 15 %, sans « please ») à l'enregistrement et à l'ajout ; règle « anglais parlé d'aujourd'hui » (How do you do? = vieilli) ; phrases de prononciation prises d'abord dans le carnet, telles quelles ; carnet : 🔊 (voix gratuite), ✎, ✕, action `edit`. **Bug trouvé** : les ids `bigserial` arrivent en texte et `/api/mots` les refusait → les révisions « Je savais / Pas encore » n'étaient jamais enregistrées (corrigé, couvert par le banc).
  - **P3** : accueil simplifié (Micro / Qualité « Max (ElevenLabs) » ou « Économique (auto) » / Vitesse ; `prof-langue:auto` → au début de séance : PC si en ligne, sinon Google / Kokoro / téléphone et Groq / téléphone) ; `/reglages/avance` (`advanced-settings.tsx`) pour le choix détaillé ; `/reglages` = objectif quotidien (`goal_minutes`), niveau, anglais, dépenses, rappels ; `/admin` (`admin.tsx`) = diagnostics sans hôte de base, adresse Tailscale ni SQL ; barre d'onglets fixe (`tab-bar.tsx`, 44 px) ; fondu à droite de la rangée des personnages ; saisie au clavier en séance (`EcoEngine.sendText`, `LiveEngine.sendText` + commande `text` dans `pc-voix/server.py`, ElevenLabs via `sendUserMessage`) ; suivi : barres depuis la première séance ; bilan : carte « Mots du jour » sans vide.
  - Non couvert par le banc : vrai ElevenLabs (quota, voix), vrai PC (Chatterbox, Whisper, temps réel, commande `text`), Samsung réel. Cherif doit mettre à jour `pc-voix/server.py` sur son PC pour la saisie au clavier en temps réel.
- **Rapport « voix du temps réel » du 29 oct. (coupures et naturel)** : cause confirmée par Cherif en appui pour parler = trous entre deux morceaux de voix (la carte fabrique moins vite qu'elle ne lit : ≈ 5 s pour « Hello »).
  - **Étape 0 (mesure)** : `synthesize()` journalise par phrase caractères, fabrication, durée, RTF (`record_rtf`, 20 dernières dans `/health.rtf`), un `timing` par morceau (`seq`, `voiceMs`, `audioMs`, `rtf`, `claudeMs` sur le premier) ; `/api/diagnostic/pc` et Admin → Mon PC affichent la moyenne ; `/pc/tts` renvoie `X-Audio-Ms`, `X-Rtf`, `X-Engine`.
  - **A2 téléphone** (`live-engine.ts`) : réserve avant de parler (`maybeStartPlayback` : RTF inconnu ou > 1 → attendre `agent`, plafond 12 s ; sinon 2 morceaux, 3 s d'audio, RTF ≤ 0,8 ou 2,5 s), le personnage « réfléchit » pendant l'attente, plus de bascule en « écoute » entre deux morceaux (`maybeFinishReply`, abandon après 15 s sans son), commande `playback {playing}` envoyée au PC, RTF lissé à partir des `timing`.
  - **A2 PC** : conditionnels de la voix de référence préparés une fois par (moteur, fichier, date) et gardés en mémoire (`conditionals_for`, plus de décodage mp3 ni d'empreinte à chaque phrase), première phrase seule puis morceaux regroupés jusqu'à ≈ 120 caractères (`GROUP_CHARS`, juge et Leo jamais mélangés), réglages `CHATTERBOX_FP16` (autocast fp16) et `CHATTERBOX_CFG=0` documentés dans `docker-compose.yml` (à mesurer par Cherif).
  - **B1** : Admin → « Enregistrer une voix » (`voice-recorder.tsx`, MediaRecorder, texte vivant de 15 s, réécoute) → `/api/voix-pc` → `POST /voices` sur le PC (conversion librosa en WAV 24 kHz mono, 20 s max, `voix/<personnage>.<langue>.wav`, cache des empreintes vidé) ; dossier `voix` monté en écriture.
  - **A1** : `agent_busy` = réponse en cours ou lecture (d'après `playback`, sinon `speaking_until`) → aucune prise de parole normale pendant la réponse ; barge-in = ≈ 600 ms de voix > 0,85 puis vérification Whisper (`confirm_barge` : ≥ 2 mots et pas l'écho des dernières phrases dites, `looks_like_echo` par distance d'édition sur les mots) avant de couper ; filtre des hallucinations dans `transcribe()` (`no_speech_prob` > 0,6, `avg_logprob` < -1, phrases typiques du bruit sur < 1,5 s) pour le temps réel et `/stt` ; réglage « Me couper à la voix » (`prof-langue:barge-in`, non par défaut : en mains libres le micro ne part pas pendant la réponse, Cherif coupe en appuyant) ; micro et lecture dans le même `AudioContext`.
  - **B2** : `PC_TTS_ENGINE=turbo` charge Chatterbox Turbo pour l'anglais (chargé seulement si demandé, repli multilingue), `/tts` accepte `engine`, page `/test-voix-pc` (`pc-voice-test.tsx`, `/api/diagnostic/pc-voix`) compare les moteurs avec les temps ; Kyutai TTS proposé, pas installé. **B3** : une voix payante au caractère n'est pas ajoutée tant que Cherif n'a pas choisi.
  - Banc : faux PC avec `timing` par morceau, interrupteur `slow` (2e phrase 1,5 s après la 1re, RTF 1,7), journal `/__live` (ordre speak/agent/playback, trames reçues pendant la réponse), `POST /pc/voices`, `engines` ; étapes « PC lent : lecture après `agent` », « sans couper à la voix, zéro trame pendant la réponse ; avec, des trames », « voix envoyée, RTF, moteurs ». Non vérifiable ici : le RTF réel de la 4070, l'écho du Samsung, la qualité des voix enregistrées, la logique Python du barge-in (pas de banc Python).
- Toutes les versions prévues (V0 à V4) sont livrées et validées. Suite possible, à choisir avec Cherif : discussion à partir d'une vidéo YouTube, app native avec Expo, ou améliorations d'usage (badges, célébrations, maquette d'avatars illustrés).
