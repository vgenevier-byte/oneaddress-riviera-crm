# Ordre des options du CRM

Base vérifiée : `81e8070969b3ba42e7ffd99595ddcbd5bceeb805` sur `origin/main` le 23 octobre 2026. Les travaux du checkout principal restent isolés.

`lib/selectOptions.ts` trie une copie par le libellé effectivement affiché avec `Intl.Collator(langue, { sensitivity: "base", numeric: true })`. Les équivalences d'accents/casse conservent l'ordre source. Les identifiants, objets, traductions et valeurs ne sont ni normalisés ni réécrits. Les fonctions `first` / `last` déclarent le rôle particulier de chaque option ; aucun rôle n'est déduit d'un identifiant `other`.

Le tri intervient uniquement dans les menus et datalists. Les cartes, boutons de filtre, navigation, listes de fiches, groupes de cases à cocher et valeurs métier sources conservent leur présentation. Les options vides/tous rendues avant la portion triée sont des choix de tête explicites. Les valeurs/defaults contrôlés ou déclarés par `defaultValue` restent résolus avant le tri.

## Inventaire des vues principales

| Vue / champ ou famille | Règle explicite | Options particulières |
| --- | --- | --- |
| Contacts, création/modification/filtre : professions | Alphabétique, libellé FR/EN visible | Vide / Toutes en tête, `Autre` complément en fin. Toutes les professions historiques/personnalisées de la projection autorisée sont conservées à l'identique, y compris les anciennes catégories. |
| Contacts : type de relation (client/propriétaire/prestataire/membre), identité personne/entreprise, civilité | Alphabétique sur la traduction visible | Identité historique non qualifiée / civilité vide en tête ; le type sélectionné n'est pas changé. |
| Contacts : langue préférée | Alphabétique sur la traduction visible | `Autre` complément en fin ; défaut explicite Français conservé. |
| Contacts : relation prospect/actif/dormant, niveau client, fiabilité/qualité/statut prestataire | Progression métier ou échelle | Aucun réordonnancement. |
| Prestataires historiques : métier du formulaire | Alphabétique sur libellé visible, valeurs historiques incluses | `Autre` complément en fin ; défaut explicitement `Autre` conservé ; boutons de filtre inchangés. |
| Devis client : clients, Réservations : prestataire affecté | Alphabétique sur nom/libellé affiché | Datalist de clients inchangée fonctionnellement ; choix vide de prestataire en tête. |
| Suivi maison : maison en filtre/saisie/paiement ; intervenant en saisie/paiement ; réutilisation contact | Alphabétique sur nom/libellé affiché | Vide / Tous en tête ; premier intervenant et première maison par défaut issus des listes originales. Boutons et tableaux inchangés. |
| Suivi maison : mode de paiement | Alphabétique sur libellé traduit | `Autre` complément en fin ; défaut Virement conservé. |
| Planning : catégorie, type d'entrée, actif en filtre/formulaire, contact en datalist | Alphabétique sur libellé traduit/complet affiché | Tous/vide en tête ; `Autre` type complément en fin ; catégorie et type par défaut d'origine conservés. |
| Demandes : catégorie, actif, contacts de création/modification | Alphabétique sur libellé réellement affiché | Toutes/vide en tête ; contact historique intégré au tri sans rapprochement d'identités. Le libellé d'actif existant est conservé. |
| Tous les statuts : devis, paiements, réservations, documents, planning, demandes, biens/véhicules/bateaux | Progression métier | Aucun réordonnancement ; filtres Tous en tête. |
| Priorités, qualité, fiabilité, niveaux client, notes/échelles | Progression métier ou numérique | Aucun réordonnancement. |
| Heures, mois, périodes, durées, dates | Chronologique ou numérique | Aucun réordonnancement. |
| Choix oui/non, blocage de disponibilité, vues mois/semaine | Progression métier | Aucun réordonnancement. |
| Recherche Contacts, suggestions proches ; prestataires classés par score ; adresses IGN | Pertinence | Classement existant conservé ; seules les listes de choix non classées par pertinence sont alphabétiques. |
| `ModuleWorkspace` | Réutilisation des mêmes vues métier | Aucune seconde liste de métiers : `ContactsView` reçoit seulement la projection Contacts autorisée ; formulaires Foncière identiques. Aucune extension des accès. |
| Responsable du shell desktop | Alphabétique dégénéré (une seule personne : Vincent) | Vide en tête ; aucun changement de présentation nécessaire. |

Compléments de l'inventaire : [autres vues CRM](secondary.md), [Foncière et IZORD](../select-order-fonciere-izord.md), [composants de recherche](pickers.md).

Les fichiers `CRMApp.tsx.before-*` sont des sauvegardes historiques non importées : aucune modification. Les pays/champs de marques et modèles saisis en texte libre restent des champs texte. Les équipements guidés rendus en cases à cocher restent dans leur ordre actuel.

## Portée des vérifications

Les tests navigateur utilisent les composants actuels avec des données fictives et des transports locaux interceptés. Ils vérifient l'interface, l'identité de sélection et la réutilisation des parcours complets/limités. Ils ne constituent pas une preuve d'Auth, de RPC, de base de données ou de session CRM authentifiée en production, ni un essai sur appareil physique. Les validations de publication et d'assets publics sont consignées dans le rapport de livraison.
