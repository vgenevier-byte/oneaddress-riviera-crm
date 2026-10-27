# Calendrier prévisionnel Foncière

Les hypothèses guidées personnelles comprennent désormais une stratégie distincte
des annonces d’agence et du mode locatif, une date civile de début de travaux,
une durée en mois et deux délais d’encaissement. Les durées restent non renseignées
jusqu’à un choix explicite, y compris zéro. Les choix usuels sont numériques et
une saisie contrôlée accepte les autres durées entières de 0 à 1 200 mois.

Chaque ajout de mois calendaires conserve le jour s’il existe, sinon retient le
dernier jour du mois d’arrivée. Le calcul se fait à chaque étape, sans timestamp,
fuseau horaire ou date du jour implicite. Exemple fictif : début le 31/01/2028,
un mois de travaux, disponibilité le 29/02/2028, deux mois avant le premier loyer
le 29/04/2028 et trois mois avant la vente le 29/05/2028. Les premiers encaissements
du scénario location puis revente sont les loyers, après trois mois cumulés.

Les scénarios inactifs restent stockés et consultables. Leurs échéances sont
exclues du calendrier. Un choix explicite de stratégie contrôle aussi les
hypothèses utilisées lors d’un nouveau transfert vers Présentations ; l’absence
historique de ce champ conserve la compatibilité des anciennes fiches.

Les champs sont inclus dans le `guided` existant et son instantané de transfert.
Le dossier bancaire utilise exclusivement l’instantané approuvé. La synthèse et
une diapositive PowerPoint éditable reprennent ce calendrier, ainsi que les notes.
Les diapositives suivent la convention française du modèle natif existant ; les
contrôles et la synthèse Foncière existent en FR/EN. Aucun planning n’est injecté
dans les présentations historiques sans données de calendrier, et les dossiers
déjà retravaillés gardent le mécanisme existant de conservation.

La migration `20261027203742_fonciere_project_calendar.sql` étend uniquement deux
fonctions privées de validation existantes. Elle ne réécrit aucune fiche, aucun
avis, aucune présentation ni aucune tâche Drive et ne change aucun droit. Les
dates civiles et les durées sont validées par le client et par PostgreSQL. Le
mécanisme existant d’empreinte demande la reconfirmation des deux avis après une
modification métier enregistrée. Le passage du temps et l’affichage sont purs.
Les formules financières, la durée de portage, la période locative et les mois
effectivement loués ne changent pas lors d’une modification du calendrier.

## Vérifications réellement exécutées

- 45 tests unitaires : calendrier, transfert, ancien modèle guidé, modèle Foncière
  et dossier bancaire. Calculs également exercés sous `TZ=Pacific/Honolulu` et
  `TZ=Europe/Paris`.
- 10 groupes serveur calendrier et 10 groupes arbitrage, dont les 16 combinaisons
  d’avis : véritables Auth, RPC, PostgreSQL et Storage Supabase locaux dédiés.
- 7 groupes navigateur sur la construction finale : saisie, valeur inconnue/zéro,
  validation, scénarios, incohérence, sauvegarde/rechargement/nouvelle connexion,
  clavier, lecture seule, français bureau et anglais mobile 390 px.
- 9 groupes présentation : instantané bancaire approuvé malgré modification
  ultérieure, réimport persistant avec nouvelle connexion, dossier retravaillé,
  export JSON et vrais PowerPoint de 2, 3 et 4 diapositives, photothèque,
  relations XML, géométrie, absence de remarques d’arbitrage privées.
- TypeScript sans erreur, lint complet sans erreur (deux avertissements antérieurs
  dans AccessPortal/CRMApp), `next build --webpack` réussi, `git diff --check` propre.
- La copie navigateur de production contient exactement les mêmes 266 fichiers
  applicatifs, vérifiés par SHA-256. Ses accès réseau sont limités aux services
  locaux ; aucune réponse de succès n’est simulée.

Les rapports et les captures fictives sont dans `verification/`. Les scripts
`tests/fonciere-calendar/server.mjs`, `browser.mjs` et `presentation.browser.mjs`
réutilisent la pile jetable documentée dans `tests/fonciere-arbitrage/README.md`.
Pour `browser.mjs`, utiliser `CALENDAR_FIXTURE` vers le fichier privé
`arbitrage-fixture.private.json` et `CALENDAR_OUTPUT` pour ses sorties. La campagne
présentation réutilise `IZORD_TEST_ACK`, `ARBITRAGE_STATUS_FILE` et
`ARBITRAGE_OUTPUT` du lanceur serveur.

Limites : mobile émulé Chromium, pas d’appareil physique. Le rendu des diapositives
a été inspecté dans l’aperçu navigateur ; les PowerPoint réels ont été inspectés
dans leur XML et leur géométrie, sans ouverture dans PowerPoint/LibreOffice.
Aucun scénario métier authentifié, avis fictif ou hypothèse fictive n’a été écrit
en production. Les vérifications après publication sont statiques et en lecture
seule. Les travaux locaux étrangers à cette mission restent dans le dépôt initial.
