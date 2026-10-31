# Retour volontaire à la liste des projets — 31 octobre 2026

Le menu Foncière → Projets transmet une intention explicite `list` au workspace
conservé en mémoire. Le bouton Tous les projets utilise le même retour. Le portail
ne change sa destination qu’après acceptation. Les retours Contacts et les liens
de tâches gardent leurs chemins dédiés.

Le retour vérifie les opérations en cours (fiche, import, contacts, accès et
arbitrage), puis demande une seule confirmation pour la fiche, les fichiers et
l’avis non enregistrés. La conservation locale existante est terminée avant de
libérer le brouillon ; aucun enregistrement métier automatique ni suppression du
brouillon récupérable n’est ajouté. En cas d’échec de cette conservation, l’éditeur
et son URL restent ouverts. Les lectures/aperçus de la fiche sont annulés et leur
génération invalidée. L’URL devient exactement `/fonciere`, le contexte de tâche est
retiré et un clic ultérieur sur la même tâche peut rouvrir sa fiche. Le catalogue
léger n’est chargé que si nécessaire. Recherche, filtre et ordre restent en mémoire.

## Vérification locale

Build de production du CRM complet, source identique pour les quatre composants
modifiés, avec Auth/RPC/Storage réels sur le banc possédé en boucle locale. Comptes
et dossiers fictifs uniquement ; aucun accès métier à la production, aucun appel
IA, copie Drive ni changement de schéma. Chromium ordinateur FR et mobile EN
(390 × 900, émulation).

`tests/fonciere-loading/list-navigation.browser.mjs` : 11 contrôles réussis,
sans erreur navigateur :

- Fiche ouverte par lien direct puis menu : liste réelle et URL nettoyée, sans
  confirmation ; réponses d’aperçus retardées sans réouverture.
- Fiche ouverte depuis la liste : recherche, filtre de décision et ordre conservés,
  sur ordinateur FR et mobile EN. Le volet mobile se ferme après acceptation.
- Modification de texte : une confirmation ; annulation conservant URL et saisie ;
  retour confirmé conservant le brouillon local.
- Fichier PDF et texte : annulation sans perte, retour confirmé, reprise réelle du
  brouillon avec son fichier, puis aller-retour Contacts conservant ce brouillon.
- Clic pendant une vraie création/transfert local (requête retardée, puis laissée
  aboutir) : message de blocage temporaire, URL conservée, sauvegarde terminée avant
  retour à la liste. Aucune réponse de succès simulée.
- Compte lecteur : retour à sa liste autorisée sans confirmation.
- Décideur configuré : choix et remarque d’arbitrage non enregistrés, annulation
  exacte puis retour confirmé, une seule confirmation à chaque tentative.
- Cible de tâche : ouverture de la fiche, retour menu supprimant cible et ancre,
  absence de réouverture tardive, puis réouverture explicite de la même cible.

Résultats et captures fictives non versionnés :
`/private/tmp/project-list-evidence/final/all-results.json` et `list-{fr,en}.png`.

```sh
COLLAPSE_FIXTURE=/path/to/owned/arbitrage-fixture.private.json \
LIST_NAVIGATION_OUTPUT=/private/tmp/project-list-evidence/final \
node tests/fonciere-loading/list-navigation.browser.mjs

node --require ./tests/i18n/register-typescript.cjs --test \
  tests/fonciere-loading/repository.test.ts \
  tests/fonciere/projectSectionState.test.ts \
  tests/fonciere/contactCreation.test.ts
npx tsc --noEmit
npm run lint
git diff --check
```

19 tests ciblés réussis ; TypeScript et diff-check réussis. Lint sans erreur,
avec deux avertissements existants (actualisation du logo dans AccessPortal et
image dans CRMApp). Build `next build --webpack` réussi via le lanceur gardé
`tests/fonciere-sensitive/serve.mjs`, puis serveur de production testé.

La campagne historique `tests/fonciere-collapse/browser.mjs`, essayée en complément,
s’arrête sur son ancien sélecteur propriétaire situé dans un sous-bloc désormais
replié, avant ses cas Contacts. Elle n’est pas comptée comme réussie. Le test ciblé
ci-dessus ouvre le sous-bloc actuel et vérifie réellement le retour Contacts.

Les mesures locales et l’émulation mobile ne constituent pas une vérification
authentifiée de comptes réels en production. Aucune migration ni modification des
données métier de production n’est nécessaire pour cette livraison.
