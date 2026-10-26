# Sélecteurs recherchables des forfaits

`server-fixture.mjs` et `browser.mjs` utilisent uniquement la pile Supabase locale dédiée `prepaid-hours-stack-kekh3b`, son fichier `local-status.json` privé et de véritables connexions Auth/JWT/RPC. Les sources sont fictives ; aucun fichier `.env` du dépôt n'est chargé.

Préparer les sources avec `tests/prepaid-hours/server-reset.mjs`, puis `tests/prepaid-search/server-fixture.mjs`. Fournir `PREPAID_HOURS_STATUS_FILE` et `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`. L'application se lance avec le serveur isolé existant `tests/prepaid-hours/serve.mjs`, `PREPAID_HOURS_TEST_ACK=PREPAID_HOURS_LOCAL_ONLY`, sur `127.0.0.1:3197` ; Auth et RPC restent sur `127.0.0.1:56031`.

Le jeu contient 138 intervenants, 135 maisons, 133 paiements admissibles pour l'intervenant cible et 134 factures de son contact. Les cinq résultats ciblés se trouvent aux positions source 132 à 137, au-delà des 12 premiers résultats affichés. Deux personnes distinctes partagent une société canonique ; leurs anciens libellés ne contiennent ni leur nom actuel ni cette société. Les métadonnées de l'adresse cible sont cohérentes avec le champ adresse.

Les neuf scénarios du rapport `docs/prepaid-search/browser-results.json` vérifient les cinq sélecteurs, les noms inversés, accents, faute légère et société canonique, le clavier, les recherches sans affectation implicite d'identité, les contrôles désactivés pendant la sauvegarde, le rattachement d'un règlement existant et les liens explicites de factures. Le cas de réessai laisse d'abord le vrai RPC local enregistrer le paiement, puis simule une réponse HTTP 503 : après recherche sans changement de sélection, nouvelle sélection du même ID et reformattage du prix, le réessai conserve les identifiants de requête et de paiement et ne crée aucun doublon.

Les parcours FR sur ordinateur, EN avec viewport mobile et événements tactiles, l'accès restreint sans visibilité sur la société et les factures, ainsi que le lecteur sans droit d'écriture sont contrôlés. Une nouvelle authentification relit réellement les deux forfaits et l'unique nouveau paiement ; dates, durées, anciens taux et intervenant horaire restent inchangés. Ces tests ne constituent pas un essai sur téléphone physique ni une authentification en Production.

Les captures enregistrées sont fictives. Les contrôles Production de cette mission sont des lectures séparées destinées à vérifier la conservation du forfait réel de Troy, des autres données et des droits.
