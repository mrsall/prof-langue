# Prof de langues IA

Web app mobile pour parler anglais (puis français) à voix haute avec une IA qui répond avec une voix naturelle. Le cahier des charges complet est dans `CLAUDE.md`.

## Où en est le projet : V2 (six personnalités, anglais et français, sujets)

Tu ouvres l'app, tu choisis la langue (anglais ou français) et le personnage, tu appuies sur **Commencer**, tu choisis un sujet, et la discussion démarre. Trois touches au total : la langue et le personnage restent ceux de la dernière fois.

Les six personnages (prénoms modifiables dans `src/config/personalities.ts`) :

| Mode | Prénom | Voix | Correction par défaut |
| --- | --- | --- | --- |
| Ton pote | Max | George | Aucune |
| Grand frère | Ibrahim | Brian | Légère |
| Débatteur | Leo | Will | Légère |
| Professeure | Emma | Sarah | Active |
| Collègue | Thomas | Daniel | Légère |
| Mise en situation | selon le rôle | Roger | Légère |

Le sujet : 3 ou 4 propositions adaptées au mode (générées par Claude, jamais les mêmes que les dernières séances), **J'ai mon propre sujet** (tu le dis à voix haute quand le personnage te le demande) ou **Surprends-moi**.

Pendant la discussion :

- **Mains libres** (par défaut) : le micro reste ouvert, tu parles quand tu veux, le personnage détecte la fin de ta phrase. Si tu parles pendant qu'il parle, il s'arrête et t'écoute. Un appui sur le gros bouton coupe le micro.
- **Appui pour parler** (endroits bruyants) : tu maintiens le gros bouton pendant que tu parles.
- **Répète**, **Vitesse** (lent, normal, rapide) et **Correction** (aucune, légère, active) se changent à tout moment : le personnage reprend là où vous en étiez après une seconde de reconnexion.
- **Texte** : affiche ou cache le texte de la conversation.
- Chaque personnage se souvient des sujets de vos dernières séances (gardés sur ton téléphone).

**Terminer** : bilan de la séance (minutes, prises de parole, part de temps de parole), un mot du personnage, 3 points à retenir avec la bonne forme, les mots du jour. Avec Max, Ibrahim ou Leo, s'il y a eu beaucoup d'erreurs, le bilan propose un bouton pour travailler ces points avec Emma.

Pour le français, l'agent ElevenLabs doit avoir le français parmi ses langues et une voix multilingue : la page **Réglages** (ou le premier lancement d'une séance) règle ça automatiquement.

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
3. Choisis la langue, le personnage et un sujet, puis discute 10 minutes. Essaie **Répète**, **Vitesse**, **Correction** et **Texte**, et interromps le personnage en parlant pendant qu'il parle.
4. Appuie sur **Terminer** et regarde le bilan.

### 5. Ce que tu me dis ensuite

- Une séance complète dans chaque mode, en anglais, puis au moins une en français : est-ce que chaque personnage a bien son caractère ?
- En français, la voix est-elle agréable et compréhensible ?
- Les sujets proposés te donnent-ils envie ? « Mon propre sujet » marche-t-il bien ?
- Le changement de correction en pleine discussion : utile, ou gênant à cause de la petite reconnexion ?

Quand tu valides la V2, on passe à la V3 (test de niveau, bilan complet, texte corrigé, carnet de mots, révisions, rappels, plafond de dépense).

## Pour les développeurs

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
- `src/components/voice-test.tsx` et `/test-voix` : page de test des voix (V0).
