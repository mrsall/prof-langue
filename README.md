# Prof de langues IA

Web app mobile pour parler anglais (puis français) à voix haute avec une IA qui répond avec une voix naturelle. Le cahier des charges complet est dans `CLAUDE.md`.

## Où en est le projet : V4 validée (prononciation, shadowing, suivi des sons, mode éco)

Nouveau depuis la V3 :

- **Prononciation** (écran Prononciation, aussi depuis le bilan) : la voix dit une phrase, tu la répètes, et chaque mot est noté et coloré (vert : bien, orange : à soigner, rouge : raté ou oublié). Appuie sur un mot pour l'entendre lentement. À la fin de la série : ta moyenne, les mots à refaire et les sons à soigner.
- **Phrases utiles** : d'abord tes propres phrases corrigées des dernières séances et des phrases des personnages, puis les phrases où tu avais raté des mots, puis une réserve adaptée à ton niveau.
- **Suivi** : moyenne de prononciation sur 30 jours, évolution par semaine, sons les moins réussis (anglais et français).
- **Rien à payer** : c'est la reconnaissance vocale de ton téléphone qui écoute (Google sur Android, Apple sur iPhone). L'app compare mot à mot avec la phrase modèle, et Claude explique en une phrase comment placer le son raté. Pour une note son par son plus fine, Azure Speech reste possible en option (voir « 2 ter »), mais ce n'est pas nécessaire.
- **Mode éco pour la conversation** (accueil → « Micro et vitesse » → « Mode éco ») : le téléphone écoute gratuitement, Claude réfléchit, et seule la lecture de la réponse est confiée à la voix de ton choix. Zéro minute de conversation ElevenLabs. Pour interrompre le personnage, tu appuies sur le micro. Les personnages, la correction, le bilan et le carnet sont les mêmes.
- **Voix « Mon PC », gratuite et illimitée** : le dossier `pc-voix/` fait tourner Chatterbox Multilingue (libre, MIT) sur la carte NVIDIA du PC de Cherif, dans Docker, joint par un tunnel Tailscale ; guide pas à pas Windows dans `pc-voix/README.md`. Dans Vercel : `PC_TTS_URL` et `PC_TTS_TOKEN`. PC éteint : repli automatique sur ElevenLabs.
- **Mode éco en flux** : Claude répond au fil de l'eau et la voix lit la première phrase pendant que la suite s'écrit ; silence de fin de phrase à 1,3 s en mains libres ; l'oreille « Mon PC » (Whisper sur la carte graphique) complète la voix du PC.
- **Oreille Groq (Whisper), gratuite** : avec une clé Groq (console.groq.com → API Keys, sans carte bancaire) mise dans Vercel sous le nom `GROQ_API_KEY`, l'oreille « Groq » du mode éco enregistre ta phrase et la fait transcrire par Whisper : bien meilleure compréhension de l'accent que la reconnaissance du téléphone, pour environ une seconde de plus. L'oreille « ElevenLabs » (Scribe) fait pareil en décomptant ton abonnement.
- **Voix Google (Gemini), gratuite** : avec une clé Google AI Studio (aistudio.google.com → Get API key, sans carte bancaire) mise dans Vercel sous le nom `GEMINI_API_KEY`, la voix « Google (gratuite) » lit les répliques en français et en anglais, de façon naturelle. Réglages → carte « Voix Google » pour la tester. Si Google ne répond pas, ElevenLabs prend le relais.
- **L'oreille écoute jusqu'au vrai silence** : la reconnaissance du téléphone coupait à la première pause d'une seconde ; l'app écoute maintenant en continu et considère la phrase finie après 1,8 s sans nouveau mot (en appui pour parler : jusqu'au relâchement).
- **Quatre voix pour le mode éco et la prononciation** : **ElevenLabs** en lecture seule (voix naturelle des deux langues ; consomme des caractères de ton abonnement, bien moins chers que les minutes de conversation : environ deux fois plus de séances par mois), **Kokoro** (voix naturelle fabriquée dans le téléphone, gratuite, anglais seulement, 90 Mo à charger la première fois ; le français bascule sur ElevenLabs), **Téléphone** (voix de synthèse du système, gratuite, de dépannage).
- En français, l'objectif est d'être compris facilement, pas d'effacer l'accent : la note mesure la clarté.

### Ce qui venait de la V3 (niveau, bilan complet, carnet, suivi, rappels, plafond)

Tout ce qui existait en V2 (six personnages, anglais et français, sujets, correction réglable, mains libres) reste, et l'app garde maintenant une mémoire grâce à une base de données :

- **Test de niveau** (5 minutes avec Emma, par langue) : proposé sur l'accueil au début, puis tous les mois. Le niveau obtenu (A1 à C2) est utilisé par tous les personnages pour adapter leur vocabulaire.
- **Bilan complet** : minutes, prises de parole, 3 points à retenir avec la bonne forme et une explication, les mots du jour, un encouragement, le coût estimé de la séance, et le **texte de la séance** avec tes phrases corrigées surlignées.
- **Carnet de mots** (écran Carnet) : les mots du jour y arrivent tout seuls. Révision espacée à J+1, J+3, J+7, J+21 : une carte, tu appuies pour voir la réponse, puis « Je savais » ou « Pas encore ». Ou **révision à la voix avec Emma**.
- **Suivi** : jours de suite, minutes par semaine, niveau par langue, carnet, avec qui tu parles, coût du mois.
- **Rappel quotidien** : une notification par jour avec un sujet, à l'heure choisie dans Réglages (sur iPhone, installe d'abord l'app sur l'écran d'accueil).
- **Plafond de dépense** : coût par minute et plafond quotidien dans Réglages ; l'app prévient avant de lancer une séance au-delà, et pendant la discussion.
- **Code d'accès** : si tu définis `APP_PIN` dans Vercel, l'app demande un code une fois par téléphone. Sans ça, n'importe qui ayant l'adresse peut utiliser tes minutes ElevenLabs.

Les personnages se souviennent des sujets de vos dernières séances. Les notes de prononciation arrivent en V4.

Depuis l'audit du 25 octobre :

- **Personne ne te flatte.** Emma dit « non, pas comme ça » et te fait redire la bonne forme. Les autres restent francs : ils ne félicitent jamais une phrase fausse et peuvent ne pas être d'accord avec toi.
- **Débat à trois** : un juge (voix différente) donne le sujet et te demande ton camp, Leo prend l'autre camp et ne corrige jamais ta langue, puis le juge dit qui a gagné et pourquoi. Le bilan montre le verdict, ton meilleur argument, toutes tes erreurs, et un bouton **« Refaire le débat »** : même sujet, mêmes camps, le juge vérifie si tu as corrigé ses remarques.
- **Mémoire des erreurs** : Emma et le juge connaissent tes erreurs des dernières séances et vérifient qu'elles ne reviennent pas.
- **Rappels** : le serveur passe à 8 h et à 18 h (heure de Dakar) ; choisis l'une des deux dans Réglages.

## Mise en route (à faire une seule fois)

### 1. L'agent ElevenLabs

Si tu as déjà l'agent de la V0, garde-le. Sinon : [elevenlabs.io](https://elevenlabs.io) → **Agents** → **Create agent** → **Blank agent**, langue **English**, puis copie l'**Agent ID** (commence par `agent_`).

Les consignes de Max, sa première phrase, sa voix et sa vitesse sont envoyées par l'app au début de chaque séance. L'agent doit l'autoriser, et il faut lui choisir Claude Haiku comme cerveau. **Pas besoin de cliquer dans le dashboard** : une fois l'app déployée, ouvre la page **Réglages** (lien en bas de l'accueil, ou `/reglages`) et appuie sur **Configurer l'agent automatiquement**. La page montre ensuite ce qui est prêt.

Si tu préfères le faire à la main : agent → **Security** → **Overrides** → activer **System prompt**, **First message**, **Voice ID**, **Speed** ; onglet **Agent** → **LLM** → **Claude Haiku**.

### 2. Les clés

- **ElevenLabs** : profil → **API Keys** → **Create API key**.
- **Anthropic** (pour les mots du jour du bilan) : [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create key**. Facultatif : sans elle, le bilan n'affiche pas les mots du jour.

### 2 bis. La base de données (nouveau en V3)

1. Va sur [supabase.com](https://supabase.com), crée un compte gratuit, puis **New project** (choisis un mot de passe de base de données et garde-le).
2. Dans le projet, bouton **Connect** en haut → onglet **Transaction pooler** (ou « Session pooler ») → copie la chaîne qui commence par `postgresql://` et remplace `[YOUR-PASSWORD]` par ton mot de passe.
3. Dans Vercel, ajoute cette chaîne sous le nom `DATABASE_URL`, puis Redeploy. Les tables se créent toutes seules à la première ouverture. La page **Réglages** indique « Base de données : Prête ».

### Si Réglages dit « la création des tables a échoué » ou « bloquée »

L'app crée ses tables toute seule, mais Supabase peut la bloquer si une table est ouverte dans l'éditeur du tableau de bord. Deux solutions :

1. Ferme les onglets Supabase (Table Editor, SQL Editor), attends une minute, puis « Réessayer » dans Réglages.
2. Ou applique le schéma à la main : Réglages → Base de données → « SQL de secours » → Copier, puis dans Supabase → SQL Editor → New query → coller → Run. Chaque ligne est sans danger si la table existe déjà.

### 2 ter. La clé Azure pour la prononciation (V4, facultatif)

La prononciation fonctionne sans rien configurer, avec la reconnaissance vocale du téléphone. Azure n'apporte qu'une note son par son plus fine ; il demande une carte bancaire à l'inscription. Si tu veux l'essayer un jour :

1. Va sur portal.azure.com et crée un compte (le niveau Free n'est pas facturé).
2. « Créer une ressource », cherche **Speech** (Azure AI services), clique sur Créer.
3. Région : **France Central** (ou West Europe). Niveau tarifaire : **Free F0** (5 heures d'audio par mois).
4. Quand la ressource est prête, ouvre « Clés et point de terminaison » : copie **KEY 1** et note la **Région** (par exemple `francecentral`).
5. Dans Vercel, ajoute `AZURE_SPEECH_KEY` et `AZURE_SPEECH_REGION`, puis Redeploy. Dans Réglages, la carte « Prononciation » doit passer à « Prête ».

### 3. Les variables dans Vercel (jamais dans le code)

Vercel → ton projet → **Settings** → **Environment Variables** :

| Variable | Valeur |
| --- | --- |
| `ELEVENLABS_API_KEY` | ta clé ElevenLabs |
| `ELEVENLABS_AGENT_ID` | l'Agent ID |
| `ANTHROPIC_API_KEY` | ta clé Anthropic (mots du jour, corrections, sujets, niveau) |
| `DATABASE_URL` | la chaîne de connexion Supabase (carnet, suivi, niveau, rappels) |
| `GEMINI_API_KEY` | facultatif : clé Google AI Studio pour la voix Google gratuite |
| `GROQ_API_KEY` | facultatif : clé Groq (gratuite, sans carte) pour l'oreille Whisper du mode éco |
| `PC_TTS_URL`, `PC_TTS_TOKEN` | facultatif : adresse Tailscale et mot de passe du serveur de voix sur le PC de Cherif (`pc-voix/`) |
| `AZURE_SPEECH_KEY` | facultatif : la clé KEY 1 d'une ressource Azure Speech (note son par son) |
| `AZURE_SPEECH_REGION` | facultatif : la région de cette ressource, ex. `francecentral` |
| `APP_PIN` | un code de ton choix pour protéger l'app (conseillé) |

Coche les trois environnements. Après un ajout, relance un déploiement (**Deployments** → les trois points → **Redeploy**). Le fichier `.env.example` liste toutes les variables possibles.

### 4. Tester sur ton téléphone

1. Ouvre l'adresse Vercel dans **Chrome** (Android) ou **Safari** (iPhone). Pour l'installer : menu du navigateur → **Ajouter à l'écran d'accueil**.
2. Appuie sur **Commencer**, autorise le micro.
3. Choisis la langue, le personnage et un sujet, puis discute 10 minutes. Essaie **Répète**, **Vitesse**, **Correction** et **Texte**, et interromps le personnage en parlant pendant qu'il parle.
4. Appuie sur **Terminer** et regarde le bilan.

### 5. Ce que tu me dis ensuite (après une semaine d'usage quotidien)

- Le test de niveau : le niveau affiché te semble-t-il juste ?
- Le bilan et le texte corrigé : clairs, utiles, lisibles en 30 secondes ?
- Le carnet : les mots reviennent-ils au bon moment ? La révision à la voix te plaît-elle ?
- Les rappels : les as-tu reçus à la bonne heure ?
- La prononciation (V4) : ouvre Prononciation, appuie sur « Écouter », puis sur le gros bouton et répète ; l'écoute s'arrête toute seule à la fin de ta phrase. Les couleurs correspondent-elles à ce que tu ressens ? Un mot que tu sais mal dire doit ressortir orange ou rouge, avec un conseil. Fais aussi une série en français.
- Le mode éco : sur l'accueil, ouvre « Micro et vitesse », choisis « Mode éco (gratuit) », lance une séance. Le personnage doit parler avec la voix du téléphone et te répondre après chaque phrase. Dis-moi si la voix est supportable et si le délai est acceptable.
- Depuis un bilan : le bouton « Répéter N phrases de la séance » doit ouvrir la prononciation avec tes phrases du jour.
- Le plafond et le coût estimé : cohérents avec ta facture ElevenLabs ? (ajuste le coût par minute dans Réglages)

Quand tu valides la V3, on passe à la V4 (prononciation, shadowing, suivi des sons).

## Pour les développeurs

### Banc de test avant livraison

```
npx tsc --noEmit && npx eslint src --max-warnings=0
DATABASE_URL=postgres://... npm run test:e2e        # SKIP_BUILD=1 pour rejouer sans reconstruire
```

Le banc lance un faux Claude et un faux ElevenLabs (`scripts/test/mock-services.mjs`), construit l'app, puis la pilote dans un navigateur avec un faux micro et une fausse voix (`scripts/test/e2e.mjs`) : séance éco complète, réponse vide de Claude, réplique longue lue en morceaux, appui pendant la réflexion, bilan, prononciation, suivi, carnet, réglages, débat avec juge, repli de voix, appui pour parler, et les routes serveur (séance ElevenLabs, agent, voix, lecture, sujets, bilan, niveau, transcription, phonèmes). Les captures des étapes en échec sont écrites dans `SHOTS_DIR`.

```bash
npm install
cp .env.example .env.local   # puis remplis les valeurs
npm run dev                   # http://localhost:3000
npm run lint && npm run build
```

Structure :

- `src/components/app.tsx` : les quatre écrans (accueil, sujet, conversation, fin de séance) et la logique de séance.
- `src/components/push-to-talk-button.tsx` : bouton « maintiens pour parler ».
- `src/components/persona-avatar.tsx` : avatar illustré de chaque personnage, animé quand il parle.
- `src/config/personalities.ts` : les six personnalités (prénom, caractère, consignes EN et FR, avatar). `src/config/topics.ts` : sujets de secours. `src/config/correction.ts` : niveaux de correction. `src/config/voices.ts` : voix. `src/config/speeds.ts` : vitesses.
- `src/lib/prompt.ts` : assemble les consignes envoyées à l'agent (personnage, règles, correction, sujet, souvenirs).
- `src/app/api/sujets/route.ts` : sujets proposés par Claude (liste de secours sans clé).
- `src/lib/history.ts` : historique des séances sur le téléphone (souvenirs, sujets récents).
- `src/app/api/elevenlabs/session/route.ts` : crée le jeton de conversation et prépare les consignes envoyées à l'agent. La clé API ne va jamais sur le téléphone.
- `src/app/api/bilan/route.ts` : mots du jour et encouragement via Claude (Haiku par défaut).
- `src/app/api/elevenlabs/agent/route.ts` et `/reglages` : état de l'agent ElevenLabs et réglage automatique (overrides, LLM Claude Haiku, variable `ELEVENLABS_AGENT_LLM` pour changer de modèle).
- `src/lib/progress.ts` : série de jours et minutes du jour (stockage local, V1).
- `src/lib/db.ts` : connexion Postgres et création automatique des tables (`settings`, `sessions`, `words`, `errors`). `src/lib/settings.ts` : niveau, coût, rappel.
- `src/app/api/sessions`, `/api/mots`, `/api/niveau`, `/api/suivi`, `/api/reglages`, `/api/rappels` (+ `/envoyer` pour le cron de `vercel.json`), `/api/acces`.
- V4 : `src/lib/speech.ts` (reconnaissance et synthèse vocales du téléphone), `src/lib/pronunciation-text.ts` (comparaison mot à mot), `src/lib/pronunciation.ts` (Azure Speech REST, option), `src/lib/stt.ts` (Scribe ElevenLabs en secours), `src/lib/recorder.ts` (WAV 16 kHz côté téléphone), `src/components/shadowing.tsx` (écran), `/api/prononciation` (note une phrase, Claude explique le son, garde notes et sons, jamais l'audio), `/api/prononciation/phrases`, `/api/tts`, `src/config/shadowing.ts`.
- Mode éco : `src/lib/eco-engine.ts` (oreille + voix du téléphone, boucle de dialogue), `/api/eco/reply` (une réplique de Claude avec les consignes de `src/lib/session-prompt.ts`, partagées avec la séance ElevenLabs), `/api/stt` (secours Scribe). Les séances éco sont enregistrées avec `engine = 'eco'` et un coût de 0.
- `src/components/carnet.tsx`, `suivi.tsx`, `settings-v3.tsx`, `acces.tsx` : écrans V3. `src/proxy.ts` : code d'accès. `public/sw.js` : notifications.
- `src/components/voice-test.tsx` et `/test-voix` : page de test des voix (V0).
