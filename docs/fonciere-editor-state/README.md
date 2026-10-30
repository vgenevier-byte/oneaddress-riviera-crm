# Foncière — effacement et ressaisie des éditeurs compacts

Base : `81591ddf449e308821ac95e7461f52976ab7c41b`. La correction conserve la présentation compacte et concerne uniquement l’ouverture des éditeurs, leur réinitialisation et le résumé des valeurs actuelles. Aucune migration, reprise de données ou modification des modèles/persistances n’est incluse.

Les trois reproductions Chromium ont été effectuées avant modification sur des données fictives locales :

- Pièces : `6` → Retour arrière masquait le champ et lui faisait perdre le focus.
- Téléphone et email locaux : effacer la valeur masquait également leur éditeur.
- Texte historique `rooms = "6"`, réponse guidée `6` puis `null` : le champ était vide, mais le résumé indiquait encore `6`.

Un composant partagé gère désormais l’ouverture explicitement en état React. Les actions d’ajout ouvrent cet état et focalisent le champ après rendu. Les champs restent montés lorsqu’ils sont repliés ; les événements natifs synchronisent aussi la réouverture automatique sur erreur. La fermeture manuelle d’un éditeur vide ramène au sélecteur d’ajout. Le cycle de remplacement d’une fiche ou d’un brouillon réinitialise les éditeurs et leurs saisies provisoires.

Le résumé utilise la valeur lisible calculée par le modèle, y compris `""`, sans réintroduire le texte source. L’original est conservé dans « Texte d’origine conservé » et reste enregistré après effacement de la réponse actuelle.

## Vérifications

- 8 scénarios ciblés sur le build de production : effacement/ressaisie sans disparition ni perte de focus ; téléphone/email ; effacement réellement enregistré et relu ; résumé actuel vide avec original historique conservé ; champs invalides montés et réouverture automatique ; changements de projet/brouillon ; fermeture manuelle ; FR/EN, clavier et mobile Chromium 390 px.
- Campagne existante de l’interface compacte : 12 scénarios validés, dont replis, absence d’écriture à la consultation, retours Contacts, pièces jointes, calendrier, arbitrage et archivage.
- 105 tests de domaine existants et pertinents validés.
- TypeScript, lint, build de production et diff-check validés. Deux avertissements de lint préexistants, sans erreur.
- Les 276 fichiers sources de l’application testée correspondent au build final. Aucun appel externe ni aucune erreur navigateur dans les campagnes.

Preuves : [avant](verification/before.json), [après](verification/after.json), [régressions existantes](verification/compact-regressions.json), [identité du build](verification/source-identity.json).

Captures : [Pièces avant](verification/screenshots/before-number.png) / [après](verification/screenshots/after-number.png), [coordonnées avant](verification/screenshots/before-contacts.png) / [après](verification/screenshots/after-contacts.png), [résumé historique erroné](verification/screenshots/before-historical.png) / [historique conservé après effacement](verification/screenshots/after-historical.png), [mobile EN](verification/screenshots/after-mobile-en.png).

Les tests réutilisent le lanceur local protégé de `tests/fonciere-arbitrage/README.md`. `tests/fonciere-editor/fixture.mjs` prépare une nouvelle fiche fictive ; `browser.mjs` utilise `COLLAPSE_FIXTURE` et `COLLAPSE_OUTPUT`. Le mode `EDITOR_BASELINE=1` reproduit les défauts sur la version initiale. Les comptes, clés et fichiers privés restent hors Git. Aucune donnée métier de production ni copie Drive n’est utilisée par ces tests.
