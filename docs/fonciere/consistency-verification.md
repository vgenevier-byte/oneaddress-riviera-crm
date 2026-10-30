# Foncière — cohérence des présentations et rapprochement

Correctif depuis `e0bb8727a9e7a5ce0955c56baed7c6cc66108ee7`. La lecture par défaut, l’édition par rubrique, les replis 01–08, les scénarios, le filtre entreprise et les documents sont conservés. Réalisation dans le checkout isolé ; aucun changement des travaux locaux étrangers.

## Défauts reproduits avant correction

- Une modification des champs acquisition/loyer de la présentation laissait le plan utilisé par les exports et les rendements inchangé (données fictives, reproduction par le modèle).
- L’aller-retour sans correction changeait les valeurs guidées et les notes lorsque le plan possédait un budget travaux différent (reproduction par le modèle).
- Suppression locale de B et choix distant de B comme référence : le rapprochement retournait uniquement A, référence B, sans conflit (reproduction par le modèle).
- Dans le CRM complet du build antérieur conservé localement, les trois durées personnalisées restaient affichées à 4 après sauvegarde/relecture de valeurs rapprochées à 7 (reproduction navigateur réelle).

## Corrections

### Présentation : une copie financière cohérente

Le plan propre à la présentation est conservé dans ses métadonnées JSON existantes. Son instantané source reste inchangé. Le même modèle alimente les contrôles adaptés, résultats, aperçus, projection financière exportée, PowerPoint et notes. L’éditeur réutilise les scénarios et calculs Foncière ; les anciens champs financiers incompatibles ne sont plus proposés pour ce modèle.

Les contrôles de validation et l’export refusent les hypothèses incohérentes ; les valeurs provisoires restent éditables. Les légendes de l’ancienne formule d’aléas/frais de revente ne contribuent plus aux résultats locatifs structurés. Les informations sources présentes dans les notes sont explicitement historiques. Les présentations sans plan structuré conservent leur modèle financier existant.

Une nouvelle présentation issue d’un projet reprend le plan actuel du projet, sans hériter d’une ancienne copie de présentation. Aucune correction de présentation ne réécrit le projet source ni ses avis. Le retour depuis un instantané non lié crée une fiche distincte ; les présentations déjà liées gardent leur comportement.

### Aller-retour et rapprochement

L’état de comparaison est capturé après les transformations automatiques. Les instantanés de la première livraison sont interprétés correctement en mémoire, sans reprise de données. Les hypothèses guidées historiques, budget travaux, calendrier et notes sont conservés ; une correction humaine modifie seulement les informations correspondantes.

Le rapprochement vérifie le plan locatif et détecte explicitement la dépendance scénarios/référence. Une référence devenue inexistante n’est pas acceptée comme une version prête à enregistrer. Les deux intentions restent conservées ; l’utilisateur choisit la version locale ou serveur. Le brouillon et les fichiers restent disponibles pendant ce choix.

Les contrôles de durée et de montant synchronisent les remplacements acceptés du serveur sans remontage général. Les saisies invalides locales et les remarques restent conservées. Le focus revient au champ après le chargement. Le formatage des montants FR/EN ne transforme pas un montant au simple focus/blur.

## Vérifications exécutées

| Campagne | Résultat |
|---|---|
| Domaine et régressions existantes | 168 tests réussis, dont 8 nouveaux cas ciblés |
| Navigateur ciblé Foncière | 4 parcours réussis : durées travaux/vente/premier loyer 4 → 7 ; invalides/focus/identité des nœuds/remarque conservés ; suppression/référence avec les deux résolutions ; fichier réel conservé puis enregistré après conflit. Contrôle EN mobile supplémentaire |
| Navigateur Présentations | 4 parcours réussis : acquisition et loyer propres à la copie, sauvegarde/relecture, aperçu et exports réels ; projet source/avis/autre présentation inchangés ; Enregistrer dans Projets depuis un instantané sans source ; EN mobile/clavier/focus des montants |
| Exports réels | Acquisition 900 000 €, base commune 1 100 000 €, loyer 5 000 × 12 = 60 000 €/an, après frais 55 000 €. JSON, aperçu, PowerPoint et notes concordants. 57 parties XML/rels, dont 5 notes, contrôlées sans marqueur propriétaire privé |
| Serveur existant consultation | 8 contrôles réussis : droits, persistance, validation, avis lecteur, reconfirmation, ancien client, conflits, exclusions privées |
| Navigateur existant consultation | 14 parcours réussis : consultation sans écriture, édition/annulation/changement, invalides et historiques, import PDF texte réel, Contacts, scénarios, documents, conflits, lecteur décideur, FR/EN mobile/clavier, reprise de création après interruption simulée |
| Vérifications de livraison | TypeScript, lint, build Next.js production et diff-check réussis. Lint : uniquement les deux avertissements préexistants d’AccessPortal et CRMApp. Identité des 282 fichiers app/components/lib vérifiée entre dépôt et copie compilée testée |

Tous les tests métier utilisent des données fictives sur Auth/PostgreSQL/PostgREST/Storage locaux réels, avec blocage des requêtes externes dans les navigateurs. Aucune migration ni reprise de données n’est nécessaire : le modèle propre à la présentation utilise les métadonnées JSON déjà disponibles.

## Limites et production

Mobile : Chromium tactile émulé à 390 px, pas un téléphone physique. Les conflits sont provoqués par de vraies révisions concurrentes dans la base locale ; le fichier de reprise utilise le vrai Storage local. L’ancienne campagne simule une interruption réseau de transfert. Aucun transfert Google Drive réel ni test métier authentifié en production n’est revendiqué.

La production est contrôlée par l’état READY, les métadonnées du commit, l’identifiant HTML du déploiement servi sur chacun des deux alias, les protections et les logs récents. Aucun scénario, projet ni calcul fictif n’est enregistré dans les données réelles. Le compte rendu externe associe le SHA final, les alias et les captures sans créer un second commit après publication.
