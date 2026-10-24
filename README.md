# Prof de langues IA

Web app mobile pour parler anglais (puis français) à voix haute avec une IA qui répond avec une voix naturelle. Le cahier des charges complet est dans `CLAUDE.md`.

## Où en est le projet : V0 (test des voix)

La V0 est une seule page : tu choisis une voix parmi trois, tu appuies sur **Parler**, et tu discutes en anglais. L'écran affiche le délai de réponse mesuré à chaque tour. Le but est que tu choisisses **la voix la plus naturelle** et que tu vérifies que **le délai est acceptable** (objectif : moins de 2 secondes).

Voix proposées (modifiables dans `src/config/voices.ts`) :

| Voix | Accent | Genre |
| --- | --- | --- |
| Brian | américain | homme |
| Jessica | américain | femme |
| George | britannique | homme |

## Mise en route (à faire une seule fois, environ 15 minutes)

### 1. Créer l'agent dans ElevenLabs

1. Va sur [elevenlabs.io](https://elevenlabs.io), menu **Agents** (ElevenAgents), puis **Create agent** → **Blank agent**.
2. Nom : `Prof de langues V0`. Langue : **English**.
3. **First message** (ce qu'il dit en premier) :
   `Hey Cherif! Good to see you. How's your day going so far?`
4. **System prompt** : colle le texte ci-dessous.
5. **LLM** : choisis un modèle rapide (par exemple Gemini Flash ou GPT-4o mini, peu importe pour la V0).
6. **Voice** : laisse celle par défaut, l'app impose la voix choisie à chaque conversation.
7. Onglet **Security** (ou **Advanced** → **Overrides**) : active l'override **Voice ID** (parfois nommé « TTS voice »). Sans ça, les trois voix sonneront pareil.
8. Enregistre, puis copie l'**Agent ID** (il commence par `agent_`).

Texte du system prompt :

```
You are a friendly English-speaking buddy helping Cherif, a French speaker from Senegal, practice spoken English.
Rules:
- Keep every reply short: one to three sentences, then ask a question or invite him to continue.
- Use simple, natural everyday English with contractions. Speak at a relaxed pace.
- Never mock his accent. Never say "error". If he makes a mistake, just use the correct form naturally in your reply.
- If he asks "how do you say ..." in French, give the English word or phrase, ask him to repeat it once, then continue.
- If he is silent or stuck, suggest a sentence starter or two possible answers.
- Topics you like: tech, anime, video games, football, movies, his day.
```

### 2. Récupérer une clé API ElevenLabs

Sur elevenlabs.io : icône de profil → **API Keys** → **Create API key**. Laisse les permissions par défaut, copie la clé. Elle ne s'affiche qu'une fois.

### 3. Mettre les clés dans Vercel (jamais dans le code)

1. Sur [vercel.com](https://vercel.com), **Add New → Project**, importe ce dépôt GitHub. Garde les réglages par défaut (Next.js).
2. Avant de déployer, ouvre **Environment Variables** et ajoute :
   - `ELEVENLABS_API_KEY` = ta clé API
   - `ELEVENLABS_AGENT_ID` = l'Agent ID
   Coche les trois environnements (Production, Preview, Development).
3. Clique **Deploy**. À la fin, Vercel donne une adresse du type `https://prof-langue.vercel.app`.

Le fichier `.env.example` liste toutes les variables possibles.

### 4. Tester sur ton téléphone

1. Ouvre l'adresse Vercel dans **Chrome** (Android) ou **Safari** (iPhone).
2. Appuie sur **Parler avec Brian**, autorise le micro quand le téléphone le demande.
3. Parle en anglais. L'IA répond, et tu peux lui couper la parole en parlant par-dessus.
4. Fais au moins 5 échanges par voix, puis **Terminer** et change de voix.
5. Appuie sur l'étoile ☆ de la voix que tu préfères.
6. Dans **Réglages**, tu peux basculer entre WebRTC et WebSocket si la voix coupe ou si le délai est long. Compare les deux.
7. Pour installer l'app sur l'écran d'accueil : menu du navigateur → **Ajouter à l'écran d'accueil**.

### 5. Ce que tu me dis ensuite

- La voix que tu préfères (et si tu veux en tester d'autres).
- Le délai moyen affiché pour chaque voix, et si ça te semble naturel.
- Si la connexion a coupé, à quel moment, et avec quel réseau (wifi, 4G).
- Si l'IA t'a bien laissé l'interrompre.

Quand tu valides la V0, on passe à la V1 (mode ami complet, appui pour parler, Répète, vitesse de la voix).

## Pour les développeurs

```bash
npm install
cp .env.example .env.local   # puis remplis les valeurs
npm run dev                   # http://localhost:3000
npm run lint && npm run build
```

Structure :

- `src/app/page.tsx` : page d'accueil (V0).
- `src/components/voice-test.tsx` : écran de test, mesure du délai, transcription.
- `src/app/api/elevenlabs/session/route.ts` : crée le jeton de conversation côté serveur. La clé API ne va jamais sur le téléphone.
- `src/config/voices.ts` : liste des voix testées.
- `src/app/manifest.ts` : manifeste PWA (installation sur l'écran d'accueil).

Le délai affiché est le temps entre la fin de la phrase de l'utilisateur (détection de voix) et le début de l'audio de la réponse. C'est une mesure côté téléphone, donc une approximation du ressenti.
