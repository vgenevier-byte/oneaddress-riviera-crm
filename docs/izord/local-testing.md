# Banc local OAR / IZORD — reproduction

La reprise du 16 septembre 2026 utilise Colima, sans installation supplémentaire. Aucune commande ci-dessous ne lit `.env.local`, ne lie un projet cloud ni ne lance `db push`. Les variables s’appliquent aux processus du banc, sans modification de contexte Docker global ni de profil shell.

## Préparation et démarrage

```sh
cd ~/Desktop/OARcrm-repo
set -e
export PATH="/opt/homebrew/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY
export SUPABASE_BIN=/Users/vg/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
export IZORD_PG_MODULE=/tmp/oar-contact-release-test-runtime/node_modules/pg
export AGENT_BROWSER_BIN=/tmp/izord-browser-runtime/node_modules/.bin/agent-browser
export IZORD_ARTIFACTS=/tmp/izord-review-results

test -S "$HOME/.colima/default/docker.sock"
docker version
node --test tests/izord/local-target.test.mjs
node tests/izord/local-stack.mjs
```

Dans Codex, l’accès au socket Colima et les serveurs loopback nécessitent l’autorisation d’exécuter hors sandbox. Ne pas contourner un refus avec `sudo`, `chmod` ou un changement de socket/contexte. Les binaires indiqués sont ceux déjà présents lors de cette reprise : si absents, arrêter, sans téléchargement automatique.

`local-stack.mjs` refuse les overrides Docker/TLS/hôte, crée un workdir et un identifiant uniques, puis un réseau dédié lié à `127.0.0.1`. Il démarre PostgreSQL, Auth, PostgREST, Storage, Kong et Mailpit, vérifie les ports publiés puis écrit le statut privé `0600`. Les images du moteur peuvent être téléchargées au premier démarrage ; cela n’installe pas d’outil système.

Cibles fixes : API `127.0.0.1:55431`, base `127.0.0.1:55432/postgres`, mail `127.0.0.1:55434`, application `127.0.0.1:3159`. Un port déjà occupé doit provoquer un échec ; ne pas arrêter arbitrairement un service existant. Aucune clé réelle ou configuration SMTP/Google externe n’est chargée.

## Matrice Auth / REST / RPC / Storage / mail

Remplacer seulement le chemin du workdir par celui affiché lors du démarrage. Ne pas afficher/copier son `local-status.json` ni son fichier de fixtures dans les artefacts.

```sh
export IZORD_LOCAL_DIR=/chemin/temporaire/izord-local-stack-XXXXXX
export LOCAL_STATUS_FILE="$IZORD_LOCAL_DIR/local-status.json"
export LOCAL_FIXTURE_FILE="$IZORD_LOCAL_DIR/browser-fixtures.json"
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/integration" node tests/izord/live-local.mjs
```

Le runner exige une base fraîche : s’il trouve `crm_workspace_state`, il échoue, sans DROP/TRUNCATE. Il crée quinze comptes `@example.invalid`, obtient leurs JWT par connexion Auth et exerce les droits de chaque utilisateur. Les privilèges administratifs ne servent qu’au montage des données fictives et à la vérification des effets. Le schéma des neuf tables OAR est une fixture minimale ; les schémas Auth/Storage, migrations et RPC testés sont réels.

Il produit un rapport sans identifiants de connexion et un fichier privé de fixtures `0600` consommé par les deux étapes suivantes. Ne pas relancer ce seed sur la même pile : reprendre les étapes suivantes si le seed a réussi, ou créer une nouvelle pile fraîche après avoir arrêté celle créée par le banc.

## Six API Next : vraie autorisation, Google simulé

Dans un terminal avec les variables précédentes :

```sh
node tests/izord/live-app.mjs
```

Le runner copie uniquement les sources nécessaires, lie `node_modules`, remplace le seul transport Google dans cette copie et vérifie que le code de vérification JWT/appartenance demeure identique. Il construit puis sert le Next de production local sur `127.0.0.1:3159`. Une garde réseau bloque les connexions hors du banc. Aucun service role n’est passé à l’application. Les identifiants Google présents sont fictifs et le transport travaille en mémoire ; aucun appel Google réel n’est autorisé.

Une fois le serveur prêt, dans un second terminal conservant les mêmes variables et `set -e` :

```sh
IZORD_DRIVE_RESULTS_FILE="$IZORD_ARTIFACTS/drive-results.json" node tests/izord/live-drive.mjs
```

Les six handlers réels utilisent les JWT locaux. Les autorisations positives atteignent le transport simulé ; chaque refus vérifie qu’aucune opération Google n’a été ajoutée. Le DELETE autorisé garde son comportement métier historique `409` (suppression désactivée). Le compte fictif `drive_revoke` est révoqué durant le test ; la suite n’est pas conçue pour être relancée sur ce compte déjà révoqué.

## Navigateur avec sessions réelles

Après la suite API, avec la même application toujours active :

```sh
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/live-browser" node tests/izord/live.browser.mjs
```

Le navigateur dispose d’un profil éphémère et d’une restriction au domaine loopback. Les connexions passent par le formulaire réel. Le runner retarde de véritables réponses Auth/REST par CDP ; il ne remplace pas leur contenu. Il observe les requêtes et les écritures SQL locales pour vérifier les changements de compte, caches et sauvegardes. Ses traces publiables conservent des noms de rôles, méthodes et chemins, jamais les headers, JWT, mots de passe ou corps métier complets. Les fixtures modifiées par les scénarios navigateur sont restaurées en fin de test.

## Corrections après revue : reproductions et extensions

Pour les preuves **avant**, utiliser une copie isolée des sources antérieures aux corrections et une pile fraîche correspondante. Ne pas revenir en arrière dans le worktree courant. Les trois commandes suivantes exigent les vraies fixtures Auth et l’application `live-app.mjs` prête ; `--before` attend explicitement le défaut et ne constitue pas une validation de sécurité :

```sh
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/before/r1" node tests/izord/document-lifecycle.mjs --before
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/before/r2" node tests/izord/cache-lifecycle.browser.mjs --before
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/before/r3" node tests/izord/token-refresh.browser.mjs --before
```

Arrêter cette pile en conservant sa sauvegarde, puis créer une **nouvelle pile fraîche**, appliquer les sources corrigées via `live-local.mjs` et reconstruire `live-app.mjs`. Reprendre les variables de statut/fixtures du nouveau workdir. Les extensions s’exécutent sans `--before` :

```sh
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/after/r1" node tests/izord/document-lifecycle.mjs
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/after/r2" node tests/izord/cache-lifecycle.browser.mjs
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/after/r3" node tests/izord/token-refresh.browser.mjs
```

Les tests navigateur sont séquentiels lorsqu’ils modifient le workspace partagé. Les profils sont temporaires et nommés par processus ; aucun profil Chrome existant n’est utilisé. L’export de récupération contient uniquement les marqueurs fictifs et reste dans un répertoire temporaire privé hors des artefacts. Les URL signées et identifiants de connexion ne sont jamais imprimés.

Les rapports conservent séparément les étapes de reproduction, les contrôles de correction, les capacités signées déjà émises et les requêtes JWT ordinaires. Les assertions d’intégration Storage vérifient les octets téléchargés, pas seulement les statuts HTTP ou les politiques SQL.

## Non-régression, fixtures visuelles et build exact

Ces résultats restent distincts de l’intégration réelle. Exécuter depuis le dépôt avec les variables locales précédentes :

```sh
IZORD_PG_RUNTIME=/tmp/oar-contact-release-test-runtime \
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/unit-postgres" node tests/izord/postgres.mjs

CONTACT_ADDRESS_ARTIFACTS="$IZORD_ARTIFACTS/contacts" \
/tmp/izord-browser-runtime/node_modules/.bin/tsx tests/contactAddress.browser.ts

node tests/izord/preview.mjs --fixture
node tests/izord/ui.browser.mjs

./node_modules/.bin/tsc --noEmit --incremental false
node tests/izord/preview.mjs
git diff --check
git status --short
```

Le premier runner exige les runtimes déjà présents `embedded-postgres@18.4.0-beta.17` et `pg@8.16.3`, crée et arrête ses deux bases. Le runner Contacts compile une copie et utilise des fixtures. Le portail visuel utilise aussi une copie avec client simulé (1440/390 px), sans preuve Auth. Le dernier `preview.mjs` sans `--fixture` compile les sources exactes, avec une URL loopback et une clé publique fictive, sans charger `.env.local` ni le fichier WIF. Aucun `next build` connecté à la Production.

Chaque commande doit sortir avec le code zéro, avec aucun test ignoré. L’absence de pile, une mauvaise cible ou une étape non exécutée invalide la validation complète ; aucun fallback vers des mocks/cloud ne remplace cette étape. `set -e` arrête la séquence au premier échec.

## Arrêt du banc créé pour ces tests

Arrêter le serveur de test avec Ctrl-C dans son terminal, puis arrêter seulement le workdir créé ci-dessus :

```sh
"$SUPABASE_BIN" stop --workdir "$IZORD_LOCAL_DIR"
```

La commande de suppression du seul réseau dédié est imprimée par le lanceur. Ne pas utiliser `--all`, `prune`, `reset`, `--no-backup`, supprimer un volume ou arrêter un environnement préexistant. Les fichiers temporaires privés et le backup local contiennent uniquement les fixtures fictives ; ils ne doivent pas être partagés/déployés.

Après arrêt et vérification des ports fermés, conserver le statut privé et vérifier séparément l'échec d'infrastructure :

```sh
LOCAL_FIXTURE_FILE="$IZORD_LOCAL_DIR/missing-stack-fixture-must-not-exist.json" \
IZORD_ARTIFACTS="$IZORD_ARTIFACTS/negative-missing-stack" node tests/izord/live-local.mjs
```

Cette commande doit échouer avec **code 1 / ECONNREFUSED sur 127.0.0.1:55432**, avant toute fixture. Ce refus attendu est un contrôle négatif distinct, jamais une réussite de la matrice Auth/Storage. Ne pas redémarrer la pile ni utiliser une autre cible pour convertir artificiellement ce contrôle en succès.
