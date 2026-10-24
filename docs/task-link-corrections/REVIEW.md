# Correctifs ciblés — présentations et maisons liées aux tâches

Base : `0ce917e31a0b3bdde6bee60c669cd658279ce7f4`, dernière version distante au démarrage. Le checkout utilisateur étranger à la mission reste intact ; les modifications sont réalisées dans un checkout isolé.

## Présentations

Le droit d’édition du rôle est indépendant du mode historique. L’ouverture décide de l’hydratation selon le rôle et la destination demandée. Chaque dossier chargé indique explicitement si ses photos sont complètes ou omises, ainsi que sa révision historique éventuelle. Les sauvegardes refusent une projection partielle, historique ou provenant d’un autre dossier/révision. La récupération conserve ces marqueurs ; elle ne transforme pas une consultation en brouillon modifiable.

Les photographies inchangées conservent leur référence par emplacement avant toute réutilisation fondée sur les octets, y compris lorsque deux assets distincts contiennent les mêmes octets. L’ouverture explicite d’un dossier courant synchronise son URL afin qu’un rechargement normal retrouve ce dossier courant ; les liens documentaires précis restent préservés.

[Parcours et conservation exacte des photos](PHOTO-VALIDATION.md).

## Maison liée à une tâche

Le contexte d’heures et les charges mensuelles utilisent un seul `SearchableSelect` commun. Le chargement parcourt toutes les pages autorisées avant la limitation des suggestions. La saisie d’une nouvelle recherche ne modifie pas `houseId`. « Toutes les maisons », le clavier, le chargement, les erreurs/réessais et l’annulation des requêtes obsolètes restent explicites.

Une migration additive enrichit uniquement les métadonnées de recherche autorisées d’une maison : adresse et ville issues du modèle d’adresse existant. Aucune donnée métier n’est réécrite et les contrôles de droits du résolveur précédent sont conservés. Le style local des deux boutons du champ évite leur chevauchement sous le CSS mobile global, sans modifier le sélecteur partagé dans les autres modules.

[Parcours et contexte canonique enregistré](HOUSE-VALIDATION.md).

## Validation

Les preuves authentifiées de sauvegarde/rechargement utilisent uniquement Auth, RPC, PostgreSQL et Storage du banc isolé avec des données fictives. Elles ne constituent pas une validation métier authentifiée en Production. La simulation d’une indisponibilité locale vérifie uniquement le comportement de reprise/erreur.

TypeScript, lint, build et diff-check sont exécutés sur le candidat. Les deux avertissements lint préexistants de `AccessPortal` et `CRMApp` sont hors du correctif. Aucune génération payante, action Publisher ou publication Instagram n’est réalisée.

Résultats du candidat : **40 tests ciblés** sur les photos, la reprise de brouillon, les continuations annulées et le catalogue de maisons ; 7 parcours photos + 1 passage direct entre dossiers ; 2 contrôles de persistance photo et le contrôle croisé ; 2 parcours de sauvegarde de contexte maison et un test tactile sans sauvegarde. Les 2 contrôles serveur des maisons confirment aussi le rejeu de la migration sans réécriture et le masquage des données non autorisées. Les anciens parcours non concernés n’ont pas été rejoués.

La migration de recherche des maisons est installée en Production. Les empreintes du workspace, des tâches, projets, versions, assets et permissions sont identiques avant/après. Le résolveur d’origine est conservé et le nouveau helper privé n’est exécutable ni par anon ni directement par authenticated : [preuve](production-schema.json). Le correctif des photos ne demande aucune migration ni réécriture de photographies.
