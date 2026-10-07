# Contrat serveur de l’historique Administration

La migration `20261007171153_tasks_admin_history_pagination.sql` ajoute uniquement
`public.crm_admin_history_page`. Elle ne modifie aucune donnée, table, règle de
droits ou fonction existante. `NOTIFY pgrst, 'reload schema'`, émis au commit,
demande à PostgREST de découvrir la nouvelle RPC.

## Requête et réponse

```sql
public.crm_admin_history_page(
  p_before_id bigint default null,
  p_snapshot_id bigint default null,
  p_limit integer default 50
) returns jsonb
```

La première requête omet les deux curseurs, ou les transmet à `null`. Une requête
suivante transmet les chaînes décimales de `nextCursor.beforeId` et
`nextCursor.snapshotId` comme `p_before_id` et `p_snapshot_id`, sans conversion
JavaScript en `number`.

```ts
type AdministrationHistoryPage = {
  events: Array<{
    id: string;
    created_at: string;
    action: string;
    actor_id: string;
    subject_id: string | null;
  }>;
  nextCursor: { beforeId: string; snapshotId: string } | null;
  hasMore: boolean;
};
```

Les événements proviennent de `public.crm_permission_events`. La projection ne
renvoie ni `detail`, ni email, ni jointure vers une fiche utilisateur. Les UUID
acteur/sujet sont les identifiants déjà présents dans l’événement. Les IDs bigint
des événements et des curseurs sont convertis en chaînes côté SQL, y compris
au-delà de `Number.MAX_SAFE_INTEGER`.

La limite par défaut est de 50 événements ; les valeurs acceptées vont de 1 à
100. Une limite `null`, nulle, négative ou supérieure à 100 est refusée avec
`22023`. Les curseurs doivent être présents ensemble, positifs, correspondre à
des IDs existants et vérifier `beforeId <= snapshotId` ; sinon la RPC refuse la
requête avec `22023`.

La première lecture fixe l’ancre à `max(id)`. Chaque page sélectionne
`id <= snapshotId` et, pour la suite, `id < beforeId`, dans l’ordre `id DESC`.
L’ID unique départage aussi les événements ayant le même horodatage. Une ligne
supplémentaire permet de calculer `hasMore` sans l’exposer. `nextCursor` contient
l’ID du dernier événement affiché et l’ancre initiale seulement si une autre
page existe. Une page vide ou finale renvoie `hasMore: false` et
`nextCursor: null`.

## Autorisation

La fonction est `STABLE`, `SECURITY DEFINER`, avec `search_path=pg_catalog` et des
relations explicitement qualifiées. Son exécution est révoquée à `PUBLIC` et
`anon`, puis accordée à `authenticated`. Chaque appel vérifie également :

- `app_private.general_admin()` : profil CRM actif et administrateur général ;
- `app_private.document_actor_active(auth.uid())` : compte Auth confirmé,
  non supprimé et non banni ;
- un compte non anonyme ;
- une ligne `auth.sessions` associée à cet utilisateur et au `session_id` du JWT,
  avec `not_after` absent ou encore valide.

Un échec de ces gardes renvoie `general_admin_required` avec `42501`. Les
métadonnées Auth modifiables par l’utilisateur ne décident pas du droit Admin.
Cette RPC ne requiert pas le module Tasks : un administrateur général sans droit
Tasks peut consulter l’historique Administration. Elle n’accorde aucun droit
supplémentaire et n’ouvre pas les tâches privées à un administrateur extérieur à
leurs participants.

`crm_admin_users()` reste inchangée : son historique conserve son ancien plafond
de 100 lignes et sa projection existante. La nouvelle RPC fournit les pages
d’historique séparément ; elle ne remplace pas la gestion des droits ou des
invitations.

## Validation locale

`tests/tasks/admin-simplification-history-database.mjs` utilise le banc Supabase
fictif existant : API `http://127.0.0.1:55731`, PostgreSQL loopback port `55732`,
comptes `@example.invalid` et opt-in `TASKS_DISPOSABLE_LOCAL_ONLY`. La garde de
cible refuse toute autre destination. Les tests utilisent de vrais comptes Auth,
connexions par mot de passe et appels HTTP RPC locaux.

Les sept groupes passent :

| Groupe | Vérification |
| --- | --- |
| 1. Fonction et accès | Corps SQL exact, `STABLE`, `SECURITY DEFINER`, search path, ACL, refus anonyme/non-admin et accès Admin indépendant de Tasks. |
| 2. Petits historiques | Pages de 0, 1, 3 et 4 événements, ordre strict et transition 3 puis 1 lorsque la limite vaut 3. |
| 3. Plus de 100 événements | Parcours complet de 134 événements par pages de 50, plafond de 100, aucun doublon/omission et exclusion d’une insertion concurrente d’ID supérieur à l’ancre. Ancien contrat `crm_admin_users()` conservé. |
| 4. Entrées invalides | Refus des limites invalides et des curseurs incomplets, non positifs, inversés ou inexistants. |
| 5. Bigint | Conservation exacte des IDs et curseurs supérieurs à `Number.MAX_SAFE_INTEGER`. |
| 6. Sessions | Refus après déconnexion Auth réelle, session expirée, profil désactivé, compte banni ou anonyme. |
| 7. Préservation | RPC en lecture seule, 17 tables préservées, définitions/ACL des fonctions et policies existantes inchangées ; refus de lecture d’une tâche par un administrateur non participant. |

Le test retire uniquement les nouveaux IDs d’événements et comptes fictifs qu’il
a créés, puis compare les données existantes à leur état initial. Il ne réinitialise
pas le banc, ne répare pas le registre de migrations, ne change aucun compte réel
et n’envoie aucun email d’invitation. Le résultat privé local indique
`cleanupComplete: true`, `productionQueries: 0` et `externalCalls: 0`.

Le dernier hash SHA-256 de la migration, incluant `NOTIFY`, est
`3237c9e14136828c33f6ab5a2beb8cbfc4180f55c5f835170dd7e0a42b5ccc5e`.

## Maintenance privée Tasks déjà existante

Cette section décrit les fonctions sources déjà livrées ; elle n’ajoute aucun
parcours de maintenance.

Dans `20261006202942_canonical_private_tasks.sql`,
`app_private.tasks_recovery_owner()` exige une session Tasks active, le droit
administrateur général et une liaison privée `task_identity_links` ayant
`verified_owner=true` pour l’utilisateur courant. Une catégorie Contact ou une
métadonnée Auth ne remplace pas cette preuve. La session Tasks active inclut les
contrôles du compte, du profil actif, de l’appartenance OAR active, du droit Tasks,
de l’absence d’invitation Tasks encore en attente et de la session réelle.

`crm_tasks_legacy_read()` utilise ce garde avant de lire la file privée
`task_legacy_archive`. Sa projection existante contient l’original archivé, la
raison, la révision de cet original et les informations de récupération et de
responsable. La nouvelle pagination Administration ne lit pas cette archive.

Les versions finales de `crm_tasks_legacy_recover(...)` et
`crm_tasks_legacy_manager(...)`, dans
`20261007132122_tasks_direct_account_assignment.sql`, exigent en plus
`module_allowed('tasks', true)`, donc Contribution Tasks. Elles conservent les
verrous, contrôles de révision et journaux de requêtes existants.

La récupération exige de 1 à 50 affectés éligibles et un responsable faisant
partie de ces affectés. Elle vérifie la paire exacte source/ID, la révision de
l’original et l’absence de récupération antérieure. L’original reste conservé ;
l’auteur demeure non confirmé (`creator_id=null`). Le changement de responsable
concerne seulement une tâche historique récupérée, non supprimée, avec original
conservé et sans auteur canonique ; il vérifie la révision, l’éligibilité du
nouveau responsable et l’ajoute explicitement aux participants, avec audit.

`crm_tasks_admin_directory()` et `crm_tasks_admin_identity(...)` conservent leur
garde session Tasks active et administrateur général. Ils gèrent les liaisons
privées optionnelles existantes, sans accorder de rôle Auth ni de droit de module.
La fonction d’identité vérifie aussi le compte cible actif et la référence
Contact « Membre de l’organisation » lorsqu’elle est requise. Ces fonctions et
leurs gardes ne sont pas modifiés par la migration d’historique.

## Limites de la preuve

Les tests démontrent le comportement du banc local, sans prouver une session
authentifiée Production ou un appareil physique. `NOTIFY` a été exécuté et la RPC
revérifiée localement ; aucune migration Production n’a été rejouée pour cette
validation.

L’ancre est une borne d’ID, pas un instantané transactionnel durable entre les
requêtes. Elle exclut les nouvelles insertions dont l’ID dépasse l’ancre. Elle ne
fige pas une modification ou suppression externe de lignes déjà présentes, ni
une transaction ayant réservé un ID inférieur à l’ancre mais ne le validant
qu’après la première lecture. Le scénario concurrent testé insère et valide un
nouvel ID supérieur après la première page.
