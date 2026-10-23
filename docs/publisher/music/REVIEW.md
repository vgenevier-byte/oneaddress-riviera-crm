# Publisher : références musicales vérifiables

## Diagnostic établi

Le code initial acceptait `unknown`, privilégiait `available` sans preuve liée
à Instagram et interrompait la génération si trois morceaux n'étaient pas
disponibles. Les schémas imposaient également trois références. Le signalement
était global au morceau ; le remplacement dans le catalogue n'existait pas.

La base Neon Publisher de Production a été consultée réellement, en lecture
seule, le 23 octobre 2026 à 23:28 (Europe/Paris), avec le rôle existant
`publisher_crm_runtime`. La fenêtre des 48 heures précédentes contient trois
créations : des brouillons prêts au format Feed 4:5, soit neuf propositions
musicales et sept références distinctes.

| Date de publication · heure de création (Europe/Paris) | Références enregistrées, principale puis alternatives | États historiques enregistrés, dans le même ordre |
| --- | --- | --- |
| 23/10/2026 · 16:52 | Mystery of Love — Sufjan Stevens<br>Sweet Disposition — The Temper Trap<br>Turnmills — Maribou State | `unavailable`<br>`unavailable`<br>`unavailable` |
| 22/10/2026 · 15:22 | Experience — Ludovico Einaudi<br>Beyond — Leon Bridges<br>Kerala — Bonobo | `unavailable`<br>`unavailable`<br>`unavailable` |
| 22/10/2026 · 15:21 | Tadow — Masego & FKJ<br>Kerala — Bonobo<br>Sweet Disposition — The Temper Trap | `unknown`<br>`unavailable`<br>`unavailable` |

Huit occurrences portent donc un ancien signalement `unavailable`, et une
occurrence reste `unknown`. Aucune version ni provenance de vérification
Instagram n'était enregistrée pour ces propositions ; le journal
`publisher_music_checks` n'existait pas avant la migration. L'origine
`legacy_catalogue` désigne ici le catalogue historique, sans attester une
vérification externe. Les anciens signalements ne précisent ni le compte, ni
le contexte, ni la date d'un contrôle Instagram.

Ces faits confirment les états enregistrés dans le CRM. Ils ne démontrent pas
l'indisponibilité actuelle des morceaux dans Instagram, et aucune référence
n'est déclarée fictive. Les identités historiques restent conservées.

Le blocage initial du contrôle automatique concernait la récupération avec
stockage local d'un secret de connexion. Il a été résolu par l'autorisation
explicite de l'utilisateur d'employer transitoirement les accès Vercel/Neon
existants, sans écrire les secrets sur disque. La lecture ci-dessus a été
réalisée dans ce cadre.

## Disponibilité et sélection

Une confirmation est un événement daté lié à la référence exacte (titre,
artiste, version), au compte interne `one-address-riviera`, au contexte Feed ou
Reel et à l'acteur CRM. Ce compte interne désigne One Address Riviera ; ce
n'est pas un identifiant externe Meta prétendument vérifié. La méthode est une
confirmation manuelle explicite depuis Instagram. Un lien ou identifiant audio
est facultatif et uniquement enregistré lorsqu'il est fourni ; aucun n'est
fabriqué. Une confirmation ultérieure peut succéder à un signalement introuvable.

Un ancien `available` sans événement devient « À vérifier » dans la réponse
serveur, sans réécrire l'ancien statut ou fabriquer une date de contrôle. Un
ancien `unavailable` conserve l'indication de signalement historique, sans lui
attribuer rétroactivement un compte, un contexte ou une date de vérification.
La sélection automatique utilise uniquement les confirmations du bon contexte,
avec la règle existante de non-répétition de 14 jours. Le texte et le visuel
peuvent être créés avec zéro, une, deux ou trois propositions fiables.

« Introuvable » ajoute un événement contextuel et retire la sélection devenue
invalide. « Remplacer la musique » explore le catalogue confirmé au-delà des
propositions affichées, sans appel de génération. L'absence de remplacement est
explicite. Le choix enregistré est conservé après rechargement. Les publications
déjà publiées restent en lecture seule et gardent leur musique historique.

L'interface musicale propose FR/EN, le titre, l'artiste, la version, la provenance
et la date du contrôle. Un véritable lien audio Instagram ouvre cet audio ; sinon,
le titre et l'artiste se copient séparément, selon le droit d'export existant.

## Meta : vérification documentaire

La [documentation officielle de l'Instagram Audio API](https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api)
a été consultée le 23 octobre 2026. Elle décrit la recherche `GET /ig_audio`, la
lecture de métadonnées et l'attachement d'un audio à un Reel. Elle requiert un
compte Business/Creator, une Page associée, une application et un jeton User avec
`instagram_basic` et `instagram_content_publish`. Elle annonce Facebook Login et
Unified Login, mais pas Instagram Login. Le catalogue autorisé pour les tiers
peut différer de celui disponible dans l'application native. La prévisualisation
d'un Reel avec cet audio n'est pas prise en charge.

Les 33 définitions d'environnement du projet CRM ont été inspectées sans
déchiffrement : aucune configuration Meta/Instagram n'est présente. Le relevé
d'environnement de Production indique également zéro définition de ces accès. Le Publisher
existant marque seulement l'historique comme publié et n'envoie pas de contenu à
Meta. Aucune recherche audio authentifiée n'a été effectuée. Le contrôle manuel
depuis le compte concerné est donc le chemin retenu. Spotify, YouTube et les
résultats web ne constituent jamais une preuve Instagram.

## Migration et livraison

- Base Publisher Neon existante : `lib/publisher/sql/003-contextual-music.sql`.
  Ajouts de colonnes, d'un journal de vérifications et d'un index d'identité avec
  version ; aucun backfill de confirmation ni changement des IDs historiques.
  Le rôle serveur existant nécessite SELECT/INSERT sur `publisher_music_checks`
  et USAGE/SELECT sur `publisher_music_checks_id_seq`, sans UPDATE/DELETE.
  L'ajout manuel nécessite aussi INSERT sur `publisher_music` et USAGE sur
  `publisher_music_id_seq` ; les droits SELECT/UPDATE existants sont conservés.
  Un trigger refuse également les opérations UPDATE et DELETE sur les événements
  du journal, y compris lorsqu'elles sont tentées par son propriétaire.
- Supabase CRM : `20261023205659_publisher_music_actions.sql` ajoute les actions
  musicales au même droit de contribution. Session active, génération, export et
  marquage comme publié conservent leurs restrictions existantes.
- Appliquer les migrations coordonnées et vérifier les droits du rôle avant de
  publier le code. Déployer uniquement le commit validé depuis une copie propre,
  après égalité du SHA local, du suivi distant et de `git ls-remote`.

Les deux migrations ont été appliquées et contrôlées en Production. La première
transaction Neon a été annulée parce que le contrôle de privilèges a détecté
l'absence d'INSERT sur le catalogue. La seconde a ajouté uniquement les droits
nécessaires et validé la migration. Les empreintes des 30 créations et 24 musiques
avant/après sont identiques hors colonnes ajoutées ; aucun statut, ID, texte,
visuel ni lien historique n'a été réécrit. Le journal contient zéro confirmation.
La lecture du moteur corrigé sur les trois brouillons réels conserve les anciens
signalements et ne sélectionne aucune musique sans preuve. Le RPC Supabase refuse
toujours l'anonyme et conserve le contrôle de session active et les droits
sensibles. La publication autorisée suit ces contrôles ; son SHA et sa provenance
Vercel figurent dans le compte rendu de livraison. Les travaux locaux étrangers
restent exclus du commit et du déploiement.

Le candidat de livraison est intégré au `main` distant actuel
`7c4d0b5b3cc04257450b7931e7806f95a888305c`. Le catalogue automobile, les choix
canoniques et leur persistance, les emblèmes, les invitations de réservation et
la traduction globale FR/EN sont conservés. Les empreintes des parties non
musicales du moteur sont comparées à cette base distante actuelle.

## Vérifications

- Moteur et génération avec frontières fournisseurs simulées : catalogues 0–3,
  preuves/contextes/versions, non-répétition, aucun remplissage non vérifié,
  conservation du nombre d'appels et récupération après erreur d'hydratation.
  Suite moteur, catalogue et invitations : 266 réussites ; contrôles SQL
  conditionnés par une activation locale explicite exécutés séparément.
- PostgreSQL local et handlers réels, Auth simulée : quatorze parcours, persistance, signalement,
  sélection, remplacement, confirmation, conflits et préservation de l'historique.
- Matrice de droits PostgreSQL locale : lecture/contribution, droits sensibles,
  compte désactivé, session absente, rôle forgé et refus de l'anonyme.
- Chromium avec le composant réel et transport simulé : treize parcours, dont
  rechargement, conflits, historique, FR/EN et largeurs 320/375/430/1440 px.
- TypeScript, lint, build de la copie de travail et build du candidat isolé.
  Les deux avertissements lint préexistants dans AccessPortal et CRMApp sont
  hors périmètre.

Aucun appel IA payant, aucune image réelle générée, aucune publication Instagram.
**Aucun morceau effectivement retrouvé depuis le compte One Address Riviera n'est
attesté par ces tests.** La confirmation réelle depuis l'application est encore
nécessaire pour constituer le catalogue fiable.
