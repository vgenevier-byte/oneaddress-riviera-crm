# Charges mensuelles — périodes et affectations maison

Date : 24 octobre 2026. Base : `76456b89f9a5ecd5b5cc0206c923522faa95ed3b`.

## Comportement livré

- Période mensuelle inclusive Du/Au, année courante initiale, raccourcis Ce mois / Mois précédent / Année en cours ; mois vides à zéro et années croisées.
- Total de période, sous-totaux Factures et Personnel avec frais annexes, puis une ligne par mois. Tous les mois sont fermés au chargement normal.
- Chaque bouton de mois expose son état et les montants à l’accessibilité. Les cartes ne sont montées qu’à l’ouverture ; affichage progressif par 50, toutes les lignes accessibles et totaux complets.
- Filtres Maison/Source/Personne, sélection commune recherchable des maisons par nom, adresse et ville. Les exports de synthèse et de détail portent sur la même période et les mêmes filtres.
- Liens sources et tâches conservés. Chaque cible mensuelle garde YYYY-MM ; une ouverture de tâche applique les filtres autorisés et ouvre seulement le bon mois, y compris lors d’une nouvelle ouverture de la même tâche.

## Diagnostic confirmé

Le calcul précédent retenait une facture uniquement via une règle fournisseur ou une exception individuelle positive. Les statuts À payer, Partiellement payé, Payé et En retard et le montant total enregistré étaient déjà admissibles ; les paiements ne constituaient pas des charges. Un filtre maison rejetait toutes les factures, faute de lien maison exploitable.

Toutes les factures admissibles sont maintenant incluses par défaut, y compris celles d’un nouveau fournisseur. Les exclusions individuelles explicites et leurs motifs restent prioritaires. Les règles des heures ne changent pas. Annulées et attendues restent hors total effectif ; aucun document PDF n’est requis pour la projection.

## Rattachements et droits

Le rattachement explicite (mois ou répartition) précède le mois de date de facture. La répartition donne les centimes résiduels aux premiers mois et ne compte jamais le montant intégral en plus des fractions. Sans date exploitable ni rattachement, la facture est à rattacher.

`config.houseAssignments` porte le couple exact facture/maison, séparément des rattachements mensuels. Aucun fournisseur, libellé ou filtre actif ne donne une maison automatiquement. Toutes maisons compte une facture une fois ; une maison précise compte ses heures et ses factures affectées. Les factures sans maison sont signalées hors de son total, avec action d’affectation ; les autres maisons sont exclues de ce périmètre.

Les RPC existantes conservent révision, idempotence et modifications ciblées. Affecter une maison exige contribution Charges, lecture Factures et lecture Maisons. Une relation invisible est masquée mais conservée lors des autres modifications. Les exports filtrés par maison exigent aussi son droit d’export ; la projection fraîche est revérifiée avant création du fichier. Un filtre devenu inaccessible masque les totaux et propose sa réinitialisation.

Migration additive : `20261024162509_monthly_charges_period_houses.sql`. Aucun enregistrement métier ni exclusion existante n’est réécrit. Les cibles de tâches Factures+Maison sont normalisées, résolues et exportées avec les droits correspondants ; invoice/hours restent les sources canoniques.

## Validation

Les données suivantes sont entièrement fictives et stockées dans une base Supabase locale isolée, avec Auth, JWT, PostgREST, PostgreSQL et RPC réels. Aucun JWT fabriqué ni interception RPC pour ces preuves.

| Mois | Factures | Personnel et frais | Total |
| --- | ---: | ---: | ---: |
| Septembre 2026 | 1 233,34 € | 0 € | 1 233,34 € |
| Octobre 2026 | 933,34 € | 200 € | 1 133,34 € |
| Novembre 2026 | 33,33 € | 0 € | 33,33 € |
| Décembre 2026 | 0 € | 0 € | 0 € |
| Période | 2 200,01 € | 200 € | 2 400,01 € |

- 77 tests unitaires Charges, monnaie, suivi maison et finance fournisseurs réussis, dont 24 Charges.
- 16 groupes Auth/RPC existants et 14 groupes période/maison réussis : patch réel puis nouvelle authentification et relecture, indépendance mois/maison, absence de mutation source, nouveaux fournisseurs, exclusions, annulées/attendues, date manquante, autres maisons/sans maison, révisions/idempotence, refus de droits et relations masquées.
- 5 groupes de liens de tâches Auth/RPC réussis : facture+maison et heures historiques, persistance/reconnexion, relations opaques, modification de note conservatrice, export et révocation des droits.
- Conseillers de sécurité sur la base isolée : aucune anomalie.
- TypeScript et build de production réussis. Lint : zéro erreur et deux avertissements préexistants (AccessPortal navigation, CRMApp img). Diff-check réussi.

- 7 groupes navigateur réels réussis : synthèse repliée et clavier FR, exports cohérents, mobile EN au toucher, recherche de maison avec accents neutralisés, écritures UI puis reconnexion/rechargement, tâches mensuelles et réouverture répétée, droits restreints, 300 interventions fictives persistées accessibles par pages de 50 avec total constant. Aucun accès réseau externe ni erreur de page. Voir `captures/period-browser-results.json` et les captures `period-*.png`.

Les détails de publication sont fournis avec le compte rendu final.

## Publication et limites

Les huit divergences de versions des migrations historiques distantes sont uniquement des timestamps de publications antérieures. Les cinq fonctions remplacées ont été comparées au code de référence actuel et leurs corps correspondent exactement. L’historique distant est récupéré dans un dossier temporaire pour appliquer uniquement le nouveau fichier, sans réparation d’historique, rôle ni seed.

Les preuves de persistance métier concernent la base isolée. Les contrôles Production portent sur la migration, la préservation des données/configurations/droits, le déploiement et les ressources réellement servies ; aucune session métier Production authentifiée n’est revendiquée.
