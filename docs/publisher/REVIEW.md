# Instagram Publisher dans le CRM — revue du lot local

**Statut : intégration locale conservée ; P1 reproduit dans le vrai produit local puis corrigé et validé sur les reprises affectées. Aucun commit, push, déploiement, changement de droits réels, migration distante ou appel payant.**

## Démonstration

URL : **http://127.0.0.1:3173/publisher**. Application Next.js réelle, Supabase Auth/PostgreSQL/Storage locaux. Générations externes simulées, visuels fictifs ; aucune bibliothèque réelle copiée. La simulation ne prouve ni la qualité ni la vitesse des générations externes.

| Compte fictif | Email | Mot de passe local | Accès |
| --- | --- | --- | --- |
| Administrateur | publisher-admin@example.invalid | Local-Publisher-2026! | Administration et modules de démonstration, Publisher explicitement attribué |
| Publisher seul | publisher-editor@example.invalid | Local-Publisher-2026! | Contribution, génération, export, marquage |
| Lecteur | publisher-reader@example.invalid | Local-Publisher-2026! | Consultation et aperçus, sans export ni mutation |
| Contributeur | publisher-contributor@example.invalid | Local-Publisher-2026! | Consultation et disponibilité musicale, sans génération/export/marquage |
| Lecteur avec export | publisher-reader-export@example.invalid | Local-Publisher-2026! | Consultation et export seulement |

Parcours : connexion → Instagram Publisher → Univers/Moment/Style → génération simulée → sélection musicale → régénération du texte → export / « Marquer comme publié » → historique. Administration → Utilisateurs et accès contient le même module et ses droits sensibles. La navigation commune et le menu mobile Plus restent disponibles selon les modules attribués.

La pile appartient à `/private/tmp/crm-publisher-local`, sans purge des autres démos. Source exécutable isolée dans `app/`, médias dans `media/`, manifestes et configurations privées à côté. Le serveur n'a que la clé publique Auth locale et les accès à sa base Publisher locale ; aucun secret fournisseur, SMTP, invitation ou Production. Les requêtes sortantes du processus sont limitées aux ports loopback dédiés 3173/55531/55532/55534. Aucun profil Chrome personnel utilisé.

## Source réellement utilisée

- CRM initial : `58eef306ec9b5f98b10e8ca2a62686122532429b` ; HEAD et distant `main` vérifiés identiques.
- Publisher : dépôt `vgenevier-byte/oneaddressr`, branche `publisher/stable`, SHA **`0ec3170d8012956350eb0ac4ba2c9231385b9ed7`**. HEAD local et branche distante identiques.
- Provenance Production lue via les métadonnées Vercel, sans appeler une route métier : projet `oneaddressr-publisher` / `prj_KxwLLx2Im5NRgg8Dz3GIL2KRofaB`, équipe `oneaddress-projects` / `team_LCAVB1UAPQQMXOJvQmMggq2G`, déploiement `dpl_H22CCheuwhwrqoKxfYc86exUjXEU`, `READY`, source Git, SHA identique.
- Alias courant : `publisher.oneaddressriviera.com`, `oneaddressr-publisher.vercel.app`. Inventaire détaillé et empreintes des fichiers dans [source.json](source.json). Les métadonnées Vercel paginées ont recensé 7 déploiements Publisher (5 READY, 2 BLOCKED), tous Production, aucun Preview visible, 4 aliases et 2 domaines : [legacy-deployments.json](legacy-deployments.json). Aucun cron Vercel ni deploy hook déclaré dans ce projet ; les automatisations externes restent à confirmer.
- Les modifications préexistantes `.gitignore` et `app/frontend/.gitignore` du dépôt source sont préservées. Aucune autre partie du site n'est importée. La branche distante `main` du site public (`b7d9bf5873ae153c7a1264ff64d9911eab00100f`) ne contient actuellement ni API ni route Publisher ; cela ne dispense pas d'inventorier les anciennes URLs de déploiement éventuellement encore capables d'atteindre ses ressources.

| Source conservée | Intégration |
| --- | --- |
| PublisherPage, CreativeSelector, PostEditor, GenerationProgress, HistoryGrid | `components/publisher/` avec styles limités à sa racine ; navigation CRM extérieure |
| Génération quotidienne/guidée et progression | Mêmes actions, mêmes IDs de requête, lecture d'état sans relance |
| `constants.js`, `rules.js`, `schemas.js`, `storage.js` | Reprise byte-identique vérifiée par SHA-256 |
| Brief de marque, prompts, modèles, qualité, formats et règles musicales | Moteur `lib/publisher/engine/generation.js` repris ; seules frontières Auth/fournisseur/stockage et sûreté de concurrence adaptées |
| Neon PostgreSQL + Blob Vercel privé | Même stockage prévu à la bascule ; base PostgreSQL et médias locaux isolés pour la démo |
| Sélection musicale manuelle | Fix source conservé : régénérer le texte ne revient pas à la musique principale |
| `publish → markPublished` | « Marquer comme publié » : statut et musique dans l'historique, aucun envoi Meta |
| Régénération du visuel déjà dans l'API source | Fonction réutilisée et bouton ajouté sous le droit Générer |
| Feed / Reel | Formats et export d'image fixe source conservés, sans inventer un rendu vidéo |
| Copie / téléchargement | Autorisation serveur export ; aperçu authentifié distinct |

Six dépendances ciblées reprennent le moteur et ses composants : Neon, Blob, OpenAI, Zod 3, lucide-react et pg pour l’adaptateur local. Next.js, React et ESLint conservent leurs versions.

Aucune suppression de contenu ajoutée. Aucun calendrier, multi-compte Instagram, dossier privé, facturation ou miroir dans `crm_workspace_state`.

## Architecture et frontières

`/publisher` réutilise AccessPortal et sa session individuelle. Le Publisher est chargé dynamiquement ; un compte Publisher seul n'a pas besoin d'une adhésion OAR/IZORD, ne monte pas CRMApp et n'a pas de droit sur leurs payloads, RPC ou Storage. Les comptes OAR existants ne reçoivent pas Publisher. Le calcul fullAccess OAR exclut Publisher et continue de fonctionner sans lui. Administrer les droits n'accorde pas le droit de lire les contenus.

Le serveur Next.js `/api/publisher` vérifie le bearer CRM avec Auth et le RPC courant `crm_authorize_publisher`. Le RPC vérifie aussi l'existence de la session Auth, le profil actif et les grants actuels. Les droits sont revérifiés avant chaque appel externe et avant livraison du résultat. Rôles du navigateur, métadonnées utilisateur, ancien cookie partagé et header benchmark n'ont aucune autorité.

| Opérations | Droit minimum |
| --- | --- |
| session, today, history, status, image | Lecture Publisher |
| generate, regenerate-text, regenerate-image | Contribution + generate |
| music-status | Contribution, identifiant musical appartenant au post fourni |
| publish | Contribution + mark_published, musique admissible du post |
| export, export-text / commandes de copie | Lecture ou Contribution + export |
| Action inconnue, login/logout legacy, benchmark, delete | Refus |

Aucun token dans une URL. Les aperçus utilisent une requête authentifiée puis une URL Blob locale au navigateur, révoquée au démontage. Réponses privées `no-store`, pas de cache partagé. Références Blob réelles exclues des payloads. L'export d'image et la copie exigent une autorisation serveur séparée. Un utilisateur autorisé à consulter conserve techniquement la possibilité de recopier les octets ou textes affichés ; l'interface ne prétend pas l'empêcher.

La base Publisher reste la source de vérité commune. Les accès Neon/Blob/OpenAI demeurent serveur. L'initialisation SQL historique a été retirée des lectures et des requêtes métiers : migration explicite requise. Les requêtes utilisent des paramètres. Une panne de lecture après commit ne supprime plus le nouveau média référencé : la persistance est reconnue, la reprise relit le résultat, et toute suppression de Blob vérifie d’abord l’absence de référence (en cas de doute, conservation). Les révisions et colonnes Auth ajoutées ne remplacent aucun ID, date, statut, musique ou référence de média historique ; les auteurs anciens restent nuls. Les nouvelles écritures et demandes enregistrent l'UUID Auth réel.

SQL préparé :

- `supabase/migrations/20260928191512_publisher_module_access.sql` : extensions additives de la couche d'accès CRM, sans attribution automatique ; invitations valident les nouveaux grants sans adhésion OAR implicite.
- `lib/publisher/sql/001-crm-boundary.sql` : migration additive de la **base Publisher Neon existante**, colonnes revision/auteur et journal d'opérations.
- `lib/publisher/sql/local-bootstrap.sql` : schéma source d'une **base locale vide seulement**, à ne jamais exécuter pour initialiser ou resemer la Production historique.

## Traitements longs, pannes et concurrence

Mêmes requêtes de création, verrous de post et identifiants source. Un journal PostgreSQL durable complète la protection pour toutes les mutations : requestId unique, acteur et empreinte canonique ; un seul traitement admis à la fois sur toutes les instances. Une répétition renvoie le résultat ou l'état existant. Une même clé avec une autre action, un autre contenu ou un autre acteur est refusée.

Bornes ajoutées là où la source n'avait pas de plafond global : 20 demandes de génération/régénération admises par compte sur 24 h, 100 globales, historique limité aux 30 entrées source, corps API 16 Ko, média 25 Mo. Les mutations musicales et le marquage ne consomment pas le plafond des générations. Réessais structurés source conservés (3 tentatives, repli de modèle), sans retries SDK supplémentaires. Ces plafonds conservateurs sont des nombres de demandes, pas un budget monétaire ni un plafond d’appels fournisseur. Ces limites ont été approuvées dans l’autorisation de publication coordonnée du 28 septembre 2026.

Les appels texte et image acceptés sont attendus tous les deux même en cas d'échec partiel, avant de libérer le verrou. Quitter le module ou révoquer un compte n'annule pas magiquement une requête déjà acceptée par le fournisseur. Le travail admis peut terminer sa persistance, mais son résultat n'est pas livré à un compte sans droits ; aucun nouvel appel fournisseur ne passe sans revérification. Pas de promesse de remboursement.

Une panne temporaire conserve la saisie en mémoire pour le même compte et la même révision d'accès. Une réponse tardive, un changement de compte, une déconnexion ou un retrait de droits abortent les opérations clientes et éliminent le brouillon concerné. Les UUID de reprise sont séparés par compte. La révision d'origine reste attachée au brouillon ; un conflit exige comparaison/rechargement, sans écrasement silencieux.

Un échec terminal exige une nouvelle tentative explicitement demandée. Un crash de processus peut laisser une opération `running` : **aucun déverrouillage automatique après cinq minutes** et aucune relance payante implicite. Avant la Production, prévoir la procédure opérateur : confirmer auprès du fournisseur et du stockage que le travail est terminé, conserver son journal, puis clôturer la demande bloquée ; seulement ensuite autoriser une nouvelle demande. Le helper hors API `lib/publisher/engine/reconcile.js` prépare cette maintenance : activation explicite, attestation documentée worker arrêté/fournisseur terminé, ancienneté minimale 15 minutes, récupération d’un résultat déjà stocké ou clôture en échec sans appel fournisseur. Son test local est `tests/publisher/reconcile.mjs`. Le délai Next/Vercel reste 300 secondes ; disponibilité de cette durée à vérifier sur le projet CRM.

## Validation locale du lot initial — résultats conservés

Aucun test local n'est présenté comme une preuve authentifiée Production.

| Vérification | Résultat |
| --- | --- |
| Moteur source : règles, schémas, formats, musique, médias | 22 tests passent, code créatif original réutilisé |
| Ancien cookie/benchmark, validation des routes, parité SHA, garde des cibles, fermeture legacy préparée | 5 tests passent |
| Panne après commit média/texte, acknowledgement perdu, conservation si référence incertaine | 9 tests passent (mocks limités aux frontières SQL/fournisseur de ce groupe unitaire) |
| Matrice de droits, session, RLS/RPC/Storage, invitations fictives, fullAccess, conflit | 13 scénarios passent avec vraie Auth locale ; vérification supplémentaire des IDs et octets de fichiers privés existants |
| API Next + Auth + PostgreSQL + médias locaux | 13 scénarios passent, y compris l’origine réelle du navigateur et les origines étrangères/forgées refusées |
| Reprise d'un verrou après interruption | Test local passe ; attestation explicite exigée, zéro appel externe |
| Chromium / WebKit, bureau et mobile | 22 contrôles passent (campagne de 21 + menu administrateur complet) : 1440 px et 375/390/430 px, Plus ouvert, formulaire, parcours musical, droits administrateur, réponses/export/copie tardifs après changement de compte |
| TypeScript | Passe (`--noEmit --incremental false`) |
| ESLint | Zéro erreur, seulement les deux avertissements historiques AccessPortal/navigation et CRMApp/img |
| Build Next.js optimisé | Passe dans la copie locale isolée, sans `.env` Production |
| `git diff --check` | Passe |

La campagne a corrigé deux défauts d'adaptation découverts par le vrai parcours : DATE local préservée comme date SQL sans décalage de fuseau ; comparaison de l'Origin avec l'HTTP Host original lorsque Next normalise l'URL locale. Les collisions des styles globaux CRM ont été neutralisées exclusivement dans le périmètre Publisher. Une fixture de légende répétitive a été corrigée après son rejet par la vraie règle anti-répétition ; les règles créatives n'ont pas été assouplies. Après correction, seules les vérifications affectées et les scénarios restants ont été repris.

Commandes ciblées (depuis le dépôt) :

```sh
node --test lib/publisher/engine/{rules,schemas,generation,storage}.test.js
node --experimental-test-module-mocks --test tests/publisher/*.test.mjs
PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY node tests/publisher/access.mjs
PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY node tests/publisher/api.mjs
PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY node tests/publisher/reconcile.mjs
PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY PLAYWRIGHT_BROWSERS_PATH=/private/tmp/crm-publisher-runtime/browsers node tests/publisher/browser.mjs
npx tsc --noEmit --incremental false
npm run lint
git diff --check
```

`tests/publisher/serve.mjs` compile puis conserve le vrai serveur Next local en fonctionnement. Pour le relancer après arrêt explicite : `PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY node tests/publisher/serve.mjs`. Son manifeste privé vérifie qu'il ne remplace aucun serveur encore actif. `stack.mjs` et `bootstrap.mjs` gardent la cible dédiée et n'effacent aucun volume. Les scripts refusent toute autre cible avant une écriture. Les tests navigateur créent leurs propres contextes, jamais le profil personnel.

Intégrité de la démonstration initiale : build local `dgavgP2XegetNcS3t8yCb`, 120 fichiers applicatifs exécutés identiques aux sources, 39 chunks publics inspectés (clé publique Auth locale attendue, aucune clé de service locale ni URL de connexion serveur). Copie applicative sans fichier `.env`. Fin de campagne : aucun travail en cours, panne simulée désactivée, serveur accessible. Preuves synthétiques dans [validation.json](validation.json). Les logs/configurations complets restent privés dans `/private/tmp/crm-publisher-local`.

Captures conservées et inspectées :

- [Bureau 1440 px, publication et musique sélectionnée](screenshots/chromium-desktop-1440.png).
- [Menu Plus ouvert, 375 px](screenshots/chromium-plus-375.png).
- [Formulaire, 390 px](screenshots/chromium-form-390.png).
- [Formulaire, 430 px](screenshots/chromium-form-430.png).
- [Menu Plus WebKit, 390 px](screenshots/webkit-plus-390.png).

Aucune campagne finance, Drive ou IZORD indépendante n'a été recommencée. Seules leurs frontières d'accès réellement affectées ont été contrôlées avec des fixtures identifiables et des témoins positifs administrateur.

## Correctif ciblé P1 — reprise après panne d’accès

La revue jointe utilisait une **sonde du composant avec hooks/API/stockage simulés**, pas un test navigateur complet. Elle a servi à définir le cas à reproduire. Les empreintes des pièces locales avant correction correspondaient à `Controles_integrite.json` : REVIEW `6f8dda92fcf18d58a7959232b0a925665c845c8b608e0bee1da633ca6df69f39`, diff `6d96b42e831ae409a5cfa9b1eaf9e9d7bda4703f73050ab01c75a9dc02d64c0d`. Les résultats et captures du lot initial ci-dessus sont conservés, sans nouvelle campagne générale ni nouvelle lecture de Production.

### Reproduction avant correction

Deux reproductions, **Chromium et WebKit**, sur le build local `d-fLt1LgoVDWJSpoRvKhp` : vrai React/Next, vraie Auth locale, vrais contrôles CRM et PostgreSQL. Le pilote attend la ligne `running` de R1 et l’entrée dans le fournisseur simulé avant de faire échouer la vérification Auth du navigateur. Il vérifie le démontage du Publisher, laisse R1 finir en base pendant la panne, puis rétablit le même compte et la même révision. La réponse HTTP de `generate` n’est pas retenue par le pilote.

| Navigateur | R1 admis et terminé pendant la panne | R2 admis au clic après retour |
| --- | --- | --- |
| Chromium | `8d34c642-13e5-4641-868e-c7157d4a8475` → post `bf4db33c-0584-4059-9548-458deb83a611` | `13a6d2f7-b2a6-47e8-a5bd-2cbb7afe15d6` → autre post |
| WebKit | `df953128-c8e9-4fbc-84fd-574053487d08` → post `1deb67d3-f5d7-4c04-b7bd-4df608475789` | `1fde9c34-9b73-4961-9daf-cf5d892caf69` → autre post |

Dans chaque navigateur : aucune consultation de R1 au remontage, trois choix réaffichés, **2 admissions et 3 + 3 entrées du fournisseur simulé**. Le défaut P1 est donc confirmé indépendamment de la sonde de revue.

### Correction et périmètre

`PublisherPage.tsx` restaure la demande avant le rendu, dans un état lié au compte **et à la révision**. Une demande conservée prend priorité sur le brouillon : lecture de son état au montage, suivi par `requestId` jusqu’au reçu terminal, puis récupération du même post après vérification du tracker. Les commandes de création et de modification de direction restent indisponibles tant que la demande n’est pas résolue. Erreur réseau ou état vide : UUID et choix conservés, aucune nouvelle génération. Un échec terminal permet « Préparer une nouvelle tentative », puis un second clic explicite sur « Créer » avec une nouvelle clé.

Le test terminal a également révélé que le suivi par l’ID du post perdait le caractère terminal du reçu d’opération ; le suivi privilégie désormais R1. Une nouvelle création volontaire avec les mêmes trois choix reste possible et a été vérifiée. Aucun rapprochement par direction, titre ou date n’est ajouté. Le brouillon non soumis, les opérations de musique et les contrôles de session existants sont conservés.

Pour éviter une régression du bouton bloqué, les deux refus **certainement avant admission** (plafond atteint ou verrou concurrent après rollback et absence de reçu) sont signalés comme terminaux par `operations.js`, avec le transport existant. Cela autorise seulement la préparation explicite d’une nouvelle tentative ; aucune modification du SQL, des plafonds ou du verrou. Un réseau indisponible, une erreur SQL inconnue ou une lecture 404 ne deviennent jamais une preuve de refus terminal. Si le refus lui-même n’a pas été reçu, l’état inconnu reste conservé pour rapprochement ; aucune relance payante implicite.

Les anciennes clés locales sans révision ne sont pas migrées : cette intégration n’est pas publiée et elles ne prouvent pas la révision d’accès. Les demandes testées après correction utilisent toutes la clé compte/révision. Aucun changement des prompts, modèles, qualité, formats, règles musicales, moteur de génération, SQL, permissions, Auth, navigation ou fermeture legacy.

### Résultats après correction — distincts du lot initial

**12 parcours ciblés**, six dans chaque navigateur, avec la page corrigée dans le build `0-BoCNSrbKPSh2NGhfcHO`. Les admissions PostgreSQL et les entrées du fournisseur simulé sont comptées et assertées en plus de l’interface. Une création réussie comporte normalement trois appels simulés (plan visuel, image, éditorial) ; « zéro supplémentaire » signifie aucun nouvel appel dû à la reprise.

| Parcours | Résultat Chromium et WebKit |
| --- | --- |
| Guidée terminée pendant la panne | Même R1, même post ; 1 admission, 3 appels initiaux, **0 admission/appel supplémentaire pour la reprise** |
| Toujours `running` au retour | Suivi de R1 ; 1 seul POST generate, 1 admission, 3 appels au total ; pannes de lecture 503 et état vide injectés conservant la demande |
| Échec terminal pendant le suivi | 1 admission échouée et 3 tentatives simulées selon les retries source ; aucun renvoi automatique ; nouvelle clé seulement après préparation puis clic explicites |
| Brouillon non soumis | Les trois choix subsistent ; 0 POST, 0 admission, 0 appel fournisseur |
| Changement vers un compte sans accès | Aucun résultat livré, aucune reprise de R1 ; l’API refuse la lecture avec 403 |
| Retrait de droits du compte | Aucun résultat livré ni reprise ; ancien jeton refusé avec 403 ; droits de fixture restaurés |

Dans Chromium, une création identique volontaire supplémentaire a aussi été admise avec un autre UUID et trois appels, uniquement après l’action « Nouvelle création ». Elle n’est pas comptée comme une reprise de R1.

La seule instrumentation serveur du navigateur est ajoutée par `serve.mjs --recovery-probe` dans la **copie jetable** de l’adaptateur fournisseur : attente contrôlée et journal d’entrée texte/image. Le produit du dépôt n’importe pas ce helper. Le manifeste distingue les empreintes produit et les deux fichiers adaptés. Les vérifications Auth, l’API, les transactions et la génération interne restent réelles ; aucun fournisseur externe n’est appelé. Les erreurs 503/état vide des consultations sont des injections de test, pas des pannes réelles du serveur SQL.

Les deux comptes de génération sont fictifs ; le grant temporaire de la fixture `matrix` et les révocations locales sont restaurés. La bibliothèque fictive du banc a épuisé ses musiques éligibles pendant les essais : ajout idempotent de 36 titres explicitement fictifs, **sans effacer l’historique ni modifier l’exclusion musicale de 14 jours**. Une attente de fin de déconnexion a été corrigée dans le pilote ; seuls les scénarios non validés ont ensuite été repris. Aucun compteur ni plafond n’a été remis à zéro.

La page de ces 12 parcours est identique à celle du build final. Seuls les deux marqueurs de refus avant admission ont été ajoutés ensuite côté serveur et validés par les tests ciblés ci-dessous ; aucune admission de ces parcours n’emprunte ces branches de refus.

Non-régression ciblée supplémentaire : `recovery-refusal.test.mjs` vérifie les refus avant admission et les reçus existants avec doubles SQL, séparément des preuves navigateur/Auth/PostgreSQL. 5 scénarios passent (le compteur Node inclut en plus le test parent). TypeScript passe ; ESLint : zéro erreur, les deux avertissements historiques seulement. Build final optimisé et diff-check : validés.

Commandes de ce correctif uniquement :

```sh
PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY node tests/publisher/serve.mjs --recovery-probe
PUBLISHER_TEST_ACK=PUBLISHER_DISPOSABLE_LOCAL_ONLY PLAYWRIGHT_BROWSERS_PATH=/private/tmp/crm-publisher-runtime/browsers node tests/publisher/recovery.browser.mjs
node --experimental-test-module-mocks --test tests/publisher/recovery-refusal.test.mjs
npx tsc --noEmit --incremental false
npm run lint
node tests/publisher/write-diff.mjs
git diff --check
git apply --reverse --check docs/publisher/integration.diff
```

`--before` sert à reproduire le défaut sur la source antérieure uniquement. `--remaining` reprend les scénarios non validés du même build et conserve ceux déjà passés. Les traces avant/après restent dans les résultats privés du banc local ; aucun nouveau rapport ou archive de livraison n’est créé. Les anciens `validation.json`, tests et captures conservent leur provenance initiale.

Démonstration finale : **http://127.0.0.1:3173/publisher**, build optimisé `QiUfpiNBcnpgwDbYjqSJe` : 120 fichiers applicatifs identiques au dépôt, 39 chunks publics inspectés sans secret serveur, aucun fichier `.env`, aucune opération `running`, contrôles de panne désactivés, grants de fixture restaurés et ouverture Chromium authentifiée en lecture réussie. Le lancement normal supprime le helper d’instrumentation et restaure le fournisseur simulé du dépôt. Générations externes toujours simulées ; aucune preuve de qualité fournisseur réelle, de session authentifiée Production ou d’iPhone physique n’est revendiquée.

## Configuration de la future publication

Destinataire du code et des nouvelles variables : **Vercel `oneaddress-projects / oneaddress-riviera-crm`**, route finale `https://oneaddress-riviera-crm.vercel.app/publisher`.

| Variable | Usage / prérequis |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Configuration CRM existante, conserver la cible CRM approuvée |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Configuration publique CRM existante |
| PUBLISHER_DATABASE_URL | Nouvelle variable serveur CRM, accès restreint à la base Neon Publisher existante, saisi en privé lors de la bascule |
| PUBLISHER_BLOB_READ_WRITE_TOKEN | Nouvelle variable serveur CRM, accès au même store **privé**, remplaçant l'ancien accès à révoquer |
| OPENAI_API_KEY | Clé serveur du fournisseur ; transfert/rotation privé coordonné, aucune valeur copiée dans ce lot |
| OPENAI_TEXT_MODEL | Reprendre la configuration réellement utilisée ; défaut source gpt-5.6-luna |
| OPENAI_IMAGE_MODEL | Reprendre la configuration réellement utilisée ; défaut source gpt-image-2 |
| OPENAI_IMAGE_QUALITY | Reprendre la qualité source effective ; défaut medium |
| PUBLISHER_TIMEZONE | Europe/Paris par défaut source |
| PUBLISHER_EXTERNAL_CALLS_ENABLED | Absente ou différente de 1 = génération externe bloquée ; activation et essai payant à approuver séparément |

`PUBLISHER_LOCAL_SIMULATION`, `PUBLISHER_LOCAL_MEDIA_DIR`, `PUBLISHER_SIMULATION_DELAY_MS`, `PUBLISHER_SIMULATION_CONTROL_FILE`, `NEXT_PUBLIC_PUBLISHER_DEMO` sont exclusivement locaux et ne doivent pas être ajoutés en Production. Le mode simulation refuse une cible Auth/base distante et toute exécution Vercel.

`PUBLISHER_MAINTENANCE_ENABLED` est réservé à la commande opérateur hors ligne de réconciliation ; il ne doit pas être configuré sur le serveur applicatif.

Les anciens `PUBLISHER_PASSWORD_HASH`, `PUBLISHER_SESSION_SECRET`, `PUBLISHER_BENCHMARK_SECRET` ne sont pas requis dans le CRM. Ni `CRM_INVITE_AUTH_KEY`, ni SMTP, ni Drive/WIF ne sont utilisés par les opérations Publisher.

Métadonnées Vercel vérifiées en lecture seule : le CRM possède déjà les deux variables publiques Supabase ; aucun nom Publisher/OpenAI/Blob n'y est configuré. Le Publisher source possède en Production `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `PUBLISHER_TIMEZONE` et les deux secrets legacy mot de passe/session. `PUBLISHER_BENCHMARK_SECRET` est absent du snapshot courant, ce qui ne prouve pas son absence dans les anciens déploiements figés. Aucune valeur secrète n'a été consultée ou copiée.

Aucun secret de Production manquant n'empêche la démonstration locale. La bascule nécessitera la saisie privée des accès au stockage existant, leur isolation/rotation, le contrôle des métadonnées effectives du projet destinataire et la validation réelle de connectivité/conservation. La présence d'un nom de variable ne prouve pas la validité de sa valeur.

## Bascule coordonnée future — à autoriser

1. Confirmer l'approbation du diff, les plafonds, la durée 300 s et les projets exacts. Relever les SHA finaux CRM/source. Préparer un point de restauration privé vérifié de Neon et des références Blob, sans dupliquer la bibliothèque dans les tests.
2. Inventorier **tous** les déploiements Publisher accessibles, Production **et Preview**, leurs aliases, domaines et anciennes URLs immuables, plus la route Publisher du site public. Vérifier les automatisations externes et désigner un seul déclencheur quotidien. Aucun cron n'existe dans le `vercel.json` source vérifié, mais cela ne prouve pas l'absence d'une automatisation extérieure.
3. Préparer un candidat CRM isolé avec les variables serveur privées et la génération externe désactivée. Préparer la fermeture legacy : [legacy-api-closed.mjs](legacy-api-closed.mjs) remplace l'API, [LegacyPublisherClosed.tsx](LegacyPublisherClosed.tsx) remplace la page Publisher. Ces fichiers ne sont pas appliqués au dépôt source dans ce lot.
4. Fermer l'admission de nouveaux traitements legacy pendant la fenêtre de bascule, laisser finir les demandes déjà acceptées et contrôler les verrous. Aucun générateur ancien et nouveau ne doit fonctionner simultanément.
5. Appliquer les migrations additives approuvées aux deux bases, vérifier les comptages/empreintes sur les champs historiques et les médias référencés. Attribuer explicitement Publisher au seul compte propriétaire **Auth vérifié**, par la matrice existante / `crm_admin_save`, en fusionnant ses droits actuels et sa révision. Ne créer ni nouvel utilisateur, ni invitation, ni adhésion OAR superflue.
6. Remplacer les pages et API legacy sur les points d'entrée concernés. Une redirection de page ne suffit pas. **Révoquer les capacités des anciens déploiements** : ancien rôle/mot de passe Neon, ancien token Blob, ancienne clé fournisseur et secrets de session/benchmark, après avoir isolé les nouvelles capacités CRM et vérifié leur usage éventuel par le site public. Les anciens environnements Vercel sont figés : modifier une variable actuelle ou déplacer un alias ne retire pas leurs anciens secrets. Utiliser en complément la protection/restriction des déploiements ; aucune suppression ou dépense automatique n'est prévue.
7. Vérifier depuis un contexte non privilégié les domaines et les anciennes URLs inventoriées : ancien cookie valide, mot de passe et benchmark ne doivent plus lire l'historique/médias, écrire ou générer. Tant qu'une URL ou capacité historique contourne encore les grants CRM, **la transition n'est pas terminée**.
8. Promouvoir le CRM autorisé, vérifier READY/provenance/alias, login individuel réel, droits matrice, médias historiques, accès direct/rechargement/mobile, exclusions OAR/IZORD, puis absence de double déclenchement. Un éventuel essai réel de génération, avec budget et identité de test convenus, exige une approbation séparée. Ne marquer aucun vrai contenu publié sans autorisation.

### Retour arrière qui conserve les restrictions

Garder les colonnes additives, IDs et journaux ; aucune restauration qui efface les nouveaux contenus. En cas de défaut, désactiver les appels externes et suspendre le module tout en gardant les anciennes APIs fermées et leurs capacités révoquées. Revenir uniquement à une version CRM déjà compatible avec les contrôles d'accès, ou laisser le module indisponible temporairement. Ne jamais republier le Publisher à mot de passe partagé ni restaurer ses anciens secrets. Reprendre les travaux en cours après rapprochement, sans second générateur quotidien.

## Diff et décision

Le [diff complet](integration.diff) inclut les modifications suivies, les nouveaux fichiers, SQL, tests et captures. Il est produit sans staging par `node tests/publisher/write-diff.mjs`. Le fichier diff lui-même est exclu de son propre contenu. Aucun secret, WIF local, volume, fichier `.env`, log privé ou archive massive ne fait partie de la livraison.

Ce correctif ne valide ni la configuration distante ni la bascule. Restent à approuver/vérifier : connectivité et conservation Neon/Blob réelles, fermeture coordonnée de toutes les capacités legacy avec inventaire des usages partagés, plafonds de demandes, durée 300 s, procédure de rapprochement des verrous (au moins 15 minutes, worker arrêté et fournisseur terminé), attribution explicite au propriétaire Auth vérifié. Activation externe et essai payant restent séparés.

À l'issue de la validation locale, une seule décision reste à prendre : **autoriser ou non la publication coordonnée décrite ci-dessus**, avec ses prérequis et l'éventuelle génération payante explicitement traitée à part.


## Publication coordonnée autorisée — préparation du 28 septembre 2026

L’autorisation couvre les commits ciblés, les candidats Production sans domaine, les deux migrations manquantes, l’attribution Publisher au seul propriétaire vérifié et la fermeture coordonnée des anciens accès. **La génération externe reste désactivée ; aucun appel fournisseur ni marquage réel n’est autorisé.** Les 12 parcours navigateur et 5 scénarios P1 déjà validés sont conservés sans nouvelle campagne générale.

Préflight vérifié : CRM local/GitHub/Production `58eef306ec9b5f98b10e8ca2a62686122532429b` ; Publisher local/GitHub/Production `0ec3170d8012956350eb0ac4ba2c9231385b9ed7`. Les 120 fichiers applicatifs sont identiques au build validé `QiUfpiNBcnpgwDbYjqSJe`. La configuration Pro avec Fluid actif et Node 24 accepte déjà 300 secondes sans changement global ni abonnement.

Neon a été interrogé en transaction READ ONLY, sans route métier ni initialisation : 16 créations, 24 musiques, 16 références de médias, aucun traitement déclaré en cours. Un HEAD authentifié confirme la lecture du Blob privé référencé ; aucun octet d’image téléchargé. Les deux migrations Publisher sont absentes. Le propriétaire Auth est confirmé, actif, administrateur général, révision 2, avec 15 modules préexistants ; aucune attribution Publisher à ce stade.

Une seule sauvegarde privée hors dépôt contient les créations/musiques/références et le schéma/droits CRM concernés, sans bibliothèque d’images ni secrets Auth/SMTP/API, session ou Vault. Répertoire 0700, fichiers 0600, relecture et SHA-256 vérifiés. La CLI Supabase a initialisé son rôle PostgreSQL technique temporaire pour sa connexion ; les requêtes de sauvegarde sont READ ONLY. Cette connexion n’est pas une preuve de connexion propriétaire dans le navigateur.

La base et le rôle Neon historiques sont partagés avec des versions Preview du site public. Ne pas les révoquer sans traiter cette dépendance. Le store Blob privé existant est identifié ; la prévisualisation de sa connexion au CRM n’ajoute que `PUBLISHER_BLOB_READ_WRITE_TOKEN`, en Production uniquement. Les règles de fermeture doivent couvrir le projet Publisher et les routes `/publisher` et `/api/publisher` des versions Preview du site, sans toucher les autres routes publiques/SMTP. Les configurations WAF actives et brouillons, lues avant préparation, ne contiennent aucune règle ni bypass. Leur activation et leur vérification sur les anciennes URLs restent à effectuer.

**Saisie privée en attente :** sur Vercel → `oneaddress-projects / oneaddress-riviera-crm` → Settings → Environment Variables → Production, reprendre les valeurs effectives `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `PUBLISHER_TIMEZONE`. Les valeurs de Production historiques sont de type sensitive et ne sont pas récupérables par l’API normale. Ne pas substituer les valeurs par défaut sans confirmation. `OPENAI_API_KEY` peut attendre l’autorisation séparée d’activation externe ; elle n’est pas requise pour consulter l’historique avec la génération bloquée.

À ce stade : aucun push, déploiement, changement de domaine, migration applicative, modification de droits métier ni fermeture legacy. Les paramètres manquants bloquent la construction du candidat définitif. La sauvegarde vérifiée et les sources ciblées sont conservées pour reprendre sans répéter la campagne locale. La fermeture est préparée dans un worktree source isolé ; `git.deploymentEnabled` désactive les déploiements Git de la seule branche `publisher/stable`, afin de permettre une bascule manuelle coordonnée sans Preview/Production automatique en double. Les autres branches restent inchangées.
