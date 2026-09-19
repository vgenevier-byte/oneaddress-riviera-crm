# CRM unifié — corrections finales locales du 19 septembre 2026

Base : `38f83b70cb4fa1e0230edd09bc92aad199a8a7b6`. Lot non commité, non poussé, non déployé. Aucune migration distante, invitation réelle, opération Google Drive réelle ou modification des droits de Production. WIF inchangé, ignoré/non suivi et exclu des livrables.

## Démonstration

[Ouvrir le CRM local](http://127.0.0.1:3160). Mot de passe commun des profils ci-dessous : **`Local-CRM-2026!`**. Comptes et données exclusivement fictifs dans la pile locale.

| Email | Profil |
|---|---|
| `unified-admin@example.invalid` | CRM complet, IZORD admin, administration générale |
| `unified-business@example.invalid` | Tous les modules métier OAR avec droits sensibles, **sans administration générale ni payload global** |
| `unified-house@example.invalid` | Contribution Suivi maison, Lecture Planning |
| `unified-invoices@example.invalid` | Factures en lecture, sans Contacts/RIB/notes privées |
| `unified-tasks@example.invalid` | Contribution Tâches seule |
| `unified-izord@example.invalid` | IZORD contributeur seul |
| `unified-izord-admin@example.invalid` | Administration IZORD, aucune administration générale |
| `unified-none@example.invalid` | Connecté, aucun accès |

Se déconnecter avant de changer de profil. Les navigateurs de test ont utilisé des contextes temporaires ; aucun profil Chrome personnel n’a été purgé. Les autres comptes visibles sont également des fixtures locales.

Avec `unified-business`, essayer les lignes de Devis, les heures et bilans Suivi maison, le calendrier Planning, les fiches Contacts et les pièces prestataires. Le Dashboard propose aussi la saisie depuis message : le parseur et les confirmations de doublons existants sont réutilisés, puis Contact + Lead sont écrits atomiquement par une RPC ciblée. Avec `unified-house`, les filtres Planning fonctionnent en Lecture mais la saisie reste désactivée. Avec l’administrateur, ouvrir **Administration → Utilisateurs et accès**, puis modifier un profil fictif ou révoquer une invitation en attente.

Pour inviter localement : adresse `@example.invalid`, droits choisis, envoi vers [Mailpit local](http://127.0.0.1:55434), lien ouvert dans un contexte distinct, Auth vérifiée puis acceptation explicite. Le même parcours prend en charge un compte existant sans accès à remplacer. Aucun droit attribué avant acceptation.

## Corrections U1 à U4

| Cas | Correction et preuve |
|---|---|
| U1 | Toute suppression via Réservations est refusée (`booking_delete_forbidden_use_cancellation`), même avec Contribution + Suppression Réservations et Contribution Devis. L’annulation reste une modification métier ; elle ne supprime pas le devis. Reproduction avant correction HTTP 200, puis refus HTTP 403 et ligne conservée. |
| U2 | Les opérations sont liées au compte, module, révision des droits et durée de vie du composant. Jeton de l’acteur capturé, client dédié, signal d’annulation, contrôle avant/après chaque attente et avant téléchargement, copie, upload suivant ou callback. Deux parcours navigateur avec Auth réelle A→B et réponses RPC réelles retardées passent : zéro téléchargement après export tardif, zéro upload après réservation tardive. Banque, paiement et administration utilisent le même mécanisme. |
| U3 | Une invitation ordinaire refuse un ancien profil `general_admin`, même inactif et sans grants actifs ; les rôles/affectations IZORD préexistants sensibles exigent une revue explicite. Reproduction avant correction HTTP 204, puis refus HTTP 403 (`existing_admin_requires_review`), sans réactivation. |
| U4 | `crm_admin_save` refuse explicitement la révision nulle et les paramètres obligatoires invalides. Comparaison optimiste par `IS DISTINCT FROM`. Reproduction avant correction HTTP 200, puis HTTP 400 ; conflits de révision et dernier administrateur restent protégés. |

Code : `lib/access/operations.tsx`, composants restreints, `crm_mutate_record`, `crm_invite_accept`, `crm_admin_save`. Preuves : `/tmp/crm-unified-review/review-before.json`, `review-after.json`, `finalisation-browser.json`, `finalisation-browser-reprise.json`.

Une requête déjà admise par le serveur peut s’achever ; aucun rollback rétroactif d’une transaction ou d’un téléchargement déjà effectué n’est promis. La base vérifie les droits effectifs à chaque opération ; le portail se rafraîchit au focus et toutes les 60 secondes. Un export ne peut empêcher la recopie d’informations lisibles.

Le texte IZORD a été corrigé : approbation réservée aux rôles Associé / Administrateur IZORD, selon les droits du module. Aucun contrôle « interdit d’approuver son propre dossier » n’est inventé ; workflow, rôles et affectations IZORD inchangés.

## Fonctions reprises et restrictions

Les profils restreints montent les **vues métier nommées existantes**, exportées depuis CRMApp, sans monter son chargeur/sauvegardeur global. Leur contrôleur utilise `crm_read_module`, des références minimales explicitement autorisées et des mutations ciblées. Les aides Contacts, devis, heures, calendrier, finance et saisie rapide sont réutilisées. Aucun second moteur de calcul ni modification PowerPoint.

Lecture ne permet pas la saisie ; les filtres et consultations restent disponibles. Contribution ne donne pas automatiquement Suppression, Export, Lecture bancaire, Gestion RIB ou Paiement. Les champs privés volontairement absents du catalogue ne correspondent pas à un nouveau droit par champ : **leur absence est une limite de projection conservatrice, pas une permission à ajouter pour rétablir leur apparence**.

| Module | Formulaire / parcours repris | Restriction liée aux droits | Limite réelle restante |
|---|---|---|---|
| Dashboard | Synthèses et raccourcis métier, saisie depuis message avec parseur existant et création Contact + Lead atomique. | Seulement sources autorisées ; aucun cache de devis global, sauvegarde/import global ou agrégat d’un module interdit. Saisie depuis message exige Contribution Contacts et Leads. | Diagnostic « contact incomplet » non affiché : les références minimales n’embarquent pas email/téléphone. Notes privées du message non reprises dans la projection. |
| Contacts | Listes guidées, adresse multiligne, classification/conversion, fiches et raccourcis vers Leads/Tâches ; panneau bancaire dédié. | RIB seulement avec Lecture bancaire ; gestion exige Contribution + Gestion RIB. Références intermodules selon leurs droits. | Notes privées/préférences hors projection. Les coordonnées bancaires se gèrent dans le panneau protégé. |
| Leads | Formulaire, choix d’actif et de contact, statuts, création de tâche et brouillon de devis par l’aide existante. | Chaque parcours lié exige ses droits propres ; aucune attribution implicite. | Notes privées hors projection. |
| Tâches | Responsable, rattachement à un lead autorisé, statuts et échéances. | Rattachement absent sans Lecture Leads ; suppression distincte. | Pas de limitation fonctionnelle supplémentaire identifiée sur la liste ciblée. |
| Devis | Prestations/lignes, chiffrage et conditions, client autorisé, états, rendu PDF existant. | Client selon Contacts ; PDF/export selon Export. | Notes internes hors projection ; aucun import/export global. |
| Réservations | Vue des devis Accepted, checklist, affectation et règlements opérationnels existants. | Écriture exige Contribution Réservations + Devis ; aucune suppression indirecte du devis. | Notes opérationnelles privées hors projection. |
| Devis prestataires | Choix prestataire, formulaire, pièce intégrée, validation/refus et décision explicite sur facture liée. | Validation exige Contribution Factures ; suppression de la facture exige son droit distinct et facture automatique réellement vide. | Une pièce historique non classée ne s’ouvre pas pour un profil limité. |
| Factures prestataires | Prestataire, pièce intégrée, saisie des règlements, préparation avec choix explicite d’un compte vérifié, nettoyage d’orphelin vide. | Contribution + Paiement + Lecture bancaire pour préparer ; compte du fournisseur vérifié, pièce et droits nécessaires pour enregistrer le règlement. Aucun virement. | Notes privées hors projection ; remplacement d’une pièce de facture utilisée refusé. |
| Suivi maison | Sélecteurs nominatifs, 96 quarts d’heure, Aujourd’hui, heures/paiements, bilans CSV, intervenants actifs/archives. | Module entier, pas de fausse portée personnelle « mes heures ». CSV selon Export, suppression selon droit et historique. | Notes privées maison/intervenant hors projection ; notes opérationnelles heures/paiements conservées. |
| Documents | Liste classée, recherche, dossiers CRM, renommage/classement, ajout, téléchargement, suppression autorisée, remplacement Storage par nouvelle version conservant l’original. | Droits Documents + propriétaire, Export pour téléchargement. RIB et preuves de factures utilisées protégés ; fichier encore référencé non supprimable par droits génériques. | Le classement/renommage est celui du CRM, sans déplacer/renommer physiquement Drive. Les fichiers Drive classés sont consultables/téléchargeables ; écriture binaire et gestion physique de l’arborescence Drive historique restent au parcours complet. Aucun bouton de remplacement Drive simulé. |
| Planning | Calendrier, filtres, ressources, disponibilité et dates liées. | Sources accessibles uniquement ; modification de dates de lead exige Contribution Leads. | Notes privées hors projection. |
| Biens / Voitures / Bateaux | Cartes, détails, filtres, champs et propriétaires autorisés, liens leads disponibles. | Identité propriétaire selon Contacts, liens selon Leads, suppression protégée. | Notes privées hors projection. Les vues existantes n’avaient pas de photothèque éditable dédiée ; aucune nouvelle photothèque annoncée. |
| IZORD Invest | Générateur et parcours existants conservés dans la navigation commune. | Matrice **et** rôle/affectations IZORD ; pas d’administration générale dérivée. Export distinct. | Preuves PowerPoint antérieures réutilisées, pas de nouvelle comparaison de 13 pages. |

Les pièces jointes sont réservées et chargées avec leur module propriétaire. Un échec après création de la fiche/réservation peut laisser une fiche ou une version non rattachée : l’interface signale l’échec, jamais un succès complet. Les anciens objets ne sont pas écrasés. Le remplacement bancaire passe par la gestion RIB ; le remplacement générique ne modifie pas une preuve bancaire vérifiée.

## Conservation et règles métier

Le serveur verrouille l’état existant, contrôle la révision, fusionne `oldrow || patch || métadonnées serveur` et remplace uniquement la collection concernée. Une propriété omise est conservée ; une chaîne vide explicitement autorisée la vide. Le navigateur compare les champs projetés et transmet uniquement les différences autorisées. Les tableaux vides de présentation ne passent **jamais** dans une écriture globale.

La preuve porte maintenant aussi sur la **ligne modifiée** : RIB/notes/adresse Contact ; paiements, pièce et lien de facture ; valeurs privées d’heures/paiements maison. Toutes les autres collections sont comparées avant/après. Preuve : `tests/unified/finalisation.mjs`, premier scénario de `finalisation-sql.json`.

Les suppressions génériques contrôlent RIB embarqués, preuves, paiements et références imbriquées. Les workflows dédiés reprennent l’origine automatique et l’absence de données d’usage, protègent les factures récurrentes et ne rapprochent jamais des factures par montant/contact/titre seuls. Refuser un devis annule seulement sa facture automatique encore vide et exige Contribution Factures si elle doit changer ; une facture utilisée reste intacte. Suppression « conserver la facture » explicite, ou « supprimer les deux » avec les deux droits et préconditions. Tests : `finalisation-finance.json`, `finalisation-finance-reprise.json`, `finalisation-additions.json`, 81 non-régressions métier existantes.

Enums, dates, quarts d’heure, références, conversion Contact et compte bancaire sélectionné sont contrôlés au serveur en plus des contrôles métier existants. La nouvelle version documentaire conserve les octets de l’original ; les permissions/restrictions effectives sont retournées avec les documents pour ne pas proposer une commande systématiquement refusée.

## Invitations : code, configuration et preuve

Le raccordement utilise maintenant **Supabase Auth natif**, depuis Administration → Utilisateurs et accès, via `/api/access/invite` et `lib/server/invitations.ts`. Il reste **désactivé par défaut en Production**. Après vérification de la session et de l’administration générale, la route prépare les droits puis appelle `inviteUserByEmail` côté serveur. Le secret Auth n’est jamais transmis au navigateur. Pour un compte déjà existant, le parcours natif `signInWithOtp` utilise `shouldCreateUser:false` ; aucun compte doublon. La présence du compte et son initialisation sont distinguées côté serveur : `crm_invite_prepare` retourne `needsPasswordSetup` à partir de l’existence effective d’un mot de passe Auth, sans exposer son hash. Une relance propose le choix du mot de passe si le compte en est encore dépourvu ; un compte déjà initialisé conserve son mot de passe. Ce booléen pilote le parcours, jamais les droits.

Le lien email est construit et vérifié par Supabase (`/auth/v1/verify`), puis revient avec une session native dans le fragment URL. Le SDK traite ce fragment ; le CRM attend son initialisation. Seul le jeton métier distinct est transporté dans `redirectTo?invite=…`. Aucun `token_hash` Auth reconstruit par le CRM, aucune attribution de droits par `user_metadata`. Une erreur Auth bloque l’acceptation, y compris avec une session préexistante et après rechargement. La base valide le destinataire et l’historique des privilèges **avant** toute modification de mot de passe. Si Auth refuse le nouveau mot de passe, une étape dédiée permet de réessayer, y compris après rechargement, sans rejouer l’acceptation. Le marqueur de reprise ne confère aucun droit.

La création et la confirmation Auth seules n’accordent ni grant, ni membership métier. Le clic d’acceptation exécute toujours `crm_invite_accept` sous le JWT du destinataire confirmé : expiration, révocation, créateur encore administrateur actif, non-rejeu, ancien administrateur et rôles/affectations IZORD sensibles restent contrôlés en base. Le créateur est revérifié avant et après l’appel Auth. Un échec d’envoi révoque l’invitation ; si la révocation échoue, la route demande sa vérification sans faux succès. La correction du 19 septembre ajoute seulement ce booléen à `crm_invite_prepare` dans la migration locale encore non publiée ; aucune migration déjà appliquée en Production n’est modifiée.

| Nature | État |
|---|---|
| Code fourni | Envoi natif Auth, retour natif, contrôles administrateur/destinataire, acceptation explicite, reprise et révocation. Ancien relais HTTPS supprimé ; aucune dépendance ou offre nouvelle. |
| SMTP distant | Google Workspace configuré dans Supabase ; réception d’un email de récupération avec le bon expéditeur **confirmée par le propriétaire**. Cette information remplace l’ancienne mention « indéterminé ». Aucune nouvelle lecture distante ni nouvel envoi pendant cette correction. |
| Configuration restante | Activation serveur CRM, origines/retour autorisés et recette du parcours d’invitation sur le domaine réel à effectuer lors d’une mise en service autorisée. Aucun nouveau prestataire, aucune modification du SMTP du site. |
| Limitation locale | Même API native Auth, avec Mailpit fictif. Garde exact 55431 et destinataires `@example.invalid`, acquittement requis ; retour 3160 ajouté à la seule pile jetable existante, avec conservation des volumes. |
| Non démontré en Production | Parcours complet d’invitation : envoi depuis le CRM, retour natif, destinataire, acceptation, droits puis reconnexion sur le domaine réel. La récupération reçue et les succès locaux ne valent pas cette recette. |

Les preuves natives précédentes restent conservées : `finalisation-invitation-adapter.json`, `native-invitations.json`, `native-invitation-password-retry.json`. Elles n’établissaient pas la relance d’un compte Auth sans mot de passe. Les reproductions et la campagne ciblée du 19 septembre sont détaillées ci-dessous, sans additionner les campagnes recouvrantes.

## Deux corrections après la revue finale

### Reproductions avant correction

- **Invitations** : premier compte Auth créé, invitation laissée inachevée, puis relance depuis Administration. Même identité Auth, aucun droit avant acceptation, mais absence du champ de mot de passe et échec de connexion par mot de passe dans un contexte neuf. Même défaut après une exception simulée de l’adaptateur **après livraison Auth locale et création du compte** : cela reproduit la reprise de cet état partiel, sans prétendre reproduire une panne SMTP réelle. Preuve : `native-invitation-resend-before.json` (2 reproductions).
- **Contacts et Devis** : RPC réelles en conflit `40001` et refus `42501`. Perte de saisie dans l’édition Contact et dans la création/édition Devis. La création Contact conservait déjà la saisie : elle n’est pas présentée comme un défaut initial. Preuves : `form-save-before.json`, `form-save-before-conflict.json`. Le statut « passed » de ces pilotes indique que l’observation a abouti ; **`draftPreserved:false` établit le défaut**, pas un succès produit. PostgREST retourne HTTP 500 pour le conflit SQL 40001 dans cette pile, pas HTTP 409.

### Correction et conservation

`ModuleWorkspace` retourne un résultat explicite jusqu’au formulaire. Contacts et Devis attendent la réponse positive avant fermeture/réinitialisation ; conflit, refus et panne conservent les champs avec une erreur lisible. Un verrou immédiat bloque le double envoi. La confirmation est rattachée à la durée de vie du formulaire et à sa version : une réponse ancienne ne réinitialise pas une saisie plus récente. Après une création confirmée dont le brouillon a évolué, l’identité créée est retenue ; la soumission explicite suivante modifie cette même fiche, sans doublon.

Les rafraîchissements de session/droits inchangés ne rechargent plus silencieusement la projection pendant un conflit. La révision d’origine demeure jusqu’à une résolution explicite ; aucun retry automatique ni remplacement de révision pour contourner un conflit. Les opérations restent rattachées au compte et aux droits capturés ; un changement de compte ou une révocation retire le formulaire. Aucun brouillon transmis au compte suivant, aucun recours au payload global.

Les mutations restent les RPC limitées et leur fusion des champs omis ; le pilote ciblé compare la ligne modifiée, toutes les autres lignes et collections, et vérifie les données attendues après confirmation. Aucun champ privé supplémentaire n’est transmis pour ressembler au formulaire complet.

### Résultats ciblés sur le code final

Une seule campagne finale après stabilisation, sur le build servi à 3160. Aucun test métier historique inchangé relancé.

| Contrôle final | Résultat | Preuve dans `/tmp/crm-unified-review/` |
|---|---|---|
| Invitations Auth/Mailpit/navigateur locaux | **11/11** : nouveau compte ; relances sans mot de passe dont échec après création Auth ; compte initialisé inchangé ; administration, destinataire, acceptation explicite, métadonnées inertes, expiration, révocation, rejeu, ancien administrateur et reprise après refus Auth | `native-invitations-final.json`, `.log` |
| Adaptateur, SDK simulé | **10/10**, dont branchement du mot de passe par état serveur et refus fermé si cet état manque | `native-invitation-adapter-final.json`, `.log` |
| Contacts/Devis, formulaires et RPC locales réelles | **24/24** : 12 conflits/refus/pannes (création + édition des deux modules), 8 succès retardés dont 4 brouillons plus récents suivis d’une reprise sans doublon, 4 changements de compte/révocations | `form-save-confirmation.json`, `.log` |
| TypeScript | Réussi, sans émission ni incrémental | `two-fixes-final-typescript.log` |
| Lint | **0 erreur, exactement 2 avertissements historiques** | `two-fixes-final-lint.log` |
| Build | Réussi, webpack/TypeScript ; application isolée prête | `two-fixes-final-build.log`, `app.json` → `buildLog` |
| Identité du code servi | 6 fichiers produit concernés comparés octet par octet aux sources ; empreintes conservées | `two-fixes-final-code.json` |
| Diff | Contrôle des espaces des fichiers suivis et nouveaux, index inchangé ; couverture intégrale du patch contrôlée | `two-fixes-final-diff-check.log`, `/tmp/crm-review-copy-checks.json` |

Les deux relances gardent le même compte Auth, révoquent/supplantent l’ancienne invitation, permettent de choisir un mot de passe, puis réussissent **déconnexion et connexion dans un contexte neuf**. Le compte déjà initialisé conserve son mot de passe (hash comparé sans être publié).

Les 8 succès métier comparent les autres lignes et modules ; les 4 éditions comparent aussi les champs omis de la fiche modifiée. Dans le JSON du pilote, `omittedFieldsPreserved:false` pour une **création** signifie « sans ligne antérieure à comparer », pas une suppression ; de même les indicateurs `newerDraft*` ne s’appliquent qu’aux quatre scénarios correspondants. Les conflits sont produits par une vraie écriture concurrente ; les refus par les vrais droits. La panne réseau est injectée sur la seule mutation, et le succès tardif retient une vraie réponse RPC 200. Le test de brouillon plus récent simule une saisie par événements DOM pendant l’attente, les contrôles étant désactivés pour l’utilisateur.

Mise au point conservée : premier sélecteur de déconnexion incorrect dans les invitations (`native-invitation-resend-before-attempt-1.*`) ; pilote conflit attendant HTTP 409 au lieu du 500/40001 réel (`form-save-before.*`, reprise ciblée `form-save-before-conflict.*`) ; avertissement supplémentaire du hook supprimé avant la campagne finale (`two-fixes-lint.log`). La relecture a également relevé puis fait corriger un risque de doublon au second enregistrement du brouillon conservé ; le test final poursuit maintenant cette seconde soumission. Aucun échec supprimé ni scénario ignoré pour obtenir le résultat.

### Bootstrap exact

Une seule exécution du pilote `tests/unified/bootstrap.mjs`, avec le bloc SQL extrait **tel quel de PUBLICATION.md**, substitution explicite du seul UUID/email fictif, et transaction finale annulée pour retirer les fixtures. **9 contrôles réussis** : acquittement absent/erroné, UUID/email erronés refusés ; propriétaire fictif complet, seconde application conservant son accès ; rôles, affectations et plafond IZORD conservés ; autres comptes et données inchangés ; fixtures retirées par rollback. Preuve : `bootstrap-exact-2026-09-19T12-34-29-977Z.json`. SHA-256 du bloc original : `54404c31376bd2b0b98f0e3f979d5f403d489030b9661058dc1d17d24e2f90eb`. Aucun compte réel concerné.

### Fichiers modifiés par cette correction

- Produit : `components/CRMApp.tsx`, `components/ModuleWorkspace.tsx`, `components/BusinessPermissions.tsx`, nouveau `lib/access/useConfirmedForm.ts`, `lib/server/invitations.ts`, et seule fonction `crm_invite_prepare` de `supabase/migrations/20260918084849_unified_module_permissions.sql` (migration encore locale).
- Pilotes : `tests/unified/finalisation-invitations.mjs`, `tests/unified/invitation-adapter.mjs`, nouveaux `tests/unified/form-save-confirmation.mjs`, `tests/unified/bootstrap.mjs`, `tests/unified/apply-invitation-password-state.mjs`.
- Documents : ce rapport et `PUBLICATION.md` ; diff complet et quatre copies de revue régénérés. Les autres chemins de l’état Git appartiennent au lot unifié préexistant.


## Résultats, sans total artificiel des campagnes recouvrantes

Toutes les preuves ci-dessous se trouvent sous `/tmp/crm-unified-review/`. Les JSON/logs privés contenant des identifiants de connexion ou liens ne sont pas copiés au dossier de partage.

| Contrôle | Résultat de finalisation | Preuve |
|---|---|---|
| U1/U3/U4 | 3 reproductions positives avant correction, 3 refus attendus après | `review-before.json`, `review-after.json`, `finalisation-u134.log` |
| Matrice Auth/REST/RPC/Storage | 23 scénarios réussis | `security.json`, `finalisation-security.log` |
| Workflows sensibles / bornes | 3 + 2 réussis, compteurs distincts | `workflows.json`, `boundaries.json`, logs `finalisation-workflows.log`, `finalisation-boundaries.log` |
| Documents / agrégats | 3 réussis : Storage réel ; Google simulé | `documents.json`, `finalisation-documents.log` |
| Conservation / validations / invitations SQL | 7 réussis au premier passage ; un défaut de projection corrigé puis seul scénario concerné réussi | `finalisation-sql.json`, `finalisation-sql-reprise.json` |
| Refus et suppressions fournisseurs | 3 réussis au premier passage ; dernière fixture corrigée puis scénario réussi | `finalisation-finance.json`, `finalisation-finance-reprise.json` |
| Saisie rapide / versions documentaires | 3 réussis, RPC et Storage réels | `finalisation-additions.json` |
| Adaptateur natif précédent, appels SDK simulés | 8 réussis : activation, destinations, compte nouveau/existant, absence de metadata métier, erreurs Auth | `finalisation-invitation-adapter.json` |
| Invitation complète locale historique (ancien relais) | 4 réussis lors de la finalisation précédente ; remplacés pour le transport par les 8 scénarios natifs décrits plus haut | `finalisation-invitations.json`, `native-invitations.json` |
| API Next | 8 contrôles réussis ; Mailpit local, refus Google avant transport | `api.json`, `finalisation-api.log` |
| Profils bureau/mobile | 7 profils réussis, sans débordement global ni erreur de page | `browser.json`, `finalisation-browser-profiles.log` |
| U2 + formulaires repris | 4 scénarios finaux réussis en première exécution/reprises ciblées : export tardif, réservation tardive, Tâches, tour des vues métier | `finalisation-browser.json`, `finalisation-browser-reprise-selecteur.json`, `finalisation-browser-reprise.json` |
| Saisies métier navigateur | Planning et lignes de devis réussis ; heures nominatives et saisie Dashboard réussies après correction de pilotes | `finalisation-business-browser.json`, `finalisation-business-browser-reprise.json` |
| Derniers raccordements UI | 3 réussis : filtres Lecture, révocation invitation et version documentaire | `finalisation-last-browser.json` |
| Non-régressions métier existantes | **81 tests réussis, 0 ignoré**, Contacts, finance prestataires, banque, maison, tâches, devise | `finalisation-unit.log`, `finalisation-unit-compile.log` |
| SQL intégral précédent (preuve conservée) | Rejeu transactionnel local avant le seul ajout du booléen à `crm_invite_prepare`, données/factures récurrentes et appartenances inchangés, aucun admin implicite, accès brut fermé, aucun SECURITY DEFINER du lot accessible à anon | `migration-replay.json`, `finalisation-migration.log` |
| Source SQL installée précédente | 49 fonctions comparées avant la correction du booléen ; installation ciblée actuelle : `invitation-password-state-local-apply.json` | `installed-sql.json`, `finalisation-installed.log` |
| TypeScript / lint / build précédents | Preuves historiques conservées ; résultats sur le code du 19 septembre détaillés séparément | `finalisation-typescript.log`, `finalisation-lint.log` |

Les warnings historiques concernent la navigation `window.location.assign` et une balise `img`. Aucune reprise des chantiers Next.js/ESLint. Les preuves antérieures finance/IZORD/session/PPT sont conservées et réutilisées ; leurs compteurs ne sont pas ajoutés à ceux de cette finalisation.

Échecs conservés : omission d’identifiant dans une projection SQL (corrigée) ; fixture d’orphelin dont l’identifiant était inclus dans celui de sa sœur, refusée par le contrôle de références existant (fixture indépendante corrigée, garde inchangée) ; sélecteurs de labels contenant leurs options ; assertion `isDisabled` sur le fieldset au lieu de ses contrôles réellement désactivés ; réponse du pilote au dialogue complémentaire du parseur historique ; nom de variable `module` interdit par le lint du pilote. Les reprises portent sur ces seuls scénarios. Aucun refus de sécurité n’a été transformé en test ignoré ou en succès.

## Captures et pièces de revue

[Heures et sélecteurs](/tmp/crm-unified-review/finalisation-maison-saisie.png) · [Devis et lignes](/tmp/crm-unified-review/finalisation-devis-saisie.png) · [Planning](/tmp/crm-unified-review/finalisation-planning.png) · [Mobile métier](/tmp/crm-unified-review/finalisation-mobile-metier.png) · [Documents/version](/tmp/crm-unified-review/finalisation-documents-versions.png).

Le dossier `/Users/vg/Desktop/CRM-Unifie-Revue` contient les quatre pièces actualisées : ce rapport, `unified.patch`, la migration SQL intégrale et `PUBLICATION.md`. Le diff contient les modifications suivies **et les nouveaux fichiers non suivis**, sans ajout à l’index. Copies de partage expurgées des secrets, mots de passe fictifs et identifiants personnels ; sources conservées. Le patch expurgé est complet en périmètre, destiné à la revue et non à une application automatique. Aucune archive ni copie massive des preuves.

[Diff source local](/tmp/crm-unified-review/unified.patch) · [État Git](/tmp/crm-unified-review/git-status.txt) · [SQL intégral](/Users/vg/Desktop/OARcrm-repo/supabase/migrations/20260918084849_unified_module_permissions.sql) · [Plan de publication](/Users/vg/Desktop/OARcrm-repo/docs/unified/PUBLICATION.md).

## État Git à la livraison

`git status --short` (aucun ajout à l’index, commit ou push) :

```text
 M app/api/drive/_utils.ts
 M app/globals.css
 M components/AccessPortal.tsx
 M components/CRMApp.tsx
 M components/VendorQuotesView.tsx
 M components/izord/IzordGenerator.tsx
 M tests/driveRegistryAuth.test.ts
 M tests/moduleAccess.test.ts
?? app/admin/
?? app/api/access/
?? components/AccessAdministration.tsx
?? components/BusinessPermissions.tsx
?? components/ModuleWorkspace.tsx
?? components/ScopedBanking.tsx
?? components/ScopedDocuments.tsx
?? components/ScopedInvoicePayments.tsx
?? components/UnifiedNavigation.tsx
?? docs/unified/
?? lib/access/collections.json
?? lib/access/modules.ts
?? lib/access/operations.tsx
?? lib/access/useConfirmedForm.ts
?? lib/server/invitations.ts
?? supabase/migrations/20260918084849_unified_module_permissions.sql
?? tests/unified/
```

## Avis de préparation

**Prêt avec réserves non bloquantes pour la décision de publication.** Les deux défauts précis et la réserve de préparation du bootstrap sont levés localement. Les limites fonctionnelles du tableau restent explicites. La récupération Google Workspace reçue est une confirmation du propriétaire, pas une validation du parcours d’invitation Production. Cette recette, la vérification privée de l’identité propriétaire et les contrôles de transition prévus par PUBLICATION.md restent à réaliser uniquement après autorisation distincte. L’envoi réel demeure désactivé dans le candidat tant que son activation n’est pas autorisée.

## Services conservés

Application : **127.0.0.1:3160**, répertoire/PID dans `/tmp/crm-unified-review/app.json`. Arrêt ultérieur : uniquement `kill -TERM <serverPID>` du manifeste. Supabase local existant : API 55431, PostgreSQL 55432, Mailpit 55434, tous sur loopback ; workdir `/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/izord-local-stack-5HXuB2`. Le serveur préexistant 3159 n’a pas été arrêté. Aucun tunnel public, reset, purge de volumes ou purge Chrome.

La publication reste soumise à une décision distincte, à un candidat prêt **avant activation des règles**, au rattachement explicite du propriétaire vérifié et à un retour arrière qui conserve la fermeture des accès.
