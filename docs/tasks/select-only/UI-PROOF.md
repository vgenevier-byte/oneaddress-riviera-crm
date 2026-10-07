# Preuve UI du sélecteur de responsables

Les cinq parcours ont réussi sur le composant candidat `TasksWorkspace` importé sans modification par une page temporaire : Chromium bureau 1440, Chromium mobile tactile 390, WebKit mobile tactile 390, affectations inactives/gestionnaire historique et conflit de révision. Les captures bureau et mobile ont été contrôlées visuellement.

- La création et la modification ne contiennent aucun champ de recherche de responsable, ni champ nom/e-mail, ni checkbox. Le sélecteur natif porte le libellé « Sélectionner un responsable ».
- Les options contiennent tous les UUID éligibles fictifs, sauf les personnes déjà sélectionnées. Le compte courant porte « (moi) » ; les homonymes accentués restent distingués par leurs e-mails fictifs.
- Plusieurs ajouts, Entrée sur le sélecteur et les retraits n'envoient aucune mutation. Tous les comptes sélectionnés désactivent le sélecteur ; un retrait réintroduit précisément l'UUID retiré.
- Chargement, erreur HTTP 503 simulée, nouvelle tentative et annuaire vide conservent les notes et les chips. Les champs restent présents à la restauration de l'annuaire.
- Deux responsables ajoutés puis un retiré produisent un seul UUID au clic explicite sur « Créer la tâche ». Le formulaire attend la réponse HTTP fictive avant de montrer la tâche enregistrée. La modification et le rechargement retrouvent les mêmes valeurs et affectations.
- Une affectation inactive reste présente jusqu'au retrait explicite ; les autres modifications n'incluent pas `assigneeIds`. Le gestionnaire historique conservé ne peut pas être retiré.
- Le conflit conserve la saisie privée et les chips ; l'enregistrement reste désactivé jusqu'à la reprise explicite sur la révision simulée courante.
- La recherche générale des tâches continue de filtrer les titres et les notes sur bureau et mobile. Aucune erreur navigateur/hydratation, aucune URL externe tentée et aucun débordement horizontal mesuré.

Le banc n'utilise aucune Auth, RPC, SQL, base de données, création de compte, donnée métier ou écriture Production. Les UUID, noms, e-mails et tâches sont fictifs. Les confirmations HTTP et la conservation après rechargement sont simulées par une fermeture Playwright en mémoire. Ces résultats prouvent le comportement UI du composant ; ils ne prouvent ni l'annuaire serveur réel, ni les permissions serveur, ni l'enregistrement en base, ni un parcours Production authentifié, ni un iPhone physique.

La page de fixture et son layout isolé restent uniquement dans une copie temporaire. Le layout de fixture utilise une police système et le CSS intégré du composant ; il n'est pas une capture de l'ensemble du CRM Production. Le serveur écoute uniquement `127.0.0.1:3201`, charge uniquement des variables publiques fictives et aucun `.env` du dépôt. Le garde réseau Node bloque les connexions sortantes hors fixture ; les routes Playwright bloquent tout domaine extérieur.

Base publiée utilisée : `bfc1ef853afe215e420fe5be3c7ab334964b492a`.

SHA-256 du composant candidat et servi : `bcc4957728156b05c930405ab99ee73c0cdb66b1fedae1e0e6a01b8a6b241108`.

Le manifeste `ui-source-manifest.json` consigne les empreintes de `TasksWorkspace`, `domain`, `types` et de la configuration copiée. Le test vérifie que chaque fichier servi et chaque fichier candidat correspond à l'empreinte avant les parcours. Le build de cette page isolée, les contrôles de syntaxe Node et ESLint des trois scripts sont passés ; le build complet de l'application relève du rapport de publication séparé.

Résultats : [ui-browser-results.json](ui-browser-results.json). Manifeste des sources : [ui-source-manifest.json](ui-source-manifest.json).

Captures : [bureau Chromium](chromium-1440-selection.png), [mobile Chromium](chromium-390-selection.png), [mobile WebKit](webkit-390-selection.png).

Reproduction depuis une copie candidate temporaire propre, avec le même `node_modules` local :

```sh
TASKS_SELECT_ONLY_ACK=TASKS_UI_FICTION_ONLY TASKS_SELECT_ONLY_BASE=bfc1ef853afe215e420fe5be3c7ab334964b492a node tests/tasks/select-only-serve.mjs
TASKS_SELECT_ONLY_ACK=TASKS_UI_FICTION_ONLY node tests/tasks/select-only-browser.mjs
```

Les opérations d'écoute locale et de lancement du navigateur peuvent nécessiter l'autorisation du sandbox. Elles ne nécessitent aucune variable Supabase réelle.
