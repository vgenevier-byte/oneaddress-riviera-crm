# Ouverture progressive de Foncière → Projets

## Mesures locales avant/après

Référence avant : `ca54e6bf555a2630df01c89cd00e0c2a20f15814` (comprend le verrou du rapprochement répété). Deux builds Next de production, même machine, Chromium 1440×1000, API/PostgreSQL/Storage locaux réels, sans latence réseau artificielle. Neuf projets fictifs identiques : trois répétitions de 0, 6 et 24 originaux JPEG 1600×1066 qualité 86 ; les quatre affectations réutilisent des photos de galerie. Catalogue identique de 88 projets autorisés pour les deux campagnes. Aucune donnée de production utilisée ou créée.

La fiche est « utilisable » lorsque son titre, le mode lecture et ses huit rubriques sont disponibles après admission. La rubrique 07 est ouverte immédiatement pour mesurer les images réellement décodées. Authentification préalable hors chronomètre. Le lien direct conserve le coût du démarrage de la page CRM. Premier clic : navigateur neuf et photos propres à ce projet non encore mises en cache serveur ; réouverture : même navigateur/serveur ; lien direct : nouveau navigateur, serveur déjà réchauffé par le clic. Chaque ligne est une médiane de trois observations.

| Photos | Parcours | Fiche ms avant → après | Première photo ms | Galerie ms | Requêtes métier | Octets métier transférés |
|---:|---|---:|---:|---:|---:|---:|
| 0 | Liste | 839 → 828 | — | — | 18 → 14 | 507 439 → 120 805 |
| 0 | Clic initial | 165 → 125 | — | — | 71 → 31 | 139 278 → 33 175 |
| 0 | Lien direct | 845 → 845 | — | — | 89 → 35 | 646 712 → 35 879 |
| 0 | Réouverture | 125 → 119 | — | — | 71 → 31 | 139 278 → 33 174 |
| 6 | Liste | 834 → 836 | — | — | 18 → 14 | 507 438 → 120 804 |
| 6 | Clic initial | 851 → 126 | 890 → 206 | 891 → 265 | 77 → 37 | 1 472 044 → 1 366 521 |
| 6 | Lien direct | 1 398 → 848 | 1 431 → 887 | 1 432 → 888 | 95 → 41 | 1 979 486 → 1 369 222 |
| 6 | Réouverture | 832 → 112 | 835 → 152 | 836 → 188 | 77 → 37 | 1 472 040 → 38 610 |
| 24 | Liste | 839 → 830 | — | — | 18 → 14 | 507 439 → 120 805 |
| 24 | Clic initial | 1 376 → 258 | 1 419 → 327 | 1 419 → 577 | 95 → 55 | 5 510 852 → 5 407 076 |
| 24 | Lien direct | 1 842 → 838 | 1 892 → 871 | 1 894 → 871 | 113 → 59 | 6 018 291 → 5 409 755 |
| 24 | Réouverture | 1 315 → 236 | 1 318 → 252 | 1 318 → 308 | 95 → 55 | 5 510 855 → 54 391 |

Les octets sont `Network.loadingFinished.encodedDataLength` de Chromium pour les requêtes métier REST/Storage et `/api`, donc incluent l’encodage/les en-têtes vus par Chromium ; ils excluent les bundles et documents HTML. Les appels serveur internes de l’aperçu ne figurent pas dans le compteur navigateur. Les mesures incluent 400 ms de stabilisation après galerie pour compter les lectures secondaires. Les compteurs de liste sont répétés par taille pour garder les mêmes séquences.

À 24 photos : fiche par clic −81 %, par lien direct −55 %, réouverture −82 %. Galerie initiale 1 419 → 577 ms ; réouverture 1 318 → 308 ms. Le volume froid de la galerie reste comparable : mêmes aperçus et même qualité. La réouverture réutilise les octets admis (304), de 5,51 Mo à 54 ko. La liste passe de 507 ko à 121 ko ; sa latence locale reste environ 0,84 s. Sans photo, le lien direct reste environ 0,85 s : le démarrage du CRM domine ce banc local. Aucun temps de production n’est déduit de ces résultats.

## Changements et garanties

- Lecture de la fiche et des métadonnées documentaires séparée de l’hydratation des photos. Trois prévisualisations simultanées au maximum ; affichage progressif et états explicites en rubrique 07, reprise possible après échec. Les retours tardifs sont rejetés après changement de projet/compte/droits.
- Références canoniques dans `project.payload`, données de formulaire et aperçus séparés. Tant que les médias ne sont pas explicitement acceptés pour édition, une sauvegarde de texte recopie les références, la galerie et les affectations originales, sans aucun transfert de photo. Les modifications de médias partiellement chargés sont refusées. Une création inachevée conserve ses photos préparées pour le nouvel essai.
- Aperçus versionnés en mémoire privée de processus (32 Mo/96 entrées/10 minutes), coalescence des calculs identiques. Cache navigateur en mémoire bornée, lié au jeton. Chaque réutilisation HTTP/304 conserve les deux admissions serveur en temps réel et la comparaison de la révision de permission. `private, no-store`, aucune URL Storage/publique, aucun cache CDN ; un changement de version invalide la clé. Les originaux ne sont pas modifiés.
- Lien direct autorisé sans catalogue préalable. Liste paginée complète sous RLS, projection des champs de recherche et d’affichage ; aucune limite globale ni modification du classement/filtres. Les réponses guidées explicitement vides restent distinctes des absences.
- Outils d’édition montés à la première utilisation puis conservés pour ce projet ; repli sans démontage. Drive, accès et arbitrage différés à leur première consultation. Lectures Contacts concurrentes mutualisées dans un instantané admis, sans cache établi réutilisé ni mélange de comptes.
- Les lectures liste + statuts partagent un même encadrement de droits avant/après. Les `crm_access_snapshot` vus par le navigateur passent de 12 à 8 sur la liste, de 44 à 20 sur l’ouverture, de 56 à 22 par lien direct. Une partie du gain vient de l’absence de montage des éditeurs ; les deux admissions propres à chaque photo sont conservées. Aucune modification des politiques, rôles, RPC d’écriture ou révisions.
- Les empreintes d’arbitrage avant/après et la relecture complète nécessaire aux transferts/exports restent obligatoires. Le rapprochement explicite d’une création utilise encore une lecture complète. Le verrou du conflit locatif répété est conservé.

## Vérifications

Voir `tests/fonciere-loading/README.md` pour les commandes reproductibles et les limites. Les preuves JSON avant/après sont conservées avec les artefacts de livraison. Résultats :

- 236 tests de domaine/transport/pagination/annulation Foncière et IZORD réussis, dont quatre nouveaux tests ciblés.
- 5 parcours navigateur de chargement progressif réussis, avec injection explicite d’un délai/échec et ajout réel d’une nouvelle photo après hydratation. Références antérieures et affectations comparées exactement avant/après ; galerie fictive restaurée ensuite.
- 4 contrôles du handler réel : miss/hit/304 et un seul original lu, immutabilité de version Storage, refus après révocation sur cache chaud/conditionnel, refus après révocation entre lecture originale et réponse.
- 3 contrôles navigateur de droits restreints réussis : lecteur affecté sans export, transfert refusé, lien non affecté refusé.
- Campagnes existantes : 14 parcours consultation (FR/EN, clavier/mobile, valeurs effacées/historique/invalides, replis, Contacts, imports, création/reprise après transfert interrompu), 4 parcours cohérence (dont conflit locatif répété et deux résolutions explicites après reprise du brouillon), 4 parcours présentations/exports JSON/PPTX.
- TypeScript sans erreur, lint sans erreur (deux avertissements préexistants dans AccessPortal/CRMApp), build Next de production, `git diff --check`.
- Parité complète avec l’ancien HTML IZORD : un essai plus large a échoué à l’initialisation parce que le fichier externe audité `IZORD_Invest_Fiche_Projet_Locations_v3 (1).html` est absent. Aucun oracle de remplacement utilisé ; ce test n’est pas annoncé réussi. Les 236 autres tests et exports réels ci-dessus ont été exécutés.

La source finale est comparée aux 283 empreintes app/components/lib du serveur local. Les benchmarks ont été exécutés avant les setups de non-régression afin de conserver exactement les mêmes neuf projets, les mêmes originaux et les 88 lignes du catalogue. Les ajustements suivants de protection de reprise, de conservation des éditeurs et d’identité de relecture sont couverts par les contrôles finaux, sans changement du parcours mesuré ni de son nombre de requêtes.

Aucune migration, reprise de données réelles, modification de droits ou donnée fictive en production. Les travaux étrangers du checkout principal sont restés hors de cette branche isolée.
