# Comment on apprend vraiment à parler une langue, et ce que l'app en fait

Note courte pour Cherif, écrite après lecture de la recherche en didactique des langues. Elle explique les choix faits dans les consignes des personnages (`src/lib/prompt.ts`, `src/config/personalities.ts`, `src/config/correction.ts`).

## Les cinq idées qui comptent

1. **Parler beaucoup, et être poussé à en dire plus.** Comprendre ne suffit pas : c'est en produisant qu'on remarque ce qui nous manque (hypothèse de la « production poussée », Swain). Les personnages doivent donc te laisser au moins 60 % du temps de parole, refuser les réponses d'un mot, et demander « pourquoi ? », « un exemple ? », « et ensuite ? ».
2. **Apprendre des blocs, pas des mots isolés.** Les expressions toutes faites (« to be honest, I think… », « let me give you an example ») se récupèrent d'un coup en mémoire et permettent de parler plus vite, avec moins de pauses. Les études sur les « séquences formulaïques » le confirment. Les personnages te donnent donc des tournures prêtes à l'emploi et te les font réutiliser tout de suite.
3. **Des tours de fluidité.** La technique 4/3/2 de Paul Nation : redire la même chose en moins de temps, plusieurs fois. La vitesse monte, les hésitations baissent, parce qu'on réutilise du connu. C'est pour ça qu'Emma, et parfois les autres, te demandent de redire ton histoire « plus court et plus vite ».
4. **Corriger en te faisant trouver.** Pour un débutant, les « incitations » (répéter ta phrase jusqu'à l'erreur et te laisser finir) marchent mieux que la simple reformulation, et l'effet dure plus longtemps. La reformulation douce reste utile pour ne pas casser le rythme. D'où les trois niveaux : aucune (tout au bilan), légère (reformulation, incitation si l'erreur revient), active (incitation d'abord, puis la forme et une répétition).
5. **Équilibrer quatre types de travail** (les « quatre brins » de Nation) : écouter du compréhensible, parler pour dire quelque chose, travailler la langue elle-même, développer la fluidité. L'app couvre les quatre : les personnages (écoute et parole), Emma et le bilan (langue), les tours de fluidité et la révision espacée du carnet (fluidité et mémoire).

## Trouver ses mots : le problème numéro un

Tu l'as dit toi-même : tu sais ce que tu penses, mais tu n'arrives pas à le formuler, même en français. Ce n'est pas un problème de grammaire, c'est un problème de **récupération** (le mot ne vient pas) et de **structure** (par où commencer). Ce qui aide, d'après la recherche et l'expérience des profs d'oral :

- **Se faire reformuler, puis redire.** Quand tu patauges, le personnage redit ton idée en une phrase claire, vérifie que c'est bien ça, te donne le mot exact, et te demande de redire toute l'idée toi-même. C'est le moment où tu apprends le plus.
- **Remplacer les mots vagues** (« truc », « chose », « faire », « thing », « stuff ») par le mot précis, un par tour, et le réutiliser tout de suite.
- **Une trame pour expliquer** : c'est quoi, pourquoi c'est important, un exemple. Pour une histoire : début, problème, fin. Pour un avis : affirmation, raison, exemple. Avec une trame, on sait toujours par où commencer.
- **Décrire pour contourner** : quand le mot ne vient pas, dis à quoi ça sert, à quoi ça ressemble. Le personnage te donne alors le mot, et il va dans ton carnet.
- **Le bilan « Dire plus précisément »** : après chaque séance, jusqu'à trois endroits où tu as tourné autour d'un mot, avec la version précise et quand l'utiliser. Ces mots rejoignent ton carnet et reviennent en révision.

## Ce que ça change concrètement

- Tous les personnages suivent la même méthode (répliques courtes pour eux, longues pour toi, tournures à réutiliser, étayage puis retrait de l'aide, recyclage de tes mots du carnet).
- **Le débat se joue à trois.** Un juge neutre, avec sa propre voix, annonce la motion et te demande ton camp. Leo prend l'autre camp et argumente vraiment, sans jamais corriger ta langue (c'est un adversaire, pas un prof). À la fin, le juge dit honnêtement qui a gagné et pourquoi, et nomme ton meilleur argument. Le bilan liste ensuite toutes tes erreurs de langue, et le bouton « Refaire le débat » relance la même motion avec les mêmes camps : le juge vérifie alors si tu as corrigé ses remarques.
- **Personne ne te flatte.** Les personnages n'ont pas le droit de dire « très bien » à une phrase fausse ni d'être d'accord avec toi par politesse. Emma est la plus exigeante : elle dit « non, pas comme ça », donne la bonne forme et te la fait redire. Les autres restent francs sur le fond (un ami ou un grand frère qui dit toujours oui ne sert à rien), mais gardent leur ton.
- **Emma** structure ses séances : échauffement, deux ou trois tournures, conversation, tour de fluidité, un seul point à travailler.
- Le niveau mesuré par le test sert à régler la difficulté « un cran au-dessus » du tien.
- Les mots de ton carnet sont glissés naturellement dans les discussions, en plus des révisions.

## Prononciation : le shadowing (V4)

Le *shadowing* (écouter une phrase et la redire aussitôt, en imitant le rythme et la mélodie) est la méthode la plus simple pour améliorer la prononciation à l'oral, parce qu'elle travaille les sons dans de vraies phrases et pas isolément. L'app l'applique ainsi :

- **Une phrase, une répétition, une note par mot.** La voix lit la phrase (normalement ou lentement), tu la répètes, et un service d'évaluation compare ta voix à la prononciation attendue : chaque mot est vert, orange ou rouge, et les sons les moins réussis sont listés. Un mot raté se rejoue lentement d'un appui.
- **Des phrases qui te servent.** D'abord tes propres phrases corrigées des dernières séances (tu les rediras en conversation), puis des phrases où tu as déjà raté des mots, puis une réserve adaptée à ton niveau. Depuis le bilan, « Répéter N phrases de la séance » enchaîne directement.
- **Un suivi des sons.** Les sons sont comptés par langue au fil des séries ; le suivi montre ta moyenne sur 30 jours et les sons les moins réussis, pour que tu voies ce qui progresse.
- **En français, l'objectif est d'être compris, pas d'effacer l'accent.** Une note orange sur un mot qu'on comprend bien n'est pas un problème ; vise le vert sur les mots que tu dois souvent répéter.

## Ce que l'app ne peut pas faire (encore)

- Les personnages ne jugent toujours pas ta prononciation (ils ne reçoivent que du texte). C'est l'écran **Prononciation** qui s'en charge, avec un service spécialisé (Azure Speech) : voir ci-dessous.
- Remplacer de vraies conversations avec des humains : une étude de 2026 montre que le dialogue avec une IA ressemble plus à un « monologue accompagné » qu'à un vrai échange rapide. L'app est un entraînement quotidien, pas un substitut.

## Sources

- Paul Nation, les quatre brins et la technique 4/3/2 : [présentation 4/3/2](https://englishonline.tki.org.nz/content/download/7184/40816/file/Paul+Nation%5C%27s+4-3-2.doc), [étude thaïlandaise sur la répétition de tâche](https://so01.tci-thaijo.org/index.php/ojed/article/view/247820), [résumé des quatre brins](https://vuw-web.matrix.squiz.cloud/lals/resources/paul-nations-resources/paul-nations-publications/publications/documents/yamamoto-four-strands.pdf).
- Correction orale, reformulations contre incitations : [Ammar & Spada, « One size fits all? »](https://www.researchgate.net/profile/Ahlem-Ammar-2/publication/232021519_One_size_fits_all_Recasts_prompts_and_L2_learning/links/590885a0458515ebb49088ac/One-size-fits-all-Recasts-prompts-and-L2-learning.pdf), [synthèse McGill](https://escholarship.mcgill.ca/downloads/6w924g64b), [étude comparative](https://files.eric.ed.gov/fulltext/EJ1306453.pdf).
- Séquences formulaïques et fluidité : [thèse d'Ottawa](https://ruor.uottawa.ca/handle/10393/29274), [François & Albakry 2021](https://scholarspace.manoa.hawaii.edu/items/e8efd200-3c68-4670-9437-cc592d197e20), [Oberg, formulaic sequences for oral fluency](https://minds.wisc.edu/items/68df8400-5cad-494c-b0a6-b714cb20313b).
- Partenaires de conversation IA : [méta-analyse EUROCALL 2026 sur les chatbots](https://research.dial.uclouvain.be/entities/publication/29791a54-111b-40eb-bacb-346494980619), [EDM 2026, dialogue IA contre humain](https://educationaldatamining.org/edm2026/proceedings/2026.EDM.full-papers.210/index.html), [hypothèse de la production, Swain](https://www.scribd.com/doc/268383929/Comprehensible-Output).
