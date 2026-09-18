# IZORD Invest — lot 1 : séparation des accès

**16 septembre 2026 — lot 1 et corrections après revue indépendante ; validations locales uniquement. Aucun changement de Production.**

Les résultats de la première reprise Colima sont conservés ci-dessous comme historique. Les reproductions et validations des corrections R1/R2/R3 sont détaillées dans la section « Corrections après revue indépendante ». Les garanties actuelles incluent le cycle documentaire finalisé, la récupération explicite des anciens caches et la sauvegarde OAR conditionnée par une révision serveur.

Le périmètre retenu à partir de la demande et des trois pièces de référence est le lot 1 : contrôle des accès, fondations SQL et entrée IZORD minimale. Le générateur complet reste au lot suivant. Les pièces jointes ont servi de spécification technique, pas d’autorisation d’exécuter une migration distante ou une invitation réelle.

## Corrections après revue indépendante — R1 / R2 / R3

Les trois pièces de `IZORD_OAR_Corrections_Lot1_Pour_Codex.zip` ont été lues. Le prompt détaillé est appliqué parce que la demande l’invoque explicitement. Le worktree antérieur a été conservé dans un instantané privé avant modification. HEAD reste `bc8700a25db4438419f3b0876ceef5f4a4cb05ca` ; aucun commit. La migration du lot est toujours nouvelle/non suivie et déclarée non appliquée à distance par la demande ; aucun accès distant supplémentaire n’a été effectué pour ces corrections.

### Reproductions avant toute correction

Sur une pile Colima distincte, le build antérieur et de vrais JWT obtenus par connexion Auth locale :

| Cas | Observation effective avant | Preuve |
|---|---|---|
| R1 — 5 groupes de reproduction | Suppression puis réimport de la présentation publiée : nouveaux octets accessibles au lecteur sous l’ancienne autorisation. Même problème sur projet approuvé ; création sur ancienne révision acceptée. Une capacité signée `upsert:true` émise avant publication remplace aussi le contenu. Upload signé accepté après retrait d’affectation ou révocation. | `before/r1/document-lifecycle-before.json` |
| R2 — 5 scénarios navigateur | Les clés globales et celles d’un ancien compte restent lisibles directement dans `localStorage` : ancien CRM vers portail, logout puis IZORD, fermeture sans logout/nouvelle session, `/izord` direct, plusieurs onglets. | `before/r2/cache-before.json` |
| R3 — 3 étapes réelles | A charge l’ancien état, B sauvegarde sa nouvelle version, puis le vrai client de A renouvelle son jeton sans édition : **1 écriture** remplace la version de B. | `before/r3/token-refresh-before.json` |

Pour le scénario R2 de fermeture, l’expiration/changement de session locale est provoqué en retirant l’entrée Auth dans le seul profil fictif ; le TTL serveur n’a pas été accéléré. Les connexions suivantes sont réelles. Aucun de ces scénarios n’a utilisé le profil Chrome personnel.

### Corrections ciblées et matrice documentaire

**R1 — SQL/Storage.** Les assets suivent `pending → finalized → withdrawn`. Le créateur encore habilité peut importer et inspecter son fichier en attente sur la révision courante non approuvée. La finalisation vérifie les droits, la révision, l’existence de l’objet Storage et enregistre son identifiant/version. Le retrait conserve la ligne et le chemin ; une nouvelle version documentaire reçoit un nouvel UUID. La permission lecteur est initialement fausse et doit être accordée explicitement par associé/admin. Le trigger de garde sur `storage.objects` bloque aussi les mutations privilégiées du service pour une ancienne capacité signée. Il ne modifie pas lui-même les métadonnées Storage. [Différences SQL et transition](sql-corrections.md).

| État/opération | Créateur contributeur encore autorisé | Autre contributeur | Associé/admin | Lecteur |
|---|---|---|---|---|
| Enregistrer/importer | Révision courante non approuvée, nouvel asset | Seulement son propre nouvel asset sur projet autorisé | Même règle de révision/projet | Refus |
| Lire un import `pending` | Son propre import, droit courant requis | Refus | Seulement s’il en est le créateur habilité | Refus |
| Finaliser | Son propre import complet et courant | Refus sur l’import d’autrui | Oui, droit/révision valides et objet complet | Refus |
| Lire `finalized` | Selon accès au projet | Selon accès au projet | Oui | Seulement présentation explicitement autorisée sur projet affecté |
| Remplacer/supprimer physiquement un document finalisé | Refus | Refus | Refus via API métier | Refus |
| Retirer logiquement | Son propre `pending` seulement | Refus sur l’import d’autrui | Oui ; chemin conservé, lecture coupée | Refus |
| Réutiliser un chemin retiré | Refus | Refus | Refus | Refus |

**R2 — navigateur.** Le cache de travail utilise uniquement une mémoire liée à la page/identité ; aucun nouveau payload CRM dans `localStorage` ou `sessionStorage`. La présence des trois familles de clés historiques ferme le portail avant connexion/montage. La récupération télécharge une copie privée hors origine ; l’utilisateur confirme sa conservation et la fermeture des anciens onglets avant une purge explicite des seules clés reconnues. Une modification depuis l’export interdit la purge. Les signaux entre onglets ne contiennent pas de payload et déclenchent effacement mémoire/revalidation. Une réécriture legacy fait rebloquer les portails. [Procédure de récupération, non exécutée sur profils réels](cache-transition.md).

**R3 — sauvegarde OAR.** L’empreinte du payload métier acquitté et sa révision serveur déterminent les changements à sauvegarder. Le jeton courant est capturé puis vérifié à chaque opération sans déclencher lui-même une sauvegarde. Autosave, synchronisation forcée, sauvegarde cloud et initialisation explicitement confirmée utilisent le même UPDATE conditionné par `workspace_id` et `updated_at` chargé. Le serveur impose un timestamp strictement croissant. Un conflit conserve la saisie en mémoire et interdit les réessais écrasants ; export puis recharge explicite restent possibles. Les gardes d’identité et AbortController sont conservés. Les départs volontaires signalent une saisie non sauvegardée ; une réponse de sauvegarde n’acquitte que le snapshot effectivement envoyé.

### Résultats après correction — compteurs séparés

Les chemins ci-dessous sont relatifs à `izord/corrections-20260916/` dans les artefacts locaux. Les détails des anciennes suites restent en section 4 ; leurs résultats ci-dessous sont les nouvelles exécutions de correction.

| Catégorie | Résultat effectif | Preuve finale |
|---|---|---|
| Unitaires/PostgreSQL | **210/210**, zéro échec/ignoré : base historique adaptée de 190 + 7 SQL + 8 cache + 5 synchronisation. Détail : 131 historiques, 51 SQL IZORD, 11 moduleAccess simulés, 12 cache, 5 workspaceSync. | `after/unit-postgres-final/test-results.json` |
| Auth/REST/RPC/Storage/mail | **96/96 groupes**, zéro échec/ignoré, migration SQL finale appliquée intégralement dans la dernière pile fraîche. | `after/integration-validated/live-local-results.json` |
| Extension R1 réel | **9/9** : import/inspection/finalisation légitimes ; rejet de remplacement publié/approuvé, ancienne révision et chemin retiré ; nouveau contenu sans héritage lecteur ; capabilities et concurrence. | `after/r1-final/document-lifecycle-after.json` |
| Six API Drive | **97/97 contrôles**, véritable Auth local et transport Google simulé, 84 refus et 13 parcours autorisés. | `after/drive-final-results.json` |
| Navigateur historique réel | **13/13**, réponses Auth/REST réellement retardées, changements de compte, sauvegarde après vraie saisie, backup, révocation, mobile. | `after/live-browser/live-browser-results.json` |
| Extension R2 navigateur | **9/9**, valeurs brutes, exports effectivement téléchargés hors origine, purge sélective, fermeture/nouvelle session et multionglets. | `after/r2/cache-after.json` |
| Extension R3 navigateur | **8/8**, refresh seul **0 écriture**, état B préservé, conflit CAS visible, édition conservée, pas de contournement manuel/backup, alertes de départ, vraie édition après refresh sauvegardée. | `after/r3/token-refresh-after.json` |
| Contacts sur fixtures | **16/16**, adaptateur serveur fictif mis à jour pour le CAS ; aucune preuve Auth réelle revendiquée. | `after/contacts/` |
| Visuels sur fixtures | **10/10**, 1440/390 px ; captures du sélecteur et de la récupération inspectées, sans débordement. | `after/visual/ui-results.json` |
| Gardes de cible | **20/20** ; contrôle séparé sans pile : code **1**, refus PostgreSQL loopback avant toute fixture, zéro succès/ignoré. | `target-guards.json`, `missing-stack-guard.json` |
| TypeScript / build exact / diff | PASS : `tsc --noEmit --incremental false`, build production local des sources exactes sans substitution, `git diff --check`. Le build d’intégration remplace uniquement le transport Google. | `after/static-checks.json`, `after/source-build/source-build.log`, `after/integration-app-build.log` |

La preuve R1 vérifie les octets originaux côté créateur et lecteur, immédiatement puis après 1,5 seconde, ainsi que la version Storage et un téléchargement via URL signée. L’upload `upsert:true` signé avant finalisation est effectivement refusé ensuite ; son contenu protégé reste identique. Le test concurrent observé a vu gagner la finalisation ; cette exécution ne couvre pas tous les ordres de concurrence possibles.

**Upload signé après perte de droits :** sur Storage `v1.72.1`, la capacité déjà délivrée annonce **7 200 secondes** et peut encore transférer des octets vers son asset `pending` après retrait d’affectation ou révocation. Le même utilisateur ne peut plus lire, finaliser ni publier cet asset. La garde refuse les capacités visant un chemin finalisé ou retiré. Ces faits ne signifient ni révocation immédiate de toutes les capacités signées ni rappel de fichiers téléchargés. Le test de téléchargement signé de la matrice observe séparément sa survie jusqu’à expiration ; aucune durée maximale imposée au produit n’est revendiquée.

### Périmètre, limites et essais intermédiaires

- Le schéma historique OAR reste une fixture minimale ; Auth/REST/Storage/mail sont les vrais services locaux. Aucun schéma ni payload réel chargé pour ces tests. Google reste simulé.
- Avant récupération, un ancien cache reste techniquement lisible dans son profil. La barrière UI ne le chiffre pas : réserver ce profil à son propriétaire, récupérer/purger explicitement, puis seulement ouvrir à un compte suivant. Aucune purge réelle exécutée. Après crash/fermeture forcée, la mémoire non sauvegardée peut être perdue ; l’alerte de départ n’est pas une sauvegarde.
- Le CAS protège les sauvegardes du client corrigé ; il ne fusionne pas deux payloads et ne retire pas les droits d’écriture directs d’un utilisateur OAR autorisé. Fermer les anciennes instances lors de la transition. Une requête déjà acceptée par le serveur ne peut pas être rappelée par l’annulation de sa réponse.
- Finalisation ne signifie pas contrôle antivirus/signature MIME. Quotas cumulés, gestion des imports abandonnés, politique de rétention et parcours TUS complet restent au lot générateur. Le point WebP a été ajouté à [l’inventaire HTML](html-inventory.md). Le fichier HTML original et ses formules sont inchangés.
- Les premiers essais de harness ne sont pas comptés comme validations complètes : attente DOM R3 trop stricte ; deuxième téléchargement R2 remplaçant le même nom ; collecteur PostgreSQL synchrone bloquant ses pipes de logs ; attente PDF tronquée dans une assertion ajoutée au runner 96. Les correctifs concernent les observations du banc et les résultats finaux remplacent ces essais incomplets. Les assertions d’accès refusé et de préservation des octets ne sont pas relâchées.
- Next.js reste 14.2.16 ; proposition séparée ci-dessous, aucune mise à niveau. Aucun package/lockfile modifié. L’ancienne migration du registre, le HTML et le WIF sont contrôlés identiques par hash ; WIF non suivi et toujours exclu.

Commandes détaillées : [local-testing.md](local-testing.md). Elles fixent explicitement PATH, le socket Colima, les quatre cibles loopback et l’opt-in jetable, puis exécutent les runners indiqués. Les modes `--before` utilisent le code de référence séparé ; ne pas les exécuter sur les sources corrigées en les présentant comme tests de sécurité réussis.

### État final de cette correction

Validation achevée le **16 septembre 2026, 22:00 Europe/Paris**. Les quatre piles jetables créées durant cette correction sont arrêtées ; leurs réseaux propres ont été retirés après contrôle, sans suppression de volume. Ports du banc/API/base/mail, serveurs UI et PostgreSQL de tests fermés. Aucun autre environnement arrêté. `cleanup.json` et `missing-stack-guard.json` le consignent.

Artefacts : `/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/corrections-20260916/`.

- `corrections.patch` : diff incrémental contre l’instantané **du lot 1 déjà préparé**, pas contre HEAD seul ; inclut les nouveaux fichiers nécessaires.
- `sql-corrections.patch` : changements de la seule nouvelle migration ; `corrections-files.json` : inventaire et hashes avant/après.
- `final-validation.json` : catégories séparées, références des preuves et état préservé.
- `git-status.txt` : état final identique au bloc suivant. WIF absent du statut car ignoré ; contrôle séparé confirme qu’il est non suivi et inchangé.

Aucun commit, push, déploiement, migration distante, invitation/email réel, écriture Supabase/Drive réelle, modification Vercel, profil Chrome réel ou nouvelle archive. Next.js et le générateur complet restent séparés. Arrêt pour revue.

```text
 M .gitignore
 M app/api/drive/_utils.ts
 M app/page.tsx
 M components/CRMApp.tsx
 M tests/contactAddress.browser.ts
 M tests/driveFolderConcurrency.test.ts
 M tests/driveRegistryAuth.test.ts
?? .vercelignore
?? app/izord/
?? app/spaces/
?? components/AccessPortal.module.css
?? components/AccessPortal.tsx
?? docs/izord/
?? lib/access/
?? supabase/migrations/20260916170445_module_access_foundation.sql
?? tests/crmCache.test.ts
?? tests/izord/
?? tests/izordAuthorization.test.ts
?? tests/moduleAccess.test.ts
?? tests/workspaceSync.test.ts
```

## Première reprise Colima : environnement utilisé avant la revue indépendante

Le premier accès au socket a été refusé par le sandbox Codex (`permission denied`). La même vérification en lecture seule, autorisée hors sandbox, a réussi : client Docker **29.8.1**, moteur **29.5.2**, API négociée **1.54**, Mac arm64 / macOS 27.0. Le socket est `~/.colima/default/docker.sock`. Aucun override Docker/TLS/contexte distant n’était présent. Les processus utilisent explicitement `PATH=/opt/homebrew/bin:$PATH` et ce `DOCKER_HOST` ; aucun contexte global, profil shell ou lien `/var/run/docker.sock` n’a été modifié. Aucun outil réinstallé, aucun `sudo`.

La pile jetable s’appelle `izord-local-stack-eghgig`, dans un workdir temporaire extérieur au dépôt. Auth, PostgreSQL, PostgREST, Storage, Kong et Mailpit sont démarrés. Ports publiés contrôlés : **127.0.0.1:55431** (API), **:55432** (PostgreSQL), **:55434** (mail). Application de test : **127.0.0.1:3159**. Images relevées : PostgreSQL `17.6.1.167`, Auth `v2.196.0`, PostgREST `v16.2`, Storage `v1.72.1`, Mailpit `v1.30.2`, Kong `2.8.1`.

Le premier démarrage sur un réseau Docker `internal` a échoué avant les migrations métier : ce moteur n’y publiait pas le port PostgreSQL. La reprise utilise un réseau dédié avec `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`, conformément à la [documentation Supabase](https://supabase.com/docs/guides/local-development). Toutes les publications sont contrôlées après démarrage. Aucun fallback cloud. Le SMTP d’Auth pointe vers `supabase_inbucket_izord-local-stack-eghgig` ; aucune configuration SMTP externe n’est chargée.

Avant toute connexion SQL/Auth ou création de compte, les gardes exigent les quatre cibles loopback exactes et `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`. Le lanceur Docker exige le socket Colima exact et refuse les overrides de contexte/TLS/hôte. Le statut et les fixtures contenant les identifiants **uniquement fictifs locaux** restent en fichiers temporaires privés `0600`, absents du rapport, du dépôt et des artefacts partagés. Le serveur Next est construit depuis une liste explicite de sources, sans `.env*`, `.vercel`, WIF ou backups ; ses sorties réseau sont limitées au banc local.

### Correctif issu de cette reprise

La revue a identifié une autosauvegarde qui pouvait continuer après `await getUser()` malgré le démontage ou un changement de compte. Le chargement, l’initialisation, l’autosauvegarde, le rechargement manuel, la synchronisation forcée et la sauvegarde cloud CRM utilisent désormais l’identité et le jeton validés du composant, fixent explicitement ce jeton sur la requête REST et annulent les requêtes au démontage. Les résultats tardifs sont ignorés. Le callback Auth invalide immédiatement la génération de vérification et le cache lors d’un changement d’identité. Il s’agit d’un défaut identifié par lecture du code ; aucune reproduction antérieure à la correction n’est revendiquée.

## 1. État de départ vérifié et audit complété

- `HEAD`, `origin/main` et `git ls-remote origin refs/heads/main` : `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`.
- Alias Production `oneaddress-riviera-crm.vercel.app` : `dpl_6nuN77EyMUZZXgSGUxu945s9EJyh`, `READY`, même `meta.gitCommitSha`. Consultation MCP Vercel en lecture seule.
- Supabase `jcmnwvlmysecrahupfkk` : lecture exclusive des catalogues, politiques, grants, fonctions et métadonnées de buckets. Aucun payload métier, document ou coordonnées bancaires consulté pour cet audit.
- Source HTML trouvée et hash confirmé ; [inventaire de réutilisation](html-inventory.md).
- Au départ, seul `GOOGLE_DRIVE_WIF_SETUP.local.md` était non suivi. Son contenu reste inchangé, SHA-256 `a804628fe4187ff6cffe5dc48ad8f05dfc6b4f48cb7039e93baf372ff485a021`. Il n’était pas effectivement ignoré : ajout d’exclusions explicites dans `.gitignore` et `.vercelignore`.
- L’ancienne migration du registre Drive est inchangée. Aucun reset, commit, push, déploiement, changement Vercel, migration distante, compte réel, email réel ou accès Drive effectué.

| Surface | Constat actuel | Préparation locale |
|---|---|---|
| `/` | Monte directement le CRM après simple session | Portail, adhésion OAR puis import dynamique/montage CRM |
| `/spaces`, `/izord` | Absents | Sélecteur selon droits et liste minimale des projets autorisés ; données fictives uniquement dans les tests |
| `crm_workspace_state` | 3 politiques permissives sur workspace fixe | Condition RLS **RESTRICTIVE**, donc AND avec les règles existantes ; auteur `updated_by` imposé par Auth |
| `crm_contacts`, `crm_leads`, `crm_tasks`, `crm_properties`, `crm_vehicles`, `crm_boats`, `crm_quotes` | Politiques par propriétaire ; doublon de politiques sur Contacts | Même condition OAR, préservation de la propriété ; grants limités au CRUD |
| `crm_backups` | Lecture/insertion propriétaire, grants plus larges | Condition OAR ; SELECT/INSERT seulement |
| Grants historiques | `TRUNCATE`, `TRIGGER`, `REFERENCES` inutiles ; grants anon sur workspace/backups | Révocation des grants larges, réattribution minimale. Le constat de grants ne prouve pas une exploitation passée |
| `crm-documents` | Bucket privé, politiques sur seul bucket | Adhésion OAR ajoutée pour toutes les opérations |
| `crm_drive_folder_registry` | Aucun accès table, 3 RPC definer | Table inchangée ; garde OAR au début de chacune des 3 RPC. Corps de coordination conservés |
| Drive | Six routes, simple `getUser` | Le helper commun vérifie l’adhésion via le même JWT et sans cache |
| Import/export/sauvegardes | Dans CRMApp : JSON, Contacts, devis, backups et synchronisation partagée | CRM non monté sans OAR ; tables et Storage protégés indépendamment de l’UI |
| Realtime | Aucun appel `channel` recensé ; aucune publication de table retournée par le catalogue | Rien ajouté |
| Server Actions | Aucune directive `use server` recensée | Aucune ajoutée |
| Caches | Trois clés locales globales et anciens préfixes UUID | Correction R2 : cache métier en mémoire, barrière de récupération/purge explicite des anciennes valeurs brutes ; voir [transition des caches](cache-transition.md) |
| Identité | Sélecteur historique « Actions par » | Aucun rôle fondé sur ce sélecteur ; auteurs versions/administration IZORD issus d’Auth ; ancien sélecteur métier conservé |

Routes Drive recensées : GET `/api/drive/file`, GET `/api/drive/diagnostic`, POST `/api/drive/folders`, POST `/api/drive/upload`, POST `/api/drive/delete`, POST `/api/drive/vendor-bank-accounts/upload`. Toutes appellent le même contrôle avant Google. Les limites de racines et le dossier 03 restent inchangés. La suppression Drive reste désactivée (comportement historique).

Les règles restrictives ne remplacent pas aveuglément les règles de propriété existantes. PostgreSQL combine `(OR des politiques permissives) AND (AND des politiques restrictives)`. Les tests démontrent que les anciennes autorisations ne contournent pas le nouveau garde.

## 2. Matrice implémentée pour le prototype local

| Profil | OAR | Projets IZORD | Écriture | Approbation | Administration |
|---|---|---|---|---|---|
| Anonyme / sans adhésion / invitation non acceptée | Non | Aucun | Non | Non | Non |
| OAR seul | Fonctions historiques selon règles de propriété | Aucun | OAR seulement | — | Aucun droit IZORD |
| Admin IZORD seul | Non | Tous | Créer/éditer | Oui | Invitations, rôles/révocations IZORD, affectations |
| Associé | Non | Tous | Créer/éditer | Oui | Non |
| Contributeur | Non | Ses projets + affectations | Créer, éditer, soumettre en revue | Non | Non |
| Lecteur | Non | Affectations seulement | Non | Non | Non |
| Double adhésion | OAR + droits IZORD indépendants | Selon rôle | Selon chaque espace | Selon rôle | Aucun héritage entre espaces |
| Révoqué | Non dans l’espace révoqué | Aucun dans cet espace | Non | Non | Non |

**Choix de prototype à valider avant comptes réels :** le lecteur voit les fiches/versions attribuées, mais pas les PDF/photos sources ; il peut lire/télécharger une présentation seulement si un admin ou associé l’a autorisée. Les contributeurs ne peuvent pas modifier les hypothèses d’une révision approuvée. L’archivage métier, les transitions détaillées du comité et l’interface d’administration ne sont pas intégrés dans ce lot. Aucun droit d’archivage implicite n’est ajouté.

## 3. SQL proposé et garanties

SQL complet : [migration nouvelle](../../supabase/migrations/20260916170445_module_access_foundation.sql).

- `app_memberships` : UUID Auth, espace `oar`/`izord`, rôle, statut ; SELECT propre compte seulement, pas d’INSERT/UPDATE/DELETE client.
- Projets, affectations, versions, assets, invitations et événements séparés du JSON CRM OAR.
- Aucun droit issu de `user_metadata`, email/domaines, prénom ou champ de formulaire. L’email vérifié ne sert qu’à rattacher l’acceptation à l’invitation exacte.
- Lecture RLS par projet. Mutations via RPC précises, sans champ `owner_id`/`workspace_id` arbitraire ; créateur imposé par `auth.uid()`.
- Révision attendue, verrou de ligne, incrément et snapshot atomique ; conflit `40001`, sans écrasement silencieux. Asset créé sur la révision courante non approuvée ; contenu finalisé et retrait conservé.
- Fonctions privilégiées dans `app_private`, `search_path=pg_catalog`, permissions explicites et références qualifiées. Wrappers publics INVOKER. Aucun SQL dynamique dans les helpers ; la boucle DDL de migration utilise une liste fixe.
- Les trois RPC historiques restent definer, conservent leurs garanties de bail, CAS, réservation immuable et coordination. Garde OAR supplémentaire uniquement.
- Invitations 48 h, token aléatoire stocké haché, destinataire Auth confirmé, usage unique sous verrou, refus mauvais compte/expiration/révocation/rejeu. Rôle décidé par un admin IZORD actif, espace fixé à IZORD. Un compte déjà actif n’est pas silencieusement rétrogradé par une invitation.
- Verrou commun aux opérations administratives ; retrait du dernier admin interdit. Révocation/déclassement d’un admin invalide ses invitations en attente. Les invitations ne créent jamais OAR.
- Les nouvelles requêtes relisent les adhésions. La donnée déjà affichée/téléchargée ne peut pas être rappelée. Le portail revalide au focus et toutes les 60 s ; il conserve le CRM monté lors d’une simple revalidation valide pour ne pas effacer une saisie.
- Les anciennes clés locales imposent désormais la récupération explicite avant ouverture des espaces. Aucun effacement automatique des caches réels, aucune réimportation silencieuse. Les nouveaux payloads ne sont pas persistés dans le stockage navigateur ; voir [la procédure de transition](cache-transition.md).

Storage : bucket privé dédié `izord-documents`, 25 Mio maximum, liste MIME, noms `project UUID/asset UUID`, autorisation par métadonnée/projet. La correction R1 ajoute un import en attente, une finalisation explicite et un retrait logique irréversible au même chemin. Suppression physique, remplacement et déplacement des documents protégés sont refusés, y compris via le garde SQL du service Storage. Une nouvelle identité nécessite une nouvelle autorisation lecteur. La validation réelle du contenu et l’interface générateur restent séparées. Les tests SQL sur `storage.objects` ne sont pas une preuve de transfert de fichiers ; voir les essais du vrai Storage dans la section de corrections et les [différences SQL](sql-corrections.md).

**Liens signés :** aucune URL signée stockée comme identité et aucune générée par la page. Un utilisateur autorisé à SELECT peut néanmoins en demander directement à Storage ; un lien déjà délivré reste valable jusqu’à expiration. Une borne courte obligatoire exige un choix complémentaire de téléchargement. Ne pas promettre la révocation instantanée d’un lien ni d’un fichier téléchargé.

## 4. Résultats initiaux avant revue indépendante — référence historique

### Tests unitaires et PostgreSQL : 190/190

Deux bases PostgreSQL 18.4 jetables sur loopback, arrêtées par le runner. Le schéma Auth/Storage et `auth.uid()` y sont des fixtures SQL : ces résultats ne sont pas comptés comme intégration Auth réelle.

| Suite | Passés | Échecs | Ignorés |
|---|---:|---:|---:|
| contactEditing | 12 | 0 | 0 |
| currency | 6 | 0 | 0 |
| drive | 13 | 0 | 0 |
| driveFolderConcurrency — PostgreSQL réel | 34 | 0 | 0 |
| driveRegistryAuth | 6 | 0 | 0 |
| houseTracking | 8 | 0 | 0 |
| vendorBankDrive | 5 | 0 | 0 |
| vendorBanking | 10 | 0 | 0 |
| vendorFinance | 37 | 0 | 0 |
| **Sous-total historique** | **131** | **0** | **0** |
| izordAuthorization — SQL local | 44 | 0 | 0 |
| moduleAccess — API/fetch simulé | 11 | 0 | 0 |
| crmCache | 4 | 0 | 0 |
| **Total** | **190** | **0** | **0** |

### Auth, REST, RPC, Storage et mail réels : 96 groupes réussis

15 comptes fictifs se connectent par `signInWithPassword` au véritable Auth local ; leurs JWT sont vérifiés. Chaque groupe peut contenir plusieurs requêtes/assertions : **96 groupes, zéro échec, zéro ignoré**, pas 96 suites ni un décompte additionné aux tests unitaires. Les opérations vérifiées utilisent le JWT concerné. SQL administratif / service role local servent seulement au montage des fixtures et au contrôle des effets.

La migration nouvelle et les trois RPC du registre sont les vrais fichiers du dépôt. Le schéma historique OAR de départ est **synthétique minimal** (neuf tables et anciennes politiques nécessaires), sans données ou secret de Production. Les schémas Auth et Storage sont ceux des vrais services. Ce banc ne valide donc pas la totalité du schéma historique de Production.

| Utilisateur | Ressource / opération vérifiée | Résultat réel |
|---|---|---|
| Anonyme | Tables OAR/IZORD, trois RPC OAR, documents privés | Refus / aucune ligne ni octet privé |
| Sans appartenance, invitation en attente, révoqué | Payload OAR + huit tables historiques : lire/créer/modifier/supprimer ; documents OAR ; RPC registre | Refus, anciennes lignes propriétaires intactes |
| OAR seul | Payload partagé ; CRUD de ses lignes historiques ; lecture/insertion backups ; upload/update/download/delete document OAR ; trois RPC registre | Autorisé ; auteur partagé imposé côté serveur ; autres propriétaires invisibles ; update/delete backups refusés |
| OAR seul | Projets, versions, assets et fichiers IZORD | Aucune ligne/octet ; créations RPC refusées |
| Admin IZORD seul | OAR, même avec rôle admin IZORD | Refus ; aucun héritage OAR |
| Admin / associé IZORD | Lecture de tous les projets/versions/assets ; création ; associé approuve et autorise téléchargement lecteur | Autorisé ; auteur authentifié enregistré |
| Associé | Affecter un projet, promouvoir un membre, inviter | Refus, administration réservée à admin |
| Contributeurs A/B | Lire/éditer leur projet ou un projet affecté ; accéder aux fichiers correspondants | Autorisé ; l’affectation puis son retrait prennent effet à la prochaine requête |
| Contributeur | Projet non attribué, approbation, modification d’une version approuvée, élévation de rôle | Refus ; historique préservé |
| Lecteur | Projet/versions attribués ; présentation explicitement autorisée | Lecture autorisée ; PDF sources, projet non attribué et toute écriture refusés |
| Double appartenance | Opérations OAR et IZORD selon chaque rôle | Autorisées indépendamment, sans élargir la propriété OAR |
| Tous rôles clients testés, y compris admin | Modifier directement rôle/workspace/owner/project/affectations/audit | Refus ; valeurs contrôlées après tentative |
| Métadonnées utilisateur falsifiées / JWT à signature modifiée | Accès privé / création | Aucun droit via métadonnées ; JWT altéré refusé 401 |
| Deux sauvegardes sur même révision | RPC de sauvegarde concurrente | Une réussit, l’autre conflit `40001` ; historique immuable |
| Storage privé | URL publique, chemin changé, remplacement/upsert/move, suppression interprojet | Refus ou zéro effet vérifié ; octets originaux conservés |
| Admin et destinataires fictifs | Invitation correcte/incorrecte, expirée, révoquée, acceptation concurrente, rejeu, rôle supérieur, email non confirmé, auteur révoqué | Seule première acceptation valide autorisée ; rôle imposé, jamais OAR |
| OAR / IZORD révoqués après connexion | REST, RPC et Storage avec le JWT inchangé, toujours validé par Auth | Prochaine requête refusée / aucune ligne, document inaccessible |
| Invitation Auth fictive | Émission puis réception Mailpit local | Reçue localement ; aucun email réel |

**URL signée déjà émise :** le test demande un TTL de 4 secondes, constate un téléchargement possible immédiatement après révocation, puis un refus après 6 secondes. La révocation d’appartenance empêche immédiatement d’obtenir de nouveaux liens. Elle ne rappelle ni une capacité signée encore valide ni des octets déjà téléchargés. Aucune durée maximale obligatoire de lien n’a été ajoutée au produit.

### Six API Drive : 97 contrôles HTTP réussis

Vraies requêtes vers les six routes Next, avec authentification et appartenance Supabase locales réelles. Seul le transport Google est remplacé dans une copie temporaire. Le code du contrôle Auth et dix fichiers de handlers/registre ont été vérifiés identiques au dépôt. Une garde réseau limite le serveur au banc local.

| Profil | Six routes testées | Résultat |
|---|---|---|
| Anonyme / JWT falsifié | diagnostic, folders, upload, file, delete, vendor-bank-accounts/upload | `401`, zéro appel au transport Google |
| Sans appartenance, invitation en attente/acceptée sans OAR, admin IZORD seul, associé, contributeurs A/B, lecteur, révoqués | Mêmes six routes | `403`, zéro appel au transport Google |
| OAR seul / double appartenance | Mêmes six routes, corps/documents fictifs valides | `200` sur cinq routes ; `409` métier sur delete, suppression historiquement désactivée |
| OAR révoqué après diagnostic autorisé | Auth valide encore le même JWT ; nouvelles requêtes sur les six routes | `403`, zéro appel supplémentaire au transport Google |

**84 refus + 13 parcours autorisés = 97 assertions HTTP.** Le transport Google simulé a effectué 37 opérations en mémoire. Le parcours RIB exerce également la lecture du contact et les RPC du registre sur Supabase local. Ces preuves ne valident **ni Google Drive réel ni WIF**.

### Contacts et contrôles visuels sur fixtures

- **16/16 Contacts**, rejoués sur le composant final : adresses, conversions Client/Prestataire/Propriétaire, conservation des RIB/historiques fictifs, copie et échec presse-papiers, rechargement, largeurs 1440/390 px.
- **10/10 contrôles visuels du portail**, dont sélection double accès, pages et refus de routes, absence de chargement OAR pour IZORD, caches ignorés, largeurs 1440/390 px et console. Captures inspectées : lisibles, sans débordement.
- Ces deux suites utilisent un client Supabase simulé. Elles sont séparées des sessions réelles ci-dessous.

### Navigateur avec Auth réel

**13/13 scénarios passent** sur le build final, avec les formulaires de connexion et les réponses Auth/REST réels :

- Anonyme et compte sans adhésion : pas de montage CRM ni de requête payload OAR.
- OAR connecté : chargement du vrai payload fictif dans son cache nominatif.
- Même navigateur : OAR → déconnexion → IZORD → retour arrière/rechargement ; absence de cache/payload OAR et de requêtes CRM sous IZORD.
- Double accès : aller-retour OAR ↔ IZORD sous la même identité vérifiée.
- Réponse REST de chargement retardée au-delà du changement de compte : ignorée/annulée, sans réinjection ni autosauvegarde.
- Réponse Auth retardée pendant l’autosauvegarde et pendant « Forcer synchro » : aucun ancien payload enregistré sous le nouvel utilisateur OAR ; les sauvegardes légitimes du nouveau compte fonctionnent.
- Sauvegarde cloud positive : une ligne réelle dans le backup historique fictif, auteur OAR correct. Réponse de la première écriture retardée pendant une déconnexion : seconde écriture annulée après changement de compte.
- Révocation du compte connecté puis revalidation : CRM démonté, cache purgé.
- Page IZORD réelle à 390 px : projets visibles, pas de débordement ; captures 1440/390 inspectées.

Quatre réponses réelles ont été retardées ; deux étaient déjà annulées lors de leur libération. Trace : 131 requêtes Auth, 27 CRM, 6 IZORD, **zéro requête distante et zéro erreur JavaScript**. Les corps de réponse ne sont pas simulés ; seule leur latence est modifiée. Pour exercer le bouton backup, la fixture historique minimale a été complétée par ses sept colonnes de compteurs, uniquement dans la base jetable. Le payload fictif et l’adhésion de test ont été restaurés, le navigateur fermé.

Le premier essai du runner s’était arrêté après quatre contrôles sur une expression CSS mal échappée ; corrigée dans le script, elle n’était pas un défaut produit. Cet essai n’est pas compté comme une validation complète. Le rapport final de 13 succès le remplace.

### TypeScript et build local

Build de production des sources finales exactes : **PASS** (`preview.mjs`, sans substitution Google ni client simulé, sans `.env.local`). Build de l’application d’intégration réelle : **PASS** (seul transport Google simulé). TypeScript `tsc --noEmit --incremental false` : **PASS**. `git diff --check` : **PASS**. Aucune mise à niveau de dépendance ; un build réussi ne constitue pas une preuve de sécurité des versions installées.

### Gardes de cible : 20/20

Cibles loopback exactes et opt-in acceptés ; Production connue, tout autre domaine, localhost, mauvais ports/chemins, absence d’opt-in, moteur distant et overrides Docker refusés. Une assertion contrôle que le refus de la cible Production survient avant toute construction de client réseau. Aucun appel à cette cible n’est effectué. Après arrêt de la pile, le runner réel a également été invoqué : il sort bien avec le code **1** dès l’initialisation, avant les fixtures, sans test sauté ni faux succès (`missing-stack-guard.json`). Ce contrôle négatif d’infrastructure reste distinct des 20 tests unitaires de garde.

### Artefacts et reproduction

Résultats de cette reprise : `/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/colima/`.

- `unit-postgres/test-results.json` et logs par suite : 190 tests.
- `integration/live-local-results.json` : matrice réelle, 96 groupes et observation du lien signé.
- `services.json`, `target-guards.log` : services/cibles et 20 gardes.
- `drive-results.json`, `drive-app-proof.json`, `drive-google-simulation.jsonl` : 97 contrôles et périmètre de la simulation Google.
- `contacts/`, `ui-results.json`, captures `spaces-*` / `izord-*` : résultats fixtures séparés.
- `source-build.log`, `final-local-app-build.log`, `typescript.log` : compilations.
- `live-browser/live-browser-results.json` et captures : 13 scénarios réels, réponses différées.
- `missing-stack-guard.json`, `cleanup.json`, `final-validation.json`, `git-status.txt` : refus sans pile, arrêt et vérifications finales.
- Les identifiants locaux, JWT, mots de passe et clés ne font pas partie de ces artefacts.

Voir [les commandes reproductibles](local-testing.md). Les runners échouent si la pile manque ou si la cible n’est pas celle du banc. Ils ne sautent aucun contrôle pour produire un succès. Les résultats anciens hors sous-dossier `colima` restent des preuves du premier passage, pas de cette reprise.

## 5. Audit des dépendances

Versions installées/lockfile : Next 14.2.16, React/React DOM 18.3.1, Supabase JS 2.107.0, `@vercel/oidc` 3.8.2, `google-auth-library` 11.0.0, `server-only` 0.0.1. Aucun changement de `package.json`/lockfile.

`npm audit --omit=dev --json` renvoie trois paquets signalés : Next **critical**, PostCSS **high**, nanoid **high**. Le rapport complet conserve les plages et avis. C’est un inventaire des dépendances, pas la démonstration que chaque vecteur est exploitable dans cette configuration.

Les avis officiels Next.js confirment la nécessité d’une montée vers une ligne maintenue ; le correctif d’août cite 15.5.24/16.3.3, tandis que le registre actuel propose 16.3.5. Ne pas appliquer automatiquement `npm audit fix --force`. Prévoir un lot distinct : choisir une version maintenue corrigée au moment de l’intervention, compatibilité React/App Router, build et toutes les régressions, audit transitive. C’est un préalable à une nouvelle ouverture cloud.

Sources : [mai 2026](https://vercel.com/changelog/next-js-may-2026-security-release), [août 2026](https://nextjs.org/blog/august-2026-security-release), [avis officiels Next](https://github.com/vercel/next.js/security/advisories), [avis Supabase JS](https://github.com/supabase/supabase-js/security/advisories), [avis Google Auth](https://github.com/googleapis/google-auth-library-nodejs/security/advisories). L’absence d’avis publié sur un dépôt n’est pas une garantie d’absence de vulnérabilité.

## 6. Déploiement et retour arrière proposés — NON EXÉCUTÉS

1. Revoir les preuves locales Auth/REST/Storage/mail désormais passées, la matrice, les droits de téléchargement et le SQL ; traiter les dépendances vulnérables dans le lot distinct prévu ci-dessous avant une nouvelle ouverture cloud.
2. Obtenir la liste **explicite** des UUID Auth OAR, vérifier leurs emails confirmés, prévoir le premier administrateur IZORD de manière distincte. Ne déduire aucun droit du nom Vincent, du domaine email ou du nombre de comptes existants.
3. Préparer sauvegardes du schéma/politiques/grants/migrations et des données hors Git ; fixer la fenêtre de maintenance. Vérifier de nouveau les SHA et catalogues pour déceler une évolution depuis cet audit.
4. Maintenir le portail fermé aux nouveaux comptes pendant l’application séparément autorisée de la migration et du [bootstrap OAR](bootstrap-oar.sql). Le template vide échoue volontairement ; aucun compte réel n’y est renseigné. Sans bootstrap, OAR reste fermé par défaut.
5. Effectuer la [transition explicite des caches](cache-transition.md) avec le propriétaire OAR antérieur, en conservant les éventuelles saisies non synchronisées hors Git ; cette récupération réelle n’est pas exécutée ici. Publier le code corrigé validé dans un déploiement séparément autorisé ; aucune ancienne instance ouverte avec autorisations larges ou autosauvegarde sans précondition. Vérifier un OAR autorisé, un IZORD seul, un non-membre, toutes les routes et la révocation avant d’envoyer des invitations.
6. Preview : base/Auth/Storage et secrets indépendants, aucune connexion Drive OAR. Une URL Preview seule n’isole rien ; coûts et environnement distant à autoriser séparément.
7. En cas d’incident, rester fermé : [proposition SQL de fermeture IZORD](rollback-close-izord.sql), garder les contrôles OAR, la révision serveur, le cycle documentaire et le portail avec récupération des caches. Ne pas rétablir les anciennes policies/grants, ne pas revenir à l’ancien wrapper CRM. Réparer en avançant ou utiliser une page de maintenance sans données. Les projets/versions ne sont pas supprimés.

L’envoi Auth futur nécessite un composant administratif serveur séparé, rate-limité et audité, avec secret Auth administratif et SMTP de production. Une clé `service_role` contourne largement la RLS : **elle n’est pas limitée à une table**. Aucun secret nouveau ajouté ici à Vercel ou au navigateur. Les opérations métier normales restent sous JWT utilisateur. Le token d’invitation applicatif ne doit pas être journalisé et ne vaut pas preuve d’email confirmé ; son acceptation exige une session Auth confirmée du destinataire. Prévoir le lien d’acceptation et la gestion des secrets au lot administratif.

## 7. Points restant à valider

- UUID des comptes OAR à rattacher, premier admin IZORD et destinataires réels : non fournis, aucun droit attribué.
- Droits précis du lecteur, durée maximale imposée des URLs signées et accès aux PDF/photos ; archivage métier. Le verrouillage documentaire finalisé/approuvé est renforcé par R1, sans rappel des fichiers téléchargés.
- UI d’acceptation/gestion des invitations, contrôles d’envoi administratif, quotas et interface d’import/finalisation des assets : pas livrés comme intégration complète. Les RPC de finalisation/retrait existent dans la correction R1.
- Les onze références financières ne sont pas fournies parmi les trois fichiers ; les récupérer pour le portage sans réécrire le moteur.

**Arrêt pour revue après les contrôles locaux.** L’application de test et la pile Supabase créée pour cette reprise sont arrêtées. Les deux réseaux propres aux tentatives du banc ont été retirés après contrôle de leur étiquette et de l’absence de conteneur attaché ; aucun volume supprimé, sauvegarde locale conservée. Les autres environnements n’ont pas été arrêtés. Aucun commit, push, déploiement, migration distante, invitation/email réel, écriture métier réelle, appel Drive réel ou variable Vercel modifiée. Next.js et le générateur complet restent hors de ce lot.

## 8. Périmètre exact des fichiers modifiés ou ajoutés

- `.gitignore`
- `.vercelignore`
- `app/api/drive/_utils.ts`
- `app/izord/page.tsx`
- `app/page.tsx`
- `app/spaces/page.tsx`
- `components/AccessPortal.module.css`
- `components/AccessPortal.tsx`
- `components/CRMApp.tsx`
- `docs/izord/REVIEW.md`
- `docs/izord/bootstrap-oar.sql`
- `docs/izord/html-inventory.md`
- `docs/izord/local-testing.md`
- `docs/izord/rollback-close-izord.sql`
- `lib/access/crmCache.ts`
- `supabase/migrations/20260916170445_module_access_foundation.sql`
- `tests/contactAddress.browser.ts`
- `tests/crmCache.test.ts`
- `tests/driveFolderConcurrency.test.ts`
- `tests/driveRegistryAuth.test.ts`
- `tests/izord/live-local.mjs`
- `tests/izord/live-app.mjs`
- `tests/izord/live-drive.mjs`
- `tests/izord/live.browser.mjs`
- `tests/izord/google-transport-fixture.ts`
- `tests/izord/local-network-guard.cjs`
- `tests/izord/local-stack.mjs`
- `tests/izord/local-target.mjs`
- `tests/izord/local-target.test.mjs`
- `tests/izord/postgres.mjs`
- `tests/izord/preview.mjs`
- `tests/izord/sql-fixture.sql`
- `tests/izord/ui.browser.mjs`
- `tests/izordAuthorization.test.ts`
- `tests/moduleAccess.test.ts`

État final `git status --short` (aucun fichier staged ; `HEAD` reste `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`) :

```text
 M .gitignore
 M app/api/drive/_utils.ts
 M app/page.tsx
 M components/CRMApp.tsx
 M tests/contactAddress.browser.ts
 M tests/driveFolderConcurrency.test.ts
 M tests/driveRegistryAuth.test.ts
?? .vercelignore
?? app/izord/
?? app/spaces/
?? components/AccessPortal.module.css
?? components/AccessPortal.tsx
?? docs/izord/
?? lib/access/
?? supabase/migrations/20260916170445_module_access_foundation.sql
?? tests/crmCache.test.ts
?? tests/izord/
?? tests/izordAuthorization.test.ts
?? tests/moduleAccess.test.ts
```

## 9. Proposition distincte de mise à niveau Next.js — non appliquée

Versions réellement installées vérifiées pendant cette reprise : Next.js et `eslint-config-next` **14.2.16**, React/React DOM **18.3.1**, TypeScript **5.6.3**, Node **24.16.0**, npm **11.13.0**. Aucun changement à `package.json`, au lockfile ni aux configurations de build.

**Cible proposée au 16 septembre 2026 : Next.js 16.3.5 + React/React DOM 19.3.0**, versions stables, sans canary. Next 16 est Active LTS, Next 15 Maintenance LTS, Next 14 hors support. Node 24 est LTS et satisfait le minimum Next 20.9.0 ; recontrôler son dernier correctif lors du futur lot. Sources primaires : [support Next](https://nextjs.org/support-policy), [release Next 16.3.5](https://github.com/vercel/next.js/releases/tag/v16.3.5), [release React 19.3.0](https://github.com/react/react/releases/tag/v19.3.0), [peers Next](https://raw.githubusercontent.com/vercel/next.js/v16.3.5/packages/next/package.json), [versions Node](https://nodejs.org/en/about/previous-releases).

L’[avis officiel AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) inclut Next 14.2.16 dans sa plage affectée, correctifs 15.5.24/16.3.3. La cible proposée est ultérieure. Cet avis ne prouve pas à lui seul l’exploitabilité de chaque installation. Un build réussi ne prouve pas la sécurité ; les avis et versions devront être revérifiés au début du lot.

Adaptations ciblées :

- `package.json`/`package-lock.json` : versions exactes Next/React/DOM/eslint-config-next, types React 19 et Node 24 ; ESLint 9 minimum selon les peers d’eslint-config-next 16.3.5.
- Ajouter une configuration ESLint plate, remplacer `next lint` par `eslint`. `next build` ne lance plus le lint : étape distincte obligatoire. [Guide Next 16](https://nextjs.org/docs/app/guides/upgrading/version-16).
- Revoir les changements 14→15→16 : APIs de requêtes asynchrones, cache/navigation, Turbopack par défaut. Aucun usage actuel de `cookies()`, `headers()`, `draftMode()`, routes à paramètres dynamiques ou middleware repéré. Conserver `nodejs`/`force-dynamic` des six routes Drive et `cache: no-store` sur les contrôles serveur. [Guide Next 15](https://nextjs.org/docs/app/guides/upgrading/version-15).
- Compiler les composants TSX, vérifier types/ref DOM/hydratation et garder `reactStrictMode`. Revoir les changements générés de `tsconfig.json`/`next-env.d.ts` plutôt que les accepter automatiquement. [Guide React 19](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).
- Vérifier `tests/izord/preview.mjs` : symlink `node_modules` depuis une copie temporaire à tester avec Turbopack. Adapter seulement si nécessaire.

Tests du futur lot : installation reproductible, audit des dépendances, ESLint séparé, TypeScript, build isolé sans `.env.local`, 190 tests actuels et leurs extensions, 16 contrôles Contacts, vues 1440/390 et console, matrice réelle Auth/REST/RPC/Storage, changements de compte/retour navigateur/révocation/refus Drive. Réexécuter les vérifications après toute adaptation.

Isoler ce futur changement dans un lot de dépendances partant d’un état du lot d’accès identifié et revu, en préservant les modifications du worktree. Aucun mélange avec SQL, données, secrets, invitations ou cloud. Pas de `npm audit fix --force`, mise à niveau globale ou codemod non relu. La séparation par branche/commit se fera seulement lorsqu’elle sera autorisée ; aucun commit créé ici.
