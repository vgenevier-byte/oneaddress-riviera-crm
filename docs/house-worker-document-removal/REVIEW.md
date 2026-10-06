# Retrait des pièces Intervenants

Le parcours Document de Suivi maison / Réglages / Intervenants est retiré de la création, de la modification et des cartes actives ou archivées. Le raccourci Contact utilise l'identifiant exact et les droits Contacts existants. Ce retrait ne dépend ni de Google Drive ni d'un marqueur de migration.

Les anciens appels `crm_new_document`, mutations documentaires, imports Storage et sauvegardes complètes obsolètes sont bloqués seulement pour ce parcours. Les données non documentaires restent modifiables avec les droits actuels.

## Nettoyage physique borné

Un opérateur autorisé réserve chaque objet par RPC service-only, avec ID Storage, chemin exact, version, date et empreinte des métadonnées, et révisions des seules fiches à détacher. L'appartenance doit venir d'une référence Intervenant exacte ou de journaux positifs d'import CRM et de création Storage concordants. Le nom et l'absence de référence ne constituent pas une preuve.

Le POST d'exécution accepte uniquement l'UUID d'une réservation déjà autorisée, limitée dans le temps. Il ne peut créer/étendre une réservation ni choisir un objet. Il réutilise la clé serveur existante sans l'exposer, sans nouveau secret ni changement Google/WIF. Les chemins et métadonnées ne sont pas retournés au client.

Avant suppression, un bail et des contrôles serveur vérifient l'objet exact et tous ses autres usages, y compris versions et historique documentaire. Un objet utilisé ailleurs est conservé. Les octets sont supprimés exclusivement par `storage.from(bucket).remove([exactPath])`, jamais par DELETE SQL de `storage.objects`. Les références Intervenants sont retirées après confirmation. Une reprise après échec de confirmation constate l'absence de l'objet avant de finaliser, sans seconde suppression.

Les données métier, Contacts, pièces métier, droits et huit partages existants sont préservés. Aucun téléchargement de pièce, copie Drive, sauvegarde de contenu ni archive n'est créé. Le journal conserve uniquement la trace technique nécessaire.

## Validation ciblée

- Interface : six groupes fictifs desktop/mobile, actif/archivé, création/modification, identifiant Contact et droits, rechargement après retrait et conservation des historiques.
- Exécuteur : sept tests de cible imposée, objet partagé, erreur Storage, reprise après suppression déjà effectuée, opération non autorisée/expirée et UUID canonique.
- Domaine Suivi maison : dix tests d'historiques, taux et saisies d'heures.
- SQL : treize groupes sur une base locale fictive séparée, schéma publié sans le lot Contacts → Drive ; reprise, partages/versions, anciens appels et sauvegardes, et invariants métier contrôlés.
- TypeScript, lint, build et diff-check. Les deux avertissements lint existants ne concernent pas ce correctif.

Les preuves UI/Auth/REST simulées et SQL locales ne constituent pas un contrôle de session authentifiée Production. La suppression réelle et les comparaisons de métadonnées distantes sont vérifiées séparément par l'opérateur.

Le lot Contacts → Drive et les modifications préexistantes du checkout principal sont exclus de ce correctif.
