# Ouverture progressive — banc local gardé

Ces scripts utilisent exclusivement les comptes `@example.invalid` et les services possédés sur 127.0.0.1:56031/56032. Ne jamais les adapter à une base réelle. Aucun `.env` du dépôt n’est chargé.

- `setup.mjs` crée neuf projets fictifs comparables (0/6/24 photos, trois répétitions). Sans `--new`, conserve les mêmes fixtures.
- `measure.mjs` mesure liste, premier clic, réouverture et lien direct dans Chromium, avec les vrais Auth/RPC/Storage. `MEASURE_LABEL=before|after`, `COLLAPSE_FIXTURE` vers le fichier privé du stack. Utiliser deux builds de production avec exactement les mêmes fixtures et le même catalogue, sans exécuter d’autres setups entre les mesures. Aucun ralentissement simulé.
- `repository.test.ts` vérifie l’absence de photos dans la lecture différée, la conservation exacte des références sur sauvegarde partielle, les identités distinctes de relecture à révision inchangée, le blocage des modifications de galerie non hydratée, la concurrence bornée, l’échec explicite, l’annulation, la pagination complète/projection et les valeurs guidées nulles. Vérifie aussi l’admission des photos préparées d’une création inachevée.
- `browser.mjs` vérifie consultation avant médias, absence d’éditeurs non utilisés, sauvegarde de texte pendant le chargement, changement interne de projet, aperçu indisponible et ajout réel d’une photo après hydratation (galerie fictive restaurée). Le délai artificiel de 900 ms et le HTTP503 injecté servent seulement à la correction fonctionnelle, jamais aux mesures.
- `preview-cache.mjs` utilise le vrai handler, Auth/RPC/Storage : miss/hit/304, droits révoqués sur cache chaud et révocation entre lecture originale et réponse. Vérifie aussi le refus serveur d’un changement de version d’original immuable. Restaure les droits et affectations fictifs.
- `restricted.mjs` vérifie le lecteur affecté sans export, ses six aperçus, l’absence d’édition/transfert d’original et le lien direct non affecté. Restaure les droits et affectations fictifs.

```sh
node --require ./tests/i18n/register-typescript.cjs --test tests/fonciere-loading/repository.test.ts
```

Pour les scripts utilisant `../fonciere-arbitrage/local.mjs`, définir `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY` et `ARBITRAGE_STATUS_FILE` vers le statut privé du stack. Le test du handler se lance avec `node --conditions=react-server tests/fonciere-loading/preview-cache.mjs`. Les scripts navigateur utilisent également `COLLAPSE_FIXTURE` pour `browser.mjs`/`measure.mjs`.

Le serveur est le harnais source identique `tests/fonciere-sensitive/serve.mjs`, en mode production, avec ses trois variables de garde documentées. Le mode local du handler requiert `PREPAID_HOURS_TEST_ACK=PREPAID_HOURS_LOCAL_ONLY`. Les requêtes externes du navigateur sont bloquées. Les sorties privées restent hors Git ; ne pas publier les fixtures, sessions ou clés.

Réutiliser ensuite les campagnes de consultation et cohérence (leurs propres setups modifient le catalogue fictif, donc seulement après les benchmarks). Les chiffres de ce banc local ne constituent pas une mesure de production ; les limites et métriques exactes figurent dans `docs/fonciere/loading-verification.md`.
