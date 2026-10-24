# Conservation des photographies des présentations

Validation réalisée sur le build de production local, avec Auth, RPC, PostgreSQL et Storage réels du banc isolé `127.0.0.1:55931` / `55932`. Deux nouveaux dossiers fictifs indépendants ont été créés avec douze JPEG finalisés et deux PDF sources privés. Chaque dossier possède quatre photographies de synthèse, deux photographies de galerie, leurs affectations et sept références de fichiers.

Les sept parcours de la première campagne passent : historique en lecture seule sur chaque dossier ; ouverture courante du même dossier, modification du seul texte « Équipements / atouts », sauvegarde puis rechargement natif sur chaque dossier ; conservation du mode historique après une indisponibilité locale bornée ; lecture courante et historique sans modification pour le lecteur affecté aux deux dossiers. Aucun `pageerror`.

L’ouverture courante est effectuée avec le bouton réel de la liste. Son URL désigne ensuite le dossier courant, sans révision historique. Le test appelle directement `page.reload()` après la sauvegarde, sans réparer l’URL.

Pendant cette première campagne, seules deux mutations ont été envoyées : les RPC de sauvegarde des textes, de la révision 3 à la révision 4. Aucun enregistrement, téléversement ou remplacement de photographie. Aucun appel de génération payante.

Le contrôle après parcours utilise une nouvelle connexion Auth et une lecture directe de PostgreSQL. Il confirme que le seul champ modifié est `data.state.features` : `photos`, `importGallery`, `photoGalleryRoles`, `importMeta` et `sourceDocuments` sont identiques. Les sept références par dossier réutilisent exactement les mêmes identifiants ; les lignes d’assets, les anciens instantanés 1 à 3 et les octets des quatorze objets Storage sont inchangés.

Les empreintes ci-dessous utilisent SHA-256 après tri récursif des clés d’objets JSON ; l’ordre des tableaux est conservé.

| Dossier fictif | Empreinte des photographies, galerie, rôles, provenance et sources avant / après |
| --- | --- |
| d037dcad-8dce-49fd-a27c-a12fbd1b204e | `b4adb2cb7ea2ff31b624e21cacef6c9b5365da99c6aee370ae6d47edabedb6fe` |
| 4910abb7-d193-49da-8e60-ce58653317b8 | `bda3a6d970db68969f73d59b539d58c40de8cd49386253c58d0c6b8e92525f35` |

Le scénario de reprise injecte uniquement une réponse HTTP 503 sur le GET local `app_memberships`, puis rétablit le vrai service et déclenche le contrôle d’accès normal. Il confirme la révision 2 et la lecture seule, sans sauvegarde. Les contrôles de droits utilisent aussi le vrai serveur : le lecteur peut lire les dossiers affectés ; sa tentative de sauvegarde reçoit `42501` et le téléchargement des JPEG privés est refusé.

## Passage vers un autre dossier dans la même vue

Un contrôle complémentaire unique a été exécuté sur le build final, sans répéter les sept parcours précédents : ouverture de l’historique du dossier A (révision 2), puis clic sur « Ouvrir » pour le dossier courant B (révision 4) dans la même vue montée. Les six JPEG de B sont présents et ceux de A sont absents de cette vue.

Le texte « Équipements / atouts » de B est modifié, puis enregistré en révision 5. Un rechargement natif conserve B, son texte et les mêmes octets photographiques, sans retouche de l’URL par le test. Cette étape ajoute exactement une RPC de sauvegarde et aucun transfert photographique.

Une lecture directe de PostgreSQL avant/après et une nouvelle connexion Auth confirment : photos, galerie, rôles, provenance, documents sources et sept références de fichiers de B identiques ; assets et instantanés antérieurs inchangés ; sept objets Storage de B identiques octet pour octet. Le dossier A est intégralement inchangé : révision, payload, assets, versions et références.

Le reçu `photo-cross-results.json` complète les reçus initiaux : A passe de 3 à 4 dans la première campagne ; B passe de 3 à 4, puis de 4 à 5 lors de ce contrôle croisé. Les contrôles de persistance initiaux restent les preuves de leur étape respective.

Les reçus détaillés et les captures sont enregistrés dans ce dossier. Les identités, jetons et paramètres privés du banc restent sous `/private/tmp/oar-task-link-corrections/photo-fixture.private.json` et ne sont pas versionnés.

## Reproduction ciblée

Utiliser le banc jetable local existant, puis le serveur corrigé sur `127.0.0.1:3198`. La préparation crée de nouveaux dossiers et conserve les précédents essais fictifs. Le contrôle croisé s’exécute une seule fois après la preuve initiale en révision 4 ; il fait avancer B en révision 5.

```sh
TASK_LINK_CORRECTIONS_ACK=TASK_LINK_CORRECTIONS_DISPOSABLE_LOCAL_ONLY node tests/task-link-corrections/photo-fixture.cjs
TASK_LINK_CORRECTIONS_ACK=TASK_LINK_CORRECTIONS_DISPOSABLE_LOCAL_ONLY node tests/task-link-corrections/photo-browser.mjs
TASK_LINK_CORRECTIONS_ACK=TASK_LINK_CORRECTIONS_DISPOSABLE_LOCAL_ONLY node tests/task-link-corrections/photo-verify.cjs
TASK_LINK_CORRECTIONS_ACK=TASK_LINK_CORRECTIONS_DISPOSABLE_LOCAL_ONLY node tests/task-link-corrections/photo-cross-dossier.mjs
```
