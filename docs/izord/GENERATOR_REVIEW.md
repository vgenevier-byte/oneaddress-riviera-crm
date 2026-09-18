# IZORD Invest — lot 2, revue locale du générateur

État : générateur intégré et validé localement le 17 septembre 2026. Arrêt pour revue, sans autorisation de publication.

## Base de comparaison et conservation

Départ : HEAD `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`, avec les lots d’accès R1/R2/R3, Next.js et le banc Playwright encore non commités. Le point de reprise de 122 fichiers de code/documentation est hors Git dans `…/izord/generator-lot2-20260917/baseline` (manifestes, empreintes, état Git et copies). Le patch du lot 2 compare ces copies au résultat, fichiers auparavant non suivis inclus ; il ne compare pas seulement HEAD.

HTML source intact : `/Users/vg/Desktop/IZORD_Invest_Fiche_Projet_Locations_v3 (1).html`, SHA-256 `8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1`. Aucun changement CRM métier, ancienne migration SQL, WIF, banc caches ou convention financière n’a été effectué dans ce lot. Le WIF reste ignoré, non suivi et absent des copies de revue.

## Modules repris et parité

| Source HTML | Portage | Preuve |
|---|---|---|
| BASE, number, errorsFor, calculate ; scénarios locatifs | `lib/izord/finance.ts` | Comparaison exécutée contre les fonctions du HTML original, mêmes entrées/résultats/arrondis/avertissements ; 11 nouveaux cas synthétiques explicitement identifiés |
| IZORD_FICHE_V1, compatibilité ancienne période | `lib/izord/model.ts` | Validation/aller-retour des champs, photos, importMeta/importGallery/photoGalleryRoles ; aucune restauration de droits ou approbation |
| parseAgency, lecteur Worker | `lib/izord/agency.ts`, `agency-worker.ts` | Parité parseur, PDF numérique/incomplet/scan, plusieurs fiches séparées, annulation et destruction Worker/blob |
| cropPhoto, resizeImported, rôles et photothèque | `lib/izord/photos.ts`, `photos-validation.ts` | JPG/PNG/WebP comparés pixel par pixel aux conversions du HTML, image entière distincte du recadrage |
| maps, rendu des textes | `presentation-maps.ts`, `presentation-layout.ts`, aperçu React | Mappings et géométrie d’origine ; source 960 × 540 |
| makePpt, notes, appendPhotoSlide, metadata | `lib/izord/presentation*.ts`, modèle dérivé | XML natif modifiable, notes, médias et dimensions comparés au HTML sur cinq dossiers fictifs ; ouverture LibreOffice et 13 pages raster identiques |

Les onze cas externes cités dans l’audit précédent ne figurent pas dans les pièces accessibles. Les onze cas synthétiques ajoutés ne sont pas présentés comme ces cas externes. Aucun taux fiscal ou source juridique n’a été actualisé ; les réserves et références du 16 septembre 2026 restent celles du HTML.

Le calcul distingue vide et zéro, acquisition/travaux/revente/prix demandé/loyers, devis notarial prioritaire, revente net vendeur/FAI. La provision de 2 % est modifiable et n’est jamais un taux légal. Les locations saisonnière et annuelle restent deux alternatives sur la même période ; leur changement ne modifie pas la marge hors loyers. Un calendrier incomplet suspend le résultat combiné. TVA immobilière et impôt sur bénéfice non calculés.

## Parcours et données

`/izord` réutilise AccessPortal et ses contrôles d’adhésion. L’éditeur dédié ne monte pas CRMApp et ne lit pas `crm_workspace_state`. La liste contient les seuls projets autorisés, titre/localisation/auteur/révision/date/état. Nouveau, PDF, JSON, sauvegarde explicite, réouverture partagée, récupération JSON, aperçu natif et génération/archivage PowerPoint sont séparés.

Le modèle partagé utilise `izord_projects` et les versions immuables existantes. `payload.schema = IZORD_GENERATOR_V1` contient les hypothèses et métadonnées, avec des identifiants d’assets privés à la place des données JPEG. La table additionnelle `izord_generator_asset_refs` relie chaque emplacement photo/galerie/PDF à sa révision et à un asset finalisé du même projet. Une nouvelle version réutilise une identité immuable ou crée un nouvel asset ; elle ne réutilise jamais un ancien chemin pour remplacer un fichier.

SQL additionnel intégral : `supabase/migrations/20260917172412_izord_generator_versions.sql`. Les deux migrations auditées antérieures sont inchangées. Application autorisée seulement dans la pile locale jetable ; 66 fonctions/politiques antérieures comparées avant/après, sans changement. Détails des RPC, droits et transferts dans [generator-persistence.md](generator-persistence.md).

| Rôle actuel | Projets | Édition/sauvegarde | Approbation | Photos/PDF privés | Présentations |
|---|---|---|---|---|---|
| Sans IZORD / OAR seul / révoqué | Refus | Refus | Refus | Refus | Refus par JWT ordinaire |
| Contributeur | Propres/affectés | Oui, révision attendue ; dossier approuvé verrouillé | Refus | Oui sur dossiers autorisés selon cycle actuel | Génération et archive avant approbation ; pas de publication lecteur |
| Lecteur | Affectés | Refus | Refus | Refus ; hypothèses textuelles visibles selon matrice existante | Seulement fichier finalisé explicitement autorisé |
| Associé / administrateur IZORD | Périmètre global existant | Oui, mêmes révisions attendues | Oui | Oui selon cycle existant | Publication explicite d’un asset ; nouvelle version non publiée automatiquement |

Être administrateur IZORD n’accorde aucun accès OAR. Une case de relecture PDF, une case de frais vérifiés ou la décision textuelle importée n’accorde aucun rôle ni état officiel.

## Concurrence, interruption et limites

Aucune autosauvegarde ni cache métier persistant du générateur. Les modifications restent en mémoire ; fermeture sans sauvegarde/export = perte possible. Le portail avertit avant départ quand le brouillon est modifié. Enregistrer passe par le RPC atomique avec révision attendue et auteur Auth. Un conflit conserve le formulaire et propose comparaison, récupération JSON et rechargement explicite, sans écrasement forcé. Une réponse après changement de projet/compte est ignorée ; les transferts et Workers peuvent être interrompus. Un renouvellement de session seul ne déclenche pas de sauvegarde.

PDF : six fichiers maximum, 25 000 000 octets chacun, 120 pages, 60 secondes par lecture, décompression agrégée plafonnée, 80 JPEG extraits maximum par PDF. Lecture locale en Worker de texte/JPEG seulement ; pas d’OCR, IA, géocodage, script exécuté ou fusion de biens. Les résultats restent des propositions à relire, avec source/page/avertissement et choix des quatre visuels. Les objectifs financiers ne viennent pas du prix demandé. Annuler laisse le projet courant inchangé ; appliquer crée un nouveau brouillon après confirmation de remplacement.

Images : contrôle des signatures et dimensions avant décodage, y compris les JPEG d’un JSON ; maximum 16 000 px par côté et 40 mégapixels. La conversion JPEG d’origine est conservée : la transparence de l’image entière devient noire, le canevas du recadrage est ivoire. Images entières redimensionnées et recadrages sont distincts ; filigranes incorporés conservés. Aucun effacement des données historiques volontairement importées. Budget cumulé : 100 000 000 octets JPEG distincts et 170 000 000 caractères JPEG, occurrences répétées comprises, pour garder une marge dans le JSON limité à 180 Mo. Ces limites sont vérifiées avant les allocations supplémentaires, l’ajout manuel, l’application PDF, la sauvegarde et le chargement Storage (taille annoncée puis octets reçus). Ce budget est une protection du client et du chargement ; il ne constitue pas une limite SQL agrégée. Un appel RPC autorisé direct peut stocker un graphe de références trop gros, dont l’ouverture sera alors refusée par l’application.

Uploads directs vers Storage par capacité signée, progression, timeout et interruption ; pas de transit des octets par Vercel ni par le JSON CRM. Contrôle de taille/MIME réellement reçus à la finalisation via métadonnées Storage ; vérification des signatures binaires côté client. Un PDF fictif de 25 000 000 octets a été importé, relu, enregistré et téléchargé dans le banc réel : taille et SHA-256 identiques, asset finalisé et lié à la révision 2, auteur vérifié. L’observateur passif XHR a vu un seul événement de progression à 100 % (multipart 25 000 297 octets), pas de palier intermédiaire. Le test terminé en 810 ms ne démontre pas une interruption de réseau réelle ni une reprise partielle. Les trois scénarios 503 restent des simulations explicitement séparées. Ce contrôle ne constitue pas une analyse antivirus ni un hash binaire calculé par le serveur. La pile testée conserve les capacités d’upload signées 7 200 secondes : après révocation un dépôt peut encore réussir, mais la finalisation, le nouvel archivage PowerPoint et les accès JWT ordinaires sont refusés. La récupération JSON de données déjà en mémoire reste possible ; aucun fichier déjà obtenu ne peut être rappelé. Un téléchargement déjà réalisé ne peut être retiré.

Les transferts interrompus restent identifiables comme `pending`, avec action « Vérifier les transferts » et abandon autorisé. Le contributeur abandonne ses pending de révision courante ; un associé/admin peut retirer ceux d’une ancienne révision avec leur identifiant vérifié. Ces anciens pending ne sont pas découverts dans la liste utilisateur : un inventaire administratif local est nécessaire. Les assets finalisés orphelins exigent aussi une vérification de leurs références avant tout retrait. L’abandon laisse un tombstone : les octets peuvent rester physiquement conservés. Les tests locaux ont constaté cette conservation ; aucune purge physique, aucun objet finalisé/référencé supprimé, aucune tâche distante n’a été lancée. Une reprise crée une nouvelle identité.

PowerPoint : modèle natif 12 192 000 × 6 858 000 EMU, textes/images/légendes/notes modifiables. Deux diapositives, troisième seulement si demandée et photothèque non vide. L’archive est rattachée à la révision sauvegardée et à ses hypothèses/assets. Un brouillon modifié doit être enregistré avant archivage. Les règles existantes interdisent les nouveaux transferts sur un projet approuvé : générer avant approbation. Pour ajouter des photos à un projet déjà approuvé, un associé/admin doit d’abord enregistrer son retour en brouillon/en revue sans nouvelle photo, puis ajouter les photos et enregistrer à nouveau. Aucun assouplissement de la règle existante n’a été ajouté. Microsoft PowerPoint n’a pas été utilisé ; ouverture réelle et comparaison par LibreOfficeDev 26.8.0.0.alpha0. Pas de garantie universelle sur toutes polices ou machines.

## Défauts trouvés pendant ce lot

- Modèle PPT dérivé : premier nettoyage XML avait remplacé les namespaces OPC par défaut par un préfixe. Slides/notes égales mais LibreOffice refusait l’ouverture. Correction du dérivé, assertion OPC ajoutée ; parité et ouverture ensuite rejouées. Traces initiales conservées.
- Éditeur : premier parcours Auth a mesuré 1 642 px de largeur pour 1 440 px de viewport. Les règles globales historiques `table min-width`, `h2 !important` et `aside !important` débordaient sur IZORD. Correction limitée au module CSS du générateur ; capture et résultat initial conservés.
- Réponse tardive sauvegarde → export : reproduction réelle avant correction (`late-export-diagnostic`) avec la réponse GET de liste déjà reçue du serveur retenue par le pilote. Après « Nouveau projet », un PPT de l’ancien dossier était encore archivé/téléchargé et affichait une fausse confirmation dans le nouveau brouillon. `save()` vérifie maintenant aussi son epoch après la mise à jour asynchrone liste/historique et retourne `null` au demandeur devenu obsolète. La preuve après correction est conservée séparément.
- Préparations de tests : import `realpathSync` du nouveau lanceur, charset manquant du serveur fixture PDF, comparaison JSON sensible à l’ordre des clés, compilation historique sans `--resolveJsonModule`, garde TMPDIR, nom accessible du sélecteur photo, assertion native fieldset désactivé, contrôle du pending avec le JWT de son auteur. Deux essais préalables de la reproduction tardive n’ont pas franchi le portail : cause non démontrée, aucun succès revendiqué ; le troisième essai instrumenté a obtenu Auth/adhésion 200 puis reproduit le défaut. Un premier test du budget comportait une constante attendue incorrecte (52 au lieu de 54), corrigée dans le test. Les erreurs correspondantes restent distinctes des réussites et ne sont pas comptées comme validations.

## Résultats — catégories séparées

Les preuves sont conservées hors Git dans le dossier indiqué ci-dessous. Aucun total ambigu ; aucun test simulé présenté comme Auth réel.

| Catégorie | Résultat actuellement obtenu | Portée |
|---|---|---|
| Unitaires/PostgreSQL | 231/231 | 218 historiques + 13 repository nouveaux ; bases embarquées arrêtées |
| Moteur/JSON/PDF — unités | 30/30 | Dont 11 parités financières synthétiques avec le vrai code HTML |
| Modèle PPT — unités | 4/4 | Structure, résidus, dimensions et namespaces |
| Worker/photos — navigateur isolé | 15/15 | Modules réels, fixtures locales ; pas une session métier Auth |
| Parité PPT — navigateur isolé | 9/9 groupes | Cinq dossiers fictifs ; XML et médias comparés |
| Rendu PPT LibreOffice | 13/13 pages identiques | Cinq originaux/portages fictifs ; résultat visuel, pas scénario Auth |
| Exports téléchargés du parcours produit | 5/5 pages ouvertes et inspectées | Deux PPTX réels du banc : 2 + 3 slides, LibreOffice, empreintes avant/après identiques |
| Générateur — Auth/RPC/Storage | 18/18 groupes | Vrais JWT, droits, révisions, finalisation et refus |
| PDF de 25 Mo — parcours direct réel | 3/3 contrôles, une exécution | Import/relecture UI ; XHR/Storage/finalisation/version ; progression native observée |
| Historique Auth/REST/RPC/Storage/mail | 96/96 groupes | Cohorte fictive neuve ; schéma/données préexistants conservés |
| Extensions Storage historiques | 9/9 | Cycle R1 et capacités signées |
| API Drive | 97/97 | Autorisation réelle locale, transport Google simulé |
| Générateur multiutilisateur UI | 16/16 groupes réels | Connexions locales A/B/lecteur, import PDF/JSON, save, réouverture, PPT2/3, conflit, session, droits et réponses retardées |
| Pannes transport du générateur | 3/3 groupes simulés | Réponses 503 injectées pour sauvegarde, upload PPT et photo ; contrôle des vrais états locaux après erreur |
| Réponse tardive sauvegarde → export | Reproduite avant ; corrigée après | Même réponse REST réelle retenue ; après correction : zéro téléchargement/écriture documentaire après nouveau brouillon |
| Navigateur historique | 13/13 | Auth/REST locaux réels |
| Synchronisation historique R3 | 9/9 | Renouvellement sans écriture, modification réelle et réponses tardives |
| Composants historiques | 20/20 | Fixtures locales, distinctes des sessions Auth |
| Cache Playwright non-régression | 9/9, un seul passage | Même contexte lors du changement OAR → IZORD, caches bruts et récupérations ; ancienne campagne 9/9 ×3 conservée séparément |
| Contacts | 16/16 | Fixture UI historique |
| Visuels portail | 10/10 | Fixture UI, 1440/390 ; aucune preuve Auth revendiquée |
| Gardes | 96/96 | 86 cible/cache + 10 réutilisation ; pas de connexion distante |
| Lint | 0 erreur, deux warnings historiques | AccessPortal navigation de sortie ; image CRMApp |
| TypeScript / build / diff-check | Réussis, code de sortie 0 | TypeScript sans émission ni cache incrémental ; build optimisé webpack dans la copie locale isolée ; patch final contrôlé séparément |

ESLint reste 9.39.5, Next.js 16.3.5 et React 19.3.0. Aucun chantier ESLint repris. JSZip 3.10.1, même version que le HTML, est la seule dépendance directe ajoutée ; 14 entrées transitives ajoutées, aucune version de dépendance préexistante modifiée. [Version officielle JSZip](https://github.com/Stuk/jszip/releases/tag/v3.10.1), consultée le 17 septembre 2026. [Supabase Storage — uploads standards](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [changelog Supabase](https://supabase.com/changelog), consultés le même jour ; configuration locale existante conservée.


## Preuves et périmètre exact

Dossier hors Git : `/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/generator-lot2-20260917`.

Le sous-dossier `review/` contient une sélection explicite : `lot2.patch`, versions finales sous `files/<chemin du projet>`, liste des changements et raisons, résultats et sorties utiles, exemples fictifs, inventaire et empreintes SHA-256. Aucune archive globale du dépôt ni nouvelle archive de clôture caches. Le patch part du point de reprise du **début du lot 2**, y compris AccessPortal déjà non suivi et les nouveaux modules repository ; les différences antérieures d’accès/Next.js ne sont pas réintroduites comme nouveautés. Le `git status --short` complet décrit néanmoins tout le worktree encore non commité.

- `product-browser-5/results.json` : 19 groupes individuels, dont 16 parcours locaux réels et 3 pannes simulées, zéro erreur page/crash/fermeture inattendue/tentative réseau distante observée. Après changement de compte dans le même contexte : zéro marqueur métier dans localStorage/sessionStorage, zéro entrée CacheStorage et IndexedDB.
- `late-export-diagnostic/` et `late-export-after/` : reproduction et correction avec résultats avant nettoyage ; les deux préconditions non franchies restent dans `late-export-before/` et `late-export-before-2/`.
- `product-browser-1` à `product-browser-4` : 1, 3, 10 et 15 contrôles terminés avant les échecs décrits. Ils ne s’additionnent pas au passage final et ne sont pas présentés comme campagnes réussies.
- `product-browser-5/rendered/` : les deux exports téléchargés ont ensuite été ouverts par LibreOffice et les cinq pages inspectées, sans chevauchement/troncature inattendu ; aucun avertissement de police dans ce rendu.
- `presentation/presentation-parity-results.json`, `presentation/rendered/pixel-parity.json` : parité des cinq dossiers synthétiques et 13 pages ; `engine-parity-notes.md` détaille les fonctions et cas.
- `backend/large-transfer/results.json` : preuve réelle du fichier limite 25 Mo, événements et octets reçus, sans relance ni altération du transport.
- `backend/live-1/results.json` : 18 contrôles Auth/RPC/Storage ; les petits blobs PDF/PPT de ces contrôles sont des fixtures de contrat de transport, pas des documents à utiliser comme preuve de rendu.
- `historical-unit-guards/unit-budget-final/test-results.json` : 231 tests par suite ; `guards.log` : 96 gardes. Le test repository 13/13 est déjà inclus dans 231, pas à additionner de nouveau.
- `cache-nonregression/cache-playwright-result.json` et trace associée : un seul nouveau passage 9/9, neuf contrôles répétés antérieurement et non 36 scénarios différents. Ce succès ne garantit pas une stabilité absolue.
- `restoration/retained-restoration.json` : 18 tables retenues vérifiées, lignes et schéma antérieurs conservés, payload OAR fictif restauré avec précondition optimiste.

Les deux warnings restent : `components/AccessPortal.tsx:122:5`, règle `@next/next/no-location-assign-relative-destination` (navigation de sortie existante, conservée dans ce lot) ; `components/CRMApp.tsx:5126:19`, règle `@next/next/no-img-element` (image historique CRM hors périmètre). Les messages complets sont dans `final-lint.log`. Aucun plugin retiré, aucune exception ajoutée et aucune migration ESLint 10. Le maintien provisoire d’ESLint 9 et ses réserves restent à réexaminer avant publication.

Le build final compare les SHA-256 de 25 fichiers applicatifs livrés avec ceux de la copie servie (`build-source-identity.json`). Le seul transport Google est remplacé dans cette copie de test ; les contrôles JWT/adhésion Drive restent identiques. Le code du dépôt n’a reçu aucune simulation de backend. Le contrôle étendu du patch, nouveaux fichiers inclus, a relevé une ligne vide finale superflue dans la copie de licence JSZip ; seule cette ligne a été retirée après build, sans changer le texte de licence ni le code exécutable. `git apply --check --whitespace=error` a ensuite été vérifié sur le point de reprise.

## Réouverture locale de la démonstration

Les volumes locaux conservent les comptes, projets et fichiers **fictifs**. La migration additionnelle a déjà été appliquée uniquement à cette pile ; ne pas la réappliquer pour rouvrir. Aucun `db reset`, suppression de volume, fichier `.env` ou profil Chrome personnel n’est nécessaire.

Depuis le dépôt, démarrage de la pile conservée :

```sh
cd /Users/vg/Desktop/OARcrm-repo
env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin HOME=/Users/vg TMPDIR=/tmp LANG=en_US.UTF-8 \
  DOCKER_HOST=unix:///Users/vg/.colima/default/docker.sock \
  IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY \
  IZORD_LOCAL_WORKDIR=/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/izord-local-stack-5HXuB2 \
  SUPABASE_BIN=/Users/vg/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase \
  IZORD_ARTIFACTS=/tmp/izord-generator-reopen-services \
  node tests/izord/generator-services.mjs --start
```

Puis dans un terminal dédié :

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR=/tmp LANG=en_US.UTF-8 \
  IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY \
  LOCAL_STATUS_FILE=/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/izord-local-stack-5HXuB2/local-status.json \
  IZORD_APP_MANIFEST_FILE=/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/izord-local-stack-5HXuB2/live-app-generator-reopen.json \
  node tests/izord/live-app.mjs
```

Attendre `READY`, puis ouvrir `http://127.0.0.1:3159/izord` dans un **profil fictif distinct**. Les identifiants locaux restent uniquement dans les fichiers privés de fixture ; aucun secret dans ce rapport. La cohorte A/B/lecteur finale et son chemin privé sont identifiés dans le README local des preuves produit. Ne pas employer de compte réel.

Pour arrêter : `Ctrl+C` dans le terminal dédié à Next, puis la commande de pile ci-dessus avec `--stop` à la place de `--start`. Elle conserve les deux volumes et contrôle les ports. Ne pas utiliser `--no-backup` ni supprimer les volumes.

URL fournie pour réouverture seulement : **indisponible après l’arrêt final demandé**. L’état final des services et volumes est consigné dans `services/stop.json`.


## Commandes des validations conservées

Les paramètres communs des bancs Auth sont les chemins privés locaux explicités ci-dessus : `LOCAL_STATUS_FILE`, `LOCAL_FIXTURE_FILE`, `IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY`, `IZORD_ARTIFACTS` neuf ; aucun contenu `.env` n’est chargé. Les commandes complètes du produit et de la reproduction tardive sont dans `README-PRODUCT.md` / `product-browser-notes.md` des preuves. L’inventaire `EVIDENCE.md` du dossier de revue précise les sorties historiques et leurs modes fixture ou Auth réel.

```sh
IZORD_PG_RUNTIME=/tmp/oar-contact-release-test-runtime IZORD_ARTIFACTS=<sortie-neuve> node tests/izord/postgres.mjs
node --test tests/izord/local-target.test.mjs tests/izord/cache-playwright-target.test.mjs tests/izord/reuse-local.test.mjs
node --import /tmp/izord-browser-runtime/node_modules/tsx/dist/loader.mjs --test tests/izord/generator-engine.test.ts
node --test tests/izord/presentation-assets.test.mjs
IZORD_ENGINE_ARTIFACTS=<sortie-neuve> node tests/izord/generator-engine.browser.mjs
node tests/izord/presentation-parity.browser.mjs
node tests/izord/generator-live.mjs
node tests/izord/generator.browser.mjs
node tests/izord/generator-large-transfer.browser.mjs
node tests/izord/document-lifecycle.mjs
node tests/izord/live-drive.mjs
node tests/izord/live.browser.mjs
node tests/izord/token-refresh.browser.mjs
node tests/izord/cache-lifecycle.playwright.mjs
./node_modules/.bin/eslint .
./node_modules/.bin/tsc --noEmit --incremental false
git diff --check
```

Ces lignes sont un index des points d’entrée, pas un script à lancer sans leur environnement documenté. La cohorte Drive révoquée durant le test ne doit pas être réutilisée comme neuve ; les restaurations des fixtures historiques sont déjà terminées. La commande de parité rendue `presentation-render.py` formalise les opérations effectivement faites ; l’ouverture réelle a utilisé les mêmes outils LibreOffice/Poppler, documentés dans les logs. Le résultat 4/4 des tests purs PPT est constaté dans la sortie d’outil de cette tâche ; le stdout d’origine n’a pas été sauvegardé en fichier, ce manque n’est pas reconstruit.


## État final de conservation

Pile Supabase arrêtée le 17 septembre 2026 à 17:54:56 UTC ; ports 55431/55432/55434 fermés. Serveur Next arrêté et port 3159 fermé. Volumes PostgreSQL et Storage conservés. Aucun commit, push, déploiement, action Vercel, migration distante ni appel Google Drive réel. Les navigateurs isolés des bancs sont fermés ; aucun accès ni purge du profil Chrome personnel.

Les 122 fichiers du point de reprise ont été recomparés : seuls six fichiers préexistants changent dans le lot 2 (AccessPortal TSX/CSS, package/lock, deux adaptations de banc). Aucun fichier antérieur supprimé. CRM métier, règles d’accès/R1/R2/R3, banc caches/page neutre, anciennes migrations, HTML source et WIF conservent leurs empreintes. WIF non suivi et exclu. Toutes les dépendances préexistantes restent identiques. Les nouveaux modules/tests/SQL sont listés dans `review/CHANGES.md`.

HEAD : `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`.

```text
 M .gitignore
 M app/api/drive/_utils.ts
 M app/page.tsx
 M components/CRMApp.tsx
 M components/MobileCRMHeader.tsx
 M components/SearchableBusinessContactPicker.tsx
 M package-lock.json
 M package.json
 M tests/contactAddress.browser.ts
 M tests/driveFolderConcurrency.test.ts
 M tests/driveRegistryAuth.test.ts
 M tsconfig.json
?? .vercelignore
?? app/izord/
?? app/spaces/
?? components/AccessPortal.module.css
?? components/AccessPortal.tsx
?? components/izord/
?? docs/izord/
?? eslint.config.mjs
?? lib/access/
?? lib/izord/
?? lib/taskMaintenance.ts
?? supabase/migrations/20260916170445_module_access_foundation.sql
?? supabase/migrations/20260917172412_izord_generator_versions.sql
?? tests/crmCache.test.ts
?? tests/izord/
?? tests/izordAuthorization.test.ts
?? tests/izordGeneratorRepository.test.ts
?? tests/moduleAccess.test.ts
?? tests/taskMaintenance.test.ts
?? tests/workspaceSync.test.ts
```

## Complément du 17 septembre 2026 — reprise volatile après indisponibilité des contrôles d’accès

Ce complément conserve le lot 2, les corrections R1/R2/R3 et Next.js. Il répond aux quatre pièces de la revue indépendante reçue dans `IZORD_OAR_Lot2_Revue_Et_Correction_Brouillon_Pour_Codex (1).zip`. La sonde instrumentée jointe n’est pas comptée comme preuve navigateur. Les résultats historiques des sections précédentes restent datés de leur campagne ; les résultats ci-dessous sont ceux de ce complément.

### Base exacte et preuves avant correction

Base : worktree corrigé au début de ce complément, HEAD `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`, **pas HEAD seul**. Avant modification, 153 fichiers sélectionnés, leur manifeste SHA-256, le statut Git et le diff préexistant ont été conservés hors Git sous :

`/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/draft-recovery-20260917/baseline/`

Dans la suite de cette section, `PREUVES` désigne le dossier parent `draft-recovery-20260917`. `review/draft-recovery.patch` compare ce point de reprise aux sources finales, y compris les nouveaux fichiers non suivis. Les changements antérieurs restent hors de ce patch.

Quatre reproductions **sur le produit réel inchangé**, Chromium 153.0.8010.12 lancé directement par Playwright 1.63.0, ont confirmé le défaut le 17 septembre de 18:46:52 à 18:47:12 UTC. Auth, droits, REST et révisions proviennent de la pile Supabase locale ; seule la réponse du contrôle précisément ciblé est remplacée par un 503. Le focus est le vrai chemin de revérification du portail, avec la page neutre du banc existant.

| Cas AVANT | Saisie avant la panne | Après retour du même compte/droits | Serveur |
|---|---|---|---|
| `getUser`, dossier existant | acquisition `612345`, photo ajoutée, relecture PDF ouverte | éditeur remonté vide ; valeur, photo et dialogue perdus | révision 2, deux versions, zéro asset : inchangés |
| `app_memberships`, dossier existant | même périmètre | même perte | inchangé |
| `getUser`, nouveau brouillon | acquisition `712345`, galerie de deux images (PDF et ajout) | aucun dossier ouvert ; valeur et galerie perdues | aucun dossier/version/asset créé |
| `app_memberships`, nouveau brouillon | même périmètre | même perte | aucun enregistrement |

Preuves : `before-1/results.json`, quatre relevés par cas, douze captures, et `result-before-cleanup.json`. Aucun crash ou événement de fermeture inattendue. La perte provenait du démontage de `IzordGenerator` sur toute erreur du contrôle parent, alors que les saisies vivaient dans ses `useState`.

### Correction et durée de vie du brouillon

- `components/AccessPortal.tsx` distingue une vérification réussie, une indisponibilité temporaire, une session absente/invalide et un refus confirmé. Les statuts 401/403 ne deviennent pas des pannes 503. Une erreur temporaire de `getSession` est aussi classée avant d’interpréter une session absente.
- Une seule capsule de reprise par portail reste dans une référence React, associée à l’UUID Auth, IZORD, l’identité du brouillon, le dossier éventuel et sa révision d’origine. `useLayoutEffect` transmet le dernier état React validé. Aucun jeton, rôle utilisable comme autorisation, URL signée ou capacité d’upload n’est restauré depuis cette capsule ; le rôle d’origine sert seulement à détecter une réduction.
- L’indisponibilité ferme immédiatement un `AbortSignal` d’accès, puis **démonte** l’éditeur. Les anciens rôles sont retirés de l’état d’accès. Les effets, transferts XHR, analyses PDF et continuations utilisent cette garde ; l’éditeur n’est pas seulement caché. La page affiche l’indisponibilité et un bouton de revérification, sans action d’export ni de sauvegarde du brouillon suspendu.
- La capsule contient les données, photographies, `photoGalleryRoles`, fichiers sources et relectures PDF déjà obtenus, l’indicateur de modification et le conflit éventuel. Elle ne crée aucune nouvelle réserve de stockage : un seul dossier courant et les limites existantes s’appliquent (six PDF par import, 25 Mo par fichier, plafonds existants de galerie/images/JSON). Elle n’est ni sérialisée ni écrite dans localStorage, sessionStorage ou IndexedDB. Pas de délai de persistance garanti : fermeture, rechargement ou crash la détruisent. Un avertissement de fermeture couvre aussi l’onglet suspendu ; il ne constitue pas une sauvegarde.
- La reprise exige une nouvelle identité vérifiée, la même appartenance active et, pour un dossier existant, un SELECT du **même dossier sous RLS avec le JWT actuel**. Le rôle global ne remplace pas l’affectation. Un retour avec lecteur, ou toute réduction de rôle, écarte la capsule et les anciens fichiers avant toute requête de dossier supplémentaire ; l’instance suivante n’a que les droits actuels.
- La demande d’état officiel et la décision proposée sont réinitialisées depuis le serveur actuel (ou les valeurs initiales pour un nouveau dossier), pas reprises de l’ancien brouillon. Les autres hypothèses sont conservées. La révision de comparaison reste celle d’origine : aucune avance silencieuse de la précondition CAS. Les anciennes métadonnées d’assets ne sont pas restaurées ; l’utilisateur peut vérifier les transferts avec les droits actuels.
- Déconnexion réelle, changement de compte, transition des anciens caches, retrait confirmé de l’appartenance ou de l’affectation détruisent la reprise. Un changement explicite de dossier abandonne l’ancien état après le parcours de confirmation prévu. Les réponses anciennes sont invalidées avant leur retour ; aucune récupération n’est offerte au compte révoqué.

`lib/izord/draftRecovery.ts` formalise le lien identité/dossier/révision et la remise à zéro des anciennes décisions. `components/izord/IzordGenerator.tsx` capture l’état validé et relie chaque opération à la garde. `lib/izord/repository.ts` propage l’annulation dans les lectures successives, créations, sauvegardes, finalisations et actions documentaires, avec vérification avant et après les attentes.

### Opérations en vol, conflits et limites

Aucune écriture ne part au seul rétablissement du réseau ou au renouvellement du jeton. Une vraie sauvegarde demande toujours l’action de l’utilisateur. Si B enregistre pendant la panne, A conserve sa révision initiale : sa prochaine sauvegarde reçoit le conflit existant et garde ses saisies, sans écraser B. L’export JSON de récupération reste réservé au compte dont les droits ont été revérifiés.

L’annulation ne retire pas une transaction déjà envoyée : une création, un enregistrement ou une finalisation peut avoir abouti sur le serveur. Une réponse tardive ne doit plus confirmer, enchaîner un transfert ni télécharger un export. L’interface de reprise demande de contrôler la liste et les transferts. Si une création a abouti mais que son accusé a été invalidé, son identifiant peut ne pas avoir été retenu ; une nouvelle création explicite peut alors produire un autre dossier. Aucun mécanisme d’idempotence SQL supplémentaire n’est ajouté dans ce complément.

Les données d’import déjà obtenues sont reprises. Une analyse ou conversion interrompue avant son résultat doit être relancée ; le message de reprise le précise. Les workers/transferts sont interrompus par les signaux existants. Les URL temporaires déjà créées gardent leur libération existante ; aucun changement du parser, du moteur de calcul ou du PowerPoint. Une capacité Storage déjà signée conserve les limites R1 documentées : ce correctif n’annule pas rétroactivement une URL émise ou un téléchargement déjà remis au navigateur.

Les conflits, le contrôle des rôles et la reprise ne garantissent pas une stabilité absolue ni la récupération après crash. Les pannes provoquées restent identifiées comme injections de transport bornées ; les connexions et droits locaux sont réels.

### Résultats APRÈS : treize contrôles distincts, avec deux échecs de pilote conservés

| Nº | Contrôle navigateur réel local | Preuve réussie |
|---|---|---|
| 1 | `getUser` 503, dossier existant : hypothèses, photo et relecture PDF reprises ; serveur inchangé | `after-1` |
| 2 | `app_memberships` 503, dossier existant : même conservation | `after-1` |
| 3 | `getUser` 503, nouveau dossier : données/photo/PDF repris ; sauvegarde seulement sur clic | `after-1` |
| 4 | `app_memberships` 503, nouveau dossier : même résultat ; PDF transféré puis téléchargé avec SHA-256 égal à la fixture | `after-1` |
| 5 | Déconnexion pendant la panne, comptes A → B → A dans le **même contexte** : aucune ancienne reprise, caches bruts sans données métier | `after-1` |
| 6 | Révocation réelle de l’appartenance : capsule et export fermés ; réattribution sans résurrection | `after-1` |
| 7 | Retrait réel de l’affectation d’un dossier appartenant à B, rôle contributeur inchangé : refus RLS et capsule détruite | `after-2` |
| 8 | Passage lecteur : aucune ancienne saisie/photo/PDF/export ; ouverture de la version serveur en lecture seule | `after-3` |
| 9 | Réduction lecteur confirmée, réponse projet retenue : anciennes capacités fermées **avant** le retour de cette réponse | `after-3` |
| 10 | Ancien contrôle d’appartenance réussi, retardé puis libéré après une panne plus récente : aucune réouverture | `after-3` |
| 11 | Création réellement validée côté serveur, accusé retenu après suspension : aucune sauvegarde/photo/PPT/download enchaîné | `after-3` |
| 12 | B sauvegarde pendant la panne : A conserve `634567`, B conserve `845678`, conflit explicite et export de récupération d’A | `after-3` |
| 13 | Nouveau dossier choisi explicitement après reprise : aucune résurrection du brouillon remplacé | `after-3` |

Chaque panne vérifie aussi l’absence d’éditeur opérationnel, d’actions protégées et de nouvelles requêtes du composant suspendu. Le retour seul ne produit aucune sauvegarde/archivage. Les contrôles réseau distinguent les requêtes de vérification d’accès des opérations métier. Aucun événement de fermeture inattendue ni erreur JavaScript non gérée dans les passages conservés.

Historique exact, sans présenter une campagne intégrale verte qui n’a pas eu lieu :

1. `after-1` : six contrôles réussis ; arrêt au contrôle 7 sur timeout de 20 s. Le pilote attendait à tort le retour de l’éditeur après le retrait d’affectation. La capture montre le **refus correct du produit**, sans champs, photo, PDF ni export : « L’accès à ce dossier a été retiré. Le brouillon n’est plus récupérable dans cet espace. » Six contrôles suivants non exécutés dans ce passage.
2. `after-2` : reprise bornée des contrôles 7–13, sans rejouer les six acquis. Contrôle 7 réussi ; arrêt à la fin du 8 sur une attente arbitraire du pilote. Après une réattribution contributeur, la vue serveur `500000` précédemment ouverte en lecteur reste affichée ; ce n’est pas l’ancien brouillon `634567`. Absence des anciens fichiers et du JSON de récupération, Enregistrer désactivé. Cinq contrôles suivants non exécutés dans ce passage.
3. `after-3` : seuls les contrôles 8–13 ont été exécutés ; six réussites. L’attente erronée a été remplacée par les invariants pertinents : données serveur conservées, ancienne saisie/fichiers absents et zéro écriture. Aucune assertion de sécurité retirée, aucun changement du produit entre ces trois passages.

Les erreurs, états de page et captures sont conservés **avant nettoyage** dans chaque dossier, avec le résultat final après fermeture du navigateur. Ces reprises ciblées ne constituent ni trois campagnes complètes ni 27 scénarios différents. Le banc final conserve des options explicites de reprise ; aucun retry automatique. Une exécution complète future ne sera pas implicitement déduite de ces résultats répartis.

### Non-régressions et périmètre effectivement exécuté

| Catégorie | Résultat de ce complément | Nature / preuve |
|---|---:|---|
| Unités/PostgreSQL historiques | **231/231**, 15 suites | `historical/unit-postgres-authorized/test-results.json` ; Auth/Storage SQL de cette suite sont des fac-similés |
| Repository ciblé existant | **13/13** | `repository/existing-13.log` ; sous-ensemble également présent dans les 231, pas 13 tests distincts de plus |
| Nouvelles gardes d’annulation repository | **19/19** | `repository/cancellation.log`, attentes et départs simulés en unitaire |
| Nouvelle logique de reprise | **6/6** | `draft-helper-tests.log`, identité/rôle/cible/révision/décision |
| Reproduction avant | **4 pertes confirmées sur 4** | `before-1`, vrai produit/Auth local ; 503 injectés |
| Nouveaux contrôles navigateur après | **13 distincts couverts**, deux échecs de pilote conservés | répartition détaillée ci-dessus ; aucune campagne complète déclarée verte |
| Auth/REST/RPC/Storage/mail | **96/96**, zéro échec/sauté | `historical/auth-rest-storage/live-local-results.json`, vrais JWT et services locaux |
| Cycle documentaire Storage | **9/9** | `historical/storage-lifecycle/document-lifecycle-after.json` |
| API Drive | **97/97** | `historical/drive-results.json`, vrais contrôles JWT ; **Google simulé**, zéro appel réel |
| Navigateur OAR/accès historique | **13/13** | `historical/historical-browser/live-browser-results.json` |
| Renouvellement et synchronisation OAR | **9/9** | `historical/historical-sync/token-refresh-after.json` ; zéro écriture au seul refresh, conflit conservé |
| Caches Playwright direct | **9/9**, une seule invocation | `cache-nonregression/cache-playwright-result.json` ; même contexte entre comptes/onglets, fichiers de récupération contrôlés |
| Contacts navigateur | **16/16** | `historical/contacts/browser-results.json` ; adaptateur de données fictif, pas une preuve Auth réelle |
| Gardes de cible | **96/96** | `static/guards.log`, tests de garde distincts des parcours réels |
| Lint global | **0 erreur, 2 avertissements historiques** | `static/lint.log` ; ESLint 9 conservé |
| TypeScript | **exit 0** | `static/typescript.log` |
| Build production local sans fixture | **exit 0** | `static/source-build.log`, copie isolée, aucun `.env` racine chargé |
| Build de l’application navigateur | **exit 0** | `after-app-build.log`, transport Google seul substitué ; empreintes source/copie dans `served-source-comparison.json` |
| Diff | **exit 0** | contrôle Git et vérification du patch ciblé consignés dans `review/` |
| Parcours historiques générateur, dont les trois pannes précédentes | **16/16 parcours et 3/3 pannes réussis après confirmation explicite** | nouvelle exécution sur le code corrigé, détaillée dans la clôture ci-dessous ; refus antérieurs conservés |

Les avertissements restent `components/AccessPortal.tsx:212`, `@next/next/no-location-assign-relative-destination` (navigation complète de déconnexion conservée), et `components/CRMApp.tsx:5126`, `@next/next/no-img-element` (image CRM existante). Aucun changement de version ou exception de lint.

Le premier lancement PostgreSQL a compilé mais s’est arrêté avant tout test sur `shmget: Operation not permitted` dans le sandbox : **zéro validation**. Une autorisation hors sandbox, limitée au PostgreSQL fictif loopback, a permis le passage des 231 tests. Deux refus préalables de délégation (PostgreSQL et Contacts) retenaient l’ancienne instruction « préparation seule » ; les exécutions autorisées depuis le coordinateur ont ensuite réussi. Les preuves du refus et du lancement bloqué restent conservées.

La revue automatique a refusé une relance élargie des suites générateur puis le seul runner des 19 parcours, en interprétant « Ne refais pas le générateur » comme l’interdiction de les retester. Aucun processus de ces commandes rejetées n’a démarré. Au premier arrêt, une confirmation explicite avait été demandée et ces 19 contrôles étaient **non exécutés**. La confirmation reçue a ensuite permis leur exécution intégrale, consignée dans la clôture ci-dessous ; les refus initiaux restent dans les preuves historiques. Les suites de parité calculs/PPT, les rendus historiques, le supplément PDF 25 Mo et les 18 groupes backend générateur ne sont pas rejoués ; leurs résultats antérieurs restent historiques. L’extension de classification `getSession` est couverte par les cas purs de classification, mais pas par une nouvelle panne de refresh injectée dans le navigateur ; le refresh OAR réel a été rejoué. Aucun test de crash/perte du processus n’apporte de garantie de récupération volatile.

### Commandes de ce complément

Les variables `LOCAL_STATUS_FILE` et `LOCAL_FIXTURE_FILE` désignent exclusivement les fichiers privés 0600 de la pile locale conservée, jamais une configuration Production. Leurs valeurs secrètes ne sont pas copiées. L’environnement de chaque lanceur a été vidé puis reconstruit ; Docker utilise explicitement le socket Colima local. Les comptes portent uniquement des adresses fictives `@example.invalid`. Les deux cohortes navigateur générateur sont indépendantes de la cohorte OAR historique.

```sh
node --import /tmp/izord-browser-runtime/node_modules/tsx/dist/loader.mjs --test tests/izord/draft-recovery.test.ts
node --import /tmp/izord-browser-runtime/node_modules/tsx/dist/loader.mjs --test tests/izord/generator-repository-cancellation.test.ts
# Avec l’environnement local gardé et un dossier de preuve neuf par invocation :
node tests/izord/draft-recovery.browser.mjs --before
node tests/izord/draft-recovery.browser.mjs --after
node tests/izord/draft-recovery.browser.mjs --after --resume-from-assignment
node tests/izord/draft-recovery.browser.mjs --after --resume-from-reader
node tests/izord/postgres.mjs
node tests/izord/live-local.mjs --reuse-existing
node tests/izord/document-lifecycle.mjs --after
node tests/izord/live-drive.mjs
node tests/izord/live.browser.mjs
node tests/izord/token-refresh.browser.mjs
node tests/izord/cache-lifecycle.playwright.mjs
/tmp/izord-browser-runtime/node_modules/.bin/tsx tests/contactAddress.browser.ts
node --test tests/izord/local-target.test.mjs tests/izord/cache-playwright-target.test.mjs tests/izord/reuse-local.test.mjs
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
node tests/izord/preview.mjs
git diff --check
```

Les options de reprise correspondent aux interruptions de pilote documentées, pas à une instruction de relance automatique. Les commandes complètes, chemins non secrets, codes de sortie et horaires sont dans `static/results.json`, `historical/authorized-sequence.json` et `review/COMMANDS.md`. Le contrôle syntaxique et le lint du pilote ont été rejoués après ses seules adaptations ; aucun changement produit ultérieur.

### Conservation et arrêt de cette campagne

Restauration préconditionnée du payload OAR fictif initial réussie : schéma inchangé, 18 tables antérieures vérifiées, lignes antérieures conservées, aucune suppression d’ancien compte/projet/objet/volume. Cette restauration locale ne supprime pas les nouveaux dossiers fictifs des tests.

Pile locale arrêtée le **17 septembre 2026 à 19:22:50 UTC** : Auth/PostgreSQL/REST/Storage/mail arrêtés, ports 55431/55432/55434 fermés, deux volumes conservés (`services/stop.json`). Serveur Next arrêté séparément ; son port 3159 est vérifié fermé. Aucun commit, push, déploiement, migration distante, invitation réelle, changement Vercel ni appel Drive réel. Aucun accès au profil Chrome personnel.

SQL, HTML original, dépendances/lockfile, moteur financier, JSON V1, parser PDF, PowerPoint, code CRM et banc caches restent identiques au point de reprise de ce complément. WIF conserve son empreinte, reste non suivi et exclu. La comparaison des 153 fichiers de référence, la liste exacte des huit fichiers modifiés/ajoutés, les empreintes et le statut Git figurent dans `review/`.

État Git relevé après les validations de ce complément (HEAD inchangé) :

```text
 M .gitignore
 M app/api/drive/_utils.ts
 M app/page.tsx
 M components/CRMApp.tsx
 M components/MobileCRMHeader.tsx
 M components/SearchableBusinessContactPicker.tsx
 M package-lock.json
 M package.json
 M tests/contactAddress.browser.ts
 M tests/driveFolderConcurrency.test.ts
 M tests/driveRegistryAuth.test.ts
 M tsconfig.json
?? .vercelignore
?? app/izord/
?? app/spaces/
?? components/AccessPortal.module.css
?? components/AccessPortal.tsx
?? components/izord/
?? docs/izord/
?? eslint.config.mjs
?? lib/access/
?? lib/izord/
?? lib/taskMaintenance.ts
?? supabase/migrations/20260916170445_module_access_foundation.sql
?? supabase/migrations/20260917172412_izord_generator_versions.sql
?? tests/crmCache.test.ts
?? tests/izord/
?? tests/izordAuthorization.test.ts
?? tests/izordGeneratorRepository.test.ts
?? tests/moduleAccess.test.ts
?? tests/taskMaintenance.test.ts
?? tests/workspaceSync.test.ts
```


## Clôture après confirmation explicite — 19 non-régressions sur le code corrigé

La confirmation utilisateur autorise expressément les 16 parcours authentifiés et les trois pannes simulées ; « Ne refais pas le générateur » interdit sa réécriture, pas ces tests. Le blocage précédent est levé. **Une seule tentative, 19 contrôles réussis, zéro échec et zéro contrôle non exécuté.** Aucun scénario, assertion ou sélecteur modifié ; aucun changement du produit.

Dossier de cette exécution (hors Git, sans nouvelle archive) :

`/Users/vg/.codex/visualizations/2026/09/16/01a0ab27-51a7-7272-a014-18917c721f80/izord/draft-recovery-20260917/historical-19-confirmed-20260917-232023`

### État exact testé et preuves conservées

HEAD reste `bc8700a25db4438419f3b0876ceef5f4a4cb05ca`. Le worktree corrigé, avec ses fichiers non suivis, constitue la version testée ; HEAD seul ne la décrit pas. `source-before.json` relève 97 fichiers de source/configuration/migration/banc avant les opérations. Le code produit, SQL, HTML original, dépendances et WIF restent inchangés après cette clôture ; seul le présent rapport change dans le dépôt.

Les quatre fichiers de correction (`components/AccessPortal.tsx`, `components/izord/IzordGenerator.tsx`, `lib/izord/repository.ts`, `lib/izord/draftRecovery.ts`) ont les mêmes SHA-256 que ceux effectivement servis aux contrôles ciblés. Dernière modification produit : **18:52:29 UTC**. Les passages ciblés ont commencé à 18:53:24, 18:55:28 et 18:56:56 UTC : ils sont donc postérieurs au dernier code produit, et leurs sources correspondent au code actuel. Les 13 contrôles distincts disposent chacun d’un événement `passed` réel : ils ne sont pas seulement « couverts » par du code de test. Ils n’ont pas été relancés ici.

Le build local existant a été réutilisé après comparaison des sources/configurations/dépendances, sans reconstruction. Seule la substitution du transport Google déjà documentée est conservée dans sa copie ; le contrôle JWT est intact. `next-env.d.ts` est généré par Next dans les copies de build ; cette différence connue n’est pas une modification du produit. Preuves : `served-source-comparison.json`, `evidence-reconciliation.json`, `app-manifest.json`.

Lint global, TypeScript et build sans fixture ont déjà réussi **après** la dernière modification produit, sur ce même état ; leurs preuves `../static/results.json`, `../static/lint.log`, `../static/typescript.log` et `../static/source-build.log` sont référencées sans répétition. Deux warnings historiques, aucune erreur : AccessPortal ligne 212 (`no-location-assign-relative-destination`), CRMApp ligne 5126 (`no-img-element`). Le seul pilote ciblé `.mjs` avait été ajusté après cette validation puis relinté ; preuve `../review/final-driver-lint.log`. Il est exclu du typage applicatif par `allowJs:false`. Le runner historique `tests/izord/generator.browser.mjs` exécuté ici est inchangé. Le diff-check et la vérification du patch sont actualisés après cette seule édition documentaire.

### Catégories, sans addition ambiguë

| Catégorie | Réussis / constat attendu | Échoués | Non exécutés | Provenance et blocage |
|---|---:|---:|---:|---|
| Reproductions avant correction | 4 pertes effectivement reproduites | 0 échec de protocole | 0 | `../before-1`, ancien produit ; aucun nouveau passage |
| Contrôles ciblés après correction | 13 contrôles distincts réellement réussis | 0 échec fonctionnel distinct restant | 0 contrôle distinct restant | `../after-1` à `../after-3`, même code actuel ; résultats conservés |
| Parcours historiques authentifiés | **16** | **0** | **0** | nouvelle exécution, Auth/REST/Storage locaux réels |
| Pannes historiques simulées | **3** | **0** | **0** | nouvelle exécution, transport 503 borné ; Auth et état serveur locaux réels |
| Erreurs antérieures du pilote ciblé | — | **2 tentatives interrompues**, conservées | 6 puis 5 contrôles non exécutés dans ces tentatives seulement | timeout au contrôle 7, attente erronée à la fin du 8 ; contrôles ensuite réussis, sans modification du produit |

Les deux erreurs du pilote ne sont pas effacées par les réussites ultérieures. Les 13 succès ciblés sont répartis sur trois passages partiels ; aucune campagne ciblée intégrale verte n’est inventée. Les 19 historiques, eux, ont réussi dans **une seule invocation complète**. Le refus d’autorisation précédent n’avait exécuté aucun de ces tests ; il ne compte ni comme échec fonctionnel ni comme validation.

### Résultats individuels de la nouvelle invocation

Exécution UTC : **2026-09-17T21:21:56.914Z → 2026-09-17T21:22:13.058Z**. Playwright **1.63.0**, Chromium **153.0.8010.12**, lancement direct avec profils fictifs possédés ; aucun CDP ni profil Chrome personnel. Exit code **0**. Zéro fermeture inattendue, erreur de page, crash ou tentative réseau distante observée. Les résultats avant nettoyage et après fermeture du navigateur sont conservés séparément.

| Nº du runner | Catégorie | Scénario inchangé | Résultat |
|---|---|---|---|
| 1 | Parcours authentifié | Real contributor login; blank draft contains no default example or OAR payload | Réussi |
| 2 | Parcours authentifié | Real PDF import review and cancellation preserve an edited draft | Réussi |
| 3 | Parcours authentifié | PDF reviewed application, empty targets and manual hypotheses remain distinct | Réussi |
| 4 | Parcours authentifié | JPEG PNG WebP additions preserve gallery plus four distinct synthesis roles | Réussi |
| 5 | Parcours authentifié | Explicit shared save stores no inline photo bytes and authoritative version author | Réussi |
| 6 | Parcours authentifié | Second real account reopens saved hypotheses and private photos after first page closes | Réussi |
| 7 | Parcours authentifié | V1 JSON recovery roundtrip and editable native three-slide export archive exact saved revision | Réussi |
| 8 | Parcours authentifié | Optional annex disabled generates two-slide export of a new explicitly saved revision | Réussi |
| 9 | Parcours authentifié | Concurrent writers detect conflict; draft and recovery remain without overwriting newer work | Réussi |
| 10 | Parcours authentifié | Real SDK session refresh alone emits zero save writes; a subsequent real edit saves | Réussi |
| 11 | Parcours authentifié | Reader sees allowed project but cannot edit, generate, approve or read private source photos | Réussi |
| 12 | Parcours authentifié | Authorized publication exposes only the exact finalized presentation to reader | Réussi |
| 13 | Parcours authentifié | Mobile 390px editor and original previews fit without horizontal overflow | Réussi |
| 14 | Parcours authentifié | JSON UI import creates a new draft and shared identity without restored approval | Réussi |
| 15 | Panne simulée | SIMULATED save transport 503 preserves local edits and never confirms saved | Réussi |
| 16 | Panne simulée | SIMULATED presentation upload failure yields no download or false archive confirmation | Réussi |
| 17 | Panne simulée | SIMULATED photo upload failure leaves explicit pending transfer; authorized abandonment retires it | Réussi |
| 18 | Parcours authentifié | An actual late project response cannot overwrite a newer draft in the same page | Réussi |
| 19 | Parcours authentifié | Actual held project response plus normal logout/account change stays isolated in the SAME browser context | Réussi |

Deux événements `held-response-delivery-cancelled` sont conservés lors de la libération des réponses retenues des deux derniers scénarios : `route.fulfill: Route is already handled!`. Ils sont interceptés par le pilote, sans erreur de page ni échec d’assertion. Ces traces ne prouvent pas que ces deux réponses annulées ont été livrées au composant ; les assertions existantes vérifient la conservation du nouveau brouillon et l’absence de fuite après changement de compte. Aucun événement n’est masqué.

Les droits, auteurs et révisions réellement enregistrés, l’ouverture par le second compte, les exports JSON/PPTX, la restriction lecteur, les conflits et réponses tardives sont vérifiés par les assertions existantes. Le renouvellement de session seul ne provoque aucune sauvegarde ; la modification réelle suivante est sauvegardée. Les trois pannes concernent la sauvegarde RPC, l’upload PowerPoint et l’upload photo. Le scénario photo vérifie aussi l’état pending puis l’abandon autorisé, sans réutilisation du chemin.

Exports fictifs conservés dans `generator-browser/` : `fictional-project.json`, les PPTX deux/trois diapositives, `reader-authorized.pptx`, les trois JSON de récupération (conflit, sauvegarde, upload). Aucun document réel. L’exécution des assertions PPTX existantes ne constitue pas une nouvelle campagne de parité visuelle ou une modification PowerPoint.

### Commandes exécutées

L’environnement a été vidé puis reconstruit explicitement. Les fichiers privés de statut et de fixture fournissent uniquement les identifiants de la pile fictive ; aucun secret n’est reproduit ici. Les commandes exactes et l’environnement sans valeur secrète figurent dans `generator-browser/invocation.json` et `review/COMMANDS.md`.

```sh
# Cycle existant, avec DOCKER_HOST=unix:///Users/vg/.colima/default/docker.sock :
node tests/izord/generator-services.mjs --start
# Réutilisation gardée du build déjà validé, sans build supplémentaire :
node /tmp/izord-confirmed19-serve.mjs
# Une seule invocation avec IZORD_TEST_ACK=IZORD_DISPOSABLE_LOCAL_ONLY :
node tests/izord/generator.browser.mjs
# Arrêt du lanceur possédé, puis :
node tests/izord/generator-services.mjs --stop
git diff --check
```

Les gardes ont vérifié le socket Colima, Client/Server Docker, les cibles locales, les six services, les liaisons loopback et les volumes existants. Aucun refus de garde de cible, aucun secours distant. Les scénarios ont créé seulement leurs nouveaux comptes/projets/versions/documents fictifs ; aucune migration ni suppression de volumes.

### Diff, limites et arrêt final

`review/draft-recovery-final.patch` compare le point de reprise du début de la correction (153 fichiers) à l’état final, y compris les fichiers non suivis. `review/confirmation-only.patch` montre uniquement l’édition documentaire de cette clôture ; `review/git-status.txt` donne le statut actuel. Les anciens patchs, résultats et erreurs restent intacts. Aucun commit, push, déploiement ni nouvelle archive.

Les limites de la reprise volatile restent celles documentées : perte possible après fermeture/crash, analyse interrompue à relancer, opération déjà envoyée susceptible d’avoir abouti, création sans accusé pouvant nécessiter un rapprochement manuel, capacités signées déjà émises non annulées rétroactivement. Aucun nouveau défaut applicatif reproduit dans les 19 scénarios ; leur réussite ne constitue pas une garantie absolue.

Pile arrêtée à **2026-09-17T21:22:37.888Z**, volumes PostgreSQL et Storage conservés. Next arrêté ; ports 3159/55431/55432/55434 confirmés fermés (`ports-stopped.json`). SQL, HTML original, dépendances et WIF inchangés, WIF non suivi/exclu. Aucun accès distant, invitation réelle, opération Drive réelle, modification Vercel ou accès au profil Chrome personnel.

Git status --short à la clôture :

```text
 M .gitignore
 M app/api/drive/_utils.ts
 M app/page.tsx
 M components/CRMApp.tsx
 M components/MobileCRMHeader.tsx
 M components/SearchableBusinessContactPicker.tsx
 M package-lock.json
 M package.json
 M tests/contactAddress.browser.ts
 M tests/driveFolderConcurrency.test.ts
 M tests/driveRegistryAuth.test.ts
 M tsconfig.json
?? .vercelignore
?? app/izord/
?? app/spaces/
?? components/AccessPortal.module.css
?? components/AccessPortal.tsx
?? components/izord/
?? docs/izord/
?? eslint.config.mjs
?? lib/access/
?? lib/izord/
?? lib/taskMaintenance.ts
?? supabase/migrations/20260916170445_module_access_foundation.sql
?? supabase/migrations/20260917172412_izord_generator_versions.sql
?? tests/crmCache.test.ts
?? tests/izord/
?? tests/izordAuthorization.test.ts
?? tests/izordGeneratorRepository.test.ts
?? tests/moduleAccess.test.ts
?? tests/taskMaintenance.test.ts
?? tests/workspaceSync.test.ts
```
