# Prof de langues IA

Web app mobile pour parler anglais (puis français) à voix haute avec une IA qui répond avec une voix naturelle. Le cahier des charges complet est dans `CLAUDE.md`.

## Où en est le projet : V1 (mode ami, anglais, appui pour parler)

Tu ouvres l'app, tu appuies sur **Commencer**, et tu discutes en anglais avec **Max**, ton pote (voix George). Pendant la discussion :

- **Maintiens le gros bouton micro** pendant que tu parles, relâche pour envoyer. Le micro est coupé le reste du temps, pratique dehors ou dans le bruit.
- Si Max parle et que tu appuies sur le micro, il s'arrête et t'écoute.
- **Répète** : Max redit sa dernière phrase, un peu plus lentement.
- **Vitesse** : lent, normal ou rapide. Tu peux changer pendant la discussion (Max reprend là où vous en étiez après une seconde de reconnexion).
- **Texte** : affiche ou cache le texte de la conversation.
- **Terminer** : bilan de la séance (minutes, prises de parole, part de temps où c'est toi qui parles, mots du jour, un mot de Max). Le bilan complet avec les erreurs arrive en V3.

L'accueil montre ta série de jours et l'objectif du jour (10 minutes). Pour l'instant, ces chiffres sont gardés sur ton téléphone ; la base de données arrive en V3.

La page de test des voix de la V0 reste accessible en bas de l'accueil (lien « Test des voix »).

## Mise en route (à faire une seule fois)

### 1. L'agent ElevenLabs

Si tu as déjà l'agent de la V0, garde-le. Sinon : [elevenlabs.io](https://elevenlabs.io) → **Agents** → **Create agent** → **Blank agent**, langue **English**, puis copie l'**Agent ID** (commence par `agent_`).

Les consignes de Max, sa première phrase, sa voix et sa vitesse sont envoyées par l'app au début de chaque séance. L'agent doit l'autoriser, et il faut lui choisir Claude Haiku comme cerveau. **Pas besoin de cliquer dans le dashboard** : une fois l'app déployée, ouvre la page **Réglages** (lien en bas de l'accueil, ou `/reglages`) et appuie sur **Configurer l'agent automatiquement**. La page montre ensuite ce qui est prêt.

Si tu préfères le faire à la main : agent → **Security** → **Overrides** → activer **System prompt**, **First message**, **Voice ID**, **Speed** ; onglet **Agent** → **LLM** → **Claude Haiku**.

### 2. Les clés

- **ElevenLabs** : profil → **API Keys** → **Create API key**.
- **Anthropic** (pour les mots du jour du bilan) : [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create key**. Facultatif : sans elle, le bilan n'affiche pas les mots du jour.

### 3. Les variables dans Vercel (jamais dans le code)

Vercel → ton projet → **Settings** → **Environment Variables** :

| Variable | Valeur |
| --- | --- |
| `ELEVENLABS_API_KEY` | ta clé ElevenLabs |
| `ELEVENLABS_AGENT_ID` | l'Agent ID |
| `ANTHROPIC_API_KEY` | ta clé Anthropic (facultatif) |

Coche les trois environnements. Après un ajout, relance un déploiement (**Deployments** → les trois points → **Redeploy**). Le fichier `.env.example` liste toutes les variables possibles.

### 4. Tester sur ton téléphone

1. Ouvre l'adresse Vercel dans **Chrome** (Android) ou **Safari** (iPhone). Pour l'installer : menu du navigateur → **Ajouter à l'écran d'accueil**.
2. Appuie sur **Commencer**, autorise le micro.
3. Discute 10 minutes avec Max en maintenant le bouton pour parler. Essaie **Répète**, change la **Vitesse**, affiche le **Texte**, interromps-le en appuyant sur le micro pendant qu'il parle.
4. Appuie sur **Terminer** et regarde le bilan.

### 5. Ce que tu me dis ensuite

- Est-ce que tu as tenu 10 minutes sans bug ? Si ça a coupé, à quel moment et sur quel réseau.
- Le délai de réponse après que tu relâches le bouton : naturel ou trop long ?
- Est-ce que Max te laisse parler (réponses courtes, questions) ou parle trop ?
- Le bouton « maintiens pour parler » est-il pratique ou préfères-tu un mode mains libres (prévu en V2) ?

Quand tu valides la V1, on passe à la V2 (six modes, français, choix du sujet, mains libres, niveau de correction).

## Pour les développeurs

```bash
npm install
cp .env.example .env.local   # puis remplis les valeurs
npm run dev                   # http://localhost:3000
npm run lint && npm run build
```

Structure :

- `src/components/app.tsx` : les trois écrans (accueil, conversation, fin de séance) et la logique de séance.
- `src/components/push-to-talk-button.tsx` : bouton « maintiens pour parler ».
- `src/components/max-avatar.tsx` : avatar illustré de Max, animé quand il parle.
- `src/config/personalities.ts` : personnalités (prénom, caractère, consignes). `src/config/voices.ts` : voix. `src/config/speeds.ts` : vitesses.
- `src/app/api/elevenlabs/session/route.ts` : crée le jeton de conversation et prépare les consignes envoyées à l'agent. La clé API ne va jamais sur le téléphone.
- `src/app/api/bilan/route.ts` : mots du jour et encouragement via Claude (Haiku par défaut).
- `src/app/api/elevenlabs/agent/route.ts` et `/reglages` : état de l'agent ElevenLabs et réglage automatique (overrides, LLM Claude Haiku, variable `ELEVENLABS_AGENT_LLM` pour changer de modèle).
- `src/lib/progress.ts` : série de jours et minutes du jour (stockage local, V1).
- `src/components/voice-test.tsx` et `/test-voix` : page de test des voix (V0).
