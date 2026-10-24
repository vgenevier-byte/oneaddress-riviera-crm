# Contacts, Foncière et Publisher — couverture des recherches

| Contrôle | Traitement | Valeur et limites métier |
| --- | --- | --- |
| Contacts : entreprise d’une personne | Un seul champ avec suggestions classées, à la place du champ de recherche suivi du menu | ID entreprise existant, entreprises fusionnées exclues, protection du dernier interlocuteur et texte historique conservés |
| Contacts : personne existante à rattacher | Même sélecteur partagé | Personnes nommées uniquement, indépendantes ou déjà liées à cette entreprise ; aucune création de relation à la saisie |
| Tâches : contact lié | Sélecteur partagé, identité principale et informations secondaires autorisées | Déduplication par ID uniquement ; nom canonique, ville et adresse de l’entreprise via `companyId` dans la projection autorisée |
| Prestataires et fournisseurs | Recherche indexée commune dans le sélecteur existant | API existante, filtres des appelants et héritage conservés ; changer la recherche conserve le lien jusqu’au remplacement ou retrait explicite |
| Foncière : agence et agent | Recherche distante dans la projection Contacts existante, classement commun avant filtrage de rôle et limite d’affichage | Aucun élargissement de droits ; confirmations de remplacement local, pièces jointes et retour depuis Contacts conservés |
| Foncière : liste de projets | Classement commun sur nom, adresse, ville et référence | Projets actifs/archivés gardent leur filtre ; correspondances approchées signalées |
| Présentations : dossiers enregistrés et auteurs | Pagination de tous les dossiers lisibles et des versions par lots de 100 IDs | Même RLS, auteur de la révision courante conservé, annulation vérifiée entre chaque page |
| Présentations : projet source | Sélecteur partagé sur la totalité des projets actifs lisibles | `listProjects` pagine les résultats RLS ; confirmations de remplacement du brouillon et instantanés indépendants conservés |
| Foncière : documents associés | Sélecteur partagé | ID du document existant ; ancienne valeur non disponible conservée et exclue des suggestions |
| Foncière : ville et code postal | Saisie libre avec suggestions classées | Toutes les suggestions issues des projets autorisés sont recherchées ; ancien plafond de 100 candidats retiré |
| Foncière : type de bien | Sélecteur partagé pour la longue liste fermée | Valeurs de schéma et traduction inchangées |
| Publisher : marque et modèle | Sélecteurs partagés, recherche sur libellé et description du catalogue | Type du véhicule, marque et réconciliation de modèle inchangés ; choix Automatique conservé |

## Menus classiques conservés et justifications

- Contacts : « rattacher une personne existante / créer une personne » reste un choix fermé de deux modes.
- Publisher : le type automobile reste une courte catégorie fermée de huit choix ; marques et modèles sont recherchables.
- Foncière : états, échelles, périodes et autres courtes catégories fermées restent des menus classiques ou des boutons. Les périodes et échelles gardent leur ordre métier. La classe DPE/GES garde son ordre A à G.
- Foncière : cases à cocher de caractéristiques et diagnostics représentent des réponses multiples fermées, pas des relations vers des fiches évolutives.

## Contrôles effectués

Commande locale :

```sh
node -r ./tests/i18n/register-typescript.cjs --test tests/contactsSearch.test.ts tests/tasks/contactOptions.test.ts tests/fonciere/contacts.test.ts tests/fonciere/search-pagination.test.ts tests/contacts-entity/identity.test.cjs
```

41 tests réussis au moment de ce contrôle : accents, mots inversés, fautes, champs répartis entre personne et entreprise liée, champs autorisés, identités distinctes, conservation du texte historique et des coordonnées locales, téléphones sans correction de chiffres, projet au-delà de la première page et annulation d’une liste distante.

TypeScript complet, ESLint sur les fichiers de ce périmètre et `git diff --check` réussis. La pagination est vérifiée avec une fixture locale de requête ; ces tests ne prouvent pas une session authentifiée Production et n’ont exécuté aucune écriture distante. Les captures et contrôles navigateur sont consignés dans le compte rendu global de la mission.
