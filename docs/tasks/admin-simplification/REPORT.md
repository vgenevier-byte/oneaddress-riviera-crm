# Responsables et Administration — correctif ciblé

Base effectivement publiée et vérifiée : `39aa89811258c2ff8438dc2bd49ed54f5fb58ea7`,
déploiement `dpl_AfhFdnLfrWF9o72JEB5kxoiu8mKD`. La préparation utilise une copie
isolée de cette base ; le checkout principal et ses travaux Contacts → Drive / Publisher
ne sont pas intégrés. Deux fichiers existants changent ; les treize anciennes migrations
et tous les autres fichiers publiés restent identiques.

## Résultat

- **Responsables** : select natif « Ajouter un responsable », ajouts successifs par UUID,
  étiquettes avec retrait explicite, recherche et distinction des homonymes. Aucun
  enregistrement automatique. Affectations inactives conservées et gestionnaire historique
  obligatoire non retirable. Annuaire, éligibilité, validation et confidentialité serveur inchangés.
- **Administration** : montage, import et état du panneau « Identités et reprise Tâches »
  retirés. Les autres brouillons restent protégés. Aucune reprise ni attribution effectuée ;
  les RPC privées et leur garde propriétaire restent identiques. Maintenance conservée
  documentée dans [SERVER.md](SERVER.md), sans nouveau parcours public.
- **Historique** : trois événements complets par défaut ; « Voir tout l’historique » et
  « Réduire l’historique ». Pages de 50, ancre stable et curseurs bigint en chaînes.
  Les pages anciennes se chargent séparément des comptes/droits, sans annoncer une liste
  partielle comme complète. Date, auteur, action et destinataire disponibles sont conservés.

## Contrôles du même candidat

| Contrôle | Résultat |
| --- | --- |
| TypeScript sans émission ni cache incrémental | PASS |
| ESLint complet | PASS : aucune erreur ; deux avertissements hérités dans AccessPortal/CRMApp |
| Build Next de l'application de Production, sans route de démonstration | PASS |
| Build de la démonstration isolée, 162 fichiers comparés aux sources | PASS |
| Serveur réel local Auth/HTTP/RPC, pagination et refus | 7/7 groupes PASS |
| Administration navigateur, ordinateur/mobile émulé | 11/11 groupes PASS |
| Responsables Chromium et WebKit mobile émulé | 7/7 groupes PASS |
| Revue indépendante ciblée, anciennes migrations et correctifs publiés | PASS |
| Diff-check du contenu indexé exact | PASS |

Les résultats sont conservés dans [VALIDATION.json](VALIDATION.json),
[SERVER.validation.json](SERVER.validation.json),
[ADMINISTRATION.validation.json](ADMINISTRATION.validation.json) et
[RESPONSIBLES.validation.json](RESPONSIBLES.validation.json).
Le [diff produit](diff.patch) contient uniquement les deux composants modifiés,
le nouveau composant d'historique et la nouvelle migration. Le diff Git du commit
contient aussi ces tests et preuves documentaires.

Les preuves serveur sont des sessions Auth réellement ouvertes dans le banc fictif
loopback. Les parcours Responsables utilisent réellement les RPC et PostgreSQL locaux.
Les pages historiques, interruptions et transport d'invitation des parcours Administration
sont explicitement simulés ; les sept groupes serveur vérifient séparément leur autorisation
et pagination réelles. Aucun mail, appel payant, JWT fabriqué, test de tâche réelle
ou appareil physique n'est utilisé. Les fixtures ajoutées sont nettoyées et les données
préexistantes du banc comparées. Voir [RESPONSIBLES.md](RESPONSIBLES.md),
[ADMINISTRATION.md](ADMINISTRATION.md) et [SERVER.md](SERVER.md).

## SQL et publication

Seule nouvelle migration :
`20261007171153_tasks_admin_history_pagination.sql`, SHA-256
`3237c9e14136828c33f6ab5a2beb8cbfc4180f55c5f835170dd7e0a42b5ccc5e`.
Elle ajoute seulement `crm_admin_history_page(bigint,bigint,integer)`, RPC de lecture
protégée par profil actif, compte CRM, session réelle et administration générale.
Projection minimale sans `detail`, limite maximale 100 ; aucune donnée ni fonction
existante remplacée. Les conditions et limites de l'ancre sont décrites dans SERVER.md.

La simulation Production propose exactement cette migration, sans seeds ni rôles,
avec `--skip-vault`. Le nom local de la migration canonique déjà appliquée est remappé
dans le seul répertoire CLI temporaire vers sa version enregistrée `20261007055654` ;
son contenu source reste identique et elle n'est ni modifiée ni rejouée.

Compatibilité : l'application publiée ignore la nouvelle RPC ; la nouvelle interface
en a besoin pour l'historique. Ordre prévu : candidat READY sans promotion automatique,
ajout SQL une fois, contrôles, puis promotion du même candidat. Aucune pause globale
nécessaire. Aucun rollback de données ni ancien tableau Tâches global.

Les vérifications avant/après publication portent en lecture seule sur les empreintes
Tâches, historiques, liaisons, droits, huit partages et payload CRM, ainsi que les fonctions
protégées existantes. Aucun contenu métier global n'est exporté. Les configurations,
protections de domaines, Google, œil des mots de passe, Intervenants et Publisher
restent conservés. Le contrôle dans les sessions réelles des utilisateurs reste distinct
des preuves locales et des contrôles de routage du déploiement.

## Rejouer les tests ciblés

Utiliser le banc fictif existant et des fichiers privés de fixtures/status locaux,
avec `TASKS_TEST_ACK=TASKS_DISPOSABLE_LOCAL_ONLY`. L'API doit être exactement
`http://127.0.0.1:55731`, PostgreSQL `127.0.0.1:55732/postgres`, l'application
`http://127.0.0.1:3200`. Les clés locales ne sont pas imprimées ni commitées.
Les runners sont `tests/tasks/admin-simplification-history-database.mjs`,
`admin-simplification-responsibles-browser.mjs` et
`admin-simplification-administration-browser.mjs`. Ne pas exécuter les fixtures
SQL et les navigateurs simultanément ; chaque suite nettoie uniquement ses propres données.

`admin-simplification-serve.mjs` construit une copie isolée des sources avec une unique
route locale de connexion aux profils fictifs. Fournir `TASKS_STATUS_FILE`,
`TASKS_FIXTURE_FILE`, `TASKS_APP_MANIFEST`, `TASKS_SOURCE_ROOT`,
`TASKS_CANDIDATE_BASE_SHA` et `TASKS_REVIEW_MODE=1`. Son fichier privé
`.tasks-candidate.json` contient `base`, `deploymentId`, `contactsDriveExcluded=true`
et les hashes SHA-256 des sources modifiées ; il ne contient aucune donnée métier.
Les navigateurs vérifient le manifeste exact avant de tester.
