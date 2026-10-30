# Foncière — maintenir la décision locative en attente

Correctif limité depuis `eb1bc3c0eb4a02194cfadffe4e7c55011bc4e50f`. Aucun changement des quatre corrections précédentes, du modèle financier ou des droits.

## Reproduction avant correction

Dans le build de référence conservé localement, avec un projet fictif A/B : suppression locale de B, choix distant de B comme référence, conflit et premier rapprochement. Un second rapprochement supprimait le choix obligatoire. Enregistrer remplaçait alors la référence distante B sans décision explicite : révision serveur 4 → 5.

## Correction minimale

- Le bouton de rapprochement est désactivé pendant `rentalMergeConflict` ; la consigne FR/EN invite à choisir une version ou à annuler l’édition.
- `reconcileRevision()` possède la même garde à son entrée, avant toute lecture serveur ou modification de la base d’édition.
- Les deux versions, la validation des choix, le brouillon, les fichiers, le blocage d’Enregistrer et la reprise existante restent conservés.

## Vérifications réellement exécutées

- Test navigateur existant étendu : après le premier rapprochement terminé, tentative de relance sans choix puis Enregistrer. Le choix reste présent ; le payload serveur complet et sa révision restent identiques. Résolution locale puis résolution serveur vérifiées séparément. Le conflit repris depuis le brouillon reste bloquant jusqu’au choix explicite.
- Campagne ciblée Foncière complète : quatre parcours réussis, dont les trois durées 4 → 7, invalides/focus/identité des contrôles/remarque conservés, choix locatifs et véritable fichier local conservé puis enregistré après conflit ; contrôle EN mobile supplémentaire.
- Campagne Présentations existante : quatre parcours réussis, dont sauvegarde/relecture, vrais exports JSON/PPTX et notes, projet source/avis/autres présentations inchangés, retour vers Projets, anglais mobile/clavier.
- 168 tests de domaine et régressions existantes réussis.
- TypeScript, lint, build Next.js production et diff-check réussis. Lint : uniquement les deux avertissements préexistants d’AccessPortal et CRMApp. Identité des 282 fichiers app/components/lib de la copie compilée testée vérifiée.

Les données et comptes sont fictifs. Auth/PostgreSQL/PostgREST/Storage locaux réels ; requêtes navigateur hors du stack loopback bloquées. Le mobile est émulé. Aucun transfert Drive réel ni session métier authentifiée de production n’est revendiqué.

Aucune migration ni reprise de données réelles. Les vérifications de production portent sur READY, les protections, les métadonnées du SHA et l’identifiant HTML du déploiement servi sur les deux alias. Les preuves de publication sont conservées hors dépôt pour ne pas créer de commit après vérification du SHA servi.

Travail effectué dans une copie isolée ; les travaux locaux étrangers du checkout initial sont préservés.
