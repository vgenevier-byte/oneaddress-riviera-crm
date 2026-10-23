# Recherche d’adresse partagée

Livraison du 23 octobre 2026, basée sur `main` e22b9e1 dans un checkout isolé. Le checkout historique et ses modifications locales sont préservés.

## Fournisseur et couverture

Aucune clé Google Maps/Places n’était configurée dans le code, les noms des variables locales ou les 33 variables Vercel inspectées sans déchiffrement. Le fournisseur actif est la Géoplateforme IGN : autocomplétion `data.geopf.fr/geocodage/completion/`, puis géocodage structuré `data.geopf.fr/geocodage/search` uniquement après sélection explicite. Les suggestions couvrent la France, sans filtre Cannes. La ville connue ordonne les suggestions sans restreindre la recherche.

Monaco, Luxembourg et les autres pays restent en saisie manuelle. Aucun compte ni facturation n’est ajouté. Étendre la recherche internationale exige ultérieurement un fournisseur configuré et autorisé ; aucune configuration ne manque pour le périmètre français livré.

Références : [autocomplétion IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/autocompletion/), [géocodage IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/), [URLs Google Maps](https://developers.google.com/maps/documentation/urls/get-started).

## Formulaires intégrés

| Parcours | Intégration |
| --- | --- |
| Contacts particuliers, entreprises, agences, prestataires et membres | Création et modification, accès complet ou limité ; détail avec copie et Google Maps |
| Raccourci contact express | Ouvre le formulaire Contacts partagé et conserve les règles de navigation/brouillon |
| Foncière, bien | Recherche et remplissage indépendant de rue, code postal, ville, pays et précision/coordonnées |
| Foncière, agence et correction d’import | Bloc autonome, adresse extraite conservée jusqu’à action explicite |
| Foncière, création rapide de personne/entreprise | Composant partagé, écriture Contacts autorisée, métadonnées conservées |
| Suivi maison | Création/modification de maison, reprise explicite d’une adresse de contact autorisé, Maps |
| Présentations Projets / IZORD | Adresse du projet, correction PDF, reprise du projet sauvegardé sans nouveau géocodage |

Les champs de ville seuls, ports, lieux de rendez-vous, zones et instructions d’accès restent libres. Les imports textuels/CSV en lot restent textuels ; aucun géocodage de masse. Les contacts liés ne sont jamais modifiés par la reprise dans une maison ou un projet.

## Sauvegarde et robustesse

Le texte historique reste compatible avec les modèles existants. Les métadonnées optionnelles conservent numéro/suffixe, voie, ligne principale, complément, code postal texte, ville, pays/code, adresse formatée, précision, source/identifiant et coordonnées cohérentes. Aucune adresse libre n’est découpée sur les virgules. Une rue ou commune ne devient pas une adresse exacte au numéro.

Le délai de frappe est de 350 ms. Les recherches et résolutions obsolètes sont annulées et ignorées, y compris lorsque le fournisseur ignore l’annulation. Chaque champ est indépendant. Erreur, délai dépassé, absence de résultat et pays non couvert conservent le brouillon et la possibilité de sauvegarder manuellement. Le pays et les compléments explicites survivent à la frappe/relecture. Remplacer une adresse existante demande confirmation ; les corrections de la base d’adresse invalident les anciennes coordonnées/références. Google Maps utilise l’adresse actuelle ou des coordonnées encore cohérentes.

La migration additive `20261023105820_address_autocomplete_metadata.sql` ajoute les objets optionnels aux collections autorisées, les valide/projette côté serveur, et réconcilie les écritures courantes des anciens clients. Elle ne change pas les politiques, adhésions, droits ni les données/instantanés existants. Les instantanés des nouvelles versions conservent leurs métadonnées. Aucune dépendance applicative ajoutée.

## Vérification effectuée

- 95 tests ciblés : modèle/fournisseur d’adresse, Contacts, Foncière, présentations, autorisations, suivi maison et finances.
- Chrome réel : clavier, FR/EN, desktop/mobile, remise à zéro après sauvegarde, requêtes dans le désordre, résolution obsolète, champs simultanés, fermeture pendant recherche, absence de résultat et HTTP 503 simulés.
- Banc Supabase local réel avec comptes fictifs : Auth, RPC, sauvegarde/rechargement/export, accès complet/contribution/lecture/refus/anonyme, validation des objets et coordonnées, reprise indépendante, conservation des historiques financiers et instantanés.
- Appels IGN réels depuis Chrome : suggestions et résolution sélectionnée en HTTP 200 avec CORS ; distincts des simulations et de la Production CRM.
- Rejeu exact de la migration sur une seconde base jetable ; comparaison des données, politiques, droits et instantanés avant/après.
- TypeScript et build Next.js réussis ; lint sans erreur, avec deux avertissements préexistants (`window.location.assign` et image HTML) ; `git diff --check` réussi.
- Production : migration appliquée, trois déclencheurs présents ; empreintes des données/droits/politiques/instantanés inchangées ; 33 variables Vercel inchangées ; aucune nouvelle alerte de sécurité. Aucun parcours authentifié CRM de Production n’est revendiqué.

Tests reproductibles : `tests/address.test.ts`, `tests/fonciere/address.test.ts`, `tests/address/component.browser.mjs`, `tests/address/browser.mjs`, `tests/address/fonciere.browser.cjs`, `tests/address/persistence.mjs`, `tests/address/migration-replay.mjs`. Les scripts d’intégration exigent des fichiers privés de comptes fictifs et refusent les cibles distantes ; aucune donnée d’authentification n’est commise.

Les résultats et captures de cette exécution sont conservés dans `/private/tmp/oar-address-delivery` et `/private/tmp/oar-address-evidence`. Le SHA et le déploiement sont consignés séparément dans le manifeste de livraison pour éviter une référence circulaire au commit.
