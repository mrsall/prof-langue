# Voix de référence (indispensable pour le français)

Chatterbox **copie la voix et l'accent** d'un court extrait de référence. Sa voix intégrée est celle d'un anglophone : sans fichier ici, le français sonne « comme un Anglais qui parle français ». Il faut donc au moins **une référence de francophone natif**, et idéalement une référence anglophone pour l'anglais.

## Fichiers acceptés

- Formats : wav, mp3, m4a (enregistrement du téléphone), ogg, flac. Seules les 10 premières secondes comptent : un fichier long convient, pas besoin de le couper.
- Voix claire, une seule personne, sans musique ni bruit de fond.

## Noms des fichiers (du plus précis au plus général)

| Fichier | Sert à |
| --- | --- |
| `default.fr.mp3` | tous les personnages en français (le minimum à mettre) |
| `default.en.mp3` | tous les personnages en anglais |
| `prof.fr.mp3`, `ami.fr.mp3`, `grand-frere.fr.mp3`, `debatteur.fr.mp3`, `collegue.fr.mp3`, `situation.fr.mp3`, `juge.fr.mp3` | un personnage précis en français |
| `prof.en.mp3`, … | un personnage précis en anglais |
| `prof.mp3` | un personnage dans les deux langues |

Aucun redémarrage n'est nécessaire : le fichier est lu à chaque phrase. Vérifie avec http://localhost:8765/health : `voices` liste les fichiers trouvés et `french_reference` doit passer à `true`.

## Où trouver des voix libres de droits

- **LibriVox** (librivox.org, livres audio du domaine public) : cherche un livre en français lu par un lecteur natif, télécharge un chapitre en MP3, renomme-le `default.fr.mp3` et dépose-le ici. Les premières secondes (« Chapitre un de… ») suffisent. Même chose en anglais avec un lecteur britannique ou américain selon ton goût : `default.en.mp3`.
- **Une personne de ton entourage** qui a l'accent que tu vises : 15 secondes lues au téléphone (application Enregistreur), fichier m4a copié ici et renommé.
- Jamais d'extrait des voix ElevenLabs ni d'une voix de personne connue sans son accord : les conditions d'ElevenLabs l'interdisent et ce ne serait pas correct.
