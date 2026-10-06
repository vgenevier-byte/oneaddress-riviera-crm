# Contacts : équipe et documents multiples — livraison locale

6 octobre 2026. Base Git inchangée : `5c646b9195f4863e5a3e7e0e9c3a4bbf4a01a521`.

## Résultat

Le quatrième type **Membre de l’organisation** et son champ facultatif **Fonction** sont intégrés aux formulaires, fiches, filtres, compteurs, recherches, projections et exports. Le classement explicite prévaut sur les anciens champs prestataire. Une conversion conserve l’identifiant, les banques, les données omises et les liens historiques. Les membres restent sélectionnables dans Suivi maison ; les nouvelles factures ne les proposent plus comme fournisseurs. Les factures existantes conservent leur sélection. Le parcours RIB d’une banque existante reste distinct de cette éligibilité fournisseur.

**Documents du contact** est disponible dans chaque fiche confirmée, pour les quatre catégories. Les imports multiples et ultérieurs ont chacun leur propre opération et chemin UUID. Types proposés : Carte d’identité, Passeport, Permis de conduire, Permis bateau, Contrat, Autre. Intitulé, expiration facultative, date et auteur serveur sont conservés dans le catalogue privé. Formats : PDF, JPEG, PNG ; limite existante du parcours Storage : 25 000 000 octets par fichier.

Le fichier est enregistré dans le bucket privé `crm-documents`, lié au contact par son ID dans `crm_document_scopes`. Aucun binaire, base64, nom de pièce privée ou lien de pièce privée n’est ajouté au payload du contact ou à son cache CRM. Les fichiers restent distincts même lorsqu’ils portent le même nom. Le remplacement est explicite et conserve l’original ; le retrait individuel conserve les octets et l’audit. Les fichiers retirés sont exclus des listes et inaccessibles. Aucun rappel, OCR ou traitement IA n’est ajouté.

## Confidentialité et sauvegarde

| Action sur une pièce personnelle | Propriétaire avec droits complets | Déposant habilité | Collaborateur explicitement partagé |
|---|---|---|---|
| Métadonnées / aperçu | Oui | Lecture Contacts et Documents | Lecture Contacts et Documents |
| Téléchargement / export de ses métadonnées | Oui | Export Contacts et Documents | Export Contacts et Documents |
| Ajout / remplacement de la version active | Oui | Contribution Contacts et Documents ; ses propres pièces | Ajout de ses propres pièces uniquement |
| Retrait individuel d’une version active ou ancienne | Oui | Contribution et Suppression Contacts et Documents ; ses propres pièces | Non sur la pièce partagée |
| Donner / retirer un partage | Oui | Non | Non |

La bibliothèque Documents et la fiche utilisent la même projection filtrée. Noms, recherches, compteurs, références et exports ne contiennent que les pièces autorisées. Les partages utilisent la table existante `crm_document_shares` ; une nouvelle version n’hérite pas automatiquement des autorisations de l’ancienne. Les documents métier historiques gardent leurs droits et restent consultables depuis la fiche.

**Correctif ciblé après revue : retrait des anciennes versions.** Le calcul `deletable` est distinct du droit de modification : il accepte une version `active` ou `superseded` pour le propriétaire ou le déposant ayant Contribution et Suppression sur Contacts et Documents. Le bouton Corbeille commun à la fiche et à Documents utilise cette capacité, même lorsque la version est en lecture seule. Les règles `readonly`, `replaceable` et le RPC de retrait restent inchangés : une ancienne version ne devient pas modifiable ou remplaçable. Un destinataire de partage ne peut jamais retirer la pièce, même avec Suppression sur les deux modules.

La correction ne modifie que la projection de la migration locale encore inédite et la garde du bouton partagé. Aucun fichier de migration déjà publié n’est modifié. Le retrait individuel d’une ancienne version conserve ses octets et son audit, la rend inaccessible dans les lectures applicatives et laisse la nouvelle version, les autres pièces, leurs droits et leurs partages intacts. La conservation n’ajoute aucune interface de restauration.

Les nouvelles pièces personnelles n’ont aucune URL signée ou publique. L’API `/api/contact-documents/file` vérifie la session, les droits et le partage avant **et après** la lecture des octets. Les accès directs Storage, son listing, les signatures, les modifications et les suppressions de ces pièces sont interdits aux clients, y compris au propriétaire. Les anciennes API de classement/import ne peuvent pas créer une nouvelle pièce Contact non bancaire contournant ce parcours. Les associations métier déjà existantes et les RIB explicitement bancaires sont conservés. Cette protection s’appuie sur les [politiques Storage](https://supabase.com/docs/guides/storage/security/access-control) et la [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) documentées par Supabase.

Chaque requête réutilise les protections de compte et de droits du CRM. Les lectures ont une séquence empêchant une réponse ancienne d’écraser une projection récente. Un aperçu tardif ne peut rouvrir une fenêtre fermée. Une sélection refusée reste modifiable et retirable. Une reprise réutilise l’opération confirmée ; une annulation ne remet jamais en cause un succès admis. Un import documentaire ne sauvegarde pas la fiche Contact. Les révisions serveur protègent les conflits ; un contact ayant des pièces retenues ne peut être supprimé par un ancien enregistrement global.

## Contrôles et preuves

- **10 contrôles ciblés du correctif de retrait**, avec Auth/RPC/Storage et navigateur locaux réels : quatre retraits propriétaire/déposant × Contact/Documents ; quatre refus destinataire partagé avec Suppression/auteur sans Suppression × les deux surfaces ; deux groupes confirmant le refus de révision périmée et de remplacement d’une ancienne version. Après rechargement, la pièce retirée reste inaccessible aux lectures, exports et au proxy ; ses octets et son audit sont conservés. La nouvelle version, les autres pièces, tous leurs partages et les droits préexistants sont strictement identiques. [Résultats du seul parcours ciblé](superseded-withdraw-results.json), runner `tests/contact-evolution/superseded-withdraw.mjs`. Le conflit conserve le code SQL `40001` / `revision_conflict` et le statut HTTP 500 du mapping local existant ; ce mapping n’est pas modifié.
- Bouton vérifié visuellement sur les deux surfaces : [ancienne version depuis Contact](captures/superseded-allowed-viewport-owner-contacts.png), [ancienne version depuis Documents](captures/superseded-allowed-viewport-depositor-documents.png). L’ancienne version dispose de Corbeille sans action de remplacement.
- **34 tests unitaires ciblés de la livraison initiale** : 24 Contacts/catégorie/RIB et 10 documents/reprise/réponses tardives. Les tests RIB emploient un transport Google fictif. Les campagnes initiales ci-dessous ne sont pas relancées pour le seul correctif de retrait.
- **8 groupes serveur** sur Auth, PostgREST, PostgreSQL et Storage locaux réels : catégorie, historiques/Charges, imports, conflits, annulation, accès directs, partages, révocation et conservation des fichiers. [Résultats](server-results.json).
- Validation des enregistrements complets, champs omis et ACL des nouvelles fonctions : [preuves complémentaires](server-extra-results.json).
- Proxy Next réel : **3 groupes API**, comparaison des octets, sessions refusées, Export distinct et révocation. [Résultats](api-results.json).
- Révocation pendant la lecture des véritables octets Storage : réponse refusée sans contenu. [Résultat](file-handler-results.json).
- Fermeture des anciennes entrées de classement/import non bancaire, avec conservation des associations métier/RIB existantes : [résultat](classification-closure-results.json).
- **5 parcours navigateur catégorie** : propriétaire/contributeur à 1440 et 390 px, création, modification, rechargement, Fonction facultative, reclassement, banque, Maison et factures historiques. [Résultats](category-browser-results.json).
- **8 parcours navigateur documents** : multi-import avec échec partiel/reprise, homonymes, ajout ultérieur, aperçu/téléchargement des octets réels, remplacement, retrait, absence de métadonnées non partagées, partage/révocation, mobile, annulation pendant l’import et conflit concurrent. [Résultats](documents-browser-results.json).
- TypeScript, lint et build isolé de production : validés. Les 14 sources de la démonstration correspondent à leurs empreintes actuelles. [Contrôles finaux](checks.json), [journal de build](build.log). Lint conserve deux avertissements existants dans AccessPortal et l’image des factures. Diff-check de l’évolution : propre. Le diff-check global signale uniquement l’espace final préexistant dans `docs/publisher/integration.diff:10063`, préservé avec ce fichier.
- Revue indépendante ciblée de la migration et du proxy : aucun problème concret identifié ; revue statique, sans mutation supplémentaire.
- [Préservation des sources récentes et du travail préexistant](preservation-results.json) : les deux fichiers Publisher déjà modifiés, WIF, les migrations partage/corbeille, la navigation, les calculs Charges et les invitations sont identiques à leur empreinte de départ.

Les comptes, contacts, fichiers et opérations du banc sont entièrement fictifs. Les huit partages documentaires antérieurs du banc et toutes ses lignes métier originales sont conservés. Les comparaisons navigateur emploient les fixtures après leur normalisation historique habituelle ; aucun historique original ni montant non vide n’est normalisé pour le test. Aucun contact réel de Clément ou Kate n’est chargé ou modifié.

Ces preuves concernent le banc local et Chrome à des dimensions ordinateur/mobile. Elles ne prouvent pas une connexion authentifiée en Production, un appel Drive réel ou un iPhone physique. Les nouvelles pièces utilisent Storage ; seul le transport Google des parcours préexistants est simulé dans la copie de démonstration. Le serveur et le navigateur sont limités au loopback. La liste se rafraîchit au focus et toutes les 15 secondes ; l’aperçu revérifie son accès toutes les 3 secondes. Les nouvelles requêtes serveur sont refusées dès révocation. La restauration des pièces retirées n’est pas développée ; leurs fichiers et leur historique restent retenus.

## Démonstration et diff

[Ouvrir la démonstration locale](http://127.0.0.1:3190/?module=contacts). Les identifiants des trois comptes fictifs sont dans le [fichier local privé](/private/tmp/oar-contact-evolution-demo-logins.txt), mode `0600` ; aucun jeton n’y est exposé. Fiches préparées : **Alex Équipe Fictive** pour le reclassement/historique, **Camille Documents Fictifs** pour les pièces. Les essais navigateur ajoutent également leurs propres fiches fictives.

1. Ouvrir une fiche confirmée, sélectionner deux fichiers de même nom et choisir deux pièces du même type, avec des intitulés recto/verso.
2. Confirmer l’ajout, recharger, ouvrir l’aperçu et télécharger avec un compte ayant Export.
3. Ajouter une autre pièce ; utiliser Remplacer explicitement puis confirmer l’import pour une nouvelle version. L’original reste consultable.
4. Retirer une pièce individuellement, y compris une ancienne version avec le propriétaire ou son déposant habilité. Elle disparaît des lectures ; le fichier reste retenu, la nouvelle version et les autres pièces restent accessibles selon leurs droits.
5. Depuis le propriétaire, ouvrir Autorisations, partager une seule pièce avec le collaborateur habilité puis révoquer. Les droits Contacts/Documents et Export restent requis séparément.

[Diff complet de l’implémentation et des tests](implementation.diff). Les preuves JSON et captures sont livrées séparément dans ce dossier ; le diff exclut les modifications Publisher présentes avant cette tâche. [Capture documents ordinateur](captures/documents-desktop-1440.png), [capture documents mobile](captures/documents-mobile-390.png), [catégorie mobile finale](captures/contact-category-mobile-final.png).

Le manifeste privé `/private/tmp/oar-contact-evolution-manifest.private.json` indique le répertoire exact de la copie, les empreintes des sources et le PID de son lanceur. Pour fermer seulement cette démonstration : `kill -TERM <launcherPID>` lu dans ce manifeste. Le banc Supabase préexistant n’est pas arrêté. Le lanceur reproductible est `tests/contact-evolution/serve.mjs` ; il ne charge aucun `.env` du dépôt.

## Plan de publication et retour arrière

**Aucune publication n’est effectuée.** La seule nouvelle migration est `20261006143754_contact_team_private_documents.sql`, créée par le CLI et appliquée uniquement au banc local. Elle ajoute des colonnes au catalogue existant et des RPC/protections, sans réécriture des historiques, des comptes ou des droits. Les migrations existantes Publisher/Charges nécessaires aux contrôles ont également été appliquées uniquement au banc fictif. Aucun commit, push, déploiement, archive, document personnel réel copié ou appel payant ; secrets, SMTP, WIF et WAF inchangés.

Après une décision explicite de publication :

1. Revoir ce diff et vérifier les migrations ancêtres installées. Conserver le travail Publisher préexistant séparément et n’inclure que les chemins de cette évolution.
2. Préparer les mesures de sauvegarde autorisées alors, puis appliquer la migration additive avant de publier le code. Vérifier les empreintes des données et des huit partages existants avant/après, sans reclasser de contact réel.
3. Vérifier la disponibilité de la clé serveur privée déjà utilisée par les invitations/corbeille, sans changer sa valeur ni les droits. Publier ensuite un SHA explicitement approuvé et vérifier provenance/READY.
4. Faire le contrôle authentifié réel propriétaire/contributeur et mobile avec des fixtures spécialement autorisées pour cette phase. Clément et Kate pourront être reclassés manuellement par le propriétaire.

Retour arrière : revenir au code approuvé précédent en conservant la migration et ses protections privées. Ne pas supprimer le catalogue, les partages, les colonnes, les fichiers ou les historiques créés pendant l’essai. Une ancienne interface ne doit jamais servir de motif pour réouvrir Storage ou distribuer les métadonnées privées. Toute suppression de données ou retrait des protections nécessiterait une décision distincte. Aucun rollback de données ni archive n’est réalisé pendant cette livraison locale.

## Préparation de la publication contrôlée autorisée

Le propriétaire a ensuite autorisé le commit ciblé, le push et la publication du lot final corrigé, ainsi qu’une seule sauvegarde privée avant migration. Les constats « aucun commit / publication » ci-dessus décrivent la livraison locale initiale. La concordance a été vérifiée sans relancer les campagnes : 24 patches correspondent aux sources, 14 sources correspondent au build prêt, migration corrigée et 10 résultats ciblés cohérents. Les droits de retrait d’une ancienne version restent ceux du propriétaire ou du déposant habilité ; le partage seul ne suffit jamais.

La sauvegarde autorisée est vérifiée dans un sous-dossier horodaté de `~/Library/Application Support/OARcrm/Backups/`, avec dossier `0700` et fichiers `0600`. Elle contient l’état métier, catalogue, partages/droits, définitions SQL, ACL, triggers et politiques concernés ; elle exclut secrets/Auth/sessions/JWT, bibliothèque Publisher et octets Drive/Storage. Son chemin, sa taille et son empreinte figurent dans [les contrôles de préparation](checks.json). Aucune restauration n’est autorisée ou effectuée.

Le dépôt GitHub actuel et l’ancienne identité conservée par Vercel désignent le même repository ID `1257372770`. Le push de `main` déclenche la Production avec ses domaines : après préparation du commit exact et du checkout propre, la migration additive sera appliquée et vérifiée avant un seul push, puis son candidat Git attendu. Cela évite un candidat CLI concurrent. Si aucun candidat Git n’apparaît après vérification, un unique déploiement du même SHA depuis le checkout propre sera préparé avec `--prod --skip-domain`, puis promu après `READY`. La clé privée existante est réutilisée ; aucune variable ou configuration n’est modifiée.

Pendant la courte fenêtre avant le nouveau code, les lectures et documents métier/RIB existants restent sur leur parcours legacy ; une nouvelle association Contact non bancaire via l’ancien formulaire est refusée par les nouvelles protections. Aucun contact réel ni document réel n’est utilisé pour vérifier cette publication. Les contrôles authentifiés avec la connexion du propriétaire et des collaborateurs restent distincts des vérifications anonymes et SQL.
