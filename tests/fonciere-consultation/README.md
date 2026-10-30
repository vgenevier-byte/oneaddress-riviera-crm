# Campagne locale Foncière consultation / scénarios

Réutilise le stack fictif gardé de `tests/fonciere-arbitrage/local.mjs`, jamais un `.env` du dépôt. Les scripts refusent une API autre que 127.0.0.1:56031, une base hors 56032 et les comptes sans suffixe `@example.invalid`. Ne pas les adapter à la production.

Domaine :

```sh
node --require ./tests/i18n/register-typescript.cjs --test tests/fonciere-consultation/*.test.ts
```

Serveur : définir `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`, `ARBITRAGE_STATUS_FILE` vers le fichier privé du stack possédé, et éventuellement `ARBITRAGE_OUTPUT`. Exécuter dans l’ordre `server.mjs`, `migration.mjs`. Le premier prépare `fixture.projects.consultation` pour le navigateur et les exports ; le second rejoue la migration exacte dans une transaction annulée.

Démarrer la copie source identique avec le harnais existant `tests/fonciere-arbitrage/serve.mjs` (sans `--dev` pour le build de production). Préparer le PDF texte fictif avec `tests/fonciere/agency-fixtures.py /private/tmp/fonciere-consult-agency` et les assets locaux via `npm run prebuild` avant le démarrage.

Navigateur : définir `COLLAPSE_FIXTURE` vers `arbitrage-fixture.private.json` du même stack ; lancer `node tests/fonciere-consultation/browser.mjs`. Chromium/Playwright doit être installé. `CONSULT_TEST_FILTER` permet de rejouer un parcours indépendant. Les requêtes externes sont bloquées.

Exports : après le navigateur, avec les variables serveur, exécuter `node tests/fonciere-consultation/presentations.mjs`. Ce test effectue les téléchargements JSON/PPTX réels, scanne toutes leurs parties XML et vérifie la conservation des dossiers retravaillés et anciens instantanés. Une nouvelle exécution complète commence par un nouveau `server.mjs`, car le test final modifie volontairement la référence du projet fictif.

Voir `docs/fonciere/consultation-rentals-verification.md` pour la portée et les limites.
