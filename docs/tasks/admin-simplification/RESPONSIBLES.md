# Responsables — select natif et vérification locale

Vérification du 7 octobre 2026 sur la copie isolée issue de `39aa89811258c2ff8438dc2bd49ed54f5fb58ea7`. L’application servie sur `http://127.0.0.1:3200` correspond au manifest `/private/tmp/oar-tasks-admin-state/demo-manifest.json` : les empreintes SHA-256 des 162 fichiers servis et de leurs sources ont été comparées avant chaque run.

## Modification ciblée

[TasksWorkspace.tsx](../../../components/TasksWorkspace.tsx) remplace les cases à cocher de Responsables par un select natif fermé « Ajouter un responsable » et une liste de chips. Chaque option porte l’UUID Auth confirmé par l’annuaire, le nom, l’e-mail disponible et le niveau d’accès ; le compte connecté est signalé « moi ». Un UUID déjà sélectionné ne reste pas proposé. Les boutons des chips sont `type="button"` avec un nom accessible « Retirer [nom] ».

L’ajout et le retrait modifient seulement le brouillon. Entrée sur le select d’ajout ou sur la recherche ne soumet pas le formulaire. La recherche nom/e-mail, le chargement, le réessai, l’état vide et l’actualisation des choix restent disponibles. Les mécanismes existants de session, de requêtes tardives, de conflit et d’enregistrement explicite sont conservés.

Une affectation sélectionnée qui disparaît de l’annuaire reste affichée avec un avertissement jusqu’à son retrait explicite. Le gestionnaire d’une tâche historique reste sélectionné et non retirable, y compris quand son accès devient inactif. Les chips peuvent revenir à la ligne.

## Résultats

[Le runner](../../../tests/tasks/admin-simplification-responsibles-browser.mjs) utilise de vrais comptes Auth fictifs, les RPC de l’application et la base Postgres du banc jetable. [Le guard](../../../tests/tasks/admin-simplification-target.mjs) exige l’opt-in `TASKS_DISPOSABLE_LOCAL_ONLY` et les seules cibles API `127.0.0.1:55731`, Postgres `127.0.0.1:55732/postgres`, application `127.0.0.1:3200`. Un contrôle séparé a admis la cible exacte et rejeté neuf cibles incorrectes.

| Parcours | Résultat |
| --- | --- |
| Chromium, 1440 px : select natif, ajout clavier, retrait clavier, « moi », homonymes distingués par e-mail, recherche, UUID uniques, ajout/retrait sans mutation | PASS |
| Chromium, 390 px : retrait tactile émulé, chips lisibles, brouillon/sélections conservés, absence de débordement horizontal | PASS |
| Conflit : brouillon et UUID conservés, enregistrement bloqué, reprise de révision puis sauvegarde explicites | PASS |
| Annulation puis nouvel éditeur : réponse d’annuaire antérieure ignorée, aucun UUID devenu inactif réintroduit | PASS |
| Gestionnaire historique actif puis inactif : chip conservée et bouton de retrait désactivé | PASS |
| Révocation pendant un chargement : saisie privée retirée et réponse tardive ignorée | PASS |
| WebKit, 390 px : select natif, retrait tactile émulé, recherche/réessai, chips et affectation inactive conservée puis retirée explicitement | PASS |

Les parcours complets Chromium et WebKit vérifient aussi : champs du brouillon conservés pendant chargement/erreur/réessai ; e-mail de secours d’un compte lecteur sans lien Contact ; création personnelle sans affectation ; visibilité confirmée pour les contributeurs affectés ; sauvegarde des UUID en base ; conservation d’une affectation inactive lors d’une modification des seules notes sans `assigneeIds` dans le patch ; puis retrait explicite confirmé par `removed_at` en base. Les contrôles réseau n’ont accepté que l’application et l’API locales, avec aucun appel externe et aucune erreur navigateur/hydratation.

Les comptes, tâches et droits créés par chacun des deux runs ont été nettoyés. Les lignes de tâches et d’affectations qui existaient au début de chaque run sont restées identiques après nettoyage (`cleanupPassed: true`).

## Preuves et captures

- [Résultats Chromium et premier lancement WebKit](</private/tmp/oar-tasks-admin-state/browser-responsibles/responsibles-browser-results.json>) : les six parcours Chromium passent. Le lancement WebKit initial échoue avant tout parcours car son chemin Playwright par défaut est absent.
- [Résultat WebKit après correction du chemin](</private/tmp/oar-tasks-admin-state/browser-responsibles-webkit/responsibles-browser-results.json>) : le seul parcours WebKit passe avec l’exécutable déjà présent `/private/tmp/monthly-charges-browsers/webkit-2336/pw_run.sh`. Aucun navigateur n’a été téléchargé et aucun code source n’a changé entre ces runs.
- [Select et chips Chromium, 1440 px](</private/tmp/oar-tasks-admin-state/browser-responsibles/chromium-1440-direct-selection.png>).
- [Select et chips Chromium, 390 px](</private/tmp/oar-tasks-admin-state/browser-responsibles/chromium-390-direct-selection.png>).
- [Select et chips WebKit, 390 px](</private/tmp/oar-tasks-admin-state/browser-responsibles-webkit/webkit-390-direct-selection.png>).

Les trois captures de sélection ont été inspectées visuellement. Les captures complètes du formulaire sont disponibles dans les mêmes dossiers (`*-direct-form.png`). Les noms, e-mails et textes sont fictifs ; les e-mails du banc se terminent par `@example.invalid`.

## Limites de la preuve

Le banc est local : aucune session Production, aucune écriture Production ni aucune donnée métier réelle n’a été utilisée. Les états de panne sont des injections explicites appliquées après une vraie réponse d’annuaire locale : réponse retenue, HTTP 503 et réponse vide. Les gestionnaires historiques du test sont des lignes fictives créées directement dans le banc SQL pour vérifier l’interface ; ce parcours ne réalise aucune récupération historique via Administration.

Les ajouts programmatiques utilisent le select natif et son événement de changement ; Chromium vérifie aussi son typeahead au clavier ainsi que l’absence de soumission sur Entrée. Les retraits tactiles et les viewports mobiles sont émulés. WebKit à 390 px ne prouve pas le comportement d’un iPhone physique ni celui de sa fenêtre système de choix native. Les fichiers de preuve sous `/private/tmp` sont locaux et ne sont pas des pièces publiées en Production.

TypeScript (`--noEmit --incremental false`) et lint ciblé du composant et des deux fichiers de test ont également passé avant les parcours navigateur.
