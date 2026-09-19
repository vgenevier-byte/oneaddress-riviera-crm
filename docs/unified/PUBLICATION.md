# Publication proposée — ne pas exécuter sans autorisation distincte

Base de ce lot : `38f83b70cb4fa1e0230edd09bc92aad199a8a7b6`. Développement et migration uniquement locaux. Aucun changement Production n’a été réalisé.

## Choix de stockage et frontières

Le document `crm_workspace_state` reste l’unique source métier OAR. Aucune collection miroir et aucune double synchronisation. Les profils limités ne montent pas `CRMApp` : `crm_read_module` produit une projection de champs et lignes structurées explicitement autorisés ; `crm_mutate_record` applique une modification à un enregistrement d’une collection autorisée sous verrou, contrôle de révision et auteur Auth. La projection ne passe jamais dans le normaliseur/sauvegardeur global. Les révisions sont calculées sur les collections du module : deux modules indépendants peuvent écrire, deux versions du même module entrent en conflit.

Le parcours CRM historique est réservé au profil d’administration **explicitement complet**, y compris ses permissions sensibles. Les autres administrateurs utilisent les projections et l’administration selon leurs droits. Un simple `oar/member` ne suffit plus. Les tables historiques, sauvegardes, état brut, registre Drive et anciens RPC globaux exigent le profil complet. Les vues ou nouvelles tables éventuellement apparues en Production doivent être inventoriées avant publication : le banc historique ne prétend pas reproduire un schéma distant non vérifié.

Les rôles et affectations IZORD demeurent en place. Le droit modulaire est une condition supplémentaire. L’administration générale ne dérive jamais du rôle IZORD admin. Les verrous d’accès réutilisent la même clé transactionnelle que les opérations IZORD existantes. Les modifications des droits sont journalisées, sans jetons ni coordonnées bancaires. Les révisions de fiche empêchent un enregistrement concurrent périmé ; le dernier administrateur général actif ne peut pas être révoqué par l’interface/RPC.

Les documents OAR limités doivent avoir un rattachement explicite (`crm_document_scopes`) à une collection et un enregistrement existants. Une rubrique Documents seule ne suffit pas. Les fichiers historiques non classés restent fermés aux profils limités. Ne jamais classer les RIB par nom de fichier. `crm_classify_document` est réservé à l’administration générale ; les créations limitées utilisent `crm_new_document`. Les liens Drive incorporés aux comptes bancaires sont exclus des projections. Les photos nécessaires au rendu IZORD restent lisibles selon les règles du projet ; les fonctions d’export de l’application et les téléchargements de présentations ont leur droit distinct.

## Portée des parcours limités

Les profils limités réutilisent les vues/éditeurs métier nommés de CRMApp, les helpers Contacts/finance/maison/devis et le parseur de saisie rapide. Ils ne montent pas le composant CRMApp global. Le catalogue `lib/access/collections.json` définit les champs autorisés ; `crm_reference_options` fournit les références minimales. Les modifications restent ciblées et conservent les champs omis, y compris dans la ligne modifiée. Les imports/exportations globaux restent fermés. Les notes privées hors projection ne sont pas réexposées pour obtenir une ressemblance visuelle.

La saisie depuis message crée Contact + Lead dans une transaction, après validation et contrôles des deux modules. Refus et suppression d’un devis prestataire utilisent leurs RPC métier dédiées ; facture utilisée, RIB, preuve documentaire et références imbriquées restent protégés. Les documents Storage peuvent recevoir une nouvelle version classée sans écraser l’original ; les RIB et pièces de facture utilisée ne peuvent pas être remplacés génériquement. Le classement/renommage des documents est une métadonnée CRM ; la gestion physique de l’arborescence et l’écriture binaire Drive historique ne sont pas portées aux profils restreints dans ce lot. Voir les limites exactes dans REVUE_LOCALE.md.

Les opérations asynchrones sont rattachées à l’identité, au module et aux droits actuels ; elles ne reprennent pas la session B pour achever l’opération A. Une transaction déjà admise peut s’achever. La suppression via Réservations est refusée, la révision nulle de matrice aussi, et une invitation ordinaire ne réactive pas un ancien administrateur ni n’élargit un rôle IZORD existant.
Dashboard agrège uniquement les collections autorisées. Il ne présente pas les notifications privées du CRM complet. La contribution aux réservations exige aussi Contribution sur Devis (collection partagée). La validation des devis prestataires exige Contribution sur Devis prestataires **et** Factures prestataires dans la même transaction ; elle conserve la facture explicitement liée, refuse un lien cassé et ne rapproche jamais des récurrences par montant/titre/contact. Les nouveaux comptes bancaires restent À vérifier, les vérifications/principal/archives sont distinctes. Préparer le paiement requiert Contribution Factures + permission Paiement + lecture bancaire Contacts et un compte vérifié du fournisseur ; aucun virement.

Suivi maison expose la portée du module, donc l’ensemble des intervenants autorisés par ce module. Aucune portée « mes heures » n’est annoncée ou déduite d’un prénom/acteur. L’ajout d’une portée personnelle nécessiterait un rattachement Auth explicite.

Les données déjà reçues par un lecteur ou les fichiers déjà téléchargés ne peuvent pas être effacés à distance. Une révocation est vérifiée côté base à chaque opération ; l’écran se revérifie au focus et périodiquement (60 s), puis retire les composants/données concernés. Les capacités signées déjà émises gardent leur durée de vie. L’export contrôlé ne peut empêcher la recopie d’informations lisibles.

## Ordre de publication à faire approuver

1. Relever `HEAD`, `origin/main`, GitHub main et le déploiement courant sans écraser un lot plus récent. Relever le schéma réel : politiques, vues, fonctions SECURITY DEFINER, buckets/publicité, clés de capacités, utilisateurs et dernières invitations. Sauvegarder données, rôles et affectations hors Git, dans un emplacement privé.
2. Vérifier dans Auth l’identité de Vincent : UUID `dc495374-494b-420c-89d7-adb4667d8747`, email confirmé `vg@oneaddressriviera.com`. Ce couple est une **précondition à revérifier**, pas une autorisation actuelle. Examiner aussi les comptes apparus depuis le pilote ; aucune extension automatique OAR aux autres membres.
3. Préparer **avant toute activation des règles** le candidat applicatif exact : revue du diff complet (nouveaux fichiers inclus), checks, build et artefact de déploiement prêts. Le patch de partage expurgé n’est pas applicable automatiquement : repartir des sources revues et comparer les fichiers. Conserver le déploiement précédent pour le retour arrière fermé. Aucun WIF, `.env`, mot de passe, statut local ou dossier de preuve dans le livrable.
4. Préparer une fenêtre de transition : fermer/synchroniser les anciens onglets avec leurs propriétaires, suspendre leurs écritures, sauvegarder les brouillons et vérifier la récupération des caches. Aucune purge globale Chrome. **Ne pas activer de compte restreint à ce stade.**
5. Dans la même intervention contrôlée, appliquer le SQL additionnel intégral, puis le bootstrap du seul propriétaire vérifié ci-dessous. Prévoir la courte fermeture d’accès entre ces deux étapes : le candidat doit déjà être prêt. Vérifier invariants métier, appartenances et affectations IZORD ; aucune attribution OAR automatique à d’autres membres. En cas de précondition échouée : arrêt fermé, pas de réouverture des anciennes règles.
6. Publier l’artefact du SHA approuvé depuis un checkout propre. Vérifier provenance du SHA, READY, alias et connexion du propriétaire explicitement complet. Aucune autorisation du générateur antérieure ne vaut approbation de ce lot. Ne pas déduire une publication du seul push.
7. Seulement lorsque l’application et les gardes sont vérifiés ensemble : activer individuellement un profil pilote explicitement autorisé ; tester ses payloads/REST/RPC/Storage et les permissions sensibles avec son Auth réelle. Classer ses documents historiques avant leur ouverture. Aucun profil limité actif avant fermeture des anciens chemins globaux.
8. L’envoi d’invitations demeure désactivé tant que le transport/expéditeur, ses coûts éventuels, les destinations et la recette de livraison n’ont pas leur approbation distincte. Les comptes/profils réels ne sont pas créés par la démonstration locale.

### Bootstrap explicite du propriétaire (validé localement, non exécuté en Production)

Effectuer après une autorisation de publication et sauvegarde, dans une session administrative privée. Ne pas substituer une recherche par nom ni une métadonnée utilisateur.

```sql
begin;
do $$
declare owner_id uuid := 'dc495374-494b-420c-89d7-adb4667d8747'; m text;
begin
 if current_setting('crm.owner_bootstrap_approved', true) is distinct from 'REVIEWED_RELEASE_ONLY' then
   raise exception 'Explicit reviewed release acknowledgement required';
 end if;
 if not exists(select 1 from auth.users where id=owner_id
   and lower(email)='vg@oneaddressriviera.com' and email_confirmed_at is not null) then
   raise exception 'Owner identity mismatch: STOP';
 end if;
 if not exists(select 1 from public.app_memberships where user_id=owner_id
   and workspace_id='oar' and status='active') then raise exception 'Existing OAR owner membership missing: STOP'; end if;
 insert into public.crm_access_profiles(user_id,active,general_admin) values(owner_id,true,true)
 on conflict(user_id) do update set active=true,general_admin=true,revision=crm_access_profiles.revision+1;
 foreach m in array array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats'] loop
 insert into public.crm_module_grants(user_id,module,level,sensitive)
 values(owner_id,m,'contribute',jsonb_build_object('delete',true,'export',true)
   || case when m='contacts' then '{"bank_read":true,"bank_write":true}'::jsonb else '{}'::jsonb end
   || case when m='vendorInvoices' then '{"payment":true}'::jsonb else '{}'::jsonb end)
 on conflict(user_id,module) do update set level=excluded.level,sensitive=excluded.sensitive;
 end loop;
 -- No IZORD role or assignment is rewritten here.
 insert into public.crm_permission_events(actor_id,subject_id,action)
 values(owner_id,owner_id,'reviewed_owner_bootstrap');
end $$;
commit;
```

Le paramètre d’acquittement n’est volontairement pas activé par cet exemple. Relever le résultat et les droits effectifs avant de poursuivre. Le bloc exact a été exécuté une fois par `tests/unified/bootstrap.mjs`, avec substitution du seul UUID/email fictif, contrôles négatifs sous savepoints et rollback final au lieu du commit de publication. Les 9 contrôles réussissent : identité/acquittement, accès complet et seconde application, préservation IZORD/autres comptes/données, retrait des fixtures. Preuve : `/tmp/crm-unified-review/bootstrap-exact-2026-09-19T12-34-29-977Z.json`. Aucun compte réel modifié. Le bloc SQL de la source locale reste strictement identique à celui vérifié ; son SHA-256 figure dans la preuve et dans REVUE_LOCALE.md. Dans la copie de partage, la procédure est conservée mais les paramètres d’identité sont expurgés : cette empreinte porte donc sur la source locale privée, pas sur le bloc expurgé.

## Invitations : activation future distincte

`lib/server/invitations.ts` appelle maintenant les invitations **natives Supabase Auth**. Le banc utilise les mêmes API, bornées à Auth local 55431, Mailpit fictif 55434, retour 3160 et destinataires `@example.invalid`. Le secret serveur est utilisé uniquement pour `inviteUserByEmail`. Un compte existant reçoit un lien de connexion natif (`signInWithOtp`, `shouldCreateUser:false`, clé publique), sans recréation. L’état `needsPasswordSetup` est calculé par la base à partir du mot de passe Auth effectif, distinctement de l’existence du compte ; il permet aussi la reprise d’une invitation inachevée. Un compte déjà initialisé ne doit pas remplacer son mot de passe. Les RPC métier utilisent toujours le JWT de l’utilisateur.

La branche Production reste désactivée. Configuration CRM à renseigner uniquement lors d’une activation autorisée :

- `CRM_INVITATIONS_ENABLED=APPROVED_PRODUCTION_ACTIVATION` ;
- `CRM_INVITE_SUPABASE_ORIGIN` cohérente exactement avec `NEXT_PUBLIC_SUPABASE_URL` et sa clé publique ;
- `CRM_INVITE_RETURN_URL` HTTPS (racine CRM) et `CRM_INVITE_APPROVED_APP_ORIGIN`, à autoriser aussi dans les redirections Auth ; le query `invite` doit être conservé ;
- `CRM_INVITE_AUTH_KEY`, exclusivement serveur, jamais `NEXT_PUBLIC_*`.

Aucun `CRM_INVITE_DELIVERY_*`, relais externe, secret SMTP dans le CRM ou abonnement supplémentaire. Le modèle d’email Supabase doit conserver son lien natif `{{ .ConfirmationURL }}` et le retour demandé, y compris le jeton métier. Examiner le modèle existant avant toute adaptation : le callback local testé utilise le flux implicite natif, pas l’ancien lien personnalisé `token_hash/auth_type`, ni un échange PKCE.

### SMTP enregistré : confirmation du propriétaire

Le propriétaire confirme que **Google Workspace est enregistré dans le SMTP personnalisé Supabase** et qu’un email de récupération a été reçu avec le bon expéditeur. L’ancienne mention « SMTP indéterminé / paramètres non appliqués » est donc obsolète. Cette correction ne relit pas la configuration distante, ne refait pas ce test et ne change aucun paramètre SMTP. Aucun secret n’est repris dans les documents ; aucun collaborateur n’est ajouté à l’équipe Supabase et le SMTP du site reste intact.

La réception de récupération confirme ce seul parcours rapporté par le propriétaire. Elle ne prouve pas l’invitation depuis Administration, son retour natif sur le domaine réel, son acceptation et la reconnexion. Lors d’une mise en service explicitement autorisée, vérifier les variables CRM ci-dessus, le modèle natif et les redirections déjà en place, puis effectuer une invitation pilote autorisée. Ne pas remplacer à l’aveugle la configuration existante.

Aucun nouvel abonnement ni coût engagé. Les quotas effectifs et éventuels coûts liés à l’offre existante n’ont pas été relus ; ne pas promettre un coût nul. L’activation réelle des invitations reste distincte de la préparation locale. Aucun mot de passe Google à changer ou recopier dans Git, les logs ou la conversation.

### Protections et validation locale

Préparation des droits → envoi Auth → vérification du lien par Supabase → session du destinataire → acceptation CRM explicite. Création/confirmation Auth et métadonnées utilisateur n’accordent aucun droit métier. La base vérifie destinataire confirmé, jeton haché, expiration, révocation, créateur encore habilité, non-rejeu et anciens privilèges. L’interface attend `auth.initialize()` et bloque les erreurs de lien persistantes, même avec une ancienne session. Le mot de passe d’un compte encore sans mot de passe, nouveau ou relancé, est enregistré seulement après validation de l’acceptation ; celui d’un compte déjà initialisé reste intact. L’URL ne prouve ni identité ni droit et les métadonnées utilisateur ne sont pas une source de permissions. Un refus Auth du nouveau mot de passe maintient une étape de reprise après rechargement, sans rappeler le RPC déjà accepté ; le marqueur de reprise ne confère aucun droit.

Les résultats ciblés du 19 septembre sont référencés dans REVUE_LOCALE.md. Les campagnes métier historiques inchangées ne sont pas relancées. La seule adaptation SQL est le retour `needsPasswordSetup` dans `crm_invite_prepare`, remplacée et vérifiée dans la base locale avec conservation de ses ACL. Le précédent rejeu intégral reste une preuve historique, antérieure à cet ajout ; aucune exécution intégrale distante n’est revendiquée.

Les formulaires Contacts et Devis propagent désormais le résultat RPC jusqu’à leur confirmation : échec conservant la saisie, double envoi bloqué, réponses tardives liées au bon formulaire, révision initiale maintenue après conflit. Aucun changement du périmètre de droits ou de payload. Le candidat à publier doit comprendre **ensemble** le serveur d’invitations et la version SQL correspondante : l’absence du nouvel état serveur bloque l’envoi et révoque l’invitation préparée, sans fausse réussite.

## Retour arrière qui ne réouvre pas les accès

Ne pas supprimer les tables de droits, les politiques restrictives ou rétablir `has_membership('oar')` comme autorité globale. Conserver la migration de sécurité et les données métier, suspendre les profils limités au besoin, puis revenir au frontend précédent uniquement pour le propriétaire complet. Les anciens clients limités échoueront fermés sur les chemins bruts. Les droits/modifications métier validés après transition restent conservés ; aucune restauration aveugle du JSON global. Une restauration de données exige un rapprochement des révisions et une autorisation distincte. Réactiver les profils limités seulement après correction validée.
