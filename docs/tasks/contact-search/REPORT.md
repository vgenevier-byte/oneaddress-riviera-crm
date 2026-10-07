# Contact lié recherchable dans Tâches

Base publiée vérifiée : `8136406ae8b38c0c43c3322d4b1d88983e2cb9cc`, déploiement `dpl_4VpeYDgewPvH4X4wZPGEXJgNa5AR` READY. Travail effectué dans une copie isolée ; le checkout principal et ses 107 fichiers locaux sont préservés.

Le menu Contact lié est remplacé, en création et modification, par « Contact lié — facultatif » et une recherche avec suggestions. La comparaison porte sur les champs prénom et nom, ignore casse, accents Unicode et espaces superflus, accepte les mots partiels dans les deux ordres. L'affichage conserve les valeurs enregistrées ; les noms composés, champs absents ou composés seulement d'espaces et sociétés restent utilisables.

Le texte recherché ne constitue jamais un rattachement. Seul un choix explicite d'une fiche existante change le `contactId` du brouillon. Un choix retenu reste affiché pendant une autre recherche, peut être retiré ou remplacé explicitement, et ne devient effectif qu'après confirmation de l'enregistrement. Entrée sélectionne le résultat activé sans soumettre le formulaire ; un résultat unique n'est pas choisi automatiquement. Échap ferme d'abord les suggestions.

Les deux parcours fournissent prénom et nom depuis leurs projections Contacts autorisées. CRMApp utilise les Contacts déjà autorisés, avec un contrôle du droit Contacts. ModuleWorkspace charge la projection dédiée `crm_reference_options('contacts')` uniquement si Contacts est lisible. Aucun payload CRM global supplémentaire n'est chargé pour un compte limité. La définition SQL déjà publiée de cette projection fournit `firstName`, `name` et `companyName` : aucune migration ni extension serveur n'est nécessaire.

Les sociétés et emails distinguent les homonymes lorsqu'ils figurent déjà dans la projection. L'email absent de la projection de références limitée reste absent ; aucune autre source n'est interrogée pour le compléter. Un lien devenu non consultable garde son ID sans divulguer son nom ou ses coordonnées ; une modification d'autres champs omet `contactId` du patch.

Seuls cinq fichiers produit sont concernés : `components/TasksWorkspace.tsx`, `components/TaskContactPicker.tsx`, `components/CRMApp.tsx`, `components/ModuleWorkspace.tsx` et `lib/tasks/contactOptions.ts`. Responsables reste un menu natif sans recherche ; son annuaire, ses étiquettes, les gestionnaires et responsables inactifs sont inchangés. Lead lié, recherche générale, mutations, confirmation, conflits et contrôles serveur restent identiques à la base. Historique repliable, retrait du panneau de reprise, diagnostic Google, œil des mots de passe, Publisher et autres modules restent conservés. Contacts → Drive est exclu.

Validation : 7/7 tests helper et 9/9 groupes navigateur fictifs réussis. TypeScript, build complet et diff-check ciblé réussis. Lint : aucune erreur ; seul l'avertissement préexistant `@next/next/no-img-element` dans CRMApp demeure, également constaté sur la base publiée.

Les parcours navigateur importent les composants réels, sans les modifier, dans une page isolée. Les réponses HTTP et le rechargement sont simulés en mémoire : aucune Auth, RPC, base, création de compte ou écriture métier réelle. Aucun appel externe ni erreur JavaScript constaté. Chromium 1440, Chromium tactile 390 et WebKit tactile 390 ont été testés ; aucune preuve de téléphone physique ou de session CRM authentifiée en Production n'est revendiquée.

Preuves : `UI-PROOF.md`, `ui-browser-results.json`, `ui-source-manifest.json`, `VALIDATION.json`, captures et `diff.patch` dans ce dossier. Les empreintes relient les sources testées au candidat ; la provenance GitHub/Vercel et les deux domaines sont vérifiés séparément lors de la publication, sans nouvelle sauvegarde globale ni maintenance des saisies.
