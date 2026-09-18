# Next.js — complément lint et fiabilité du banc local

Clôture du **17 septembre 2026** : **lint à zéro erreur, deux avertissements justifiés** ; les autres catégories fonctionnelles et les nouveaux tests React passent. **La stabilité caches reste non validée** (9/9, 9/9, puis 7/9 avec fermeture CDP inexpliquée). ESLint 9 reste hors maintenance, les trois plugins bloquant ESLint 10 étant identifiés. La pile est arrêtée avec ses volumes conservés. Aucun déploiement n'est autorisé. Le rapport historique de la première mise à niveau est conservé plus bas.

## Référence et périmètre du complément

- Référence incrémentale : `/private/tmp/izord-lint-cdp-baseline-20260917-141504`, créée le 17 septembre à 14:15:04 Europe/Paris, **109 fichiers sélectionnés** avec inventaire et SHA-256. Elle contient le lot 1 corrigé **et** la première mise à niveau Next.js, avant ce complément. Aucun secret, environnement, profil navigateur, dump ou donnée métier réelle n'a été ajouté à cette référence.
- HEAD reste `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`. Aucun reset, modification de l'index, commit, push ou déploiement.
- **B** désigne `/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/lint-cdp-20260917`.
- Le patch `B/lint-cdp-complement.patch` compare les fichiers finaux à cet instantané, y compris les nouveaux fichiers non suivis. Il est distinct de `nextjs-20260917/nextjs-lot.patch`, conservé : ce dernier compare la première mise à niveau au lot 1 corrigé. Aucun de ces deux patches ne prend simplement `main` comme base.
- Aucun changement de SQL, des contrôles d'accès, de récupération/purge des caches, des routes d'accès, des autorisations Drive, du HTML original ni de WIF. Les ajustements de React concernent leurs consommateurs, avec des tests dédiés aux sessions/sauvegardes et aux états modifiés.

## Chaîne maintenue : blocage explicitement conservé

Recherche officielle et métadonnées npm du **17 septembre 2026**, archivées avec leurs URL/date/empreintes dans `B/maintenance/evidence/`. Détails : `B/maintenance/RESEARCH.md` et `compatibility-matrix.json`.

| Élément | Version réellement installée et finale | Compatibilité |
|---|---|---|
| Node / npm | 24.16.0 / 11.13.0 | Node 24 Active LTS ; satisfait ESLint 10 et Next 16. Pas de mise à jour système |
| Next / eslint-config-next | 16.3.5 / 16.3.5 | Node >=20.9.0 ; preset ESLint >=9 |
| React / React DOM | 19.3.0 / 19.3.0 | peer React DOM ^19.3.0 satisfait |
| ESLint | **9.39.5** | **fin de maintenance le 6 août 2026** |
| eslint-plugin-react | 7.37.5 | bloque ESLint 10 : `^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7` |
| eslint-plugin-jsx-a11y | 6.10.2 | bloque ESLint 10 : `^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9` |
| eslint-plugin-import | 2.32.0 | bloque ESLint 10 : `^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9` |
| eslint-plugin-react-hooks | 7.1.1 | accepte ^10.0.0 |
| typescript-eslint / parser / plugin / typescript-estree | 8.70.0 | acceptent ESLint ^8.57 / ^9 / ^10 et TS >=4.8.4 <6.1.0 |
| TypeScript | 5.6.3 | conservé, dans la plage du parseur |
| Types Node / React / DOM | 24.13.5 / 19.3.0 / 19.3.0 | inchangés depuis la mise à niveau |

ESLint **10.10.0** est stable et maintenu ; Node convient. Cependant **aucune version stable dans les plages des trois plugins imposées par le preset Next ne déclare accepter ESLint 10**. Le peer permissif du preset ne suffit pas. La matrice inspecte toutes les versions stables admises, pas seulement les tags latest. [Support ESLint](https://eslint.org/version-support/), [migration ESLint 10](https://eslint.org/docs/latest/use/migrate-to-10.0.0), [preset Next](https://registry.npmjs.org/eslint-config-next/16.3.5), [React plugin](https://registry.npmjs.org/eslint-plugin-react/7.37.5), [a11y](https://registry.npmjs.org/eslint-plugin-jsx-a11y/6.10.2), [import](https://registry.npmjs.org/eslint-plugin-import/2.32.0).

**Le point maintenance reste ouvert.** Option retenue pour cette revue : garder provisoirement 9.39.5, corriger les diagnostics, puis attendre des versions stables compatibles des trois plugins et revérifier le preset/l'installation. Aucun `--force`, `--legacy-peer-deps`, override, suppression de plugin ou changement de linter. Le support commercial évoqué par ESLint n'a ni été évalué ni souscrit. Un audit sans vulnérabilité ne rend pas ESLint 9 maintenu. Node 24.21.0 est publié mais sa mise à jour système est hors périmètre. [Calendrier Node](https://github.com/nodejs/Release/blob/main/schedule.json), [support Next](https://nextjs.org/support-policy).

`package.json`, `package-lock.json`, `eslint.config.mjs` et `tsconfig.json` restent inchangés **dans ce complément**.

## Diagnostic initial du lint et attribution

`npm run lint -- --format json --output-file <B>/lint-initial.json` a effectivement retourné **1**, avec **31 erreurs et 8 avertissements**. La sortie originale et celle du premier lot Next sont conservées. `B/lint-initial-diagnostics.json` donne pour chacun le fichier, ligne, colonne, règle, sévérité et message complet, sans dépendre des numéros de ligne après correction.

| Règle | Gravité | Fichier:lignes initiales |
|---|---|---|
| `@next/next/no-location-assign-relative-destination` | avertissement | `components/AccessPortal.tsx` : 121 |
| `react-hooks/set-state-in-effect` | erreur | `components/CRMApp.tsx` : 1880, 3468, 3481, 5466, 5696, 5709 |
| `react-hooks/exhaustive-deps` | avertissement | `components/CRMApp.tsx` : 1921, 5828, 5841, 10080, 10181 |
| `react-hooks/preserve-manual-memoization` | erreur | `components/CRMApp.tsx` : 2902, 10188, 10192, 10192, 10198 |
| `@next/next/no-img-element` | avertissement | `components/CRMApp.tsx` : 5138, 8664 |
| `react-hooks/refs` | erreur | `components/CRMApp.tsx` : 5242, 5327, 5337, 5337 |
| `react-hooks/immutability` | erreur | `components/CRMApp.tsx` : 5502 |
| `react-hooks/static-components` | erreur | `components/CRMApp.tsx` : 11682, 11688, 11689, 11690, 11695, 11699, 11703, 11709, 11713, 11723, 11727, 11731 |
| `react-hooks/set-state-in-effect` | erreur | `components/MobileCRMHeader.tsx` : 42 |
| `react-hooks/set-state-in-effect` | erreur | `components/SearchableBusinessContactPicker.tsx` : 68, 103 |

L'origine est établie par la comparaison des **règles et presets**, puis un rejeu ciblé, et pas seulement par l'absence de modification des fichiers :

- Les **31 erreurs** proviennent de cinq règles Compiler recommandées par Hooks 7/Next 16, absentes du plugin Hooks 5 verrouillé auparavant. Les constructions analysées précèdent la mise à niveau. Elles deviennent visibles avec cette configuration ; il ne s'agit pas de 31 régressions métier démontrées. Aucun React Compiler n'a été activé dans le produit.
- Le warning de destination relative est nouveau dans le plugin Next 16 ; le code du portail était inchangé.
- Les **cinq exhaustive-deps et deux no-img** sont reproduits aux mêmes lignes par **ESLint 8.57.0 / preset Next 14.2.16 / ancien Hooks**, sur les sources de l'instantané. Preuves : `B/lint-old-rules-replay.json` et `.log`. C'est un rejeu explicite du preset dans une copie locale, **pas la preuve qu'un ancien lint configuré passait ou avait été exécuté**. L'ancien dépôt ne contenait pas de configuration ESLint. Le premier chargement de cet ancien runtime déplacé a manqué `@eslint/eslintrc` ; la résolution a été explicitée avec `NODE_PATH` vers ses propres dépendances, sans installer ni mélanger des plugins actuels. Le rejeu signale aussi l'absence de dossier pages dans sa copie réduite ; cela ne crée ni ne supprime les sept diagnostics concernés.
- Le blocage ESLint 10 vient des peers déclarés. Il est distinct des diagnostics applicatifs ; aucun crash du parseur/plugin n'explique les 31 erreurs initiales.

La commande analyse les fichiers applicatifs `app`, `components`, `lib` ; `B/lint-coverage.json` compare leur inventaire à la sortie ESLint. Aucun module applicatif n'a été exclu, aucune règle désactivée, abaissée ni supprimée. Le code d'échec initial est conservé ; aucun `|| true` ne transforme un échec en validation.

## Corrections ciblées et comportement préservé

- **Composants Dashboard** : deux composants sans état sortent du corps de CRMApp. Leur identité React reste stable à chaque rendu ; contenu/actions inchangés.
- **Références asynchrones** : `useCommittedValue` met à jour jeton et payload dans `useLayoutEffect`, après commit. Les callbacks ne voient pas une valeur provenant d'un rendu suspendu/abandonné. Le changement de jeton n'entre pas dans les dépendances des effets de chargement/autosauvegarde.
- **Sauvegarde** : callbacks de chargement, conflit et écriture stabilisés avec leurs dépendances réelles ; l'indicateur dirty lit un état d'empreinte, pas une ref pendant le rendu. Une réponse acquitte exactement le payload envoyé, jamais les éditions plus récentes. Révision/CAS, abort, conflit, identité et garde des réponses tardives restent actifs. Le seed autorisé conserve l'empreinte du serveur avant l'écriture.
- **Préremplissage des devis** : une nouvelle demande explicite prend un instantané du devis correspondant ; l'effet ne manipule ensuite que les champs DOM. Un rafraîchissement des props quotes sans nouvelle demande ne remplit pas à nouveau le formulaire et ne doit pas effacer la saisie. Le bouton Modifier conserve son action explicite.
- **Suivi maison** : ajustement conditionnel de l'état propre lors de l'invalidation du salarié/filtre, avant le rendu des enfants. Le taux saisi est conservé quand le salarié reste actif. L'état vide est gardé sans boucle.
- **État initial** : données RAM et acteur lus par les initializers ; JSON invalide donne toujours le message d'avertissement. L'ancien effet « Visite→Devis » était exécuté sur `emptyData` avant le remplacement par la RAM, puis le chargement cloud ; il n'opérait donc aucune migration des données chargées. Sa suppression n'ajoute aucune conversion de statut métier.
- **Tâches terminées** : même seuil strict de plus de trois jours et même horodatage des tâches sans date, appliqués à l'initialisation et lors du remplacement de la collection dans `setData`. Le temps est capturé avant l'updater pour supporter son rejeu. Une tâche ouverte, une date invalide ou future est conservée. Une maintenance d'un payload cloud reste dirty face à la vraie empreinte serveur, donc sauvegardable. Aucun minuteur de purge supplémentaire.
- **Calculs Documents/Planning** : retrait de wrappers `useMemo` inefficaces, déjà invalidés par leurs collections recréées au rendu. Corps des calculs, filtres et tris inchangés ; aucune logique d'accès ajoutée.
- **Recherche mobile et sélecteur de prestataire** : resets conditionnels sur les mêmes primitives de changement ; maintien des saisies lors d'un rafraîchissement sans changement de sélection, recherche/clavier/reset conservés.
- **Logo public** : passage à `next/image` avec import statique et classe existante. Le document privé reste sur son URL blob autorisée.

Les changements de logique d'effet/état sont vérifiés par les nouveaux tests React de composants/commit, initialisation et tâches, ainsi que les tests réels R3 et le nouveau cas de réponse de sauvegarde retenue. Les fixtures React ne sont pas comptées comme des preuves Auth/REST réelles. [Ajuster l'état React](https://react.dev/learn/you-might-not-need-an-effect), [règle effet/état](https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect), [référence du plugin Hooks](https://react.dev/reference/eslint-plugin-react-hooks).

### Avertissements conservés individuellement

1. `components/AccessPortal.tsx`, `@next/next/no-location-assign-relative-destination` : navigation complète après déconnexion. Elle abandonne le contexte JavaScript qui contient la RAM métier. Remplacer mécaniquement par une navigation client demande de revalider cette frontière. Impact : rechargement complet de page ; warning conservé **sans suppression locale**.
2. `components/CRMApp.tsx`, `@next/next/no-img-element` : aperçu d'une facture privée sur une URL blob obtenue après accès authentifié. Le conserver évite de modifier le transport/autorisation de ce document pour une optimisation d'image. Impact : pas d'optimisation Next sur cet aperçu ; warning conservé **sans suppression locale**. Le logo public a, lui, été traité.

## Installation reproductible du complément

Copie vierge : `/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/izord-lint-cdp-clean-z6d7bnnf`. Seulement package/lock avant installation ; environnement reconstruit, npmrc vides distincts, cache dédié, aucun secret ni `.env` chargé.

```sh
npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund
npm ls --all --json
npm audit --json
```

Les trois commandes retournent **0**. 392 paquets installés, arbre sans problème déclaré, zéro vulnérabilité signalée, lock inchangé (`ac771156f3486647bfd842804ca4d0781f214752995d45e0b4f639a2dc09bf65`). Scripts lifecycle non exécutés ; le build séparé vérifie le runtime compilé. L'avertissement npm signalant ESLint 9 hors support est conservé dans `B/npm-ci.log`. Résultats : `B/clean-install-result.json`, `npm-tree.json`, `audit.json`.

## Timeout CDP : diagnostic et limites

Première trace protégée : `B/original-cdp-failure.json`, SHA-256 `cad1b707a0d6f448997950c0321dbd2c3d06f10f596cc0899a80d1cb900660fa`. Elle montre sept groupes réussis, puis un `Runtime.evaluate` sans réponse pendant 20 s lors de la deuxième récupération, après la propagation entre onglets. **Elle ne permet pas d'identifier le clic précis.** Les anciennes traces ne contiennent ni commande nommée, ni console/réseau au moment de l'échec, ni sonde serveur contemporaine. L'ancien serveur avait annoncé ready en 60 ms et sept groupes avaient déjà utilisé Auth ; ces éléments ne prouvent pas son état exact à l'instant du timeout.

Le runner conserve 20 s par commande et neuf groupes. Il ajoute des libellés/durées sans arguments sensibles, la sélection du seul onglet de récupération possédé, des attentes sur document/loader, visibilité, cases et boutons, puis sur le GUID terminé et le vrai fichier de téléchargement. Les autres onglets restent testés en arrière-plan. Les erreurs CDP ne sont plus avalées par une attente générique ; seule la destruction explicite d'un contexte pendant une navigation est traitée comme transitoire. Aucun clic ni suite ne tourne en boucle jusqu'au succès. Console, réseau, santé locale, téléchargements et diagnostic d'échec sont consignés sans jetons, expressions privées ni champs de formulaire.

Ces adaptations traitent des lacunes démontrables du **pilotage et des traces**, sans établir la cause de l'ancien timeout. `B/CDP_DIAGNOSIS.md` conserve l'analyse complète. Trois commandes de stabilité sont prévues, chacune avec un profil fictif neuf et son dossier de preuve ; la première suit le redémarrage à froid des processus locaux, avec les volumes existants conservés. La validation finale ci-dessous rapporte chaque tentative.

### Trois essais de stabilité réalisés — validation non complète

| Essai | Début UTC | Résultat | Contexte |
|---|---|---|---|
| 1 | 12:31:02.362 | **9/9**, 8,992 s | profil neuf ; premier passage caches après redémarrage à froid de la pile conservée et premier lancement de la nouvelle application |
| 2 | 12:31:21.050 | **9/9**, 8,879 s | autre profil neuf |
| 3 | 12:31:48.573 | **7/9 puis échec**, 8,809 s | autre profil neuf ; deux groupes finaux non validés |

Preuves : `B/cache-stability/run-{1,2,3}/`, résultats et traces JSONL de commandes. **Aucun quatrième essai.** Ce sont neuf tests uniques répétés, pas 27 tests uniques.

Au troisième passage, le second téléchargement est terminé et son fichier vérifié ; le portail est visible, focalisé, avec le contrôle actif. Les deux cibles se détachent puis le WebSocket CDP se ferme vers 12:31:57.323–355 UTC, avant l'évaluation nommée `recovery acknowledgement rendered`. L'erreur est **`CDP transport is not open`**, distincte du timeout de 20 s historique. La sonde serveur après cet échec répond au 401 anonyme attendu en 2 ms. Aucune exception JavaScript ni boîte de dialogue n'est consignée dans ce passage ; cela ne prouve pas l'absence de défaut interne au navigateur.

**Le timeout initial ne s'est pas reproduit et sa cause reste inconnue.** La fermeture de transport du troisième passage reste également non expliquée à ce stade ; la stabilité du banc caches **n'est pas validée**. Les deux succès ne sont pas présentés comme une résolution. Les horaires d'une autre fixture navigateur ont été comparés : son fichier de configuration puis son lancement observables sont postérieurs à la perte CDP ; aucune fermeture correspondante n'a été identifiée chez elle. Cela ne démontre ni une cause partagée ni son exclusion absolue. Les investigations sont limitées aux processus/profils fictifs possédés.

## Adaptation du banc à la pile conservée

La pile existante `izord-local-stack-5HXuB2` a été relancée le 17 septembre à 12:18:40.787 UTC, prête à 12:19:03.754 UTC, avec ses volumes PostgreSQL/Storage conservés. Auth, PostgreSQL, REST, Storage, mail local et passerelle Kong seulement, ports sur 127.0.0.1, socket Colima explicite. Le froid est un redémarrage des processus, pas un reset de données. Les tests Auth ont précédé les caches ; aucun effacement de caches serveur ou de volumes n'est revendiqué.

`live-local.mjs --reuse-existing` crée une nouvelle cohorte fictive et de nouveaux UUID/chemins de registre. Il compare les réponses REST complètes aux droits attendus, y compris les anciennes lignes autorisées pour les rôles globaux. Il contrôle dix-huit inventaires de lignes et une empreinte ciblée des fonctions public/app_private, politiques public/storage, triggers non internes et flags RLS des tables, avant/après. Ce n'est pas un dump intégral du catalogue. Le payload partagé fictif est sauvegardé hors Git puis restauré sous empreinte et révision optimiste, sans reculer la date serveur. Aucun ancien compte, projet, objet ou tombstone n'a été supprimé pour satisfaire les assertions.

Le premier passage a échoué après 23 groupes sur une collision `23505` d'un **identifiant Drive fictif du banc** déjà présent. Cette tentative est conservée dans `B/integration/auth-rest-storage/`, avec sa restauration réussie. Après correction des identifiants fictifs reserve/ready pour inclure l'UUID de passage, une autre cohorte a terminé **96/96** dans `auth-rest-storage-final/`. Les 23 groupes partiels ne sont pas comptés comme une validation complète supplémentaire. SQL et autorisations applicatives n'ont pas changé. Dix tests supplémentaires vérifient les préconditions de réutilisation/restauration.

## Commandes du complément

Les chemins privés de status, fixtures et manifest doivent désigner **la pile fictive conservée**, jamais un projet distant. Les secrets locaux restent dans ses fichiers privés, sans être copiés dans ce rapport. `LOCAL_FIXTURE_FILE` doit être un nom nouveau pour chaque nouveau passage Auth ; le runner refuse de l'écraser. Chaque catégorie utilise un dossier de résultats distinct.

```sh
RESULTS="/tmp/izord-lint-cdp-replay-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS"
export PATH="/opt/homebrew/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY
export IZORD_PG_MODULE=/tmp/oar-contact-release-test-runtime/node_modules/pg
export IZORD_PG_RUNTIME=/tmp/oar-contact-release-test-runtime
export AGENT_BROWSER_BIN=/tmp/izord-browser-runtime/node_modules/.bin/agent-browser
# LOCAL_STATUS_FILE, LOCAL_FIXTURE_FILE et IZORD_APP_MANIFEST_FILE :
# fichiers privés appartenant à la même pile existante vérifiée.
# IZORD_ARTIFACTS : dossier neuf propre à la catégorie.
node tests/izord/live-local.mjs --reuse-existing
node tests/izord/document-lifecycle.mjs --after
node tests/izord/live-app.mjs
# Autre processus, application prête et sorties dédiées :
IZORD_DRIVE_RESULTS_FILE="$RESULTS/drive/drive-results.json" node tests/izord/live-drive.mjs
node tests/izord/postgres.mjs
node --test tests/izord/reuse-local.test.mjs
node --test tests/izord/local-target.test.mjs
node tests/izord/live.browser.mjs
node tests/izord/token-refresh.browser.mjs
# Exactement trois invocations cache ont été effectuées, avec dossiers distincts :
IZORD_ARTIFACTS="$RESULTS/run-1" node tests/izord/cache-lifecycle.browser.mjs
IZORD_ARTIFACTS="$RESULTS/run-2" node tests/izord/cache-lifecycle.browser.mjs
IZORD_ARTIFACTS="$RESULTS/run-3" node tests/izord/cache-lifecycle.browser.mjs
# Fixtures React supplémentaires, sans preuve Auth :
IZORD_COMPONENT_ARTIFACTS="$RESULTS/components" node tests/izord/component-state.browser.mjs --crm-views
# Seulement après les suites dépendant de la pile :
node tests/izord/restore-reused-workspace.mjs
# Contrôles statiques :
npm run lint -- --format json --output-file "$RESULTS/lint-final.json"
./node_modules/.bin/tsc --noEmit --incremental false
git diff --check
# Copie exacte isolée issue de npm ci, environnement fictif et garde réseau :
node node_modules/next/dist/bin/next build --webpack
```

L'ordre effectif des trois essais caches était **avant** les 13 historiques et R3 ; la liste ci-dessus regroupe les commandes par fonction. Le runner `local-stack.mjs` crée une nouvelle pile : il n'a **pas** été relancé pour remplacer les volumes existants. Le redémarrage et l'arrêt passent par le CLI Supabase ciblé sur le workdir privé existant. Les commandes Contacts et visuelles ainsi que leurs fixtures sont détaillées dans les preuves de leurs catégories.

La recette détaillée de reprise de la pile conservée est dans `B/RESTART_EXISTING.md` : réseau privé recréé avec son label et liaison loopback, six services vérifiés, statut CLI privé actualisé en 0600, volumes contrôlés. Cette recette documentaire n'a pas été exécutée après l'arrêt final. Les commandes historiques effectivement utilisées et leurs résultats sont dans `B/INTEGRATION_REPORT.md`.

## Résultats finaux, catégories distinctes

| Catégorie | Résultat du complément | Périmètre et preuve sous B |
|---|---|---|
| Unitaires/PostgreSQL historiques | **210/210** | 13 suites historiques, schémas Auth/Storage facsimilés ; `integration/unit-postgres/test-results.json` |
| Nouveaux tests tâches | **8/8** | dates, seuil, immutabilité, rejeu, état dirty après chargement cloud ; même fichier de résultats |
| Nouveaux tests du banc conservé | **10/10** | préconditions, inventaires/restauration, aucun service réel ; `integration/reuse-harness/` |
| Auth/REST/RPC/Storage/mail réels locaux | **96/96** | nouvelles connexions/JWT et mail local ; `integration/auth-rest-storage-final/` |
| Extensions Storage réelles locales | **9/9** | immutabilité, versions, capacités déjà signées, révocations ; `integration/storage-lifecycle/` |
| API Drive | **97/97** | vrais JWT, six routes et registre local, **Google simulé** ; `integration/drive/` |
| Navigateur historique | **13/13** | vraie pile Auth/REST, identité/révocation/réponses tardives ; `live-browser/` |
| Renouvellement et conflit | **8/8 historiques + 1/1 nouveau** | vrai refresh, zéro écriture seul, conflit, deux réponses PATCH réelles retardées ; `token-refresh-browser/` |
| Caches, neuf groupes uniques | **9/9 ; 9/9 ; 7/9 puis échec** | trois répétitions de stabilité, deux groupes finaux non validés au troisième ; `cache-stability/` |
| Composants et états React nouveaux | **20/20** | navigateur sur fixture, Auth bloquée dans la page de test d'initialisation ; `component-state/` |
| Contacts | **16/16** | navigateur/fixtures fictives, aucun Auth/Drive réel ; `contacts/browser-results.json` |
| Visuels | **10/10** | fixtures 1440/390, lisibilité/débordement/navigation ; `visual/ui-results.json` |
| Gardes de cible | **20/20** | puis rejeu des mêmes 20 après arrêt, pas 40 tests uniques ; `integration/guards/` |
| Refus pile arrêtée | **refus attendu confirmé** | exit 1 ECONNREFUSED, zéro groupe Auth validé, aucun nouveau fixture, aucun secours distant ; `integration/negative-missing-stack/` |
| Lint | **0 erreur, 2 avertissements, exit 0** | 43 fichiers applicatifs effectivement analysés, 83 fichiers au total ; `lint-final.json`, `lint-coverage.json` |
| TypeScript | **exit 0** | `tsc --noEmit --incremental false`, `typescript.log` |
| Production, code exact | **exit 0** | copie issue du nouveau npm ci, aucune substitution de code, garde réseau locale ; `exact-production-build.log`, `exact-build-manifest.json` |
| Diff whitespace | **exit 0** | `git diff --check`, preuve finale dédiée |

Les vingt groupes React se répartissent en **8 Mobile/Picker, 3 valeurs après commit/suspension, 3 devis, 3 Suivi maison, 1 Dashboard, 2 initialisation RAM/JSON invalide**. Ils vérifient notamment l'acteur restauré, le statut Visite conservé, les tâches maintenues, les taux et brouillons préservés. Le test de props de devis attend un témoin confirmant leur changement effectif. Les commandes de modification des props fictives sont pilotées dans la page de test ; ce n'est pas une simulation d'Auth annoncée comme intégration réelle.

Les essais de mise au point de cette nouvelle fixture restent conservés : un pointeur sur un résultat influençait le scénario clavier ; un clic sur une commande fictive n'avait pas été reçu pendant le scroll programmatique. Le premier contrôle de conservation de saisie, sans témoin de props réellement modifiées, était insuffisant. Ces tentatives ne sont pas ajoutées aux vingt groupes finaux. Les corrections portent sur le pilotage et les observations de la fixture ; aucun défaut produit n'a été déduit de ces faux échecs. Les captures espaces/IZORD mobile et fiche Contacts ont également été relues, sans ajouter un nouveau compteur de tests.

**Aucun total global fusionnant unitaires, fixtures, échanges réels et répétitions n'est annoncé. Aucun groupe ignoré, non exécuté ou bloqué n'est compté réussi.** La fermeture CDP reste un échec réel du banc, et les réserves de maintenance restent ouvertes.

## Fichiers du seul complément

| Fichier | Motif |
|---|---|
| `components/CRMApp.tsx` | corrections React ciblées, sauvegarde/initialisation, composants stables, calculs et logo public |
| `components/MobileCRMHeader.tsx` | reset conditionnel de la recherche lors du changement d'onglet |
| `components/SearchableBusinessContactPicker.tsx` | synchronisation conditionnelle des valeurs par défaut et index clavier |
| `lib/access/useCommittedValue.ts` **nouveau** | références mises à jour uniquement au commit |
| `lib/taskMaintenance.ts` **nouveau** | maintenance pure des tâches avec horloge fournie |
| `tests/taskMaintenance.test.ts` **nouveau** | huit comportements de maintenance/dirty/rejeu |
| `tests/izord/component-state.browser.mjs` **nouveau** | vingt groupes sur les effets/états corrigés, fixture isolée |
| `tests/izord/cache-lifecycle.browser.mjs` | attentes explicites, traces et diagnostics, trois essais distincts |
| `tests/izord/token-refresh.browser.mjs` | cas additionnel de deux vrais accusés de sauvegarde retardés |
| `tests/izord/live-local.mjs` | réutilisation explicite de la pile conservée, cohortes/identifiants uniques |
| `tests/izord/reuse-local.mjs` **nouveau** | gardes, inventaires et préconditions de restauration |
| `tests/izord/reuse-local.test.mjs` **nouveau** | dix contrôles des gardes du banc |
| `tests/izord/restore-reused-workspace.mjs` **nouveau** | restauration du seul payload fictif sous CAS |
| `docs/izord/NEXTJS_REVIEW.md` | ce rapport, avec historique conservé |

Les exports supplémentaires de vues CRM et le blocage de la réponse Auth pour la fixture React existent **uniquement dans sa copie temporaire**, pas dans le produit. Aucun élargissement de permission ni modification SQL. Le patch contient les versions ajoutées non suivies et peut être appliqué à une copie de l'instantané de référence ; l'inventaire et les empreintes sont dans `B/changed-files.json`.

## État conservé et arrêt

Les deux migrations SQL sont inchangées : registre `ac1e8a6f5ae5bab3ae042bec94fc40bdc937e661ddc2474564d12b8545eda7f6`, accès `03b897399c1dc0e9eb3314fd6ddfe1c17135337c8fdef7a27eb579210253fce9`. HTML original inchangé : `8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1`. WIF inchangé et non suivi : `a804628fe4187ff6cffe5dc48ad8f05dfc6b4f48cb7039e93baf372ff485a021`. Preuve : `B/protected-files.json` ; le contenu WIF n'est pas copié dans les artefacts.

Le payload fictif initial a été restauré sous CAS ; dix-huit inventaires de lignes conservées et l'empreinte SQL ciblée sont conformes. L'application puis la pile ont été arrêtées, sans suppression de volumes. `B/integration/cleanup/cleanup.json` conserve les deux noms, dates et drivers identiques avant/après et l'absence de changement des conteneurs étrangers. Les profils temporaires et serveurs de fixture ont été fermés. La garde pile absente a refusé l'exécution, sans écrire ni chercher un environnement distant.

Aucun commit, push, déploiement, migration distante, changement Vercel, invitation réelle, écriture métier distante, appel Google réel ou purge d'un profil Chrome réel. Aucun ajout au générateur HTML. Aucun ZIP supplémentaire. **Arrêt pour revue**, avec stabilité caches non acquise et maintenance ESLint non soldée.

## Pièces de revue et contrôles de livraison

[Patch incrémental — 14 fichiers](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/lint-cdp-20260917/lint-cdp-complement.patch) · [Inventaire et empreintes](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/lint-cdp-20260917/changed-files.json) · [Analyse CDP](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/lint-cdp-20260917/CDP_DIAGNOSIS.md) · [Résultats navigateur et commandes Contacts/visuels](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/lint-cdp-20260917/BROWSER_REPORT.md) · [Recette de reprise de la pile conservée](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/lint-cdp-20260917/RESTART_EXISTING.md).

Le patch a été vérifié puis appliqué **uniquement à une copie temporaire de l'instantané** : les quatorze fichiers reconstruits correspondent aux SHA-256 finaux (`patch-validation.json`). Le contrôle de confidentialité n'a trouvé aucun JWT, clé privée ou valeur réelle des credentials du banc dans les preuves textuelles ; aucun chemin exclu n'y est présent (`confidentiality-check.json`). Ce contrôle ne modifie ni ne copie les secrets. La vérification finale des huit ports, y compris 3163 après la fixture React, confirme leur fermeture (`final-port-check.json`).

## Git status --short à la clôture

```text
 M .gitignore
 M app/api/drive/_utils.ts
 M app/page.tsx
 M components/CRMApp.tsx
 M components/MobileCRMHeader.tsx
 M components/SearchableBusinessContactPicker.tsx
 M package-lock.json
 M package.json
 M tests/contactAddress.browser.ts
 M tests/driveFolderConcurrency.test.ts
 M tests/driveRegistryAuth.test.ts
 M tsconfig.json
?? .vercelignore
?? app/izord/
?? app/spaces/
?? components/AccessPortal.module.css
?? components/AccessPortal.tsx
?? docs/izord/
?? eslint.config.mjs
?? lib/access/
?? lib/taskMaintenance.ts
?? supabase/migrations/20260916170445_module_access_foundation.sql
?? tests/crmCache.test.ts
?? tests/izord/
?? tests/izordAuthorization.test.ts
?? tests/moduleAccess.test.ts
?? tests/taskMaintenance.test.ts
?? tests/workspaceSync.test.ts
```

---

# Historique conservé — première validation Next.js avant ce complément

La section suivante décrit l’état **antérieur** : ses 31 erreurs de lint et sa reprise caches ne remplacent pas les résultats actuels ci-dessus. Texte conservé pour distinguer les lots.

# Mise à niveau locale Next.js — 17 septembre 2026

## Conclusion et périmètre

Next.js **16.3.5**, React/React DOM **19.3.0** installés localement. Les catégories fonctionnelles demandées passent, avec un délai CDP non élucidé à la première tentative du banc caches, puis un passage complet réussi. **Le lint échoue : 31 erreurs et 8 avertissements.** Les constructions concernées existaient avant la mise à niveau ; elles ne sont ni réécrites ni masquées dans ce lot. La validation globale reste donc non verte. Ce travail ne constitue pas une autorisation de déploiement.

Les trois pièces de `IZORD_OAR_Revue_Corrections_Et_Lot_Nextjs.zip` ont été lues. Le prompt autorise cette mise à niveau locale ; la revue conserve les corrections R1/R2/R3 et leurs limites. Les 17 tests rejoués par la revue indépendante appartiennent à la suite existante et ne sont pas ajoutés aux résultats ci-dessous.

## Base corrigée préservée et diff de ce lot

- HEAD inchangé : `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`.
- Base de comparaison : **état corrigé et non commité du lot 1**, pris le 17 septembre à 11:16:32 Europe/Paris ; ce n’est pas un diff contre HEAD.
- Instantané privé hors Git : `/private/tmp/izord-nextjs-baseline-20260917-111632` ; 106 fichiers sélectionnés, inventaire `manifest.json`, `SHA256SUMS`, état Git avant modification et copies sous `source/`. Empreintes des copies vérifiées. Aucun `.env`, WIF, Git, dépendance, build, profil navigateur ou donnée de base n’est copié dans cet instantané.
- Ancien `node_modules` conservé séparément dans `/private/tmp/izord-nextjs-previous-node-modules-20260917`, pour un retour local des dépendances. Aucun reset, clean, stash ni modification de l’index.
- Artefacts de cette exécution : `/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/nextjs-20260917` (désigné **A** ci-dessous). Les preuves du lot 1 antérieur ne sont pas réutilisées comme résultats de cette mise à niveau.
- Diff : `A/nextjs-lot.patch`, accompagné de `A/changed-files.json` et des états Git. Il inclut les nouveaux fichiers non suivis. Les changements préexistants du lot d’accès sont exclus du diff incrémental.

Les **11 fichiers** de ce lot sont :

```text
docs/izord/NEXTJS_REVIEW.md                  nouveau
eslint.config.mjs                          nouveau
package.json
package-lock.json
tsconfig.json
tests/contactAddress.browser.ts
tests/izord/cache-lifecycle.browser.mjs
tests/izord/live-app.mjs
tests/izord/nextjs-smoke.browser.mjs         nouveau
tests/izord/preview.mjs
tests/izord/ui.browser.mjs
```

## Versions vérifiées et choix

Sources officielles et registre npm consultés le **17 septembre 2026**, métadonnées conservées dans `A/official-metadata.json` (09:18:51 UTC). Détails et URL par paquet dans `A/official-research.md`.

| Élément | Avant | Après |
|---|---|---|
| Next / eslint-config-next | 14.2.16 | **16.3.5** |
| React / React DOM | 18.3.1 | **19.3.0** |
| @types/react | 18.3.11 | **19.3.0** |
| @types/react-dom | 18.3.1 | **19.3.0** |
| @types/node | 22.7.5 | **24.13.5** |
| ESLint | 8.57.0 | **9.39.5** |
| TypeScript | 5.6.3 | **5.6.3**, conservé |
| Node / npm système | 24.16.0 / 11.13.0 | inchangés |
| Supabase JS / @vercel/oidc / google-auth-library / server-only | 2.107.0 / 3.8.2 / 11.0.0 / 0.0.1 | inchangés |

Next 16 est Active LTS et 16.3.5 la plus haute stable de cette majeure observée dans le registre. React 19.3.0 est stable et satisfait les pairs Next ; React DOM demande `^19.3.0`. Node satisfait le minimum Next `20.9.0`, TypeScript le minimum `5.1.0` et les types retenus (TS 5.6). Aucun canary/RC/beta installé dans le produit. [Support Next](https://nextjs.org/support-policy), [release Next](https://github.com/vercel/next.js/releases/tag/v16.3.5), [release React](https://github.com/react/react/releases/tag/v19.3.0), [métadonnées Next](https://registry.npmjs.org/next/16.3.5).

**Réserve d’outillage : ESLint 9 est hors support communautaire depuis le 6 août 2026.** Le stable 10.10.0 ne satisfait pas les pairs publiés des plugins React 7.37.5, JSX a11y 6.10.2 et import 2.32.0 employés par la configuration Next. ESLint 9.39.5 est retenu pour respecter ces contraintes sans `--force` ni `--legacy-peer-deps`. Cette chaîne n’est donc pas présentée comme intégralement maintenue. TypeScript 7, actuellement `latest`, sort de la plage du parser ; aucune montée non nécessaire de TypeScript. [Support ESLint](https://eslint.org/version-support/), [plugin React](https://registry.npmjs.org/eslint-plugin-react/7.37.5), [a11y](https://registry.npmjs.org/eslint-plugin-jsx-a11y/6.10.2), [import](https://registry.npmjs.org/eslint-plugin-import/2.32.0).

## Adaptations strictement nécessaires

1. `package.json` et lockfile : versions exactes ci-dessus ; scripts `dev` et `build` avec `--webpack`, `start` conservé, `lint` remplacé par `eslint .`.
2. `eslint.config.mjs` : flat config officielle Core Web Vitals. Aucune règle désactivée ; seuls les dossiers générés (`.next`, `.vercel`, `out`, `build`), sauvegardes et `next-env.d.ts` sont exclus. Aucun ajout du preset TypeScript optionnel imposant une nouvelle politique de style.
3. `tsconfig.json` : `jsx: react-jsx` et inclusion `.next/dev/types/**/*.ts`, conformément aux changements effectués automatiquement par Next 16 dans la première copie de build. `strict`, contrôle des types et StrictMode conservés. `next-env.d.ts` source reste inchangé ; Next génère ses références de routes propres au mode dans les copies temporaires.
4. Runners `preview.mjs`, `live-app.mjs`, `ui.browser.mjs`, `contactAddress.browser.ts` : même bundler explicite, copies sélectionnées avec package/lock/config, environnements reconstruits sans variables métier héritées. Contacts lit les URL d’icônes réellement émises au lieu d’un hash Next 14 codé en dur. Les assertions historiques sont conservées. Typage `NODE_ENV` du runner adapté à Next 16.
5. Nouveau `tests/izord/nextjs-smoke.browser.mjs` : démarrage dev puis production, pages anonymes et ressources réelles, profils temporaires, contrôle console/hydratation/réseau. Aucun hook ni fixture ajouté au produit.
6. `tests/izord/cache-lifecycle.browser.mjs` : traces d’étapes, événements de téléchargement/dialogue et capture en cas d’échec pour diagnostiquer un délai CDP. Aucun changement d’action, d’assertion, de timeout, de stratégie de retry ou de logique produit.

Webpack est une option officielle de Next 16. Son maintien explicite évite de changer simultanément le bundler et les observations des deux bancs qui inspectent `webpackChunk_N_E` pour accéder au vrai client Auth et à la mémoire. Les copies liées à `node_modules` restent des builds Webpack cohérents avec les scripts du produit. Turbopack, React Compiler et Cache Components ne sont pas activés. [Guide 16](https://nextjs.org/docs/app/guides/upgrading/version-16).

Les transitions 14→15 et 15→16 ont été examinées : aucune API `cookies`, `headers`, `draftMode`, aucun paramètre de route Next synchrone, middleware ou ancien réglage expérimental nécessitant un codemod n’a été trouvé. `URL.searchParams` natif n’est pas concerné. Les codemods correspondants ne sont donc pas exécutés sur les sources. [Guide 15](https://nextjs.org/docs/app/guides/upgrading/version-15), [codemods](https://nextjs.org/docs/app/guides/upgrading/codemods), [guide React 19](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).

## Installation reproductible et audit

Installation dans une copie propre issue de la sélection, sans `.env`, WIF, `.vercel`, `.git`, session navigateur ni `node_modules` initial : `/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/izord-nextjs-clean-043fngkd`. Environnement explicite, registre officiel et deux fichiers npmrc vides distincts ; aucune configuration npm privée chargée.

```sh
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund
npm ls --all --json
npm audit --json
# Correctif transitif ciblé de l’outillage :
npm update brace-expansion --package-lock-only --ignore-scripts --strict-peer-deps --no-audit --no-fund
npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund
npm ls --all --json
npm audit --json
npm audit --omit=dev --json
```

Les deux `npm ci` réussissent, le dernier sur le lock final ; `npm ls --all` réussit également après mise à jour du dépôt local. La première résolution du vieux lock affiche un avertissement transitoire React 18/DOM 18 lors du remplacement simultané par 19.3.0 ; l’installation finale avec `--strict-peer-deps` n’a aucun conflit. Aucun forçage ni correction globale. Voir `A/installation.json`, `npm-ci-final.log`, `npm-ls-final.json`, `lock-install.log` et `lock-fix.log`.

Aucun script de cycle npm exécuté (`--ignore-scripts`). Les métadonnées directes et les hooks des paquets installés ont été inventoriés. Seul `unrs-resolver@1.12.2` possède un `postinstall` dans le lock effectif (`napi-postinstall`), non exécuté ; les paquets natifs précompilés installés suffisent au lint et au build sur ce macOS. Les scripts `prepare` trouvés sont listés dans `installation.json`, sans exécution. Aucun script de téléchargement de configuration ni accès aux secrets ajouté.

L’audit initial du nouveau lock signalait uniquement `brace-expansion@1.1.15`, **développement**, via `minimatch@3.1.5` et l’outillage ESLint : DoS par expansion de motifs (trois avis). Le dernier avis est corrigé à partir de 1.1.18 ; la plage existante `^1.1.7` résout désormais **1.1.21**, sans override et sans changement d’autre paquet dans cette correction transitive. [Avis primaire](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-rgw5-rvv9-x895).

**Audit final complet : 0 avis ; audit sans dépendances de développement : 0 avis**, le 17 septembre. Preuves `A/audit-final-all.json`, `A/audit-final-prod.json`, audit initial conservé dans `A/audit-before-transitive-fix.json`. Ce constat dépend de la base d’avis à cette date ; il ne démontre pas une absence de vulnérabilité ou d’exploitabilité. La réserve de support ESLint reste entière. Les avis Next d’août corrigés en 16.3.3 sont hors plage de 16.3.5. [AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [Windows](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36).

## Résultats réexécutés — catégories distinctes

Toutes les lignes ci-dessous se rapportent à la nouvelle exécution du 17 septembre, sans sommer les catégories.

| Catégorie | Résultat | Preuve sous A / portée réelle |
|---|---|---|
| Unitaires / PostgreSQL | **210/210 PASS**, aucun skip | `integration/unit-postgres/test-results.json` ; bases PostgreSQL jetables et facsimiles Auth/Storage SQL, distincts des HTTP réels |
| Auth / REST / RPC / Storage / mail | **96/96 PASS** | `integration/auth-rest-storage/live-local-results.json` ; vrais JWT par connexion Auth locale, vrais services locaux, courrier Mailpit fictif |
| Extension documents Storage R1 | **9/9 PASS** | `integration/storage-extension/document-lifecycle-after.json` ; vrais services Storage/Auth locaux, concurrence observée et octets contrôlés |
| Six API Drive | **97/97 PASS** | `integration/drive-results.json` ; vraies routes Next, vrai contrôle JWT/appartenance, transport Google seul simulé |
| Navigateur historique Auth réel | **13/13 PASS** | `live-browser/live-browser-results.json` ; connexion, accès, révocation, navigation et réponses tardives réels |
| Caches navigateur R2 | **9/9 PASS à la reprise**, première tentative en échec | `cache-browser-diagnostic/cache-after.json` ; premier délai CDP après sept assertions conservé dans `cache-browser/cache-after-failure.json`, non compté comme neuf succès |
| Renouvellement / conflits R3 | **8/8 PASS** | `token-refresh-browser/token-refresh-after.json` ; vrai renouvellement Auth, aucune écriture pour le seul jeton, vraie édition, CAS et conflit conservés |
| Contacts | **16/16 PASS** | `contacts/browser-results.json` ; fixtures fictives, ne constitue pas une preuve Auth/Drive réelle |
| Visuels 1440/390 | **10/10 PASS** | `visual/ui-results.json` ; fixtures, captures de portail/projets et états mobiles |
| Gardes de cible | **20/20 PASS** | `integration/target-guards.tap` ; exécutées avant les écritures locales |
| Refus sans pile | **PASS : échec attendu**, exit 1 | `integration/negative-missing-stack/expected-refusal.json` ; ECONNREFUSED sur 127.0.0.1:55432, aucune fixture créée ; distinct des vingt gardes et des succès Auth |
| Smoke anonyme exact final : développement | **13/13 PASS** | `source-build-final/next-development-smoke.json` ; routes `/`, `/spaces`, `/izord`, icônes, console ; ne remplace pas les treize scénarios Auth |
| Smoke anonyme exact final : production | **13/13 PASS** | `source-build-final/next-production-smoke.json` ; démarrage réel du build final par `next start` |
| TypeScript | **PASS**, exit 0 | `typescript-final.log` ; `tsc --noEmit --incremental false`, contrôle de types également actif dans les builds |
| Build production exact final | **PASS**, exit 0 | `source-build-final/source-build.log` ; copie exacte, aucune substitution Auth ou Google, aucune `.env` |
| Build intégration | **PASS** | `integration/app-build.log` ; seule substitution Google dans la copie de test, garde Auth byte-identique |
| Lint | **ÉCHEC**, exit 1 | `lint-final.json` : **31 erreurs, 8 avertissements** |
| `git diff --check` | **PASS** | commande séparée ; patch incrémental également contrôlé à la clôture |

Les premières erreurs TypeScript concernaient les objets env nouvellement assainis du runner Contacts (`NODE_ENV` requis par les types Next). Elles ont été corrigées dans le runner avant son exécution réussie ; `typescript-initial.log` est conservé. Aucune adaptation de type du code métier n’a été nécessaire.

La première exécution caches a obtenu sept assertions puis expiré sur `Runtime.evaluate` pendant la seconde récupération entre onglets. La reprise complète avec diagnostics supplémentaires obtient neuf assertions, zéro requête distante et fermeture de son navigateur. Aucun changement comportemental n’a été apporté pour faire passer cette reprise. **La cause du premier délai n’est pas démontrée, ni déclarée corrigée** ; cette limite de reproductibilité du banc reste visible. Le cas fermeture/réouverture emploie un vrai navigateur et une vraie connexion locale, avec expiration de session simulée dans ce seul cas. Aucun export/purge du profil réel.

Les 210/96/9 ont précédé le dernier correctif transitif de lint et l’alignement source de la configuration JSX déjà imposée par Next dans les copies. Aucun paquet runtime, SQL ou code métier n’a changé entre ces passages. Les builds finaux et les API utilisent le lock final ; cette chronologie est conservée dans les preuves.

Le premier smoke exact (`browser/`) est conservé mais n’est pas compté une seconde fois : les lignes ci-dessus désignent le passage final après alignement du lock et de `tsconfig.json`. La dernière modification du runner caches ne concerne que la journalisation ; son lint ciblé passe, les autres résultats restent ceux de leurs exécutions identifiées.

### Lint : échec réel conservé

| Règle | Erreurs |
|---|---:|
| `react-hooks/static-components` | 12 |
| `react-hooks/set-state-in-effect` | 9 |
| `react-hooks/preserve-manual-memoization` | 5 |
| `react-hooks/refs` | 4 |
| `react-hooks/immutability` | 1 |

`CRMApp.tsx` concentre 28 erreurs, `MobileCRMHeader.tsx` une et `SearchableBusinessContactPicker.tsx` deux. Ces trois fichiers sont **identiques octet pour octet** à la base corrigée. Les huit avertissements portent sur les dépendances d’effets, images et navigation. La première analyse comprenait aussi un artefact `.vercel/output` ; ce dossier généré est désormais exclu, sans exclure de source applicative.

Les constructions sont donc préexistantes, mais l’ancien lint n’a pas été rejoué et aucune configuration ESLint précédente n’était présente à la racine : il serait incorrect de prétendre que l’ancienne chaîne produisait déjà ces diagnostics. Les nouvelles règles les révèlent. Une correction complète toucherait les composants et cycles d’effets du CRM, hors de l’adaptation de compatibilité autorisée. Aucun `eslint-disable`, aucune règle coupée, aucun `ignoreBuildErrors` ni suppression de StrictMode pour obtenir du vert. **La validation globale reste non verte tant que ce point n’est pas traité dans un périmètre revu.** Détails : `A/lint-audit-notes.md`.

### Icônes, console et rendu

Les six URL d’icônes observées répondent 200 avec un type image et un contenu non vide en développement et en production : quatre chemins publics et les deux URL avec hash émises par les metadata. Aucun changement de fichiers/configuration d’icônes. Les deux smokes vérifient les trois routes à 1440 et 390 px, sans CRM visible pour un anonyme, sans débordement, overlay Next, exception, console.error, message d’hydratation, échec HTTP ni requête hors banc observés. Cette preuve anonyme est distincte de la couverture authentifiée. Les captures mobiles Contacts et IZORD ont aussi été examinées visuellement.

## Invariants conservés et limites du lot d’accès

`A/invariants.json` contrôle **59 fichiers** applicatifs, ressources et migrations de la sélection : tous inchangés par rapport au lot 1 corrigé. Les six routes Drive conservent `nodejs`, `force-dynamic`, réponses privées/no-store et vérification réelle de l’identité/appartenance ; aucune sécurité remplacée par le routage ou le navigateur. Aucun hook de test ni fixture introduit dans `app`, `components` ou `lib`.

| Pièce protégée | SHA-256 avant = après |
|---|---|
| Migration registre `20260914210807_drive_folder_registry.sql` | `ac1e8a6f5ae5bab3ae042bec94fc40bdc937e661ddc2474564d12b8545eda7f6` |
| Migration corrigée `20260916170445_module_access_foundation.sql` | `03b897399c1dc0e9eb3314fd6ddfe1c17135337c8fdef7a27eb579210253fce9` |
| HTML `IZORD_Invest_Fiche_Projet_Locations_v3 (1).html` | `8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1` |

WIF : empreinte comparée identique, fichier non suivi, exclusions Git/déploiement conservées, contenu jamais copié aux artefacts. Les fichiers métier Contacts/adresses, RIB, factures récurrentes, Suivi maison et Planning sont inchangés.

Les limites de [REVIEW.md](REVIEW.md), [transition des caches](cache-transition.md) et [corrections SQL](sql-corrections.md) restent applicables :

- R1 : objet finalisé/retiré non remplaçable, nouvelle version avec identité distincte. Une capacité d’upload déjà émise reste valable **7 200 secondes depuis son émission**, pas depuis la révocation ; elle peut encore déposer un pending, sans accorder à l’utilisateur révoqué lecture/finalisation/publication. Aucun nettoyage physique automatique des pending ; un seul ordre concurrent finalisation gagnante est démontré par le test observé. Pas de nouvelle garantie de révocation immédiate des téléchargements déjà signés.
- R2 : gate avant connexion et purge explicite/export réservé à l’ancien détenteur du profil. Pas de chiffrement rétroactif ni de preuve cryptographique du propriétaire des anciens caches ; le profil doit rester réservé jusqu’à cette transition. Aucun profil Chrome réel consulté, exporté ou purgé.
- R3 : dirty métier, identité fixe, jeton courant, CAS et conflit visible avec conservation des modifications en mémoire/export. Pas de fusion automatique ni de CAS universel imposé aux autres clients directs autorisés ; perte possible de la mémoire à la fermeture brutale. Fermer les anciens clients avant activation.

Activation des droits et retour arrière dans l’environnement réel restent **proposés, non exécutés** : [bootstrap-oar.sql](bootstrap-oar.sql), [rollback-close-izord.sql](rollback-close-izord.sql). Les migrations existantes ne sont rejouées que dans les bases fictives. Aucune migration nouvelle, réouverture d’OAR ou intégration du générateur HTML.

## Commandes de reproduction locale

Le statut et les fixtures privés contiennent uniquement les identifiants fictifs du banc ; ne pas les imprimer ni les partager. Chaque nouvelle exécution complète utilise une pile fraîche : `live-local.mjs` n’est pas une réinitialisation idempotente. Arrêter en cas d’échec d’une garde, sans fallback distant.

```sh
export PATH="/opt/homebrew/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY
export SUPABASE_BIN=/Users/vg/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
export IZORD_PG_MODULE=/tmp/oar-contact-release-test-runtime/node_modules/pg
export AGENT_BROWSER_BIN=/tmp/izord-browser-runtime/node_modules/.bin/agent-browser
export A="$(mktemp -d /tmp/izord-nextjs-replay.XXXXXX)"
node --test tests/izord/local-target.test.mjs
node tests/izord/local-stack.mjs
# Reprendre uniquement les chemins émis par CE démarrage :
export LOCAL_STATUS_FILE="<workdir>/local-status.json"
export LOCAL_FIXTURE_FILE="<workdir>/browser-fixtures.json"
IZORD_ARTIFACTS="$A/integration/auth-rest-storage" node tests/izord/live-local.mjs
IZORD_ARTIFACTS="$A/integration/storage-extension" node tests/izord/document-lifecycle.mjs --after
IZORD_PG_RUNTIME=/tmp/oar-contact-release-test-runtime IZORD_ARTIFACTS="$A/integration/unit-postgres" node tests/izord/postgres.mjs
node tests/izord/live-app.mjs
# Serveur précédent maintenu actif dans un processus séparé :
IZORD_DRIVE_RESULTS_FILE="$A/integration/drive-results.json" node tests/izord/live-drive.mjs
IZORD_ARTIFACTS="$A/live-browser" node tests/izord/live.browser.mjs
IZORD_ARTIFACTS="$A/cache-browser" node tests/izord/cache-lifecycle.browser.mjs
IZORD_ARTIFACTS="$A/token-refresh-browser" node tests/izord/token-refresh.browser.mjs
# Les trois suites navigateur réelles sont séquentielles (sessions/état partagés).
CONTACT_ADDRESS_ARTIFACTS="$A/contacts" /tmp/izord-browser-runtime/node_modules/.bin/tsx tests/contactAddress.browser.ts
IZORD_ARTIFACTS="$A/visual" node tests/izord/preview.mjs --fixture
IZORD_ARTIFACTS="$A/visual" node tests/izord/ui.browser.mjs
IZORD_ARTIFACTS="$A/source-build-final" node tests/izord/preview.mjs
# Après libération de 3159 par le serveur d’intégration :
IZORD_ARTIFACTS="$A/source-build-final" node tests/izord/nextjs-smoke.browser.mjs
./node_modules/.bin/tsc --noEmit --incremental false
npm run lint
git diff --check
```

Les commandes d’installation sont lancées dans la copie propre avec `env -i`, PATH/HOME/TMPDIR explicites, `npm_config_registry=https://registry.npmjs.org`, `npm_config_userconfig=/tmp/izord-nextjs-user.npmrc` et `npm_config_globalconfig=/tmp/izord-nextjs-global.npmrc` (deux fichiers vides). Aucun fichier d’environnement de production utilisé. Lint est une étape séparée et doit conserver son code de sortie non nul dans toute automatisation.

## Arrêt et état Git

Validations exécutées le **17 septembre 2026**, clôture vérifiée à **11:33:25 Europe/Paris (09:33:25 UTC)**. Notre application Next et les six conteneurs de `izord-local-stack-5hxub2` sont arrêtés ; son réseau dédié est retiré après vérification, volumes PostgreSQL et Storage conservés. Les environnements étrangers restent inchangés. Après le dernier smoke anonyme, les ports **3148, 3158, 3159, 55431, 55432, 55434, 55487** sont tous fermés. Preuves : `A/integration/cleanup.json` et `A/source-build-final/browser-cleanup.json`.

L’arrêt reproductible est `supabase stop --workdir <workdir de CE banc>` sans option de suppression des sauvegardes, puis retrait du seul réseau étiqueté de ce banc lorsqu’aucun conteneur n’y est attaché. Ne jamais employer un arrêt global Docker ou une purge de volumes. Le contrôle négatif relance uniquement le runner local sur ce statut arrêté, avec un nouveau chemin privé de fixture, et exige l’échec avant toute création.

Les artefacts ont été contrôlés contre les valeurs de credentials fictifs du banc et les motifs JWT/clé privée ; aucun trouvé dans les fichiers destinés au rapport. Aucun contenu WIF ni profil/cookie/session navigateur partagé. Les sources originales ne sont pas expurgées ou altérées ; les logs des runners expurgent les jetons lorsqu’ils produisent leurs preuves.

État complet du checkout ci-dessous : il inclut volontairement le travail du lot 1 antérieur. Seul le patch incrémental de 11 fichiers décrit cette mise à niveau. HEAD et index inchangés, WIF toujours non suivi et ignoré.

```text
 M .gitignore
 M app/api/drive/_utils.ts
 M app/page.tsx
 M components/CRMApp.tsx
 M package-lock.json
 M package.json
 M tests/contactAddress.browser.ts
 M tests/driveFolderConcurrency.test.ts
 M tests/driveRegistryAuth.test.ts
 M tsconfig.json
?? .vercelignore
?? app/izord/
?? app/spaces/
?? components/AccessPortal.module.css
?? components/AccessPortal.tsx
?? docs/izord/
?? eslint.config.mjs
?? lib/access/
?? supabase/migrations/20260916170445_module_access_foundation.sql
?? tests/crmCache.test.ts
?? tests/izord/
?? tests/izordAuthorization.test.ts
?? tests/moduleAccess.test.ts
?? tests/workspaceSync.test.ts
```

Aucun commit, push, déploiement, migration distante, modification Vercel, invitation/email réel, écriture métier distante, appel Google réel ou opération sur le profil Chrome réel. Aucune nouvelle archive. Arrêt pour revue avec le lint et la limite CDP ci-dessus explicitement ouverts.
