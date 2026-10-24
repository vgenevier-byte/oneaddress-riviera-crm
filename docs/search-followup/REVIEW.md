# Correctifs ciblés Documents et Personnel

Base de travail : `fb0f8e58cc1b59c952094abaa6d4d492cd5b2164`, dernière version de `origin/main` vérifiée au démarrage. Le checkout principal et ses 149 fichiers modifiés ou non suivis préexistants sont préservés.

Dans `DocumentsView`, toutes les actions de navigation passent par `navigateToFolder` : ouvrir un résultat, choisir un élément du fil d’Ariane, revenir à la racine ou utiliser le sélecteur. Le changement de dossier efface la recherche globale pour réafficher les seuls enfants directs du dossier choisi.

Dans `HouseTrackingView`, les champs de recherche des intervenants utilisent `createHouseWorkerFieldResolver`. Ce résolveur réutilise le moteur commun et cherche le contact par son ID uniquement dans la projection déjà fournie. Les champs autorisés du contact et de son entreprise canonique complètent les libellés historiques de l’intervenant. Il est utilisé dans le filtre général, les Heures, les Paiements et les Archives. Les valeurs sélectionnées et enregistrées restent `worker.id`, et les listes actifs/archivés conservent leurs filtres.

Aucun calcul ni gestionnaire d’enregistrement financier n’est changé. Les intervenants sans contact lisible restent recherchables par leur libellé et leur rôle historiques. Aucun droit, RPC ou schéma de base n’est modifié.

## Vérifications

- 13 nouvelles régressions isolées : quatre sur les callbacks JSX et projections réels de Documents, neuf sur les champs de recherche Personnel, les droits, identifiants et invariants financiers.
- Les quatre tests Documents exécutés contre le code antérieur échouent sur deux cas, dont le bouton Ouvrir qui conserve la recherche. Ils passent avec le correctif.
- 63 tests ciblés réussis, incluant ces 13 cas et les régressions existantes du moteur de recherche, des contacts et de Suivi maison.
- 208 contrôles navigateur intégrés réussis sur huit sessions : Chromium/WebKit, bureau/mobile émulé, français/anglais. Aucune erreur JavaScript ni requête Auth/RPC/API métier.
- TypeScript complet, lint complet, build Next.js et `git diff --check` réussis. Deux avertissements lint préexistants : navigation dans AccessPortal et image dans CRMApp.
- L’audit des sélecteurs reste valide : 72 contrôles natifs justifiés, 49 usages de sélecteurs avec recherche et sept usages de saisie libre avec suggestions.

Le banc navigateur importe les vues métier réelles `DocumentsView` et `HouseTrackingView`, le contexte de permissions et les styles globaux. Les composants métier ne sont pas remplacés par des copies simplifiées. Les fichiers testés sont vérifiés par empreintes SHA-256, voir `fixture-manifest.json`. Les parcours et captures sont consignés dans `browser-results.json` et `screenshots/`.

La sauvegarde des Heures et Paiements dans le navigateur est une simulation par callbacks et `localStorage`, avec reprise après rechargement. Les projections de droits sont fictives. Aucun appel Auth, RPC ou API métier, aucune écriture Supabase/Drive réelle ni session authentifiée Production n’est prouvé par ce banc. La vérification de publication porte séparément sur Vercel READY, le SHA de provenance et les réponses HTTP des deux alias.
