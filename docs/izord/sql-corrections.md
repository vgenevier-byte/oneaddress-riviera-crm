# Différences SQL de la correction du lot 1

Base de comparaison : instantané local du lot 1 du 16 septembre 2026, HEAD `bc8700a25db4438419f3b0876ceef5f4a4cb05ca` plus ses modifications non commitées. La migration `20260916170445_module_access_foundation.sql` est nouvelle et non suivie ; son absence d’application distante est déclarée dans la demande. Aucune nouvelle connexion distante n’a été faite pour cette correction. L’ancienne migration appliquée du registre `20260914210807_drive_folder_registry.sql` est conservée octet pour octet.

## Cycle documentaire

- L’asset conserve son identité UUID et son chemin unique, avec les états `pending`, `finalized`, `withdrawn`.
- L’enregistrement exige la révision courante d’un projet non approuvé et un droit d’écriture actuel. L’import JWT ordinaire est limité à son créateur et à l’état `pending`. Seul ce créateur, toujours autorisé sur la révision courante non approuvée, peut relire son import pour l’inspecter avant finalisation ; lecteur, autre contributeur assigné et tiers ne le lisent pas.
- La nouvelle RPC `izord_finalize_asset` revérifie les droits et la révision, vérifie la présence d’un objet Storage terminé, puis conserve son identifiant et sa version. Le contenu finalisé devient immuable ; sa permission lecteur reste initialement désactivée.
- L’autorisation explicite d’un associé/admin reste indispensable pour une présentation finalisée. Une nouvelle identité documentaire n’hérite jamais de cette autorisation.
- La nouvelle RPC `izord_withdraw_asset` conserve une tombe logique et désactive la lecture. Le contributeur peut retirer son import encore en attente, mais pas un document finalisé ; associé/admin assurent le retrait des documents finalisés. Les chemins retirés ne sont pas réutilisables.
- Les suppressions physiques et UPDATE des objets IZORD ne sont pas accordés aux clients. La garde SQL `izord_document_lifecycle` sur `storage.objects` refuse également suppression, déplacement et mutation d’un objet finalisé/retiré lorsque le service utilise ses privilèges internes pour une capacité d’upload signée. Elle ne crée/modifie aucune métadonnée Storage elle-même ; les transferts continuent via l’API Storage.

Le verrou d’asset coordonne cette garde et la finalisation. La finalisation n’est pas une analyse antivirus, une vérification des signatures MIME ni une validation métier du fichier. Le nettoyage administratif des imports abandonnés, la politique de rétention et le parcours TUS restent à concevoir au lot générateur : ne pas désactiver les gardes pour ajouter une suppression côté client.

Le support de triggers personnalisés dans les schémas gérés est décrit dans le [changelog Supabase du 18 mars 2025](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025), consulté le 16 septembre 2026. Les effets des capacités signées sont vérifiés contre Storage `v1.72.1` local ; toute mise à niveau de Storage impose de rejouer les tests d’octets et de concurrence.

## Révision de synchronisation OAR

Le trigger existant `stamp_oar_author` conserve l’auteur Auth et impose désormais `updated_at` côté serveur, strictement croissant par ligne, même si le client soumet un timestamp ancien ou identique. Cette valeur sert de précondition au compare-and-swap du payload OAR. Le client met à jour uniquement la révision qu’il a chargée ; zéro ligne renvoyée constitue un conflit visible, sans réessai écrasant.

Ce mécanisme protège les sauvegardes du client corrigé ; il ne transforme pas les utilisateurs OAR autorisés en lecteurs, ne fusionne pas deux payloads JSON et ne protège pas d’un client autorisé qui choisirait délibérément une écriture sans précondition. Toute ancienne version du frontend doit être fermée lors de la transition.

## Transition et retour arrière

Aucune migration réelle n’est exécutée ici. Avant une application séparément autorisée : fermer les anciennes interfaces, vérifier le statut réel de la migration et les schémas, sauvegarder hors Git, appliquer le SQL revu et une liste OAR explicitement validée via le template vide `bootstrap-oar.sql`. Si la migration a entre-temps été appliquée ailleurs, arrêter et préparer une migration additive ; ne pas rejouer ce fichier initial ni altérer l’historique appliqué.

Les profils navigateur nécessitent la [récupération explicite des caches](cache-transition.md) avant ouverture à un compte suivant. Aucun réimport automatique ni aucune suppression des caches réels ne fait partie de cette correction.

En retour arrière, conserver les gardes OAR, le portail corrigé, le cycle documentaire et la révision serveur. Fermer IZORD avec la proposition `rollback-close-izord.sql` ou une page de maintenance ; ne pas restaurer les politiques larges, l’ancienne autosauvegarde ou les caches globaux. Une capacité signée déjà délivrée et un fichier déjà téléchargé ne sont pas rappelés par une simple révocation d’adhésion.
