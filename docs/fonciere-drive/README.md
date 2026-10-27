# Références Foncière et copies Google Drive

Les projets gardent leurs UUID, relations et URL. PostgreSQL attribue une référence `PRJ-000001` à la première création persistée, dans une séquence commune sans remise à zéro ni réutilisation. Le nombre conserve au moins six chiffres et reste extensible. Les références sont immuables, y compris après archivage/restauration. Les trous de séquence sont normaux.

La migration sauvegarde les lignes historiques dans `app_private.fonciere_numbering_backup`, avec leur correspondance UUID/numéro, avant de numéroter par `created_at`, puis UUID. Les dates et instantanés des présentations restent inchangés. Une clé UUID de création conservée avec le brouillon avant le premier appel RPC permet de retrouver la création après une réponse perdue. Une empreinte SHA-256 du contenu, des catégories et des octets sources est conservée lors de la sauvegarde finale : son rejeu retrouve les mêmes assets sans nouvel upload. Un brouillon modifié depuis cette sauvegarde demande une vérification explicite et reste conservé. L’ancien appel de création sans cette clé est refusé ; la modification des projets existants conserve son RPC.

## Copie organisationnelle

Le serveur réutilise Vercel OIDC, Google Workload Identity Federation et le compte technique déjà configuré. Aucun compte Google individuel, partage public ou nouveau membre n’est créé. La destination canonique est enregistrée dans la configuration privée après une recherche complète et la vérification de son ascendance, de son Drive partagé et des droits effectifs. Une recherche incomplète ou un accès refusé ne déclenche aucune création.

Chaque projet possède un dossier durable `PRJ-000001 - Nom enregistré`, avec les catégories `01 - Documents agence`, `02 - Plans`, `03 - Photos`, `04 - Autres documents`. Le renommage conserve les identités Drive et les fichiers. Les catégories des nouveaux originaux sont proposées selon le parcours et peuvent être choisies avant enregistrement parmi quatre valeurs finies. Les anciennes pièces sans contexte précis restent classées selon leurs métadonnées ; leur catégorie peut nécessiter une vérification métier.

Le déclencheur transactionnel de sauvegarde extrait exclusivement les références d’assets finalisés présentes dans le payload enregistré. Finaliser un upload seul n’exporte rien. Une modification de texte ne recrée pas les travaux de fichiers. La file persistante est indépendante du navigateur ; Vercel Cron l’exécute chaque minute sur `/api/fonciere/drive/worker`, protégé par `CRON_SECRET`.

Les jobs ont des baux, une réservation d’identité Drive durable, un suivi par fichier et un journal. Le worker lit les octets du bucket privé `fonciere-documents`, contrôle identité/version/taille/type, utilise les noms d’origine et des uploads reprenables par blocs de 4 Mio. Il confirme taille, MD5, dossier et propriétés de l’asset par lecture de l’identité réservée avant d’enregistrer `synced`. Une réponse Google perdue ou un crash avant confirmation revient à cette même identité. Les fichiers homonymes ont des identités différentes. Aucun original CRM ni copie Drive n’est supprimé lors d’un retrait ou archivage.

Les erreurs temporaires reprennent après temporisation exponentielle, plafonnée à une heure. Les incidents d’identité, de droits ou de dossier déplacé/mis à la corbeille demandent une intervention : restaurer les droits ou le même dossier à son emplacement attendu, puis utiliser « Réessayer la copie ». Le worker ne remplace pas silencieusement un dossier géré. Après une interruption serveur, un bail expiré devient récupérable après dix minutes. L’état synchronisé nécessite une confirmation Drive enregistrée en base.

## Droits et opérations

Les RPC de suivi et de reprise vérifient le périmètre courant Foncière. La reprise demande la contribution ; l’ouverture du dossier demande aussi Export et téléchargement. Les routes générales Drive restent inchangées. La clé de service organisationnelle reste sur le serveur. Les droits Google natifs demeurent indépendants des droits CRM.

Le worker accepte uniquement des actions finies via le secret serveur : `diagnose` (lecture), `configure` (découverte/activation canonique), `backfill` (reprise sans doublon des références actuellement enregistrées), `run`, `report`, `test`. Aucune destination n’est acceptée du navigateur. Une destination ambiguë demande un choix administratif avant activation.

L’action `test` crée un dossier fictif dédié sous Projets, copie cinq fichiers fictifs (dont deux PDF homonymes et un fichier supérieur à 5 Mo), simule une réponse finale perdue, rejoue la même identité, relit les octets par SHA-256, puis met à la corbeille exclusivement ses propres identités après contrôle de leurs marqueurs. Elle n’ajoute aucun projet fictif au CRM.

## Formats et vérification

Formats disponibles : PDF, JPEG, PNG, WebP ; limite réelle de **25 000 000 octets par fichier**, **30 documents sources par projet**. Les photos de présentation conservent leurs limites existantes de galerie et de pixels. Les nouveaux imports directs de photos conservent aussi le fichier source, indépendamment des JPEG optimisés de l’éditeur. La copie lit les objets privés d’origine, jamais les aperçus de consultation. Une ancienne photo dont seul le fichier canonique optimisé existe dans le CRM ne permet pas de recréer un fichier source absent. Word, Excel et DWG ne sont pas pris en charge et ne sont pas envoyés à l’OCR.

Les preuves sont séparées : tests de transport simulé (`worker.test.cjs`), tests PostgreSQL/Auth/Storage isolés (`sql.mjs`, `repository.mjs`), contrôles navigateur avec doubles explicites (`browser.mjs`), et copies Google réelles effectuées puis relues par l’action `test`. Les résultats locaux sont enregistrés sous `/private/tmp/fonciere-drive-evidence` et `/private/tmp/fonciere-number-ui-evidence`, sans identifiants secrets dans les rapports partageables.
