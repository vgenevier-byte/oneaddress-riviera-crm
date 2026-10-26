# Saisie des forfaits prépayés en heures

Les réglages, la création et le renouvellement présentent « Volume du forfait (heures) » / « Package volume (hours) ». Un volume enregistré à 1 800 minutes se présente comme `30` ; `30,5` et `30.5` deviennent exactement 1 830 minutes.

La conversion reste exclusivement dans l’interface. Les RPC reçoivent les mêmes champs `defaultMinutes` et `capacityMinutes`, en minutes entières. Les signatures de rejeu sont calculées après cette conversion : `30`, `30,0` et `30.00` produisent le même patch canonique. Les identifiants de requête et du paiement sont conservés après une réponse perdue.

Les fractions d’heure finies restent éditables en décimal. Pour les durées sans représentation décimale finie, le champ garde une forme exacte telle que `30 h 01`, également acceptée à la saisie. Les résumés, historiques et détails des Charges mensuelles affichent les heures et minutes, sans arrondi d’affichage. Aucune contrainte aux quarts d’heure n’est ajoutée ; `30,1` vaut 1 806 minutes. Une fraction de minute est refusée explicitement, sans modification silencieuse.

## Périmètre préservé

Le registre, les calculs, les RPC, les migrations, les autorisations et les données de production ne sont pas modifiés. Aucun rapprochement de Troy ni paiement de production n’a été exécuté. Les prix, paiements, consommations, affectations et soldes des données existantes sont conservés. Les essais financiers concernent uniquement les sources fictives de la pile isolée.

Le checkout principal `/Users/vg/Desktop/OARcrm-repo` reste inchangé. Le correctif part du commit `3c76a2eeddfeac49da2c754b0d3b53531886c50c`, dans `/private/tmp/oar-prepaid-hours-input`, branche `codex/prepaid-hours-input`.

## Contrôles ciblés

- TypeScript global : `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- ESLint ciblé : les deux composants modifiés, le convertisseur et les scripts/tests modifiés.
- 18 tests unitaires et métier : 5 tests de conversion, 8 tests des calculs prépayés, 5 tests de rapprochement. Les tests de conversion couvrent les allers-retours de 1 à 3 000 minutes, la limite serveur existante et les limites d’entiers sûrs, en français et en anglais.
- Vérification React : hooks, champs contrôlés ou non contrôlés, description unique et libellé accessible, brouillons, droits et blocages pendant la sauvegarde.
- Compilation de production réussie : les 21 empreintes de sources testées concordent avec le correctif. Log dans `build.log`, empreintes dans `source-hashes.json`.
- 9 parcours navigateur de persistance réussis : réglages, création et renouvellement à 30 h et 30 h 30 ; virgule/point, relecture après nouvelle connexion, FR sur ordinateur et EN sur viewport mobile, accès complet/limité/lecture seule, pertes de réponse et clés de rejeu, durées historiques exactes, conservation des prix et sources. Rapport : `browser-results.json`.
- 3 contrôles des Charges mensuelles réussis : lecture locale réelle, projection en mémoire de 31 minutes affichée `0 h 31`, projection invalide gardant son diagnostic sans exception. Les deux projections ne sont pas des preuves de persistance ; elles ne sont pas enregistrées. Rapport : `monthly-display-results.json`.
- Résultats techniques consolidés dans `checks.json`.
- `git diff --check` sur le checkout du correctif.

Compilation des tests ciblés :

```sh
node node_modules/typescript/bin/tsc --target ES2017 --lib ESNext,DOM --module commonjs --moduleResolution node --esModuleInterop --strict --skipLibCheck --outDir /private/tmp/prepaid-hours-regression-test tests/prepaid-hours/hours-input.test.ts tests/prepaid-hours/calculations.test.ts
node --test /private/tmp/prepaid-hours-regression-test/tests/prepaid-hours/hours-input.test.js /private/tmp/prepaid-hours-regression-test/tests/prepaid-hours/calculations.test.js tests/prepaid-hours/reconciliation.test.mjs
```

Les parcours navigateur utilisent Auth, JWT, RPC et PostgreSQL réels sur la pile jetable gardée par `tests/prepaid-hours/server-local.mjs`. Le serveur d’application dédié utilise le port `3198`, distinct de l’autre aperçu local. Aucun fichier `.env` du dépôt n’est chargé ; les requêtes navigateur externes sont bloquées.

```sh
PREPAID_HOURS_STATUS_FILE=/chemin/privé/local-status.json PREPAID_HOURS_TEST_ACK=PREPAID_HOURS_LOCAL_ONLY PREPAID_HOURS_APP_PORT=3198 node tests/prepaid-hours/serve.mjs
PREPAID_HOURS_STATUS_FILE=/chemin/privé/local-status.json IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY PREPAID_HOURS_APP_ORIGIN=http://127.0.0.1:3198 node tests/prepaid-hours/hours-input.browser.mjs
```

Ces preuves concernent le navigateur sur ordinateur et un viewport mobile avec événements tactiles. Elles ne constituent pas un essai sur téléphone physique ni un test authentifié en production. Aucune publication n’est effectuée dans cette livraison locale.

Le serveur de prévisualisation dédié et la pile jetable de cette vérification ont été arrêtés après les essais. Les autres services locaux sont conservés.
