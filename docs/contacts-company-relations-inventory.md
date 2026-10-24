# Inventaire Contacts et aperçu de reprise

Inventaire lu en Production le 24 octobre 2026 avant toute mutation de Contacts. Le détail contenant les identités personnelles et les sauvegardes reste hors du dépôt, dans un répertoire privé sous /private/tmp. Ce rapport ne contient aucune donnée personnelle issue de la Production.

## État initial

- 53 fiches : 9 entreprises explicites, 10 personnes explicites, 34 fiches historiques sans entityType.
- Aucun identifiant d'entreprise dupliqué et aucun doublon d'entreprise établi par des preuves suffisantes.
- 6 entreprises explicites contiennent encore un prénom d'interlocuteur ; 4 contiennent aussi un nom.
- Les deux entreprises contenant une identité complète déjà présente comme personne ont aussi exactement le même téléphone que cette personne.
- 2 autres entreprises contiennent une identité complète sans personne correspondante.
- 2 entreprises ne contiennent qu'un prénom et doivent être complétées ; 3 entreprises ne contiennent aucune identité personnelle.
- 2 paires de personnes présentent le même prénom, nom, téléphone et libellé d'entreprise. Elles restent distinctes dans cet aperçu et font l'objet d'un contrôle séparé.

## Aperçu conservateur

Le plan certain comprend les rapprochements automatiques suivants et les confirmations humaines reçues après l'inventaire :

1. Rattacher 2 personnes existantes sur la base du prénom, nom, téléphone et libellé d'entreprise explicitement identiques ; rattacher 2 autres personnes qui déclarent explicitement l'entreprise exacte dans companyName, avec une seule entreprise correspondante et aucune contradiction d'identité.
2. Créer 2 véritables fiches personnes depuis les identités complètes inscrites dans 2 anciennes entreprises, puis les rattacher atomiquement.
3. Rattacher 2 autres personnes existantes à une entreprise après confirmation humaine explicite de leur appartenance ; le domaine email seul n'a pas été utilisé comme preuve.
4. Après confirmation humaine que deux dénominations désignent la même société, qualifier une ancienne fiche mixte comme entreprise et une autre comme personne, puis établir leur lien. Les deux identifiants, dénominations historiques, coordonnées et informations embarquées restent présents. Le prénom incomplet de l'ancienne fiche mixte reste à compléter ; aucune personne supplémentaire n'est inventée.
5. Conserver chaque identifiant, tous les champs originaux hormis les 2 classifications de nature explicitement approuvées, les valeurs divergentes et leur provenance.
6. Aucun regroupement d'identifiants d'entreprise et aucune fusion de personne dans cet aperçu.

Résultat attendu : 55 fiches, dont 10 entreprises, 13 personnes explicites et 32 fiches historiques non qualifiées. 9 personnes seront liées, dont 2 nouvelles et 7 existantes. Deux entreprises resteront « À compléter — contact requis ». Une société est regroupée par affiliation après confirmation humaine, sans suppression ni consolidation d'identifiant.

Les autres cas restent à compléter ou à valider : identités limitées à un prénom et doublons potentiels de personnes avec des états métier différents. L'utilisateur a précisé que « X » signifie identité inconnue ; aucune personne portant ce libellé n'est créée. Aucun rapprochement n'est déduit d'une simple ressemblance. L'affiliation explicitement renseignée sur une personne et correspondant exactement à une unique fiche entreprise est distinguée d'une consolidation entre deux identités d'entreprises.

Les coordonnées anciennes ne sont pas reclassées silencieusement : une adresse générique reste sur l'entreprise. Une coordonnée d'origine indéterminée reste conservée sur la fiche source et dans la sauvegarde. Une identité personnelle issue d'une ancienne entreprise doit porter la provenance de sa création.

## Références à préserver

| Stockage | Références présentes et règle |
| --- | --- |
| Workspace JSON / contacts | Identifiants, banques prestataires et historique de chaque fiche conservés. Aucun changement de propriétaire de document. |
| Workspace / vendorQuotes | 3 contactId existants ; conserver les identifiants, contactName et contactPersonName historiques, documents et montants. |
| Workspace / vendorInvoices | 8 contactId existants ; conserver références, comptes bancaires, paiements et montants. |
| Workspace / houseTrackingWorkers | 3 contactId renseignés sur 4 intervenants ; conserver les identités, interventions et paiements. |
| Workspace / leads, quotes, planningEntries, properties | Libellés libres et instantanés historiques conservés ; ils ne constituent pas une preuve d'identité. |
| Workspace / documents | 10 fiches ; tous les chemins, identifiants et libellés sont conservés. |
| app_private.task_records | 11 tâches ; 1 lien contact présent dans une tâche supprimée. Préserver aussi legacy_original. |
| app_private.task_identity_links | 2 liens d'identité ; 1 contact_id renseigné. Aucune extension des droits. |
| app_private.task_events | 32 événements ; instantanés immuables. |
| public.fonciere_project_contacts | Aucun lien existant en Production. Conserver le rôle entreprise dans agency_contact_id et le rôle personne dans contact_id lors des nouvelles opérations. |
| public.fonciere_projects | Aucun projet existant en Production. Les liens canoniques et les champs locaux restent distincts. |
| public.izord_projects / izord_project_versions | Aucun projet ni version existant en Production. Les présentations restent des instantanés indépendants. |
| public.crm_document_scopes | 16 ressources : 8 documents généraux, 5 documents personnels d'un même contact, 3 documents de devis. Aucun déplacement, partage ou élargissement des droits. |
| public.crm_document_shares | 8 lignes ; conserver à l'identique. |
| app_private.document_drive_trash | 2 journaux ; conserver à l'identique. |
| public.crm_contacts | Ancienne table vide ; la source active reste le workspace JSON. |
| public.crm_backups / historiques tâches | Archives à préserver ; une reprise ne réécrit aucun instantané ancien. |

## Sauvegarde, journal et relance

La sauvegarde privée contient le payload intégral exact, la révision et son empreinte calculée par Postgres. Un second fichier privé contient les empreintes des tables de référence et un troisième l'aperçu détaillé des opérations avec identifiants d'origine, critères d'identité et divergences.

Toute application doit vérifier la révision, verrouiller le workspace, conserver le snapshot initial et journaliser chaque opération avec un identifiant stable. Les nouvelles personnes issues d'entreprises utilisent un identifiant déterministe. Une relance doit constater les liens déjà établis et rester sans effet. Une restauration ultérieure doit vérifier que les fiches n'ont pas été modifiées depuis l'opération pour éviter d'effacer un travail intervenu après la reprise.

Aucune mutation Production n'a été exécutée pendant cet inventaire. Les scripts administratifs ont été vérifiés sur une base PostgreSQL locale séparée et jetable : journal privé avec RLS, application répétée sans doublon, restauration exacte, refus après modification ou nouvelle référence externe, et concurrence réelle entre une écriture de référence et le rollback. Ces contrôles SQL ne remplacent pas les contrôles applicatifs de la tâche principale.
