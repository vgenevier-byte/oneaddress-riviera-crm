# Relations entre tâches et éléments CRM

Une tâche conserve son identité et son stockage privé canonique. Les liens sont des références typées avec un principal facultatif et des compléments. Les changements sont des opérations explicites sur des identifiants de relations ; une projection partiellement masquée ne remplace jamais la liste complète.

## Inventaire livré

| Type | Identité et contexte réels | Destination |
|---|---|---|
| contact | contacts.id, personne/entreprise/prestataire | Fiche Contact |
| lead | leads.id, linkedTo reste son alias historique | Demande exacte |
| quote / booking | quotes.id ; réservation = devis accepté | Devis ou réservation |
| vendor_quote / vendor_invoice | vendorQuotes.id / vendorInvoices.id | Carte exacte, échéance et solde existants |
| bank_account | compte bancaire.id + contactId | Compte précis dans Contacts, indépendant du principal |
| worker / worker_period | worker.id ; début/fin civils, maison facultative | Personnel / Heures filtrées, même sans ligne |
| time_entry / staff_payment | houseTimeEntries.id / housePayments.id | Intervention + frais / paiement enregistré |
| house | houseTrackingHouses.id | Maison suivie |
| property / vehicle / boat | identifiants des collections existantes | Fiche exacte |
| planning_entry | planningEntries.id | Élément planning / intervention |
| fonciere_project | fonciere_projects.id | Projet indépendant |
| presentation | izord_projects.id, révision facultative | Présentation ; révision historique en lecture seule |
| document | resource_id + provider ou asset.id + catalogue + projectId | Carte exacte, protections du catalogue conservées |
| folder | dossier workspace.id ou Drive registry folder.id | Dossier exact, accès complet requis par le catalogue existant |
| monthly_charges | mois civil + source + personne/maison facultatives | Vue calculée filtrée, aucun faux enregistrement |
| publisher_creation | publisher_posts.id (Neon) | Création enregistrée exacte |

Les relations et leur identité sont dans app_private.task_links. L'écriture des tâches et des relations utilise la même transaction crm_tasks_mutate, ses révisions, verrous, journal et requêtes idempotentes. Les anciens contacts/demandes sont repris additivement ; les futures récupérations historiques produisent également les relations correspondantes. Aucun contenu de tâche n'entre dans les sauvegardes JSON du workspace.

## Permissions

La visibilité de la tâche et la lecture de la cible sont contrôlées séparément. Le serveur résout les métadonnées avec les droits du lecteur. Un élément inaccessible est neutre (pas de référence, ancien libellé, montant ni coordonnées). La recherche et les listes inverses utilisent les mêmes contrôles. Les exports neutralisent les cibles dont l'export n'est pas autorisé ; documents et banques gardent leurs protections.

Publisher conserve Neon comme stockage. Le pont serveur vérifie Auth et le module, lit uniquement les créations enregistrées, puis atteste l'existence d'un identifiant pour l'acteur avant un nouvel ajout. Les preuves privées expirent pour les ajouts et ne conservent aucun titre/caption. Les libellés sont relus dans Neon. Ce pont ne génère ni ne publie aucun contenu.

## Utilisation

- Facture : ouvrir Tâches liées → Créer une tâche ; modifier le titre et l'échéance, ajouter éventuellement un prestataire ou un RIB précis. Le reste à payer utilise les calculs financiers existants.
- Heures : choisir l'intervenant et la période, puis créer une tâche de vérification ou de complément. La période et l'échéance restent distinctes.
- Projet : créer la tâche depuis le projet tout en conservant son brouillon ; la présentation et ses révisions sont des cibles distinctes.
- Depuis Tâches : Lier un élément du CRM, rechercher puis sélectionner un identifiant ; définir le principal et les compléments.

La création et l'édition de tâche ne démontent pas le formulaire source. Depuis un éditeur de tâche, l'ouverture d'un élément utilise un nouvel onglet pour conserver la saisie. Depuis le détail, la navigation commune prend en charge Retour et les vues complètes/restreintes. Les destinations rechargent leur propre projection autorisée.

## Validation et limites de preuve

Les comptes, données, montants et créations des captures sont fictifs. Les essais utilisent de vrais Auth, HTTP RPC, PostgreSQL et composants métier sur le banc local isolé. Pour Publisher, le transport PostgreSQL local remplace Neon distant ; aucun service de génération ni Instagram n'est appelé. Aucune preuve de workflow métier authentifié en Production n'est revendiquée.

Les droits des dossiers suivent le catalogue actuel (accès complet). Les éléments non enregistrés demandent l'enregistrement préalable pour obtenir un identifiant confirmé. L'état Terminé ne déclenche aucune opération métier.

Les résultats détaillés, captures et informations de publication sont conservés dans ce dossier ; les fichiers de session et clés du banc restent hors Git.

Résultats finaux : 81 tests TypeScript ciblés, 21 scénarios serveur canonique + 4 scénarios du pont Publisher, 43 parcours navigateur (30 ouvertures complètes/restreintes, 7 parcours métier, 4 interactions clavier/retour/brouillons, 2 régressions StrictMode). TypeScript, build et diff-check passent. Lint : aucune erreur ; deux avertissements préexistants (`window.location.assign` et aperçu `<img>`) hors du changement fonctionnel.

La migration Production est installée. Les empreintes des tâches, attributions, événements et payload workspace sont identiques avant/après ; les fonctions installées correspondent exactement aux fonctions testées localement. Voir production-schema.json. Le test authentifié de persistance décrit plus haut reste celui du banc isolé.
