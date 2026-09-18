# ESLint — maintien provisoire pour le développement local

**Décision documentée le 17 septembre 2026 : conserver provisoirement ESLint 9.39.5 et les versions compatibles du lockfile pour poursuivre uniquement la validation locale.** La branche ESLint 9 est hors maintenance officielle depuis le **6 août 2026**. Ce report ne constitue ni une garantie de sécurité, ni une acceptation pour la Production, ni une autorisation de publication.

Cette décision applique le point 2 de `Prompt_Codex_Finaliser_Test_Navigateur.txt`, reçu dans `IZORD_OAR_Revue_Nextjs_Et_Test_Navigateur_Pour_Codex.zip`. La revue et `Controles_independants.json` joints ont été lus. Les faits ci-dessous reprennent les sources officielles et preuves déjà collectées le 17 septembre ; leur documentation ne constitue pas une nouvelle interrogation du registre, installation ou exécution de tests.

## Point de maintenance ouvert

| Champ | Décision |
| --- | --- |
| Statut | Report temporaire limité au travail local ; réserve ouverte |
| Version conservée | ESLint **9.39.5**, `eslint-config-next` **16.3.5**, plugins et lockfile actuels |
| Responsable | **À désigner** |
| Réexamen | **Avant toute publication** et, si le développement se poursuit, **au plus tard le 17 octobre 2026** ; retenir la première échéance atteinte |
| Portée de la date | Échéance de revue, **pas une garantie de sécurité jusqu’à cette date** |
| Acceptation Production | Absente ; toute décision ultérieure doit être explicite et fondée sur la chaîne réellement destinée au déploiement |
| Automatisation | Aucune tâche en arrière-plan, aucun rappel ni mise à jour automatique créés ; aucun abonnement payant |

Le prochain réexamen devra vérifier les versions stables et leurs contraintes officielles, le support, les avis pertinents et les diagnostics du projet. Si une chaîne maintenue devient compatible, sa mise à niveau fera l’objet d’une décision explicite et de validations locales appropriées. Si le blocage demeure, le responsable devra documenter la suite ; cette échéance ne déclenche aucune installation ni acceptation automatique.

Le maintien local n’autorise pas `--force`, `--legacy-peer-deps`, un override pour contourner les peers, un remplacement de plugin/linter ou une désactivation de règle. Aucune version, configuration ESLint ou dépendance n’est modifiée par ce document.

## Contraintes déclarées qui empêchent l’adoption d’ESLint 10

La collecte officielle du 17 septembre identifie ESLint **10.10.0** comme stable et maintenu. Node **24.16.0**, utilisé lors de la validation locale, satisfait son moteur `^20.19.0 || ^22.13.0 || >=24`. Le preset Next installé accepte ESLint `>=9.0.0`, mais les trois plugins qu’il emploie déclarent des plages plus étroites :

| Plugin verrouillé | Version | Peer ESLint exact |
| --- | --- | --- |
| `eslint-plugin-react` | **7.37.5** | `^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7` |
| `eslint-plugin-jsx-a11y` | **6.10.2** | `^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9` |
| `eslint-plugin-import` | **2.32.0** | `^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9` |

La matrice archivée a examiné toutes les versions stables dans les plages du preset Next (`^7.37.0`, `^6.10.0`, `^2.32.0`) : aucune ne déclare accepter ESLint 10. Hooks **7.1.1** et le parseur TypeScript **8.70.0** acceptent déjà cette majeure ; ils ne sont pas ces trois blocages. Le peer permissif du preset Next ne remplace pas les contraintes de ses plugins.

**Il s’agit d’une incompatibilité de contraintes déclarées. ESLint 10 n’a été ni installé ni exécuté : aucune panne fonctionnelle de plugin sous ESLint 10 n’a été observée.** Aucun message `ERESOLVE`, crash de plugin ou échec d’exécution provenant d’une tentative ESLint 10 n’est invoqué comme preuve.

L’installation stricte déjà enregistrée avec ESLint 9 a réussi : `npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund`, puis `npm ls`, sans conflit déclaré. Son journal contient réellement :

```text
npm warn deprecated eslint@9.39.5: This version is no longer supported. Please see https://eslint.org/version-support for other options.
```

Le résultat d’audit sans vulnérabilité signalée à cette date ne rétablit pas la maintenance de la branche 9 et ne constitue pas une garantie d’absence de risque.

## Usage de développement, vérification, build et sorties locales

`package.json` classe ESLint et le preset Next dans `devDependencies`. La commande de vérification est `npm run lint` → `eslint .`. Le build utilise séparément `next build --webpack`, et le serveur `next start` ; Next 16 ne lance plus automatiquement le lint pendant le build. Le succès d’un build ne remplace donc pas la vérification ESLint.

ESLint était installé dans la copie propre utilisée pour préparer le build et a été exécuté lors de la vérification séparée. Une dépendance de développement hors support reste une réserve pour l’environnement de développement/vérification ; elle n’est pas automatiquement un défaut de l’autorisation exposée par l’application.

L’inspection antérieure du **build local optimisé conservé** a établi :

- **15 traces NFT**, couvrant 742 fichiers uniques présents, sans chemin vers le moteur ESLint, sa configuration ou ses plugins ;
- **94 fichiers de sortie serveur et 31 JavaScript client** examinés ; leurs quatre mentions `eslint` sont des exports de la constante interne Next `ESLINT_DEFAULT_DIRS`, pas le moteur d’analyse ;
- aucune sortie `.next/standalone` ou `.vercel/output` dans cette copie.

Ces résultats se limitent aux artefacts locaux inspectés. Ils ne prouvent pas l’absence de tout code tiers transformé, ni l’absence d’ESLint dans une future Production. **Aucun paquet effectivement déployé sur Vercel n’a été inspecté ou validé dans ce lot.** La présente note n’ajoute aucune nouvelle preuve de runtime, de build ou de déploiement.

## Deux avertissements conservés, règles toujours actives

La dernière sortie de lint conservée établit **0 erreur et 2 avertissements**, avec code de sortie 0. Les positions suivantes correspondent aux sources examinées le 17 septembre 2026. Aucun `eslint-disable` ni changement de sévérité n’est appliqué pour les faire disparaître.

### Navigation complète après déconnexion

Fichier : `components/AccessPortal.tsx`, **ligne 121, colonne 5** (fin 121:38). Règle : **`@next/next/no-location-assign-relative-destination`**, sévérité 1.

Message complet conservé :

> Do not use `window.location.assign()` to navigate to internal Next.js pages. Use `redirect()` in the render phase, or `useRouter().push()` in Client Components' event handlers instead. See: https://nextjs.org/docs/messages/no-location-assign-relative-destination

Le code efface la mémoire métier, exécute la déconnexion et diffuse le reset avant `window.location.assign("/spaces")`. La navigation complète abandonne le contexte JavaScript. La remplacer mécaniquement par une navigation client modifierait cette frontière de session et demanderait une validation dédiée. **Impact conservé : rechargement complet de la page.** Ce comportement ne remplace pas les autorisations serveur. La règle demeure active et cet avertissement reste visible pour revue.

### Aperçu image d’une facture

Fichier : `components/CRMApp.tsx`, **ligne 5126, colonne 19** (fin 5126:94). Règle : **`@next/next/no-img-element`**, sévérité 1.

Message complet conservé :

> Using `<img>` could result in slower LCP and higher bandwidth. Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images. This may incur additional usage or cost from your provider. See: https://nextjs.org/docs/messages/no-img-element

L’élément affiche l’URL d’aperçu de la facture. Pour le document Storage privé, le code télécharge avec l’accès authentifié puis crée une URL blob, révoquée à la fermeture. Une branche historique accepte aussi une URL externe : toutes les sources ne sont donc pas exclusivement des blobs. Conserver `<img>` évite de modifier le transport documentaire pour une optimisation d’image. **Impact conservé : aperçu sans optimisation Next, avec le coût potentiel de performance/bande passante signalé.** Le logo public a déjà été adapté séparément ; aucun document privé n’est rendu public pour satisfaire cette règle. L’avertissement reste actif et visible.

## Sources et preuves conservées

Sources publiques **déjà collectées le 17 septembre 2026**, sans nouvelle veille pour cette note :

- [Politique de support ESLint](https://eslint.org/version-support/) : branche 9 EOL le 6 août, branche 10 maintenue ; [migration ESLint 10](https://eslint.org/docs/latest/use/migrate-to-10.0.0).
- Métadonnées npm officielles : [ESLint 10.10.0](https://registry.npmjs.org/eslint/10.10.0), [preset Next 16.3.5](https://registry.npmjs.org/eslint-config-next/16.3.5), [React 7.37.5](https://registry.npmjs.org/eslint-plugin-react/7.37.5), [JSX a11y 6.10.2](https://registry.npmjs.org/eslint-plugin-jsx-a11y/6.10.2), [import 2.32.0](https://registry.npmjs.org/eslint-plugin-import/2.32.0).
- Références également citées par la revue reçue : [Next 16, installation et lint](https://nextjs.org/docs/app/getting-started/installation), [warning image](https://nextjs.org/docs/messages/no-img-element).

Le [rapport Next.js local](NEXTJS_REVIEW.md) définit le dossier de preuves `B` du complément du 17 septembre. Les pièces pertinentes sont `B/maintenance/RESEARCH.md`, `B/maintenance/evidence/compatibility-matrix.json`, les métadonnées `*-registry.json`, `B/npm-ci.log`, `B/lint-final.json`, `B/static-validation.json` et `B/exact-build-manifest.json`.

Dans l’archive de revue `IZORD-OAR-Nextjs-Lint-CDP-Revue-20260917-152341.zip`, `observations/ESLINT.md` et `observations/eslint-build-inspection.json` conservent l’inspection locale, les hashes et ses limites. Le dossier indépendant reçu ensuite reprend ces constats dans `Revue_Nextjs_Lint_CDP.md` et `Controles_independants.json` ; il ne prétend pas avoir réexécuté le lint, le build complet ou la Production.
