# Foncière : projets immobiliers et présentations

Le lot ajoute `/fonciere` (fiches immobilières) et regroupe la navigation sous **Foncière → Projets / Présentations Projets**. L’identifiant technique et la route des présentations restent `izord` et `/izord` ; `/?module=izord` fonctionne toujours. La marque des présentations reste IZORD.

## Stockage et droits

Les fiches immobilières (`fonciere_projects`) sont distinctes des dossiers de présentation et de leurs versions (`izord_projects`, `izord_project_versions`). Les présentations conservent leur instantané, leurs fichiers propres et une relation canonique par version dans `fonciere_presentation_sources`. Modifier ou archiver une fiche ne réécrit pas une présentation. L’actualisation est explicite et confirmée.

Les droits Foncière réutilisent le module IZORD : administrateurs/associés, contributeurs propriétaires ou affectés, lecteurs affectés. Aucune ancienne affectation de présentation n’est étendue automatiquement. Les contacts utilisent la projection et la mutation CRM autorisées ; le lien est une véritable identité CRM, dans une relation protégée distincte. Les rapprochements et doublons proposés ne fusionnent rien.

Les originaux et les photos sont privés dans `fonciere-documents`, avec contrôles RLS, chemins par projet, admission, contrôle des octets/MIME reçus et finalisation immuable. Les mises à jour des fiches utilisent une révision attendue. Une sauvegarde interrompue conserve l’identité déjà créée pour permettre une reprise sans créer une seconde fiche. Les migrations sont additives et ne modifient ni les données ni les appartenances existantes.

## Extraction

L’import accepte PDF, JPEG, PNG et WebP, 25 Mo par fichier. Les propositions restent modifiables avant enregistrement ; un réimport laisse les corrections existantes décochées par défaut. Les champs manquants ne deviennent pas des faits. L’adresse du bien reste séparée de celle de l’agence ; le potentiel annoncé, les hypothèses personnelles et les montants financiers restent distincts.

Le lecteur historique est réutilisé, complété par PDF.js et Tesseract FR/EN. Les fichiers du moteur sont servis par l’application et préparés par `scripts/prepare-agency-assets.mjs` pendant l’installation/build. Les documents ne sont pas envoyés à un fournisseur OCR. Les fichiers générés du moteur (environ 22 Mo) ne sont pas versionnés.

L’OCR est imparfait et limité à 12 pages scannées par fiche (120 pages maximum pour la lecture PDF). Les visuels des scans sont des pages complètes, à recadrer/compléter manuellement. Une extraction partielle conserve les éléments récupérés, le document original et un avertissement. Les valeurs issues de l’OCR doivent être relues ; la référence de la fixture a notamment subi une confusion entre `0` et `O` pendant les essais.

## Vérifications et reproduction

Tous les essais d’écriture utilisent uniquement des données fictives et une pile Supabase locale dédiée sur `127.0.0.1:55931` (Auth/REST/Storage), `55932` (PostgreSQL), `55934` (mail local) et le CRM sur `3159`. Les outils n’utilisent pas le fichier `.env.local` du dépôt ni les secrets de Production. Le banc crée les tables métier minimales puis applique les migrations réelles et exerce les RPC, les JWT et les fichiers réels du Storage local.

Les fixtures privées de connexion restent hors Git ; ne pas publier `local-status.json`, `local-fixture.private.json` ou les traces contenant des sessions.

Tests :

- `tests/fonciere/model.test.ts` : validation, instantanés, hypothèses, provenance et aller-retour présentation/fiche.
- `tests/fonciere/agency.test.ts` : extraction, séparation des adresses et propositions de réimport.
- `tests/fonciere/live-local.mjs` : Auth, persistance, Contacts, RLS, conflits, documents, archivage.
- `tests/fonciere/storage-boundaries.mjs` : signatures et originaux, reprise après erreur, concurrence, sources de présentation, affectations et refus.
- `tests/fonciere/agency.browser.mjs` : vrais PDF/OCR/PPTX locaux ; inclut une panne de fichier OCR explicitement simulée.
- `tests/fonciere/workflow.browser.mjs` : parcours du CRM dans Chromium avec les services locaux réels ; vues desktop/mobile FR/EN et captures.

Les chemins des exécutables locaux et des fixtures se configurent dans les runners. Un test historique de parité avec le HTML original n’a pas pu être lancé : le fichier externe `IZORD_Invest_Fiche_Projet_Locations_v3 (1).html` est absent de cette machine. Il n’est pas remplacé par une fixture présentée comme l’original.

Les preuves locales ne constituent pas une connexion authentifiée ni une création/export en Production. Le contrôle de livraison en Production vérifie séparément le commit, les migrations, l’état du déploiement, l’alias et les ressources servies, sans créer de données fictives dans la base réelle.

## Résultats du lot du 23 octobre 2026

32 tests unitaires ciblés, 24 groupes serveur réels locaux, 19 groupes navigateur CRM et 6 groupes extraction/OCR/export sont passés. TypeScript et build passent ; lint comporte zéro erreur et deux avertissements préexistants. Les captures utilisent des données fictives et sont dans `screenshots/`. Les résultats détaillés sont conservés dans le répertoire temporaire de livraison, séparés des fixtures privées.
