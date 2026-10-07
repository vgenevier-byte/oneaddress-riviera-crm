# Recherche du Contact lié par entreprise

Base publiée vérifiée : `b33ec9841d111727f48ace0f3c06ec2830da4b13`, déploiement `dpl_8AytJ7LfQPvnDWRh2iAtZDPbMDvv` READY. Copie isolée ; HEAD, index et les 107 fichiers locaux préexistants du checkout principal sont préservés.

La recherche compare désormais simultanément prénom, nom et entreprise enregistrée. Les mots partiels peuvent correspondre à plusieurs champs, dans n'importe quel ordre. Normalisation Unicode, accents, casse et espaces restent inchangés. Le placeholder devient « Rechercher par prénom, nom ou entreprise… ».

Le composant existant est conservé : une personne affiche Prénom Nom avec sa société en complément ; une fiche société seule affiche son intitulé une seule fois, y compris avec des espaces périphériques. Les contacts distincts d'une même entreprise restent distincts et sélectionnables. Seule une répétition du même `contactId` est supprimée des options, en gardant la première occurrence autorisée, sans fusionner de fiches.

Deux fichiers produit seulement changent : `lib/tasks/contactOptions.ts` et `components/TaskContactPicker.tsx`. Les parcours CRMApp/ModuleWorkspace restent identiques : ils utilisent `companyName` uniquement s'il est présent dans la projection Contacts autorisée, avec leur contrôle du droit Contacts. Aucun payload global supplémentaire, aucune extension SQL, aucune nouvelle dépendance, création de compte, contact, invitation ou droit.

La sélection reste unique et explicite par ID, locale jusqu'à confirmation serveur. Saisie seule, résultat unique, retrait/remplacement, lien non consultable, brouillons, erreurs, conflits, réponses tardives et révocations gardent leurs règles existantes. TasksWorkspace, Responsables, Lead lié, recherche générale, historique, Administration, routes serveur et migrations restent identiques à la base publiée. Les autres correctifs sont préservés ; Contacts → Drive reste exclu.

Validation finale : **10/10 tests helper**, dont les sept tests prénom/nom préexistants ; **10/10 groupes navigateur**, dans 13 sessions fictives Chromium 1440, Chromium tactile 390 et WebKit tactile 390. Les recherches entreprise et combinées, deux interlocuteurs de la même entreprise, doublon d'ID, accents/Unicode, société seule, entreprise absente, projections limitées, sélection/enregistrement/rechargement/édition simulés sont couverts, ainsi que les neuf groupes UI précédents. TypeScript, lint ciblé (zéro erreur/avertissement), build complet et diff-check réussis.

Le banc importe les composants réels avec empreintes de sources vérifiées. HTTP et confirmations sont simulés en mémoire : zéro Auth, RPC, SQL, base de données, écriture métier réelle ou appel externe. Aucune erreur navigateur inattendue. Mobile émulé, pas de téléphone physique ; aucun essai authentifié en Production revendiqué. Les contrôles Production portent sur SHA, READY/promotion, pages et bundles des deux domaines, protections et configuration.

Preuves : `UI-PROOF.md`, `VALIDATION.json`, `ui-source-manifest.json`, `ui-browser-results.json`, captures et `diff.patch`. Publication ciblée sans sauvegarde globale ni maintenance des saisies.
