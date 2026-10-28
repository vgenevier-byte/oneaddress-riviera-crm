# Deux corrections ciblées après 9125b9d

## Reproductions avant correction

La livraison `9125b9da701bf16f026febf0fbf145239533ae00` a été reproduite
dans une copie isolée. Avec « Baisses de prix annoncées : » en page 1 puis
« 80000 EUR » en page 2, les deux parcours rendaient un prix demandé de 80000,
et la proposition interne était absente. Quatre des cinq régressions initiales
échouaient ; les preuves figurent dans `verification/import/`.

Le navigateur réel a également reproduit trois variantes : ajout d'un représentant
après retrait du propriétaire choisi, conservation du choix dans un nouveau projet
jamais enregistré, et retour depuis Contacts avec un nouveau contact et un PDF.
Le mode `before` des rapports constate ces défauts ; il ne valide pas leur sûreté.

## Corrections

L'extraction filtre désormais le document dans l'ordre en conservant l'état de
section privée entre les pages. Les deux parcours reprennent uniquement au prochain
libellé public reconnu, en français ou en anglais. Le formulaire de revue récupère
les continuations internes ; l'extrait conserve les marqueurs PAGE et le numéro de
la page du libellé initial. Une sélection explicite reste nécessaire.

Le choix du propriétaire représenté se vide lorsqu'il devient indisponible. L'ajout
et le retour depuis Contacts revérifient les propriétaires du brouillon courant.
Si une nouvelle sélection est nécessaire, le contact est conservé en attente d'une
confirmation explicite. L'utilisateur peut choisir un propriétaire courant,
indiquer volontairement une représentation encore à préciser ou abandonner ce lien
en conservant le contact CRM. L'enregistrement attend cette résolution. Un nouveau
brouillon réinitialise les choix et recherches transitoires. Les relations orphelines
déjà enregistrées restent conservées pour vérification.

Les contrôles serveur existants et le schéma ne changent pas. Aucune migration,
reprise de propriétaires ou modification des calculs financiers n'est nécessaire.

## Vérifications

Résultats finaux sur la construction de production locale :

- 100 tests unitaires et de régression, sans test ignoré.
- 15 groupes serveur réels Auth/PostgREST/PostgreSQL.
- 3 parcours de vrais PDF multipages, 5 parcours ciblés de représentant et
  9 groupes du parcours propriétaires existant : sauvegarde, relecture, nouvelles
  sessions authentifiées, documents, FR et EN mobile émulé Chromium 390 px.
- 9 groupes présentation : JSON et PowerPoint réels, manuels et bancaires ;
  45 XML/rels par PowerPoint dont deux fichiers de notes, zéro marqueur privé.
- TypeScript, lint complet (zéro erreur, deux avertissements préexistants), build
  et diff-check réussis. Les 272 fichiers applicatifs du banc sont identiques
  aux sources publiées par SHA-256.

Les rapports finaux sont dans `verification/`. Ils séparent les tests métier
sur la pile locale fictive, les preuves avant correction, les vrais PDF importés,
et les contrôles de publication. Les exports de présentations manuelle et bancaire
incluent l'inspection de tous les XML/rels des PowerPoint et de leurs notes.
Les identifiants, comptes et documents utilisés pour les essais sont fictifs.

La limite de la livraison précédente reste applicable : la comparaison d'empreintes
de lignes de production n'a pas été réalisée, après refus du contrôle automatique
d'approbation pour agrégation de données sensibles. Elle n'a pas été retentée.
Les contrôles de production de cette correction sont statiques et en lecture seule.
