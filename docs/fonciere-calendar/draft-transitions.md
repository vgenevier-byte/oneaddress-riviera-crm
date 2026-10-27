# Synchronisation des brouillons de calendrier

Le contrôle de mois conservait `custom`, `raw` et `invalid` lorsque les données
du dossier étaient remplacées. Une relecture pouvait donc afficher une saisie
ancienne, alors que la synthèse et le serveur utilisaient la nouvelle durée.

Le correctif transmet un compteur de remplacement aux seuls contrôles de mois
et de date. Leur clé React change après une ouverture, un nouveau projet, une
récupération de brouillon, une relecture d’arbitrage ou un rechargement confirmé
après archivage/réactivation. Les protections contre les réponses périmées et les
annulations restent en place. Les saisies, sauvegardes, imports et rafraîchissements
d’avis ordinaires ne changent pas ce compteur. Le bloc d’arbitrage reste monté,
ainsi que les autres champs : la remarque en cours est conservée.

## Régression réelle locale

Le même scénario navigateur utilise deux connexions indépendantes avec les vrais
services Auth/RPC/PostgreSQL locaux et des comptes fictifs. La version publiée
`3446494fcee21d1add113cde6d8c2a2bea36406f` est construite séparément de la correction.

- Avant : les trois durées sont sauvegardées à 4 mois dans le premier onglet,
  puis à 7 dans le second. Après la relecture proposée par l’arbitrage, le premier
  onglet affiche encore `[4, 4, 4]`, tandis que le serveur enregistre `[7, 7, 7]`
  et la synthèse indique 7 mois de travaux et 14 mois cumulés. « Nouveau projet »
  conserve aussi un champ personnalisé et son ancienne erreur de validation.
- Après : les trois champs affichent `[7, 7, 7]` avant la reconfirmation de l’avis,
  en accord avec le serveur et la synthèse. La date civile relue concorde aussi.
  Le choix et la remarque privés restent présents jusqu’à l’enregistrement
  explicite de l’avis.
- Les valeurs invalides restent visibles pendant les modifications d’autres
  champs, empêchent la sauvegarde et survivent à une confirmation d’abandon
  refusée. Chaque frappe conserve le focus. Un abandon accepté vers un nouveau
  projet réinitialise valeurs, modes personnalisés et erreurs de mois/date ;
  les durées non renseignées sont réellement sauvegardées ainsi. L’ouverture
  suivante d’une fiche enregistrée retrouve ses données courantes sans erreur
  héritée.

Le script est `tests/fonciere-calendar/draft-transitions.browser.mjs` et utilise
le banc de `tests/fonciere-arbitrage/README.md`. Il exige `CALENDAR_FIXTURE` vers
la fixture privée de ce banc. `CALENDAR_APP` choisit uniquement les serveurs
locaux 3197/3198, `CALENDAR_TRANSITIONS_OUTPUT` la sortie et
`CALENDAR_TRANSITIONS_PHASE` le nom des preuves avant/après. L’administration
des décideurs est temporairement adaptée au compte fictif éditeur puis restaurée.

Résultats : deux échecs reproduits sur l’ancienne version, six groupes réussis
sur la correction, aucune erreur navigateur ni requête externe. Les 266 sources
de la construction finale correspondent au worktree ; seuls les deux composants
prévus diffèrent de la version précédente. Les 45 tests unitaires existants
(calendrier, finances, historique et transfert) passent également. TypeScript,
build et diff-check passent ; lint complet ne signale que les deux avertissements
préexistants. Rapports et captures : `draft-transitions/`.

Aucune migration n’est nécessaire. Aucun changement de données, d’avis ni de
droits n’est effectué en production ; les contrôles après déploiement restent
statiques et en lecture seule. La régression utilise Chromium local, sans
simulation de réponse de succès.
