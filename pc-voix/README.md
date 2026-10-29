# Voix « Mon PC » : Chatterbox sur ta carte NVIDIA (Windows)

Ce dossier fait de ton PC (RTX 4070) un serveur de voix gratuit et illimité pour l'app, en français et en anglais. Quand le PC est éteint, l'app bascule toute seule sur ElevenLabs puis Google.

Compte 30 à 45 minutes la première fois (téléchargements), puis un double-clic.

## 1. Préparer Windows (une seule fois)

1. **Pilote NVIDIA à jour** : ouvre « NVIDIA App » (ou GeForce Experience) → Pilotes → Mettre à jour. Redémarre si demandé.
2. **Docker Desktop** : télécharge-le sur docker.com, installe-le en laissant « Use WSL 2 » coché, redémarre, ouvre Docker Desktop une fois et attends qu'il affiche « Engine running ».
3. **Vérifie la carte graphique dans Docker** : ouvre PowerShell et tape
   ```
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
   ```
   Tu dois voir un tableau avec « NVIDIA GeForce RTX 4070 ». Si ça échoue, redémarre le PC et réessaie.
4. **Tailscale** : télécharge-le sur tailscale.com/download/windows, installe, connecte-toi avec ton compte Google. L'icône apparaît près de l'horloge.

## 2. Installer le serveur de voix

1. Télécharge ce dépôt (GitHub → bouton « Code » → « Download ZIP ») et décompresse-le, par exemple dans `C:\prof-langue`.
2. Dans le dossier `pc-voix`, copie le fichier `.env.example` en `.env` et écris dedans un mot de passe à toi, par exemple :
   ```
   PC_TTS_TOKEN=banane-thies-2026-voix-pc
   ```
3. Ouvre PowerShell dans ce dossier (clic droit dans le dossier → « Ouvrir dans le Terminal ») et lance :
   ```
   docker compose up -d --build
   ```
   La première fois, ça télécharge environ 8 Go (le modèle et ses bibliothèques). Suis l'avancement avec `docker compose logs -f` ; quand tu lis « Prêt », c'est bon.
4. Dans le navigateur, ouvre http://localhost:8765/health : tu dois voir `"ok": true` et `"gpu": "NVIDIA GeForce RTX 4070"`.

## 3. Donner une adresse internet au PC (Tailscale Funnel)

Dans PowerShell :
```
tailscale funnel --bg 8765
```
La première fois, Tailscale affiche un lien pour activer « Funnel » sur ton compte : ouvre-le, clique sur Activer, puis relance la commande. Elle affiche une adresse du type `https://nom-du-pc.tonreseau.ts.net`. C'est l'adresse de ton PC, stable et chiffrée.

Teste-la depuis ton téléphone : `https://nom-du-pc.tonreseau.ts.net/health` doit afficher la même réponse qu'au point 2.4.

## 4. Brancher l'app (Vercel)

Vercel → ton projet → Settings → Environment Variables, ajoute :

| Nom | Valeur |
| --- | --- |
| `PC_TTS_URL` | l'adresse Tailscale, par exemple `https://nom-du-pc.tonreseau.ts.net` |
| `PC_TTS_TOKEN` | le même mot de passe que dans `pc-voix/.env` |

Puis Deployments → Redeploy. Dans l'app : Réglages → carte « Voix de mon PC » → « Tester » (elle parle). Sur l'accueil, choisis la voix « Mon PC ».

## 5. Donner une vraie voix française (important)

Chatterbox copie l'accent de la voix de référence ; sa voix intégrée est anglophone. Le dossier `voix` contient déjà une voix de départ par personnage, en français et en anglais (origine et licences dans `voix/CREDITS.md`). Pour en changer, remplace le fichier par un enregistrement à toi (voir `voix/README.md`). Pas besoin de redémarrer.

## 6. L'oreille aussi sur le PC

Le même conteneur fait tourner Whisper (modèle `large-v3-turbo`) sur ta carte graphique : sur l'accueil, choisis « Mon PC » comme **oreille** du mode éco. `http://localhost:8765/health` indique `stt` quand il est chargé. PC éteint : Groq ou Scribe prennent le relais.

## 7. Rendre la voix plus naturelle

- Le plus efficace : remplacer les voix de référence fournies (voix de synthèse Piper, un peu plates) par un **enregistrement humain** de 10 à 15 s (voir `voix/README.md`).
- Deux réglages dans `docker-compose.yml`, puis `docker compose up -d` : `CHATTERBOX_EXAGGERATION` (0,3 = plat, 0,6 = conversation, 0,7 = très expressif) et `CHATTERBOX_CFG` (0,5 = colle au rythme de la référence, 0,3 = débit plus libre et plus vivant).

## 8. V5 : mode « Temps réel (mon PC) »

Le téléphone parle directement à ton PC (WebSocket à travers Tailscale) : le PC écoute en continu, détecte tout seul la fin de ta phrase, transcrit avec Whisper, fait répondre Claude en flux et renvoie la voix phrase par phrase, sans trou. Si tu parles pendant que le personnage parle, il se tait. Objectif : 1,5 à 2 s entre ta phrase et la réponse, gratuit, illimité.

1. Dans `pc-voix/.env`, ajoute ta clé Anthropic (la même que dans Vercel) :
   ```
   ANTHROPIC_API_KEY=sk-ant-…
   ```
   Sans guillemets, sans espace, la clé complète (elle commence par `sk-ant-` et fait une centaine de caractères). Vercel ne permet pas de relire une clé : si tu ne l'as plus, crée-en une nouvelle sur console.anthropic.com → API Keys → Create Key, et mets la même dans Vercel (`ANTHROPIC_API_KEY`) pour que tout le monde utilise la même.
2. Reconstruis : `docker compose up -d --build` (après un simple changement du `.env`, `docker compose up -d` suffit). Les journaux doivent montrer « VAD Silero chargé », « Whisper chargé » et « Clé Anthropic acceptée ». Sinon, `http://localhost:8765/health` → `claude.error` explique le problème (« clé refusée par Anthropic (401) » = la clé est fausse ou tronquée).
3. Sur l'accueil de l'app, le choix « Temps réel (mon PC) » apparaît à côté de « ElevenLabs » et « Mode éco » dès que `PC_TTS_URL` et `PC_TTS_TOKEN` sont dans Vercel. Choisis-le et lance une séance.
4. Pendant la séance : mains libres conseillées. Pour couper le personnage, parle simplement (ou appuie sur le micro). « Répète » relit la dernière phrase. La vitesse de lecture n'est pas réglable dans ce mode.

Le PC ne reçoit que du son et du texte de séance ; rien n'est enregistré sur disque (les fichiers temporaires de transcription sont effacés aussitôt). Le mot de passe du PC ne quitte jamais Vercel : l'app donne au téléphone un ticket signé, valable 3 heures, que le PC vérifie.

## 9. Si le mode temps réel se coupe ou ne répond plus

- **Le PC s'est mis en veille** (souvent la nuit) : Tailscale et Docker ne répondent plus. Réveille-le, puis Windows → Paramètres → Système → Alimentation : règle « Mettre en veille » sur « Jamais » quand il est branché.
- **Docker ou Tailscale ne tournent plus** : dans PowerShell, dans `pc-voix`, `docker compose up -d` puis `tailscale funnel --bg 8765`.
- **La séance se coupe dès le début** : `docker compose logs --tail 100` montre l'erreur ; envoie les dernières lignes.
- Dans tous les cas, l'app bascule toute seule en mode éco quand le PC ne répond pas au démarrage d'une séance, et tu peux toujours choisir « Mode éco » ou « ElevenLabs » sur l'accueil.

## Mettre à jour le serveur

Quand le dépôt change : retélécharge le ZIP, remplace le contenu du dossier `pc-voix` **en gardant ton fichier `.env` et ton dossier `voix`**, puis dans PowerShell, dans `pc-voix` :
```
docker compose up -d --build
```

## Au quotidien

- Docker Desktop démarre avec Windows et relance le serveur tout seul ; Tailscale aussi. Si ce n'est pas le cas : `docker compose up -d` puis `tailscale funnel --bg 8765` dans le dossier `pc-voix`.
- Le PC doit être allumé pendant tes séances. Éteint ou injoignable, l'app passe sur ElevenLabs sans rien te demander.
- Pour arrêter : `docker compose down`. Pour mettre à jour après un changement dans ce dossier : `docker compose up -d --build`.
- Voix par personnage : voir `voix/README.md`.

## Si ça coince

- Pour récupérer la dernière version d'un seul fichier sans retélécharger tout le ZIP (PowerShell, dans `pc-voix`) :
  ```
  Invoke-WebRequest -Uri https://raw.githubusercontent.com/mrsall/prof-langue/main/pc-voix/Dockerfile -OutFile Dockerfile
  Invoke-WebRequest -Uri https://raw.githubusercontent.com/mrsall/prof-langue/main/pc-voix/server.py -OutFile server.py
  ```

- `docker compose logs -f` montre ce que fait le serveur (téléchargement, chargement, chaque phrase avec sa durée).
- « CUDA not available » dans les journaux : le pilote NVIDIA ou l'accès GPU de Docker manque, reprends le point 1.3.
- L'app dit « PC injoignable » : vérifie l'adresse `/health` depuis le téléphone, et que `PC_TTS_URL` dans Vercel n'a pas de barre oblique à la fin.
- Mot de passe refusé (401) : `PC_TTS_TOKEN` doit être identique dans `pc-voix/.env` et dans Vercel.
