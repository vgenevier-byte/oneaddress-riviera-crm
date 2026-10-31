# Préparation de la bascule Drive — 31 octobre 2026

**Mission non terminée. Aucune bascule activée, aucun original supprimé, aucun déploiement effectué.** Les nouveaux fichiers suivent encore les parcours Supabase existants. Ce dossier contient l'inventaire en lecture seule et un outil préparatoire de vérification, pas la livraison de l'architecture demandée.

## Source et isolation

Copie indépendante de `origin/main`, SHA `8d8b3626fced2460b39b6b6e28fb52be35575cc7`, dans `/private/tmp/oar-drive-primary`. La version distante courante est le commit d'optimisation demandé. Aucune modification des travaux du checkout `/Users/vg/Desktop/OARcrm-repo`.

Les deux domaines demandés ont été résolus par le connecteur Vercel vers le déploiement existant `dpl_9tLdzy5LDYLdbe9BZDmbr9Db7hxH`, état READY, même SHA. Cela vérifie les métadonnées du déploiement existant ; aucune nouvelle version ni mesure de performance en production n'en découle. Protection SSO du projet : `all_except_custom_domains`, inchangée.

## Inventaire réel en lecture seule

Source : requêtes SELECT sur le projet Supabase `jcmnwvlmysecrahupfkk`, avec exclusion des noms, coordonnées, avis et contenus des fiches. L'instantané et le classement fichier par fichier sont joints :

- `inventory-2026-10-31.json` : références CRM, versions des objets, copies enregistrées, destinations enregistrées et références des instantanés.
- `registry-preflight-2026-10-31.json` : classement préparatoire ; aucune preuve Google actuelle.

| Élément | Nombre | Octets |
|---|---:|---:|
| Projets | 13 | — |
| Références finalisées Projets | 241 | 107 873 310 |
| PDF finalisés | 30 | 76 672 053 |
| Photos finalisées | 209 | 30 724 091 |
| Pièces jointes finalisées | 2 | 477 166 |
| Copies Drive enregistrées pour la même version | 229 | 103 221 260 |
| Fichiers finalisés sans copie enregistrée | 12 | 4 652 050 |
| Références en attente, sans objet Storage | 2 | 1 097 798 attendus |
| Objets `fonciere-documents` | 241 | 107 873 310 |
| Objets `crm-documents`, hors priorité de bascule | 26 | 27 427 712 |
| Total des objets Storage observés | 267 | 135 301 022 |

Les 229 références actuelles sont toutes associées à un job de copie synchronisé de même identité/version. Les 12 fichiers sans copie ne sont référencés ni par les fiches actuelles ni par les instantanés d'arbitrage inventoriés. Ce constat ne constitue pas une autorisation de retrait.

Les deux instantanés d'arbitrage contiennent 23 références documentaires : toutes correspondent à une version finalisée connue, disposant d'une copie enregistrée. Aucun instantané n'a été réécrit. La seule présentation enregistrée possède une seule version, avec un payload vide et aucun asset IZORD. L'absence actuelle de fichiers de présentation ne dispense pas d'adapter leurs nouveaux dépôts et leurs historiques.

Les colonnes des fiches Projets et des présentations ont aussi été contrôlées par recherche des URI `data:image/` et `data:application/` dans les payloads : aucun média incorporé observé. Aucun contenu de payload n'a été exporté dans ces rapports.

## Destination enregistrée, à confirmer avec l'identité technique

Configuration SQL active : Drive partagé `0ANj9BrFwFggDUk9PVA`, racine `1asCPnhFDabwSbdWCgtzm8b6NhGbeEeag`, parent égal au Drive partagé. Le registre contient 65 dossiers, soit cinq destinations par projet. Ces identités proviennent de la configuration effective enregistrée, pas d'une recherche par nom.

**Le nom « 05 — PROJETS », son ID, son parent et son Drive partagé ont été confirmés via la connexion organisationnelle One Address Riviera.** Les premiers appels avaient mal sélectionné la connexion ; ce problème a été corrigé. Cette lecture organisationnelle ne prouve pas les droits du compte technique du CRM. Les contenus des copies n’ont pas encore été vérifiés pendant cette mission. Aucun Drive personnel n’a été utilisé en remplacement.

La vérification doit utiliser le compte technique du CRM et son intégration WIF/Vercel OIDC existante. Réactiver un connecteur Google personnel ne prouve pas l'accès du compte technique. Aucune nouvelle infrastructure n'est nécessaire pour l'outil préparé.

## Parcours recensés dans la source

| Périmètre | Écritures et conservation actuelles | Lectures, aperçus, export et historique | Travail restant |
|---|---|---|---|
| Projets | `lib/fonciere/repository.ts` : enregistrement d'asset, `fonciere-documents.upload`, finalisation ; originaux sources et JPEG préparés | Téléchargement via Storage après `fonciere_asset_access`, aperçu privé via `foncierePhotoPreview.ts`, transfert et préparation bancaire via les repositories | Dépôt Drive direct, fournisseur explicite, finalisation serveur, reprise durable, lectures Drive |
| Copies Projets | `fonciereDrive.ts`, `fonciereDriveSupabase.ts` : lecture originale Storage, copie Drive reprenable par blocs de 4 Mio, ID réservé | File privée et dossiers existants, copies vérifiées au moment du worker ; pas encore source de lecture CRM | Réutiliser les copies après vérification actuelle, sans recopier le catalogue |
| Présentations | `lib/izord/repository.ts` : URL d'upload signée `izord-documents`, finalisation ; photos, PDF et PowerPoint conservés | Téléchargement, hydratation, versions de payload, JSON/PPTX, transferts Projets et banque | Adapter tous les nouveaux assets liés aux projets et leurs relectures, préserver les versions immuables |
| Contacts | `ContactDocuments.tsx`, `lib/contactDocuments.ts`, route `contact-documents/file` : Storage ou références Drive selon le catalogue | Lecture privée, aperçu et téléchargement avec droits documentaires | Hors bascule prioritaire ; continuer à signaler cet usage Storage |
| Documents généraux et pièces métiers | `ScopedDocuments.tsx`, `ModuleWorkspace.tsx` : `crm-documents`, remplacement par nouvelle version | Aperçu privé, téléchargement, remplacement et retrait | Hors bascule prioritaire |
| Devis et factures prestataires | `VendorQuotesView.tsx`, `CRMApp.tsx`, `ModuleWorkspace.tsx` : pièces `crm-documents` | Téléchargement des devis/factures, liens documentaires et pièces conservées | Hors bascule prioritaire |
| Personnel | Nettoyage existant `houseWorkerDocumentCleanup.ts` des anciens documents retirés | Pièces privées du module, règles existantes | Hors mission ; aucun nettoyage déclenché |

Les JSON/PPTX téléchargés localement ne sont pas tous des objets persistants : distinguer les exports immédiats des PowerPoint conservés comme assets IZORD. Le changement de stockage ne doit pas incorporer les binaires dans la base.

## Outil préparé et tests

`lib/server/fonciereDriveAudit.ts` et `scripts/fonciere-drive-audit.mjs` n'ont aucune opération d'écriture, de copie ou de suppression. L'audit utilise uniquement les IDs enregistrés, refuse les associations ambiguës, vérifie racine/Drive/parents/propriétés/type/taille, lit une fois la source, compare son MD5 au contenu Drive et calcule son SHA-256. Il relit les versions source et Drive et les dossiers après le transfert ; un écart empêche toute preuve. Les requêtes sont limitées à trois fichiers simultanés, avec délais finis, sans boucle de reprise. Les exceptions et leurs éventuels secrets ne sont pas recopiés dans le rapport.

Les preuves sont des observations datées. Elles ne permettent pas, seules, de changer le fournisseur : une future transaction de bascule doit contrôler à nouveau la version source et la révision Drive. Le SHA-256 du rapport identifie les octets sources ; le contrôle des octets Drive utilise son MD5 fourni par Google. L'audit ne prétend pas avoir téléchargé le contenu Drive par SHA-256.

Rejouer le classement SQL, sans appel externe :

```sh
node --conditions=react-server scripts/fonciere-drive-audit.mjs \
  docs/drive-primary/inventory-2026-10-31.json /private/tmp/drive-registry-report.json
```

Le fichier de sortie doit être nouveau. Le script refuse de l'écraser et le crée en mode privé 0600. Ne pas publier de fichiers contenant des credentials.

Le mode `--verify` nécessite les variables serveur Supabase et WIF habituelles du CRM et un jeton OIDC disponible pour ce runtime. Le script ne charge lui-même aucun `.env`, n’imprime aucune valeur secrète et n’accepte aucune destination Drive fournie par le client. La relecture vérifie la ligne d’asset et les métadonnées Storage réelles, notamment ID et version. La commande Vercel officielle `env run --environment production` a été essayée sur le projet vérifié, sans enregistrer les variables : Vercel indique que huit valeurs Secret de production ne sont pas exportables ; `CRM_INVITE_AUTH_KEY` manque dans ce processus local. Aucun octet original n’a donc été téléchargé. Ce comportement ne prouve aucune absence de credential dans le runtime déployé. Ne pas transmettre ni extraire cette clé : le contrôle réel devra être exécuté dans le runtime serveur Vercel où elle est injectée.

Vérifications exécutées : 12 tests fictifs de l'audit réussis, TypeScript sans erreur, lint sans erreur (deux avertissements préexistants dans AccessPortal/CRMApp). Build Next réussi avec URL/clé publiques fictives locales (le premier essai sans variables publiques avait échoué au prérendu), `git diff --check` sans erreur. Ce build n’est pas une validation authentifiée de production. Aucune réussite de transfert reprenable direct, d'accès réel Google ou de performance Drive n'est revendiquée.

## Quotas, coûts et volumes

Plan Supabase mesuré via l'organisation : Free. Au relevé SQL du 31 octobre : base `pg_database_size` 19 680 403 octets, trois comptes Auth. Ces chiffres sont des volumes instantanés, pas des compteurs de facturation ni de trafic. Storage observé : 135 301 022 octets, dont 27 427 712 hors Projets. Les quotas/compteurs de trafic Supabase, de Drive/API et de Vercel ne sont pas établis par ces mesures ; capacité mutualisée du Drive et consommation API inconnues.

Aucun abonnement, paiement, service payant, budget ou règle de facturation modifié. Aucun espace libéré. Aucun arrêt des nouveaux dépôts Supabase ni diminution des lectures Supabase activé. Base et authentification restent utilisées.

## Conditions avant activation

1. Achever l'inventaire Google réel avec le compte technique ; vérifier les copies existantes et leurs versions, sans les recréer en cas d'accès refusé.
2. Implémenter fournisseur et transfert Drive direct reprenable côté serveur pour Projets et parcours Présentations dépendants, y compris médias préparés et exports conservés. Limiter chaque requête entrante sous 4,5 Mo ; les blocs Google doivent respecter son protocole reprenable. Aucun fallback Storage.
3. Contrôler les identités durables, révisions, baux et empreintes ; conserver brouillons/fichiers jusqu'à confirmation ; empêcher toute finalisation arbitraire par le client et tout nouvel upload Storage du périmètre après activation.
4. Adapter lecture originale, aperçu privé, cache versionné, imports/exports et historiques. Conserver le chemin de texte sans médias, les trois chargements concurrents, le lien direct, le chargement différé de l'éditeur et les contrôles de droits avant/après.
5. Migrer fichier par fichier avec preuve et contrôle de version transactionnel, sans modifier le dossier métier ni ses empreintes d'arbitrage ; conserver les versions d'origine des instantanés et des présentations.
6. Tester les parcours demandés sur données fictives, puis un vrai transfert/relecture technique dans un dossier fictif dédié. Nettoyer uniquement ses identités contrôlées.
7. Mesurer avant/après à données et conditions identiques, avec 24 photos, en distinguant les octets internes serveur et navigateur. Le rapport historique `docs/fonciere/loading-verification.md` est une référence locale antérieure, pas un résultat de cette bascule.
8. Documenter le retour arrière par fournisseur : anciens fichiers vers leur original Supabase conservé, nouveaux fichiers Drive restant lisibles. L'ancien code non adapté ne constitue pas un retour arrière sûr pour les nouveaux fichiers.
9. Publier seulement l'architecture complète validée, contrôler READY/SHA et les deux domaines sans retirer la protection.

La liste de retrait futur ne peut pas encore être validée : zéro fichier autorisé à supprimer. Les 229 candidats du registre représentent 103 221 260 octets, sous réserve de vérification Google, de bascule effective des lectures, de contrôle des historiques et d'une autorisation distincte. Les 12 fichiers sans copie demandent une analyse séparée ; aucun n'est déclaré inutile ou supprimable.

Références techniques : [limite des Functions Vercel](https://vercel.com/docs/functions/limitations), [protocole d'upload reprenable Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
