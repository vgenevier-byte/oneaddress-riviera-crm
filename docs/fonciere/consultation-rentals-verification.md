# Foncière — consultation et scénarios locatifs

Version issue de `c78f2721de8ca296805193e71be809b14d676b8b`, sans changement distant intervenu pendant la réalisation. Travail effectué dans une copie isolée ; le checkout local de l’utilisateur et ses modifications étrangères sont préservés.

## Comportements livrés

- Les projets complètement enregistrés s’ouvrent en consultation avec libellés/valeurs et détails historiques ; les huit replis et leurs préférences restent disponibles.
- Une seule édition de rubrique 01–07, avec sauvegarde réelle et relecture, annulation locale, trois choix de changement de rubrique, rapprochement explicite des conflits. Les imports annoncent les rubriques concernées et gardent « Conserver seulement le document ».
- Une identité attribuée avant transfert ne vaut pas enregistrement complet. Le brouillon et les fichiers restent disponibles par une reprise explicite. Après échec, l’interface précise que des transferts peuvent déjà être enregistrés et empêche une annulation trompeuse.
- Les avis de Vincent et Ann Charlotte ont leur propre mode lecture/édition et leurs droits serveur ; un décideur lecteur garde son droit de vote.
- Scénarios locatifs versionnés et validés au serveur : alternatives indépendantes, mois/semaine/nuit/année, périodes mixtes complémentaires et sans chevauchement sur une année type de 365 jours. Les unités effectivement louées produisent les recettes ; aucun second taux d’occupation. Base d’investissement explicite commune, inconnus distincts de zéro, rendements seulement sur une base confirmée positive. Les anciennes hypothèses et durées de portage sont conservées.
- Les nouveaux instantanés et PowerPoint reprennent référence, comparaisons, unités, périodes et calendrier. Aucune mise à jour des présentations historiques ou des dossiers bancaires retravaillés. Données privées de propriétaires exclues.
- Filtre entreprise compact et commandes documentaires neutres, dans les styles complets du CRM.

## Vérifications réellement exécutées

| Contrôle | Résultat |
|---|---|
| Tests de domaine et régressions Foncière/Drive | 160 réussis : exemples 48 000 / 42 000 / 51 000 / 15 000 €/an, année, inconnus/zéro, coûts, chevauchements, occupation, calendrier, historique, droits, reprises Drive simulées |
| Serveur de consultation | 8 contrôles réussis avec Auth/PostgreSQL/PostgREST réels locaux : persistance/reconnexion, rejets directs, lecteur/éditeur/non affecté, avis lecteur, reconfirmation, ancien client, conflit, exclusions privées |
| Serveur compact existant | 5 contrôles réussis ; véritables transferts Storage de deux fichiers, catégories `plans`/`other` et destinations de file Drive conservées |
| Navigateur CRM complet, build production | 14 parcours réussis : consultation sans écriture, Modifier/Annuler/sauvegarde sans changement, trois choix, valeurs effacées et historiques, invalides/replis/focus, filtre, scénarios/référence/duplication/suppression, documents, extraction PDF locale réelle et relecture, retour Contacts, conflit/rapprochement, décideur lecteur, EN mobile/clavier, création interrompue et reprise explicite du même projet avec fichier |
| Présentations et exports | 5 contrôles réussis : persistance des instantanés, dossier bancaire approuvé, téléchargements JSON et PPTX réels par Chromium, cinq alternatives et résultats communs, 65 parties XML/rels et 7 notes par fichier sans marqueur privé ; changement de référence/reconfirmation et conservation exacte des présentations retravaillées/historiques |
| Rendu PowerPoint | Conversion LibreOffice vers PDF puis inspection visuelle des diapositives comparaison et unités/périodes |
| Migration locale | Application réelle puis répétition exacte dans une transaction annulée ; empreintes projets/présentations/avis/jobs/policies inchangées ; fonctions privées non exécutables par anon/authenticated |
| Compilation | TypeScript sans erreur ; lint sans erreur, deux avertissements préexistants dans AccessPortal et CRMApp ; build Next.js production réussi ; 281 fichiers app/components/lib identiques entre sources et serveur testé ; diff-check réussi |

Les comptes et données de ces campagnes sont fictifs, sur un stack loopback dédié. Les appels navigateur hors de ce stack sont interdits par le harnais.

### Limites précises

- Mobile : émulation Chromium tactile de 390 px, pas un téléphone physique.
- L’échec de transfert est un abandon réseau simulé ; création, identité, conservation IndexedDB, nouvelle ouverture et reprise Storage utilisent les vrais services locaux.
- L’extraction d’une brochure PDF texte est réellement exécutée localement. Cette livraison ne refait pas toute la campagne OCR des versions précédentes.
- Les tests du worker Google Drive utilisent un fournisseur simulé. Storage et la file de synchronisation sont réels localement ; aucune copie Drive de test n’est exécutée en production.
- Les contrôles de production portent sur la migration, les empreintes, les privilèges, l’état READY, les protections et la page HTTP servie sur chaque alias. Ils ne prétendent pas couvrir une session métier authentifiée de production.
- Aucune hypothèse locative de test n’est enregistrée dans un projet réel.

## Migration et publication

Migration additive unique : `20261030193537_fonciere_rental_scenarios.sql` (même version dans le registre Supabase). Aucun backfill, table supplémentaire, droit accordé ou changement de règle d’accès.

Avant/après application en production, les empreintes de tous les projets, présentations, avis, jobs Drive et policies restent identiques ; zéro payload locatif créé par la migration. Les cinq fonctions concernées gardent `search_path=pg_catalog` et aucun droit EXECUTE pour anon/authenticated. Les avis de sécurité Supabase sont inchangés : [search_path préexistant](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [RPC SECURITY DEFINER existantes](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [protection des mots de passe divulgués](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

L’identifiant du déploiement et les contrôles des deux alias sont consignés dans le compte rendu de livraison et les preuves externes au dépôt, pour éviter d’ajouter un commit après la vérification du SHA servi.
