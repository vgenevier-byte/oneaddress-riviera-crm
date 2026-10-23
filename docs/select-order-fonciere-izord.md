# Ordre des sélections Foncière et IZORD

Les règles portent sur la présentation des options. Les tableaux sources, valeurs,
identifiants, traductions, choix par défaut et valeurs enregistrées restent conservés.
Le tri utilise le libellé effectivement affiché et la langue courante, via
`lib/selectOptions.ts`. Les menus restent contrôlés par leur valeur existante.

| Champ / famille | Règle | Options particulières |
| --- | --- | --- |
| Foncière `propertyType`, `areaKind`, `parkingType`, `access` | Alphabétique FR/EN | Option vide « Non renseigné » en tête ; « À confirmer », « Sans objet », « Autre — préciser » sont des compléments explicitement marqués en fin. |
| Foncière `fees.inclusion`, `fees.payer`, `poolDetails.position`, `rentalHypothesis.mode` | Alphabétique FR/EN | Option vide en tête ; compléments explicitement marqués en fin. |
| Foncière documents associés, y compris identité historique indisponible | Alphabétique sur le nom affiché | « Aucun document associé » en tête. Une identité historique reste une option sélectionnable avec son libellé « Document conservé / Retained document ». |
| Foncière anciennes adresses / villes proposées par `datalist` | Alphabétique sur le texte enregistré, comparaison numérique naturelle | Aucun changement des suggestions IGN, qui gardent leur pertinence. |
| Foncière `condition`, `seaExtent`, `occupancy`, `servicing`, `worksHypothesis.level` | Progression métier / échelle conservée | Les options de complément gardent également leur ordre source. |
| Foncière `renovation.stage`, `division.stage`, `extension.stage`, `buildability.stage`, états des contrôles / diagnostics | Progression métier conservée | Les nouveaux contrôles commencent toujours « À vérifier ». |
| Foncière `poolDetails.heating` | Oui / non conservé | « À confirmer » garde sa position métier. |
| Foncière `charges.period`, `rentalHypothesis.period` | Chronologique conservée | Les unités ne sont ni renommées ni converties. |
| Foncière classes DPE / GES | Échelle A → G conservée | « À confirmer » en tête. |
| Foncière `pool`, `locationPrecision` affichés en boutons ; équipements, annexes, extérieurs, vues, objectifs, contraintes, usages et autres cases à cocher | Présentation métier conservée | Ces éléments ne sont pas des listes déroulantes. Les sélections multiples et l'exclusivité des réponses restent identiques. |
| Contacts liés depuis Foncière | Alphabétique sur le libellé affiché pour les résultats sans score ; pertinence conservée pour les recherches classées | Le parcours Foncière filtre la projection autorisée sans score de pertinence ; ses résultats sont classés alphabétiquement. Le classement par score des recherches de prestataires et les suggestions proches restent inchangés. |
| IZORD `rentalMode`, `regime`, `resaleBasis` | Alphabétique sur `displayLabel`, recalculé en FR/EN | `regime=other` désigne la vraie option « Foncière / sans engagement » : elle est classée normalement. Les choix par défaut explicites du modèle sont conservés. |
| IZORD `sea`, `decision`, état du dossier | Oui / non / échelle ou progression métier conservée | « À confirmer » et « À renseigner » gardent leur rôle métier. |
| IZORD fiche PDF à examiner | Alphabétique sur le nom de fichier réellement affiché | La valeur reste l'index d'origine : aucun document ni résultat d'extraction n'est déplacé dans les données. |
| IZORD photos de photothèque et d'import | Numérique conservé | Photos 1, 2, … ; « Aucune sélection / À compléter manuellement » reste en tête. |
| Cartes et listes de projets, boutons, sections, versions et documents hors sélecteurs | Présentation existante conservée | Hors du périmètre des options de listes déroulantes. |

Les politiques des choix guidés sont déclarées dans `GuidedFieldDefinition` /
`GuidedSubfield` (`optionOrder`) ; celles de chaque champ IZORD `select` sont
déclarées dans `components/izord/fields.json`. Les identifiants techniques ne
déterminent jamais à eux seuls un placement spécial.
