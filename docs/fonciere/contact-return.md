# Foncière → Contacts → projet

Les boutons « Créer une fiche entreprise » et « Créer un contact » ouvrent le formulaire Contacts existant dans le même onglet, respectivement avec `company` et `person`. Le formulaire conserve ses champs, catégories métier, validation, doublons et autocomplétion d’adresse.

L’intention temporaire est typée et liée au compte, à la révision des droits et au rôle IZORD. Le projet reste monté pendant la création : ses corrections, liens, photos et véritables objets `File` ne passent par aucune sérialisation ni sauvegarde forcée. Le formulaire Contacts ordinaire reste lui aussi monté, séparé du formulaire créé pour cette intention. Les confirmations de départ et avertissements de fermeture restent actifs. Les contextes sont écartés lors d’un changement de compte ou de droits.

L’entreprise reçoit les coordonnées et métadonnées d’adresse de l’agence. La personne reçoit ses coordonnées directes et le nom d’entreprise disponible. Une identité structurée n’est reprise que si la fiche liée correspond toujours au libellé du projet ; un nom composé ambigu est présenté intégralement à vérifier, sans inventer sa décomposition. Les adresses de l’agence, du bien et de la personne restent indépendantes.

« Enregistrer et revenir au projet » attend le succès confirmé et le véritable `recordId` dans la projection autorisée. Le retour applique le mécanisme existant de sélection et de confirmation des remplacements locaux, puis indique que le projet reste à enregistrer. Une fiche existante choisie dans les doublons utilise son identifiant réel, sans écriture de contact. L’annulation ne modifie aucun lien ; une erreur conserve le formulaire. Le contexte est consommé une fois. La création ordinaire reste indépendante.

Aucun changement de schéma, de droits, de configuration, de données historiques ou d’intégration Drive/Publisher n’est nécessaire. Les écritures continuent d’utiliser les RPC et contrôles serveur existants.

## Vérifications

- 29 tests unitaires ciblés : intention de création, noms composés, coordonnées/adresses indépendantes, métadonnées, sélection Contacts, modèle et persistance des adresses.
- 20 groupes de tests navigateur réussis sur l’application candidate et les vrais services locaux Auth/RPC/Storage, uniquement avec des données fictives : accès complet FR sur ordinateur et accès limité EN sur mobile émulé ; création/annulation entreprise et personne ; préremplissage modifiable ; conservation d’un projet jamais enregistré avec PDF et photo ; erreur de sauvegarde ; double soumission ; identifiants canoniques ; choix d’un doublon ; confirmation refusée puis acceptée ; brouillon Contacts antérieur ; enregistrement/rechargement du projet et comparaison exacte du PDF téléchargé ; création ordinaire après consommation du contexte.
- 3 groupes de tests directs des RPC locaux réussis : projections autorisées ; refus de création en lecture seule, sans droit et anonyme ; refus de liens falsifiés, de mauvaise nature ou sans autorisation, avec révision et anciens liens conservés.
- TypeScript, lint, build et `git diff --check` réussis avant publication. Le lint conserve deux avertissements déjà présents (`location.assign`, image existante).

Les scénarios authentifiés ci-dessus sont locaux. Ils ne constituent pas une preuve d’utilisation authentifiée en Production ni un test sur téléphone physique. Les fichiers non enregistrés sont conservés pendant l’aller-retour dans le même onglet ; le mécanisme de fermeture signale toujours les modifications non sauvegardées.
