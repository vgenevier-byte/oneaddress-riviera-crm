# Contacts : personnes et dossier entreprise

Les personnes gardent leur identité, leurs coordonnées et leurs documents. Leur champ facultatif `companyId` référence une fiche entreprise existante ; le libellé historique `companyName` est conservé. Les entreprises présentent tous leurs interlocuteurs et peuvent désigner un `primaryContactId`.

## Enregistrement et accès

La création de l'entreprise et de son premier interlocuteur passe par un seul RPC transactionnel, pour le propriétaire comme pour les contributeurs. Il accepte soit une personne existante, soit les coordonnées propres d'une nouvelle personne. Les formulaires guidés, les adresses, le FR/EN, les brouillons et les créations depuis Foncière utilisent cette relation.

Le garde serveur vérifie l'état final du workspace pour tous les chemins, y compris les écritures globales et les RPC existants. Une entreprise nouvelle sans personne, un lien vers une entreprise absente et le retrait du dernier interlocuteur sont refusés. La session active, les permissions Contacts, le verrou du workspace et la révision sont contrôlés par le nouveau RPC. Les anciens clients qui omettent les nouveaux champs ne peuvent pas supprimer ces liens par omission.

Une ancienne entreprise incomplète conserve tous ses champs et affiche « À compléter — contact requis ». Une opération sur un autre module demeure possible ; sa régularisation ajoute une véritable personne. Les droits des documents restent attachés à chaque identifiant d'origine, sans héritage par l'entreprise.

Les consolidations explicites d'entreprises conservent une fiche source avec `mergedIntoCompanyId`, ses informations divergentes, ses documents et ses anciens accès. Les références métier et les instantanés historiques gardent leurs identifiants. Aucun alias ni marqueur de conformité ne peut être forgé par le catalogue d'écriture des contributeurs.

## Reprise

L'[inventaire initial](../contacts-company-relations-inventory.md) précède toute mutation. Après les confirmations humaines, la reprise appliquée rattache sept personnes existantes et crée deux personnes depuis des identités complètes déjà présentes. Deux fiches historiques sont qualifiées explicitement pour constituer un dossier entreprise commun avec son interlocuteur. Elle conserve les 53 identifiants initiaux et aboutit à 55 fiches. Aucun identifiant n'est consolidé et aucune personne n'est fusionnée.

Les valeurs, montants, références, coordonnées et documents originaux restent inchangés. Chaque nouvelle personne porte la provenance de sa création. Les coordonnées dont l'attribution est incertaine restent sur la fiche historique, avec une indication de cette incertitude.

Le script hors ligne `scripts/contact-company-reconcile.mjs` produit un aperçu et un SQL privé. L'application vérifie le snapshot et sa révision sous verrou, puis sauvegarde le payload intégral et les opérations dans un journal privé protégé par RLS et inaccessible aux rôles applicatifs. Un même plan est sans effet lors d'une seconde application. Le [retour arrière vérifié](reconciliation-verification.md) refuse de supprimer les corrections ou les références ajoutées après la reprise.

## Vérification et limites

Les tests ciblés couvrent les helpers, la recherche, les modifications partielles, les parcours Foncière et le plan de reprise. Les tests serveur utilisent de vraies sessions Auth locales, PostgREST et PostgreSQL avec des données fictives persistantes. Le retour arrière est testé séparément sur PostgreSQL 17, y compris une écriture concurrente et les références hors workspace.

Les résultats du navigateur (19 parcours Contacts, 20 Foncière), du contrôle serveur et de la reprise sont enregistrés dans ce dossier. La [vérification administrative en Production](production-data-verification.json) confirme les neuf liens, les deux entreprises à compléter, les champs originaux et onze ensembles de références inchangés. Une seconde application du plan est sans effet, avec la même révision. Le journal privé conserve le workspace initial et les dix-sept opérations ; ses tables sont inaccessibles aux rôles applicatifs.

L'analyse Supabase signale l'absence de politique sur le journal privé : c'est le refus d'accès attendu, avec RLS active et aucun privilège client. Elle signale aussi l'exécution authentifiée du nouveau RPC SECURITY DEFINER : son exposition est volontaire, avec contrôle de session active, permissions Contacts et révision ; les refus sont vérifiés localement. Les recommandations sont documentées par [Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Les alertes portant sur les anciennes fonctions et la configuration Auth ne sont pas modifiées par cette mission.

Les largeurs mobiles sont des simulations de viewport. Les validations locales et les lectures SQL administratives en Production ne constituent pas une session CRM utilisateur authentifiée en Production, ni une preuve d'accès à Google Drive. Le SHA et le déploiement sont communiqués au compte rendu de livraison.

Le checkout principal et ses modifications étrangères à cette mission sont conservés. La livraison part d'un worktree isolé basé sur le SHA Production vérifié `d5b7660e8da6f5c83406e5cf45ef16b283fba838`.
