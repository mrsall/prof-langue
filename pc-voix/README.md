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

## Au quotidien

- Docker Desktop démarre avec Windows et relance le serveur tout seul ; Tailscale aussi. Si ce n'est pas le cas : `docker compose up -d` puis `tailscale funnel --bg 8765` dans le dossier `pc-voix`.
- Le PC doit être allumé pendant tes séances. Éteint ou injoignable, l'app passe sur ElevenLabs sans rien te demander.
- Pour arrêter : `docker compose down`. Pour mettre à jour après un changement dans ce dossier : `docker compose up -d --build`.
- Voix par personnage : voir `voix/README.md`.

## Si ça coince

- `docker compose logs -f` montre ce que fait le serveur (téléchargement, chargement, chaque phrase avec sa durée).
- « CUDA not available » dans les journaux : le pilote NVIDIA ou l'accès GPU de Docker manque, reprends le point 1.3.
- L'app dit « PC injoignable » : vérifie l'adresse `/health` depuis le téléphone, et que `PC_TTS_URL` dans Vercel n'a pas de barre oblique à la fin.
- Mot de passe refusé (401) : `PC_TTS_TOKEN` doit être identique dans `pc-voix/.env` et dans Vercel.
