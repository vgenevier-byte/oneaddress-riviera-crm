# OAR / IZORD — page neutre du banc et campagne caches

**17 septembre 2026 : précontrôle technique réussi au premier essai, puis trois passages complets à 9/9.** Les neuf mêmes contrôles ont été répétés trois fois ; ce ne sont pas 27 scénarios différents. Aucun retry ni quatrième passage. La pile est arrêtée et les volumes sont conservés. Ces résultats locaux ne constituent pas une garantie absolue de stabilité ni une validation Production.

## Base de comparaison et fichiers modifiés

Base : état local au **2026-09-17T16:44:30.520546+00:00**, `/tmp/izord-playwright-neutral-baseline-20260917`, après la campagne précédente arrêtée à 3/9. HEAD reste `bc8700a25db4438419f3b0876ceef5f4a4cb05ca` ; les lots non commités ne sont pas représentés par ce SHA seul.

| Fichier | Changement limité au banc |
|---|---|
| `tests/izord/cache-lifecycle.playwright.mjs` | Helper HTML neutre, remplacement des deux usages techniques de favicon, précontrôle technique distinct ; extraction sans réduction des assertions d’expiration simulée et de récupération partagée. |
| `tests/izord/cache-playwright-target.mjs` | Deux gardes pures supplémentaires : URL neutre canonique et navigation GET principale exacte. |
| `tests/izord/cache-playwright-target.test.mjs` | 39 tests supplémentaires des gardes ; les 27 tests de garde navigateur précédents conservés. |
| `docs/izord/CACHE_PLAYWRIGHT_REVIEW.md` | Présent rapport, preuves et limites. |

[Diff ciblé du banc](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/neutral-bench.patch), [diff avec rapport](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/neutral-complement.patch), [liste et SHA des fichiers](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/changed-files.json), [base](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/baseline-reference.json), [préservation](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/preservation.json). Ces patches comparent les copies de l’instantané aux fichiers actuels, **pas les lots cumulés contre HEAD**. Les fichiers non suivis sont inclus ; versions finales intégrales sous `/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/final/`, chemins relatifs conservés.

**128 autres fichiers préexistants identiques**, index et HEAD inchangés. Les **141 pièces des trois dossiers Playwright antérieurs** sont intactes. Produit, règles d’accès, corrections R1/R2/R3, SQL, HTML original, dépendances/lockfile, ESLint et runtime externe Playwright inchangés. WIF inchangé et non suivi, contenu exclu des preuves. Aucun fichier ajouté à `app/` ou `public/`, aucune icône ni vraie route Next modifiée.

## Ce que prouve l’ancien échec favicon

Le pilote précédent utilisait explicitement `/favicon.ico` pour deux **navigations principales** : groupe 4, ouvrir un onglet de même origine avant de fermer OAR ; groupe 7, créer l’ancien onglet écrivain. Dans la campagne précédente, seul le premier usage a été atteint.

La trace établit l’appel volontaire `page.goto(.../favicon.ico)` au groupe 4, suivi de `net::ERR_ABORTED` le **17 septembre à 16:21:25.636Z**, après le groupe 3 réussi. Cela ne correspond pas à la seule présence d’une requête secondaire d’icône. Les compteurs de blocage HTTP/WebSocket sont **0**, aucun événement d’abandon par la règle du pilote n’est enregistré ; celle-ci autorisait cette origine locale. Les quatre événements `request-failed` conservés concernent les deux paires `/auth/v1/logout` et `/spaces`, pas favicon.

**La cause exacte reste non déterminée.** Statut, en-têtes/MIME et URL finale brute du favicon ne sont pas disponibles ; aucun téléchargement du favicon n’est enregistré. Aucun crash ou navigateur déconnecté avant cleanup. L’ancien snapshot `[blocked-origin]` est un masque de filtrage pouvant aussi recouvrir une page initiale sans origine HTTP ; il ne démontre pas une requête distante. Ne pas conclure que le favicon a été téléchargé, bloqué par une garde ou interrompu par une cause précise à partir du seul `ERR_ABORTED`.

[Relecture limitée des traces](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/previous-favicon-trace-review.json), [ancien résultat 3/9](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-summary-20260917/campaign/run-1/cache-playwright-result.json), [rapport précédent complet](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/previous-CACHE_PLAYWRIGHT_REVIEW.md). Les anciens 2/9 liés au menu Actions et au rôle supposé du summary, ainsi que les incidents CDP de cause non démontrée, restent conservés dans les dossiers antérieurs. Le succès actuel ne les explique pas rétroactivement.

## Helper neutre : périmètre exact

`openNeutralPage(reference, label)` crée un onglet dans le **contexte existant** et construit une URL distincte de la forme `http://127.0.0.1:3159/__e2e__/neutral-<UUID>.html`. Avant création/configuration du routage, `assertNeutralDocumentTarget` vérifie l’origine littérale, protocole/hôte/port, chemin canonique et UUID minuscule ; refuse identifiants, query/fragment, alias, encodages et normalisations, port Auth ou cible distante.

L’interception utilise **`page.route` sur cet onglet et cette URL exacte seulement**. Avant `fulfill`, la requête repasse par la garde réseau existante et `isExactNeutralNavigation` exige : URL exacte, méthode GET, navigation du document principal, type `document`. Les requêtes non correspondantes conservent le traitement normal via `route.fallback`. Aucune substitution de `/`, `/spaces`, `/izord`, Auth, REST/RPC ou Storage.

La réponse est **200**, `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`. HTML minimal identifiable, sans script ni ressource externe ; CSP `default-src 'none'; base-uri 'none'; form-action 'none'`. Le pilote attend DOMContentLoaded puis vérifie origine, chemin, type HTML et marqueur DOM, zéro élément actif/ressource et absence d’UI applicative. Il compare en mémoire les empreintes Auth du localStorage déjà existant et lit la préférence fictive depuis les deux pages ; **aucune valeur Auth n’est publiée et le helper ne modifie pas le stockage**.

Après vérification, le `page.route` précis est retiré dans `finally`. La surveillance des requêtes de l’onglet reste active jusqu’à sa fermeture ou avant sa navigation réelle suivante : une seule requête de document, **aucune requête applicative ni WebSocket** autorisée par cette surveillance. Toute requête inattendue marque l’essai en échec ; aucune exception globale ne masque les erreurs. Les résultats finaux démontrent `fulfilled: 1`, `verified: true`, `interceptionRemoved: true` pour chaque page neutre. L’événement intermédiaire `neutral-document-verified` précède le retrait ; son champ `interceptionRemoved: false` est suivi de l’événement de retrait et du résultat final à true.

Les deux remplacements sont effectués : groupe 4 `openNeutralPage(closedOAR, 'reopened-profile')` ; groupe 7 `openNeutralPage(current, 'legacy-writer')`. L’étiquette `reopened-profile` nomme un onglet, **pas un nouveau profil**. La seule occurrence restante de `/favicon.ico` dans le driver permet d’identifier cette URL dans les journaux ; elle ne lance aucune navigation technique et ne modifie pas les requêtes secondaires d’icônes du produit.

**Limite HTTP :** Playwright indique dans sa documentation installée (`playwright-core/types/types.d.ts`, lignes 4467 et 10390) que le routage désactive le cache HTTP. Le banc comportait déjà un routage de contexte pour les gardes réseau ; le nouveau routage de réponse est temporaire et limité à la page neutre. Retirer ce routage ne prouve pas le rétablissement d’un cache HTTP normal pendant le banc. Cette campagne ne valide donc pas la politique de cache HTTP de Production. Les assertions brutes sur **localStorage et sessionStorage restent actives**. Le HTML neutre est une réponse technique simulée, explicitement distincte des pages applicatives réelles et des échanges Auth/REST locaux réels.

## Ordre et assertions de sécurité préservés

Groupe 4 : chargement OAR réel → nouvel onglet neutre du même contexte et vérification du stockage partagé → fermeture réelle de l’ancien OAR **sans logout** → seule simulation déjà autorisée de retrait des clés Auth `sb-…-auth-token` → navigation et connexion IZORD via le vrai formulaire → absence de caches CRM bruts. Aucune suppression des caches CRM pour obtenir le succès.

Groupe 7 : l’onglet neutre écrit seulement les deux familles de cache fictif et la préférence fictive déjà prévues par `seedLegacy`. Les deux vrais portails ouverts doivent afficher la porte de transition et abandonner le CRM. L’écrivain est fermé avant récupération. Les contrôles de fichiers téléchargés, Auth/préférences conservées et purge partagée sont maintenus. L’extraction `expireClosedPageAuth` et `verifyRecoveredPortals` réutilise les assertions précédentes dans le précontrôle et la suite ; aucune assertion de sécurité supprimée.

Les helpers logout précédemment validés sont conservés : summary direct Actions (texte source exact, rendu CSS ACTIONS), clic normal sur Déconnexion ; branche explicite Se déconnecter du portail. Attente d’un document renouvelé, formulaire de connexion et absence d’Auth locale/cache ; destination `/spaces` ou route initiale connue. Ni nouveau contexte entre comptes, ni appel direct au logout Auth par le test, ni clic forcé/JavaScript, ni suppression générale de localStorage/cookies. Aucun `about:blank` ou `data:` utilisé comme document neutre de remplacement.

## Précontrôle technique, distinct des neuf groupes

**Premier essai réussi : 3/3 blocs techniques**, début UTC **16:48:14.216**, durée **5 143 ms**, sortie 0. Essais courts 2 et 3 **non exécutés**, puisque le premier réussit. [Résultats des essais](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/preflight-attempts.json), [résultat détaillé](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/preflight-1/cache-playwright-result.json), [trace](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/preflight-1/cache-playwright-trace.jsonl).

| Bloc technique | Opérations réellement vérifiées | Résultat |
|---|---|---|
| 1 | Première récupération complète, page conservée ; connexion OAR et Actions → Déconnexion ; connexion IZORD puis Se déconnecter, même contexte | Réussi |
| 2 | HTML neutre même origine et stockage partagé ; ancien OAR fermé ; seule expiration Auth fictive simulée ; vraie navigation/connexion `/izord` | Réussi |
| 3 | Ancien écrivain neutre, réaction des deux vrais portails ; second téléchargement complet, purge et Auth/préférences préservées | Réussi |

Deux documents neutres distincts, chacun avec un seul GET et interception retirée ; deux téléchargements **275 octets** chacun, `saveAs` et vérification JSON terminés. Les pages restent utilisables, y compris après la deuxième récupération. Zéro crash, fermeture inattendue, erreur HTTP/console/JS, requête distante bloquée ; **4 requêtes annulées** des deux logouts conservées dans la trace. Ces blocs techniques ne sont pas comptés comme des groupes supplémentaires validés de la campagne.

## Trois passages complets

Pile de précontrôle arrêtée à **16:48:37.126Z**, ports fermés et volumes préservés. Redémarrage à froid à **16:48:41.077Z**, services prêts à **16:49:04.038Z**. Le froid concerne les processus, avec build/volumes conservés ; aucun effacement de caches OS ou disque revendiqué.

| Passage | Début UTC | Durée processus supervisé | Durée runner | Résultat | Sortie |
|---|---|---|---|---|---|
| 1, après démarrage à froid | 16:49:26.834 | 12 224 ms | 12 188 ms | **9/9** | 0, signal null |
| 2, après réussite du 1 | 16:49:39.059 | 12 164 ms | 12 128 ms | **9/9** | 0, signal null |
| 3, après réussite des 1 et 2 | 16:49:51.223 | 12 167 ms | 12 130 ms | **9/9** | 0, signal null |

[Supervision bornée](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/campaign/campaign.json), résultats [passage 1](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/campaign/run-1/cache-playwright-result.json), [passage 2](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/campaign/run-2/cache-playwright-result.json), [passage 3](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/campaign/run-3/cache-playwright-result.json), [synthèse factuelle](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/results-summary.json). Une seule invocation du superviseur, zéro retry et aucun quatrième passage. Code identique au précontrôle réussi.

| Groupe inchangé | Passage 1 | Passage 2 | Passage 3 |
|---|---|---|---|
| 1 — Récupération initiale téléchargée, JSON vérifié, purge explicite et préférence conservée | Réussi | Réussi | Réussi |
| 2 — Vrai payload OAR affiché ; absence de cache brut localStorage/sessionStorage | Réussi | Réussi | Réussi |
| 3 — Logout OAR puis vraie connexion IZORD seule dans le même contexte | Réussi | Réussi | Réussi |
| 4 — Fermer sans logout, expiration locale simulée, vraie connexion IZORD sans ancien cache | Réussi | Réussi | Réussi |
| 5 — Route directe /izord sans cache OAR brut | Réussi | Réussi | Réussi |
| 6 — Changement d’identité propagé à l’autre onglet OAR, sans payload persistant | Réussi | Réussi | Réussi |
| 7 — Ancien écrivain fictif déclenche le blocage des deux portails | Réussi | Réussi | Réussi |
| 8 — Deuxième récupération téléchargée, deux pages vivantes, Auth/préférences conservées | Réussi | Réussi | Réussi |
| 9 — Purge partagée, stockages nettoyés, deux portails utilisables, Auth/préférences conservées | Réussi | Réussi | Réussi |

Chaque passage crée un profil fictif neuf et **un seul contexte**, partagé entre comptes/onglets. Auth locale réelle par formulaire avec nouveaux JWT, GET REST réel contenant le contact fictif et affichage dans Contacts. Les lectures de caches bruts après la fenêtre historique de 1 800 ms et aux changements de compte restent présentes. Les objets Storage et données métier existantes ne sont pas écrits par cette campagne de caches.

Deux téléchargements vérifiés **par passage**, chacun 275 octets, avec format et seules clés fictives attendues, exclusion des Auth/secrets/préférence étrangère, puis contrôle des deux pages et empreintes Auth. Les hashes et métadonnées figurent dans chaque résultat ; contenu des récupérations non publié, copies privées nettoyées. Deux pages neutres par passage, six preuves de navigation technique au total, sans les transformer en scénarios de sécurité distincts.

## Événements et limites conservées

Chaque passage enregistre **0** crash/fermeture inattendue, erreur de page/console, erreur HTTP, dialogue, requête HTTP/WebSocket distante bloquée et erreur de nettoyage. Chromium et runner sortent avec code **0**, signal **null**. Les fermetures de pages prévues et le `browser-disconnected` final suivent les actions/cleanup volontaires ; aucune fermeture de transport CDP n’est invoquée, aucun CDP n’est utilisé.

En revanche, chaque passage conserve **9 requêtes annulées** : quatre `/auth/v1/logout`, quatre `/spaces`, une `/` sur l’autre onglet. Ne pas présenter les compteurs précédents comme une absence totale d’annulation. Les formulaires déconnectés observés restent sur `/` ou `/izord`. La concurrence entre `reload()` au changement d’identité et `assign('/spaces')` reste une explication statique plausible ; la cause précise n’a pas été démontrée. La révocation serveur des jetons et la destination systématique `/spaces` **ne sont pas prouvées**. Cette intervention ne change pas ce comportement du produit.

Les messages techniques Chromium macOS de type `CVDisplayLinkCreateWithCGDisplay failed` restent dans les traces expurgées ; aucune causalité avec un échec n’est attribuée. Les preuves sont locales, avec données fictives et transport Google simulé. Elles ne couvrent ni Production, ni Google réel, ni une stabilité absolue ou l’expiration naturelle d’une session (le retrait Auth du groupe 4 est une simulation explicite). Les incidents historiques, y compris l’ancien 3/9 favicon, restent des résultats conservés.

[Serveur précontrôle](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/services-preflight/server.log), [serveur campagne](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/services-campaign/server.log), stdout/stderr et JSONL dans chaque dossier de passage. Aucun échec nouveau ne nécessite de snapshot avant cleanup dans cette campagne ; les captures des précédents échecs restent disponibles dans leurs dossiers historiques.

## Gardes et contrôles ciblés

| Catégorie | Résultat |
|---|---|
| 47 gardes existantes | **47/47** conservées et rejouées |
| Extensions du helper | **39/39** ; origine/URL canonique, chemins, méthode, navigation principale, iframe/sous-ressource, URL différente et valeurs invalides |
| Ensemble des gardes pures | **86/86**, sans navigateur, aucun échec/skipped ; ne pas ajouter ce compteur aux groupes navigateur |
| Lint complet `eslint .` | **0 erreur, 2 warnings**, code 0 |
| Typage `checkJs` des cinq fichiers JS du banc | **Réussi**, code 0 |
| `git diff --check` et whitespace des fichiers non suivis | Réussi |
| Application des patches à une copie jetable de la base | Réussie, reconstruction exacte des fichiers |
| SQL avant précontrôle / après campagne | **READ ONLY** : identités fictives, données publiques, payload/révision, schéma et objets Storage identiques |
| Suites métier historiques et nouveau build | Non rejoués, intervention limitée au banc et à son rapport |

[Sorties des gardes et commandes](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/guards.log), [lint](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/lint.log), [typage](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/typecheck.log), [métadonnées](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/static-checks.json), [diff-check](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/diff-check.json), [comparaison des données](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/data-after.json). Les erreurs de préparation (chemin Node absent, callback de test typé unknown) sont conservées séparément dans `guards-initial-errors.log`, corrigées avant navigateur ; elles ne constituent pas des échecs de parcours. Les répétitions de tests de préparation ne sont pas des tests uniques supplémentaires.

Versions inchangées : Node **24.16.0**, Playwright **1.63.0**, Chromium Headless Shell **153.0.8010.12**, révision **1243** ; Next **16.3.5**, React/DOM **19.3.0**. Build réel existant `QJC2_XWQqx3wgnAyz5FtU` réutilisé après vérification des sources/guardes ; aucun build ou installation. Autorisation JWT réelle conservée, seul le transport Google de la copie du banc est fictif.

ESLint **9.39.5** reste provisoire pour le développement local, avec les réserves de [ESLINT_MAINTENANCE.md](ESLINT_MAINTENANCE.md), inchangé. Pas de reprise du chantier ESLint, de règle désactivée ni d’acceptation Production. Les deux avertissements sont conservés :

- `components/AccessPortal.tsx:121:5` — `@next/next/no-location-assign-relative-destination`, navigation complète prévue après logout ; comportement effectif et limites ci-dessus.
- `components/CRMApp.tsx:5126:19` — `@next/next/no-img-element`, aperçu de facture sans optimisation Next, branche blob privée et URL historique conservées.

## Cibles, arrêt et reproductibilité

Socket Colima explicite vérifié ; client Docker **29.8.1**, serveur **29.5.2**, API **1.54**, aucune variable de redirection distante. App `127.0.0.1:3159`, API locale `127.0.0.1:55431`, DB et mail locaux ; environnement minimal, aucun `.env` Production chargé. La pile et les fixtures conservées sont validées avant connexion ou écriture Auth. Aucune cohorte recréée, aucune migration/restauration ; les écritures internes Auth locales sont hors empreinte des contenus métier.

**Arrêt final à 2026-09-17T16:51:01.091Z.** Ports 3159/55431/55432/55434 fermés, aucun conteneur du banc, volumes D/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/Storage et réseau conservés, ressources étrangères inchangées, zéro erreur de cleanup. [Cycle du précontrôle](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/services-preflight/lifecycle.json), [cycle de campagne](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/services-campaign/lifecycle.json).

[Commandes reproductibles](/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/playwright-neutral-20260917/commands.txt) : un `--neutral-preflight`, arrêt/redémarrage à froid, puis une seule invocation du superviseur complet. Les scripts de service et de campagne sont inchangés. Les cibles privées sont référencées par chemin, jamais par leurs secrets. Un futur passage nécessite un nouveau dossier de preuves et n’est pas lancé automatiquement par ce rapport.

Aucun profil Chrome réel accédé ou purgé, aucune invitation réelle, écriture Supabase distante ou Drive réelle, commit/push/déploiement, opération Vercel ou intégration HTML. **Aucune archive créée.** Inventaire et SHA-256 ajoutés au dossier sélectionné ; contrôle ciblé de confidentialité, traces expurgées sans modification des sources originales ou des anciennes preuves.

## Git status --short final

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

Les différences contre HEAD comprennent les lots précédents ; seuls les quatre fichiers annoncés sont attribués à cette intervention. **Trois passages locaux réussis, limites documentées, arrêt pour revue.**
