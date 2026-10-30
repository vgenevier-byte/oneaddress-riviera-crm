# Cohérence Foncière / Présentations

Ces tests utilisent le harnais local gardé de `tests/fonciere-arbitrage`. Ne jamais les adapter à la production : ports API 56031/base 56032 et suffixe `@example.invalid` sont contrôlés. Les fichiers privés du stack fournissent les comptes fictifs ; aucune variable du dépôt n’est chargée.

- `model.test.ts` : aller-retour structuré, anciens instantanés, copie de présentation, mêmes résultats dans les exporteurs, correction humaine ciblée, dépendance référence/scénarios, durées, absence d’héritage d’une copie financière périmée, absence d’anciens aléas/frais de revente dans les résultats.
- `setup.mjs` : crée des projets et présentations fictifs indépendants et configure le compte administrateur fictif comme Vincent uniquement pour vérifier la remarque en cours pendant l’édition. Utilise `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY` et `ARBITRAGE_STATUS_FILE` comme les campagnes existantes.
- `browser.mjs` : après setup et démarrage du harnais `serve.mjs`, définir `COLLAPSE_FIXTURE` vers le fichier privé du stack ; couvre les trois délais, invalides/focus/remarque, les deux résolutions de scénarios et la reprise d’un fichier.
- `presentations.mjs` : mêmes variables serveur, après setup ; contrôle les vrais champs, résultats, sauvegarde/relecture et exports Chromium JSON/PPTX, les exclusions privées et l’enregistrement d’un instantané non lié dans Projets. Contrôle mobile anglais et clavier. Les deux campagnes ciblées utilisent des projets distincts.

Les campagnes serveur/navigateur consultation existantes peuvent être rejouées ensuite ; leur setup rétablit sa propre configuration de décideurs fictifs.

`reproduce.cjs` et le mode `CONSISTENCY_BASELINE=1` du navigateur ont servi avant correction : leurs assertions attendent les anciens défauts, pas le comportement corrigé. Les preuves avant correction sont conservées hors dépôt. Les tests de non-régression utilisent le mode normal et `model.test.ts`.

```sh
node --require ./tests/i18n/register-typescript.cjs --test tests/fonciere-consistency/model.test.ts
```

Portée, preuves et limites : `docs/fonciere/consistency-verification.md`.
