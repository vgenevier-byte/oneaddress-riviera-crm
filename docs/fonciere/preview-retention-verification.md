# Aperçus privés conservés au retour à la liste — 31 octobre 2026

La correction retire uniquement la purge de `returnToList()` dans
`ProjectsWorkspace`. Le menu et « Tous les projets » gardent leur retour commun,
les confirmations, la conservation locale des brouillons, l’annulation des lectures
et l’invalidation des réponses tardives. Les purges au changement de compte,
d’autorisation, à la déconnexion et à l’échec d’admission restent inchangées.
Aucun contrôle serveur, fournisseur, stockage persistant ou limite mémoire ne change.

## Mesure avant/après

Référence : `46255be93c9e760408d1891a5c8c4656c2ac5fe3`, qui contient `fe2e008`
et les changements Drive ensuite publiés. Deux builds de production du CRM complet,
sources identiques sauf la purge retirée ; même base locale, mêmes comptes fictifs,
mêmes trois projets de 24 JPEG. Trois réouvertures par moyen de retour, après
chargement complet. Aucun délai artificiel dans ces mesures.

| Par réouverture, identique sur les 6 passages | Avant | Après |
|---|---:|---:|
| Corps JPEG reçus par Chromium | 5 341 664 octets | 0 octet |
| Requêtes d’aperçu | 24 | 24 |
| Réponses | 24 × 200 | 24 × 304 |
| Requêtes avec If-None-Match | 0 | 24 |
| Admissions serveur `crm_drive_read` | 48 | 48 |
| Validations de métadonnées du fournisseur fictif | 240 | 240 |
| Lectures d’originaux par le handler, fournisseur fictif | 0 | 0 |
| Lectures d’originaux Supabase par le handler | 0 | 0 |

Les 5,34 Mo évités sont les corps JPEG vers le navigateur, pas une économie de
lectures d’originaux : le cache privé serveur évitait déjà ces dernières sur ces
réouvertures. Les requêtes et leurs en-têtes restent nécessaires. CDP rapporte
5 351 768 octets encodés avant et 0 sur ces 304 ; ce compteur à zéro sur 304 ne
signifie pas zéro trafic HTTP. La réduction publiée porte donc sur le corps JPEG.

Le fournisseur Google est un double local : les contrôles Auth/RPC et le handler
courant sont réels, mais les réponses Google et les révisions épinglées sont
fictives. Les 82 658 553 octets de sauvegardes Supabase chargés pour construire ce
double sont mesurés séparément, hors fenêtres comparées, identiques avant/après.
Aucune requête Google réelle ni conclusion sur les performances du Drive réel.
Le serveur HTTP de mesure ne simule pas de réponse de succès du handler.

## Contrôles

- Retour pendant les aperçus retardés : aucune réapparition, puis réouverture saine.
- ETag de version obsolète remplacé par un 200 contrôlé ; nouvelle version dans le
  cache client, puis revalidation 304. Remplacement de tête Google sans substitution
  de la révision historique épinglée ; identité fournisseur déplacée refusée.
- Modification de version d’un original lié refusée par Storage (`42501`).
- Révocation réelle temporaire d’un compte fictif : refus serveur du 304, aucun
  aperçu client réutilisé ; restauration du droit initial dans `finally` et nouvelle
  lecture admise sans ancien ETag. Aucune donnée métier modifiée.
- Tests des limites 96 entrées et 32 000 000 octets, isolation par jeton.
- Campagne de navigation existante réutilisée avec fournisseur de lecture sans
  mutation : 7 contrôles FR/ordinateur, EN/mobile, recherche/filtre/ordre,
  confirmation unique et annulation exacte, liens de tâches.
- 22 tests ciblés réussis ; TypeScript, lint, build de production et diff-check
  réussis. Lint : les deux avertissements préexistants d’AccessPortal et CRMApp.

Mesures et résultats synthétiques : `preview-retention-measurements.json`.
Résultats bruts non versionnés : `/private/tmp/preview-retention-evidence`.

```sh
# Banc possédé déjà préparé, API 127.0.0.1:57031, serveur CRM sur 3197.
IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY \
ARBITRAGE_STATUS_FILE=/path/to/owned/local-status.json \
COLLAPSE_FIXTURE=/path/to/owned/arbitrage-fixture.private.json \
MEASURE_LABEL=before node --conditions=react-server \
  tests/fonciere-loading/preview-retention.browser.mjs
# Reconstruire les sources corrigées, puis même commande avec MEASURE_LABEL=after.
# Même environnement pour preview-retention-security.mjs.
node --require ./tests/i18n/register-typescript.cjs --test \
  tests/fonciere-loading/repository.test.ts \
  tests/fonciere/projectSectionState.test.ts \
  tests/fonciere/contactCreation.test.ts
```

Les fixtures et identifiants restent hors Git. Aucun changement de schéma ni de
données métier, aucune nouvelle mise en cache publique ou persistante.
