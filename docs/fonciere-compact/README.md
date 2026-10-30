# Foncière — saisie et analyse compactes

Version de départ : `efc22dcdedad0e7a8cca24f2095fb3e20b1af448`. Travail effectué dans une copie isolée ; le checkout principal et ses modifications étrangères sont préservés.

La liste utilise les projets autorisés déjà chargés, en lignes responsives (référence, nom/ville, type, prix, visite, décision, surface sur grand écran). Recherche approximative, pertinence, numérotation à recherche vide et filtres conservés.

Les huit rubriques restent montées et repliables. Les compléments sont visibles sous forme de synthèses et s’ouvrent individuellement. Les erreurs ouvrent la rubrique et les détails concernés avant le focus. Les descriptions longues restent intégrales et la saisie d’une description vide conserve son focus dès le premier caractère. Les anciens choix « Autre » et « Sans objet » restent modifiables sans être proposés pour de nouvelles réponses en 04.

La date de visite civile et la réponse explicite aux diagnostics sont facultatives et indépendantes des imports, des anciens diagnostics et du calendrier. Validation client/serveur, création, modification, effacement, relecture, brouillons et retour Contacts vérifiés. Les précisions par contrainte sont indépendantes ; les anciennes précisions globales restent conservées. Les présentations conservent les contraintes publiques mais excluent la date de visite, la réponse interne aux diagnostics et le contexte privé propriétaires/négociation.

Les zones Plans et Documents attribuent automatiquement `plans` et `other`, vers les dossiers existants `02 - Plans` et `04 - Autres documents`. Glisser-déposer, sélection, sauvegarde groupée, restauration du brouillon et retour Contacts conservent chaque association. Les fichiers sélectionnés sont annoncés « À enregistrer », jamais comme déjà copiés sur Drive. Photos et import agence restent distincts.

## Réduction mesurée

Chromium desktop 1440 × 1000, mêmes fiches fictives, rubriques 02–05 ouvertes et détails facultatifs initialement fermés. Le comptage exclut les contrôles cachés, inertes et contenus dans des détails fermés. La hauteur est la somme des quatre rubriques, en pixels CSS.

| Fiche | Contrôles avant → après | Hauteur avant → après |
| --- | --- | --- |
| Vide, type villa | 157 → 23 (−85 %) | 9 254 → 2 810 px (−70 %) |
| Riche, valeurs historiques | 192 → 25 (−87 %) | 12 249 → 3 735 px (−70 %) |

[Liste desktop](verification/screenshots/liste-lignes-desktop.png) · [Liste mobile](verification/screenshots/liste-lignes-mobile.png) · [Date et chargements 07](verification/screenshots/01-date-07-uploads.png)

[Fiche riche avant](verification/screenshots/02-05-rich-before.png) · [Après](verification/screenshots/02-05-rich-after.png) · [Fiche vide avant](verification/screenshots/02-05-empty-before.png) · [Après](verification/screenshots/02-05-empty-after.png) · [02–05 mobile](verification/screenshots/02-05-mobile.png)

## Vérifications

- TypeScript, lint (aucune erreur ; deux avertissements préexistants (navigation et `<img>`)), build de production et `git diff --check`.
- 105 tests de domaine (existants et nouveaux), 41 tests Drive simulés.
- 5 scénarios serveur dédiés sur Auth/PostgreSQL/PostgREST/Storage réels locaux : dates, rejets, anciennes fiches riches, anciens clients, deux fichiers et catégories.
- Suites existantes d’arbitrage, propriétaires et présentations ; exports JSON/PPTX réellement téléchargés et inspectés, y compris notes PowerPoint et métadonnées privées.
- 12 scénarios navigateur : fiche vide/riche, lecture sans écriture, choix historiques, contraintes individuelles, modification isolée, erreurs masquées, diagnostics, types de biens, saisie longue, création/annulation Contacts, restauration de brouillon avec deux fichiers, liste/clavier/mobile et archivage. Aucun appel externe et aucune erreur navigateur.
- Migration finale rejouée intégralement dans une transaction locale annulée : projets, avis, historiques, file Drive et politiques inchangés ; fonctions privées sans droit d’exécution public. Les champs absents des anciens clients sont conservés ; une valeur vide explicite permet l’effacement.

**Drive :** uploads Storage et mises en file réels dans la base jetable ; destinations et reprises du worker vérifiées par les tests simulés existants. Aucune copie Google Drive réelle, aucun OCR/IA et aucune donnée métier de production créés par les tests.

Les preuves assainies sont dans `verification/`. Les clés, sessions, fichiers privés de fixture et exports intermédiaires restent hors Git.

Pour reproduire, suivre le lanceur jetable de `tests/fonciere-arbitrage/README.md`, préparer la fixture puis exécuter `tests/fonciere-compact/server.mjs`. La campagne navigateur emploie `COLLAPSE_FIXTURE` et `COLLAPSE_OUTPUT`. La mesure initiale utilise la version de départ sur le port 3198 avec `COMPACT_MEASURE=1` et `COLLAPSE_APP=http://127.0.0.1:3198`. `migration.mjs` répète la migration dans une transaction annulée sur la base locale uniquement.
