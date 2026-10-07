Preuve navigateur du candidat fondé sur `8136406ae8b38c0c43c3322d4b1d88983e2cb9cc` : **9 groupes passent**.

Le banc importe une copie octet identique de `TasksWorkspace.tsx`, `TaskContactPicker.tsx`, `contactOptions.ts`, des types et du domaine. `ui-source-manifest.json` contient leurs SHA-256, ceux des nouveaux runners et du test helper, les sources des deux points d’intégration et les fichiers propres au banc. Le runner recontrôle ces empreintes avant chaque campagne.

Les parcours passent dans Chromium à 1440 px, Chromium à 390 px avec émulation tactile et WebKit à 390 px avec émulation tactile. Ils vérifient la recherche insensible à la casse et aux accents, les formes Unicode composées/décomposées et pleine largeur, les fragments de prénom/nom, l’ordre libre des mots et les espaces. Ils couvrent les homonymes distingués par entreprise/e-mail déjà fournis, les noms composés, les prénoms ou noms manquants et le repli entreprise lorsque les noms sont absents ou blancs.

La saisie seule, y compris un résultat unique et Entrée sans résultat actif, ne choisit aucun ID et ne soumet aucun formulaire. Le choix, le remplacement et le retrait restent explicites. Les parcours confirment une création fictive, un rechargement, une édition sans modification de référence, le nom complet dans le détail et un retrait sauvegardé. Le brouillon issu d’un Contact conserve son ID prérempli jusqu’à l’enregistrement explicite.

Le clavier est vérifié avec Flèche bas/haut puis Entrée et avec Échap fermant d’abord les suggestions. Le select natif Responsables garde son option initiale, ses e-mails et ses chips sans champ de recherche ; Lead et recherche générale restent fonctionnels. Les dimensions du document et de chaque dialogue ne dépassent pas leur viewport horizontal. Les captures desktop Chromium et mobile WebKit ont aussi été inspectées visuellement.

Sans options Contacts lisibles, aucune suggestion n’est proposée. Une référence historique non lisible garde son ID sans afficher un nom ou cet ID ; une édition de notes omet `contactId` du patch. La révocation est simulée sur une tâche déjà enregistrée : elle retire immédiatement les anciennes étiquettes et suggestions, préserve le brouillon et omet aussi `contactId` lors d’une édition de notes. Ce scénario ne prétend pas autoriser un nouveau rattachement après révocation. L’erreur de sauvegarde et le conflit simulés préservent les champs, le Contact et les chips ; la reprise exige une confirmation explicite et le retry identique conserve son `requestId`.

`ui-browser-results.json` contient les neuf résultats et les audits : **0 tentative externe, 0 erreur JavaScript, 0 erreur console inattendue**, dans les neuf sessions. Les erreurs HTTP 503 sont volontairement simulées et répertoriées séparément.

Les Contacts, comptes, tâches et IDs sont entièrement fictifs. Seuls `list`, `directory`, `contacts` et `mutate` sous `/__task_fixture/` sont interceptés ; l’état des confirmations vit dans la closure Playwright en mémoire. La garde réseau du banc existant est copiée dans un dossier temporaire avec le seul remplacement du port fixe 3201 par 3202. Aucune `.env` métier n’est chargée. Aucune Auth, RPC, SQL, base de données, création de compte ou écriture métier n’est exécutée. Le banc rend les composants Tâches importés dans une page isolée : il ne rend pas les pages CRM complètes et ne constitue pas une preuve authentifiée en Production ou sur iPhone physique.

Reproduction dans la copie jetable, en deux terminaux :

```sh
TASKS_CONTACT_SEARCH_ACK=TASKS_UI_FICTION_ONLY TASKS_CONTACT_SEARCH_BASE=8136406ae8b38c0c43c3322d4b1d88983e2cb9cc node tests/tasks/contact-search-serve.mjs
TASKS_CONTACT_SEARCH_ACK=TASKS_UI_FICTION_ONLY node tests/tasks/contact-search-browser.mjs
```

Attendre `READY http://127.0.0.1:3202/contact-demo` avant la seconde commande. Le processus serveur doit être arrêté après la preuve.
