# Charges mensuelles — livraison locale

Date : 5 octobre 2026. Projet : `/Users/vg/Desktop/OARcrm-repo`.
Point de départ : HEAD `83715640a4a1505984ce53dba315953d6238fff5`, branche `main`.
Statut : intégration locale utilisable, publication soumise à une décision distincte.

## Démonstration

Ouvrir [la démonstration locale](http://127.0.0.1:3183/charges).
La copie servie est construite en mode Production, avec Auth, PostgreSQL et PostgREST **locaux**.

Identités exclusivement fictives du banc ; elles n’existent pas en Production :

| Compte | Email | Utilisation |
| --- | --- | --- |
| Propriétaire | `monthly-owner@example.invalid` | Tous les droits OAR, Charges contribution et exports |
| Lecteur | `monthly-reader@example.invalid` | Charges lecture, deux sources, noms protégés, aucun export |
| Contributeur | `monthly-contributor@example.invalid` | Paramètres Charges modifiables ; sources en lecture ; export Factures uniquement |
| Factures | `monthly-invoice@example.invalid` | Charges et Factures ; aucune heure ni règle horaire transmise |
| Maison | `monthly-house@example.invalid` | Charges et Suivi maison ; aucune facture ni règle fournisseur transmise |
| Charges seules | `monthly-empty@example.invalid` | État vide explicite sans total complet |
| Sans Charges | `monthly-invoiceOnly@example.invalid` | Factures accessibles, `/charges` refusé |

Mot de passe fictif commun : `Local-Charges-2026!`.
Le banc comporte également des profils sans droit, propriétaire OAR historique sans Charges et Publisher seul.

Parcours de démonstration : choisir septembre 2026 : facture 600 € + heures 300 € = **900 €**, indépendamment des paiements d’octobre. Octobre, novembre et décembre présentent chacun **300 €** pour la facture trimestrielle répartie ; le total annuel de la sélection initiale vaut **1 800 €**. « Sélectionner mes charges » présente les autres sources fictives, sans les sélectionner automatiquement.

« Rattachement / répartition » permet le mois explicite, 1 à 12 mois consécutifs ou le retour à la date de facture. « Actualiser » relit les sources. Les liens ouvrent la véritable fiche locale et sa ligne historique. Le menu Plus contient Charges immédiatement après Suivi maison.

Le serveur et la pile restent disponibles dans un seul répertoire privé :
`/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/monthly-charges-stack-QMQVe4`.
API `127.0.0.1:55631`, PostgreSQL `55632`, application `3183` ; ports publiés exclusivement sur loopback.
Les clés, JWT et manifests de comptes restent dans ce répertoire privé, hors Git, hors captures et hors diff.

## Règles réalisées

- Une configuration de sélection partagée, initialement vide hors fixtures. Règles par identifiant fournisseur/intervenant, exceptions individuelles prioritaires et rétablissement de la règle automatique. Les deux types de source restent distincts. Aucun abonnement implicite à une personne après inclusion individuelle.
- Les règles couvrent les dépenses existantes et futures enregistrées. Aucune charge n’est inventée aux mois vides. Des factures identiques sur deux mois restent deux dépenses ; seule une même identité source est comptée une fois.
- Factures : montant total enregistré ; `paidAmount`, échéance, règlements, acomptes et devis n’entrent jamais dans le total. Statut actuel affiché à titre informatif. Annulées exclues, attendues hors total, aucune obligation de PDF pour une facture valablement enregistrée.
- Défaut = mois d’une date civile de facture valide, provenance « Date de facture ». Sans date valide et sans choix explicite : « À rattacher », hors mois. Aucun remplacement par création/paiement/mois courant.
- Rattachement personnalisé propre à la synthèse, sans modifier la source. Répartition égale en centimes, remplaçant l’imputation entière : les centimes résiduels vont aux premiers mois dans l’ordre chronologique. `100 € / 3 = 33,34 + 33,33 + 33,33`. Les fractions traversant décembre/janvier apparaissent dans chaque année concernée, même si la facture provient d’une autre année.
- Heures : durée nette calculée avec le helper existant, pause et passage de minuit ; multiplication par le taux enregistré sur chaque ligne. Le tarif courant de l’intervenant n’intervient jamais. Les historiques hors quarts d’heure restent calculés et signalés. Un paiement maison n’ajoute aucune charge.
- Zéro explicite valide ; montant/taux/date/horaires/pause manquants ou invalides signalés. Aucune normalisation rétroactive. Arrondi monétaire contrôlé au centime ; agrégat dépassant les entiers sûrs refusé avec état d’erreur, sans faux total.
- Filtre maison utilisant `houseId` des heures uniquement. Les factures sont présentées séparément « maison non renseignée », hors du total d’une maison filtrée.
- Historique des intervenants archivés conservé. Sources supprimées jamais recréées ; exceptions sans cible signalées seulement si la source reste autorisée. Le chevauchement facture/heures nécessite une exclusion explicite et éventuellement un motif.
- Tableau janvier–décembre, regroupements par source/personne, sous-totaux Factures et Suivi maison, détail mensuel, mois courant/futur, comparaison avec le précédent sur les mêmes filtres et sans pourcentage sur base nulle. Un zéro n’atteste pas l’absence de dépenses extérieures au CRM.
- CSV annuel et détail du mois : lecture serveur fraîche sous permissions d’export, période/périmètre/origine/rattachement explicites, totaux conciliables, rubriques hors total identifiées et cellules protégées contre les formules.

## Architecture et droits

`app/charges/page.tsx` utilise `AccessPortal`. Le catalogue commun ajoute `monthlyCharges` après `houseTracking` ; la navigation mobile réutilise `UnifiedNavigation`. Pour Charges, le propriétaire complet est lui aussi dirigé vers le workspace dédié, jamais vers le chargement global de `CRMApp`.

`lib/monthlyCharges/calculations.ts` calcule à partir du snapshot autorisé, avec `lib/currency.ts` et `lib/houseTracking.ts`. Aucun montant ni document source n’est stocké dans la configuration.

La migration additive `20261005092958_monthly_charges.sql` crée uniquement deux tables privées : configuration partagée et registre des demandes idempotentes. Elles ont RLS, aucune permission de lecture directe pour anon/authenticated, révision UUID et auteur `auth.uid()` ; les demandes ne stockent que l’empreinte du patch, la révision et l’acteur.

Les RPC `crm_read_monthly_charges` et `crm_patch_monthly_charges` réutilisent les contrôles d’accès existants, vérifient l’identité Auth et une session locale active, et filtrent avant toute restitution. Les fonctions privilégiées sont bornées, avec `search_path=pg_catalog` et EXECUTE public/anon révoqué.

| Action | Conditions serveur |
| --- | --- |
| Consulter | Lecture Charges ∩ Lecture de chaque source |
| Modifier les paramètres | Contribution Charges ∩ Lecture de la source touchée |
| Exporter | Export Charges ∩ Export de chaque source lisible demandée |
| Ouvrir une source | Droit de lecture du module source, parcours existant |

La contribution Charges n’attribue aucun droit de modification des factures/heures. Les patches transmettent uniquement les changements, contrôlent les références/champs/types et une révision partagée ; les règles omises ou invisibles sont conservées. Les conflits sont atomiques. Le registre par acteur et `request_id` rend un renvoi identique sans doublon après perte de réponse.

Les projections excluent paiements, RIB, emails, notes, documents et URLs, même pour le propriétaire. Sans Lecture Contacts, les sélecteurs et regroupements utilisent des étiquettes neutres. Configuration, options, détails, compteurs et exports ne contiennent que les sources autorisées. Charges sans source affiche un état vide, pas un total présenté comme complet.

Les exports insuffisamment autorisés sont explicitement refusés ; l’utilisateur peut réduire le filtre Source. Aucun contournement `service_role`, clé d’invitation ou appel de document externe dans la page. Les tests de création d’identités utilisent exclusivement l’administration Auth du banc fictif.

Les fonctions communes `module_allowed`, `validate_grants` et `full_access` évoluent dans la nouvelle migration. Charges est exclu des prérequis de l’ancien accès OAR complet. Publisher reste indépendant ; son niveau, ses actions sensibles et ses garde-fous sont conservés. L’administration existante sait attribuer explicitement Charges, sans source implicite. Aucun compte réel n’a été modifié.

## Sauvegarde et réponses différées

Les opérations réutilisent `useScopedOperations` : JWT de l’acteur capturé, vérification des permissions avant/après RPC, annulation au changement de compte et contrôle avant téléchargement. Aucun succès avant confirmation serveur ; double clic borné et même identifiant pour un nouvel envoi strictement identique.

Sur erreur, refus ou conflit, la saisie reste en mémoire pour le même compte. « Actualiser les données », puis « Reprendre ma saisie sur la version actualisée » effectuent une reprise explicite, sans écrasement automatique. La reprise transmet uniquement les intentions modifiées et garde les changements des autres contributeurs. Les brouillons sont refiltrés au changement de périmètre et effacés lors d’un changement d’identité. Une ancienne réponse d’export ne peut pas remplacer le résultat d’une sauvegarde plus récente.

Les paramètres confirmés persistent après rechargement. Le brouillon non confirmé reste en mémoire dans l’onglet : il ne survit pas à sa fermeture/rechargement. La navigation avertit en cas de saisie ; annuler cette navigation la conserve. Aucune persistance de données métier en localStorage n’a été ajoutée.

## Validation sur le code livré

Les résultats privés se trouvent dans le répertoire du banc : `server-results.json`, `browser-results.json`, `resilience-browser-results.json`, `build.private.log` et `app.private.json`. Le manifest d’application contient les empreintes des fichiers produits pour vérifier que la démonstration correspond au code du dépôt.

| Vérification | Résultat |
| --- | --- |
| Calculs/CSV Charges + helpers monétaires, heures et finance source affectés | 68 tests réussis, dont 15 cas Charges ; pas de double comptage des mêmes tests |
| Vrais Auth/JWT → PostgREST → RPC locaux | 16 vérifications réussies |
| Parcours Chromium/WebKit, 1440/390/430 px et profils | 15 scénarios réussis |
| Réponses perdues/tardives, double clic, compte et révocation | 4 scénarios réussis |
| TypeScript complet | Réussi |
| ESLint complet | Zéro erreur ; deux avertissements historiques conservés |
| Build Next avec webpack, copie isolée sans `.env` | Réussi, route `/charges` présente |
| Conseiller de sécurité Supabase local | « No issues found » |
| Diff-check du lot, y compris fichiers nouveaux | Réussi |

Les 16 contrôles serveur couvrent refus directs anon/sans Charges, intersections des profils, absence de données privées, auteur et persistance, patches limités conservant les règles cachées, refus des mutations métier, conflits et réémissions idempotentes, validation des mois/répartitions, exports, sources supprimées, correction de montant, archive, révocation de droits et session Auth terminée. Ils vérifient également l’administration commune, l’ancien accès OAR complet et la frontière Publisher, sans campagne indépendante.

Les tests navigateur utilisent de vraies connexions locales ; seule la transmission est retardée/coupée pour les scénarios de panne. Ils vérifient les totaux affichés et exportés, la conservation/reprise de saisie, le rechargement, les deux liens vers les sources, le menu Plus **ouvert**, les dialogues et l’absence de débordement global. Les accès Charges, y compris propriétaire, ne demandent jamais `crm_workspace_state` au navigateur. Ouvrir la source ensuite utilise son parcours autorisé existant.

Les sources fictives sont comparées intégralement avant/après les sauvegardes Charges, puis restaurées après les essais explicites de correction/suppression de fixture. Aucun original réel n’est lu ou exporté. Il s’agit de preuve locale authentifiée et de navigateurs mobiles émulés, pas de preuve de Production ni d’un iPhone physique.

Les deux avertissements historiques : navigation `window.location.assign` dans AccessPortal, balise `<img>` dans CRMApp. Le diff-check général retrouve une espace finale déjà présente dans `docs/publisher/integration.diff` ; ce document préexistant est conservé. Le lot Charges et son patch complet passent leur propre contrôle.

### Commandes exactes

Depuis le projet, avec la pile retenue :

```sh
export MONTHLY_CHARGES_STATUS_FILE=/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/monthly-charges-stack-QMQVe4/local-status.json
export IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY
export PLAYWRIGHT_BROWSERS_PATH=/private/tmp/monthly-charges-browsers

node --import /Users/vg/.npm/_npx/67eb4586ca667318/node_modules/tsx/dist/loader.mjs --test tests/monthly-charges/calculations.test.ts tests/currency.test.ts tests/houseTracking.test.ts tests/vendorFinance.test.ts
node_modules/.bin/tsc --outDir /private/tmp/oar-monthly-charges-unit --noEmit false --incremental false --module commonjs --target es2022 --esModuleInterop --skipLibCheck tests/monthly-charges/calculations.test.ts
node tests/monthly-charges/server-tests.mjs
node tests/monthly-charges/browser.mjs
node tests/monthly-charges/resilience.browser.mjs
node_modules/.bin/tsc --noEmit --incremental false --pretty false
node_modules/.bin/eslint .
git diff --check -- components/AccessPortal.tsx components/CRMApp.tsx components/ModuleWorkspace.tsx lib/access/modules.ts
node tests/monthly-charges/write-diff.mjs
git apply --numstat docs/monthly-charges/integration.diff
git apply --check --reverse docs/monthly-charges/integration.diff
```

Les scénarios serveur/navigateur sont exécutés **séquentiellement** ; ne pas les lancer en parallèle sur cette configuration partagée. Les modules Playwright et calculs compilés peuvent être indiqués par `PLAYWRIGHT_MODULE` et `MONTHLY_CALCULATIONS_MODULE`.

Pour relancer la seule application après avoir arrêté son lanceur actuel :

```sh
MONTHLY_CHARGES_TEST_ACK=MONTHLY_CHARGES_LOCAL_ONLY node tests/monthly-charges/serve.mjs
```

Le lanceur copie `app`, `components`, `lib`, `public` et la configuration de compilation dans le même répertoire privé, sans `.env`. Il exécute `next build --webpack`, puis `next start --hostname 127.0.0.1 --port 3183`, avec garde réseau loopback et uniquement la clé publique Auth locale. Aucun paramètre SMTP/Drive/Publisher payant n’est transmis.

La pile a été créée une fois par `server-stack.mjs`, puis préparée par `server-prepare.mjs`, avec le CLI Supabase existant 2.117.0 et Colima. Le démarrage d’une pile neuve est explicitement borné ; le script de préparation refuse de rejouer la baseline dans une démonstration existante. Ne pas supprimer les volumes ni purger les profils d’autres campagnes. Le cache WebKit installé précédemment était incomplet ; le seul navigateur de test WebKit 26.5 a été téléchargé gratuitement dans `/private/tmp/monthly-charges-browsers`, sans modification des dépendances du projet.

## Captures vérifiées

[Bureau 1440 px](captures/bureau-1440.png), [mois mobile 390 px](captures/mois-mobile-390.png), [Plus ouvert 390 px](captures/plus-ouvert-390.png), [répartition mobile 430 px](captures/repartition-mobile-430.png).
Les captures présentent uniquement des fixtures fictives.

## Préservation et diff

[Diff complet du lot](integration.diff), incluant les nouveaux fichiers, migration SQL, tests, présent rapport et captures binaires. Il exclut sa propre copie et les deux changements Publisher préexistants ; aucun staging n’est effectué. Le fichier est contrôlable avec `git apply --numstat` et le contrôle inverse sur le worktree livré.

Les fichiers préexistants `docs/publisher/REVIEW.md` et `docs/publisher/integration.diff` conservent exactement leurs empreintes initiales. Les 32 empreintes de contrôle (Publisher, ces deux documents, dépendances et WIF lorsqu’il est présent) sont identiques. Les historiques et données réelles restent inchangés. Les anciennes migrations n’ont pas été modifiées. `GOOGLE_DRIVE_WIF_SETUP.local.md` reste inchangé, non suivi et exclu du patch.

Aucun commit, staging, push, déploiement, migration distante, variable Vercel, attribution réelle, invitation réelle, SMTP, téléchargement Drive/Storage réel, export Production ni appel payant. Aucun fichier moteur/configuration Publisher, WAF legacy, modèle, clé, historique, SMTP, WIF, Drive ou IZORD n’est modifié. Les seules protections communes touchées sont testées localement dans leur périmètre affecté.

Limites : actualisation explicite, aucune promesse temps réel ; totaux des seules charges enregistrées et sélectionnées ; aucune charge manuelle, banque, cotisation, TVA, paie, budget ou comptabilité complète. Les tests n’attestent ni l’état opérationnel distant à cet instant ni les droits authentifiés de comptes réels. Aucun compte réel n’est sélectionné ni préparé implicitement.

## Plan de publication et retour arrière — non exécuté

1. Après autorisation distincte, revoir ce patch et identifier le propriétaire réel avec une identité Auth vérifiée. Préparer une sauvegarde privée des données/configurations utiles et les empreintes de préservation. Maintenir WIF exclu ; conserver les modifications Publisher préexistantes hors du lot Charges.
2. Autoriser puis effectuer le commit des seuls chemins du lot validé, sans `git add .`/`-A`, et vérifier diff indexé, HEAD/origin/main/GitHub. Exécuter les contrôles sur le SHA exact dans un checkout propre. Aucun déploiement n’est réalisé dans cette livraison.
3. Préparer un candidat Vercel exact-SHA, vérifier `READY`, provenance et aliases selon la procédure existante. Appliquer **uniquement** la nouvelle migration additive au projet CRM convenu après validation de la sauvegarde. Vérifier l’absence de modification des sources et de toute perte d’accès OAR/Publisher.
4. Attribuer explicitement `monthlyCharges` au seul propriétaire vérifié dans Administration, avec Export selon décision. Respecter les grants existants des sources ; la migration n’attribue aucun droit. La configuration réelle reste vide jusqu’à la sélection volontaire des dépenses.
5. Vérifier en session réelle privée les refus et intersections, sélection/sauvegarde/rechargement/export et parcours source, puis tester un vrai téléphone. Promouvoir uniquement après ces critères et rendre un rapport bref SHA/déploiement/READY/migration/préservation/état Git.
6. En cas d’échec, revenir à l’application publiée précédente selon autorisation. Conserver les tables privées et les paramètres enregistrés ; ne supprimer ni source ni historique. Retirer/suspendre les droits Charges si cette action est autorisée. L’ancienne application conserve ses prérequis OAR ; aucune migration destructive inverse n’est nécessaire pour préserver les données.

Arrêt à cette livraison locale. La décision de publication appartient au propriétaire.
