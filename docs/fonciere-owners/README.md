# Propriétaire(s) et contexte de vente

La section 02 regroupe l’agence, les interlocuteurs et le nouveau bloc interne.
Les sections 07 Documents et 08 Arbitrage conservent leur numéro. Les informations
restent facultatives, avec des détails dépliables et des contrôles FR/EN.

`ownerContext` sépare l’organisation de la propriété, les droits détenus, le
nombre déclaré, les personnes ou entreprises propriétaires et leurs représentants.
Les liens utilisent les identifiants CRM autorisés et ne créent aucun propriétaire
fictif. Les parcours de création ouvrent le formulaire Contacts complet avec un
préremplissage vide, puis reviennent au brouillon avec ses pièces jointes.

Les renseignements personnels communiqués, leurs sources, le contexte de vente
et l’appréciation manuelle restent dans le projet. La validation cliente et la
migration contrôlent types, dates, limites, liens Contacts et droits existants.
Le serveur attribue l’auteur et la date d’une modification de l’appréciation.
Les incohérences métier sont signalées et conservées pour vérification.

Les propositions d’agence exigent une sélection explicite et conservent leurs
extraits et pages dans la provenance interne. Les paragraphes internes, y compris
leurs continuations et les libellés anglais, sont exclus de l’extraction publique.
Les baisses de prix annoncées ne deviennent pas un prix demandé ou une hypothèse.
Le réimport préserve les corrections sans sélection et l’appréciation interne.

Les conversions vers les présentations utilisent une liste explicite de champs
publics. La validation des métadonnées, la persistance PostgreSQL et les notes
PowerPoint excluent le bloc interne. Une réconciliation depuis une présentation
préserve le contexte du projet existant et ne récupère aucune copie cachée.
Les documents originaux suivent le parcours documentaire existant et sont conservés.
Les présentations déjà travaillées et les calculs financiers gardent leur comportement.
Une modification enregistrée du contexte reconfirme l’arbitrage selon son mécanisme
existant ; l’affichage de l’ancienneté d’annonce ne réalise aucune écriture.

## Vérifications réalisées sur données fictives

- 94 tests unitaires et de régression, sans tests ignorés.
- 15 groupes serveur sur de vrais services locaux Auth/PostgREST/PostgreSQL :
  persistance et nouvelle connexion, droits complets/restreints/lecture seule,
  identités canoniques, refus des contournements, provenance et reconfirmation.
- 9 groupes navigateur sur le CRM construit en mode production : recherche,
  création personne/société, représentant distinct, brouillon et PDF conservés,
  import/réimport, sauvegarde/rechargement, nouveau projet vide, FR et EN mobile.
- 8 groupes présentation : manuelle et bancaire sauvegardées, JSON et PowerPoint
  réels ; 45 fichiers XML/rels par PowerPoint dont deux fichiers de notes, sans
  marqueur privé. Réimport caché, présentations existantes et finances vérifiés.
- TypeScript, lint complet (zéro erreur, deux avertissements préexistants), build
  et diff-check réussis. Les 272 fichiers applicatifs du banc correspondent aux
  sources finales par SHA-256.

Les rapports et captures fictives sont dans `verification/`. Les scripts de
`tests/fonciere-owners/` réutilisent le banc local documenté dans
`tests/fonciere-arbitrage/README.md`. Mobile : émulation Chromium 390 px ; les XML
PowerPoint ont été inspectés sans application PowerPoint ou LibreOffice.

## Production

La migration `20261028122339_fonciere_owner_context.sql`, appliquée en production,
ajoute uniquement des validateurs et des déclencheurs privés ; elle
ne réécrit aucune ligne métier et n’effectue aucune reprise de propriétaires.
Son application et les contrôles statiques après publication sont consignés dans
le compte rendu de livraison. Aucun scénario métier fictif n’est exécuté en production.
Le contrôle automatique d’approbation a refusé l’agrégation des lignes réelles en
empreintes, jugée sensible ; cette comparaison de données de production n’a pas été
effectuée. Les essais métier et de préservation restent ceux de la base isolée.
