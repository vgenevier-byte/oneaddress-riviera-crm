# Actualisation par les logos du CRM

`CRMRefreshButton` utilise le rechargement complet du navigateur (`window.location.reload()`). Le chemin, les paramètres et l’ancre restent ceux de la page courante. Les sessions et préférences ne sont pas modifiées.

Les hôtes et éditeurs enregistrent leurs protections dans un registre commun. Les saisies et fichiers des vues masquées y participent, y compris Projet → Contact et les remarques d’arbitrage. Un clic demande une seule confirmation de perte potentielle. Annuler conserve les éditeurs et leurs objets `File`. Une écriture ou un transfert en cours bloque l’actualisation et demande de réessayer après sa fin ; aucun rechargement différé, aucune sauvegarde métier ou relance d’écriture n’est déclenché par le logo.

Les boutons conservent les images existantes, leurs dimensions et leurs règles de visibilité. Ils portent le libellé « Actualiser le CRM » / « Refresh CRM », utilisent `type="button"`, Entrée/Espace et un focus visible. Le format téléphone à 390 px conserve son en-tête compact existant sans logo affiché ; le logo mobile existant est testé à 768 px.

## Vérification navigateur locale

Commande : `node tests/logo-refresh/browser.mjs`, sur une version de production construite avec `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3997` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-fixture-key`, servie sur `http://127.0.0.1:3199`.

Le test utilise Chrome via Playwright et uniquement un transport HTTP fictif. Chaque appel Auth, RPC, base et Drive reçoit une réponse en mémoire ; les autres origines et API sont bloquées. Aucune donnée réelle, migration ou publication externe n’est utilisée.

Résultat définitif sur le dernier build : **14 contrôles réussis sur 14**, aucune erreur de page ni requête inattendue. Les seuls appels d’écriture fictifs sont les trois actions explicitement soumises par le test (reprise Drive, sauvegarde maison échouée, sauvegarde Administration) ; les logos ne soumettent aucune écriture. Les résultats détaillés figurent dans `validation.json`. Les contrôles vérifient :

- Un nouveau document et une navigation de type `reload`, la totalité de l’URL et les valeurs de stockage de session/langue, dans le CRM classique, Administration et Foncière avec sa fiche identifiée.
- Une saisie classique et une modification Administration : annulation intégrale, puis confirmation unique sans second dialogue `beforeunload`.
- Le maintien de la protection native du navigateur après l’annulation d’un clic logo.
- Les boutons clavier et le focus EN à 768 px, la conservation de l’en-tête à 390 px et l’accès restreint.
- Trois clics synchrones sur le logo : une seule demande de nouveau document.
- Une remarque d’arbitrage sale dans Foncière masquée alors que l’Administration visible est propre.
- Les parcours Projet → Contact en accès complet et restreint : projet masqué avec saisie, PDF en attente et remarque d’arbitrage ; avertissement même lorsque le Contact visible est encore propre ; annulation puis confirmation.
- Une demande de reprise de transfert Drive retenue : clic bloqué pendant la requête et aucun rejeu après la réponse puis l’actualisation.
- Une sauvegarde maison retenue puis une réponse fictive 503 : clic bloqué pendant l’écriture, formulaire conservé après échec et avertissement avant rechargement, sans rejeu.
- Une sauvegarde Administration retenue : clics répétés bloqués, sauvegarde explicite terminée une fois et aucun rejeu après actualisation.

Limites : ces essais utilisent Chrome automatisé et des dimensions de fenêtre simulées ; ils ne couvrent pas tous les navigateurs ni des appareils physiques. Les réponses serveur sont simulées pour ces contrôles ; ils ne constituent pas une nouvelle validation Auth/RLS/Storage de production. Aucun scénario de saisie ou d’écriture n’est exécuté sur les alias de production. Les scripts existants de récupération et les droits métier sont conservés ; la confirmation autorise la perte des données qui ne sont pas récupérables par ces mécanismes existants.

## Contrôles de livraison

- `node_modules/.bin/tsc --noEmit --incremental false` : réussi.
- `npm run lint` : réussi, 0 erreur ; 2 avertissements préexistants, sur le `location.assign` de déconnexion dans AccessPortal et une image existante dans CRMApp.
- `npm run build` avec la configuration Supabase fictive ci-dessus : réussi.
- `git diff --check` : réussi.
- Test unitaire du coordinateur : `tsc lib/pageRefresh.ts tests/pageRefresh.test.ts --outDir /private/tmp/oar-logo-refresh-unit --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck --typeRoots /Users/vg/Desktop/OARcrm-repo/node_modules/@types`, puis `node --test /private/tmp/oar-logo-refresh-unit/tests/pageRefresh.test.js` : réussi (1 test regroupant les assertions du coordinateur).
