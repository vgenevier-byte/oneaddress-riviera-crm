Preuve navigateur du candidat fondé sur `b33ec9841d111727f48ace0f3c06ec2830da4b13` : **10 groupes passent dans 13 sessions**, dont les neuf groupes du banc Contact précédent.

Les parcours utilisent Chromium à 1440 px, Chromium à 390 px avec émulation tactile et WebKit à 390 px avec émulation tactile. Ils importent des copies octet identiques de `TasksWorkspace.tsx`, `TaskContactPicker.tsx`, `contactOptions.ts`, des types et du domaine. `ui-source-manifest.json` contient les SHA-256 des sources servies, des deux points d’intégration, du test helper et des nouveaux runners. Le runner recontrôle ces empreintes ; une vérification finale confirme qu’elles correspondent encore au candidat et à la copie servie.

La recherche entreprise couvre `azur`, `services`, `azur services`, des fragments, des espaces et une tabulation, les accents, Unicode décomposé et pleine largeur, et des mots distribués entre prénom, nom et entreprise dans plusieurs ordres : `julien azur`, `martin azur` et `services julien martin azur`. Les anciens cas prénom/nom restent présents, notamment `clement`, `CLÉMENT`, `clem`, `minodier`, les homonymes, les noms composés et les champs manquants.

Deux contacts fictifs distincts, Julien Martin et Camille Laurent, ont l’entreprise Azur Services. Tous deux restent proposés et sélectionnables ; une deuxième ligne portant le même ID de Julien est dédupliquée en gardant la première ligne stable. Chaque moteur/largeur choisit explicitement Julien après une recherche entreprise, confirme son ID dans une sauvegarde HTTP simulée, recharge et édite la tâche, puis remplace explicitement le contact par Camille et confirme son autre ID après un nouveau rechargement. Taper une nouvelle recherche entreprise conserve le contact déjà choisi jusqu’au choix explicite.

Un contact entreprise seule avec prénom/nom blancs et espaces autour du nom d’entreprise n’affiche pas deux fois l’entreprise dans les suggestions ou la sélection. Une entreprise absente n’est pas inventée. Le groupe de projection limitée vérifie une entreprise déjà fournie dans la projection lisible et une autre omise : seuls les champs présents sont recherchés et affichés, aucun e-mail n’est reconstitué et la recherche ne déclenche aucune requête supplémentaire.

Les neuf parcours antérieurs gardent leurs assertions de sélection/retrait/remplacement explicites, de saisie seule et d’Entrée sans choix actif sans soumission, de navigation Flèche bas/haut/Entrée, d’Échap fermant d’abord les suggestions, de création/édition/brouillon issu d’un Contact et du nom complet dans le détail. Ils conservent les contrôles du select natif Responsables sans recherche, de Lead, de la recherche générale, des références historiques non lisibles omises d’un patch de notes, de l’absence d’options Contacts, de la révocation des étiquettes, de l’erreur de sauvegarde et du conflit simulés avec brouillon préservé.

Les dimensions du document et des dialogues restent dans le viewport horizontal. Les captures desktop Chromium et mobile WebKit ont été inspectées. `ui-browser-results.json` contient les dix résultats et les treize audits : **0 tentative externe, 0 erreur JavaScript, 0 erreur console inattendue**. Les 503 volontairement simulés sont répertoriés séparément.

Les personnes, contacts, comptes, tâches et IDs sont entièrement fictifs. Seuls `list`, `directory`, `contacts` et `mutate` sous `/__task_fixture/` sont interceptés ; les confirmations et rechargements utilisent une closure Playwright en mémoire. La garde réseau existante est copiée dans un dossier temporaire avec le seul remplacement du port fixe 3201 par 3203. Aucune `.env` métier n’est chargée ; aucune Auth, RPC, SQL, base de données, création de compte ou écriture métier n’est exécutée. Le banc rend les composants Tâches dans une page isolée, sans rendre les pages CRM complètes. Il ne constitue pas une preuve authentifiée en Production ou sur iPhone physique.

Reproduction dans la copie jetable, en deux terminaux :

```sh
TASKS_COMPANY_SEARCH_ACK=TASKS_UI_FICTION_ONLY TASKS_COMPANY_SEARCH_BASE=b33ec9841d111727f48ace0f3c06ec2830da4b13 node tests/tasks/company-search-serve.mjs
TASKS_COMPANY_SEARCH_ACK=TASKS_UI_FICTION_ONLY node tests/tasks/company-search-browser.mjs
```

Attendre `READY http://127.0.0.1:3203/company-demo` avant la seconde commande. Le serveur a été arrêté après cette preuve.
