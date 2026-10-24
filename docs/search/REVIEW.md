# Harmonisation des sélections et recherches du CRM

Le rattachement Contacts entreprise/personne se fait directement dans un seul champ de recherche. Le même contrôle sert aux listes évolutives dans les accès complets et restreints : responsables et demandes liées, prestataires, biens du planning et des opportunités, maisons/personnel/paiements, dossiers/documents/comptes de règlement, Charges, Foncière, Présentations et marques/modèles Publisher. Les anciens textes libres restent libres ; une liaison existante garde son identifiant jusqu’à un remplacement ou retrait explicite.

Le moteur local partagé ignore casse, accents et ponctuation usuelle, combine des mots dans plusieurs champs et classe exact/direct/préfixe avant les fautes. Les fautes concernent des mots d’au moins quatre lettres, avec un budget limité. Chiffres, téléphones et références ne subissent aucune correction. Les liens `companyId` sont résolus uniquement dans la projection déjà autorisée, y compris les coordonnées pertinentes de l’entreprise. Aucun appel IA ou externe n’est ajouté.

Les index sont réutilisés jusqu’à modification des données éligibles. Tous les candidats sont recherchés et classés avant limitation des suggestions. Les résultats du composant commun commencent à 12 avec défilement borné et « Afficher plus ». Le sélecteur prestataires existant limite l’affichage à 50 résultats après classement. Foncière et Présentations Projets chargent toutes les pages RLS lisibles avant recherche des projets ; les auteurs de révision IZORD sont récupérés par lots bornés.

Le contrôle de couverture reproductible est `node scripts/audit-search-controls.cjs`. Le détail par contrôle est dans [control-inventory.json](control-inventory.json), et le détail métier dans [coverage-contacts.md](coverage-contacts.md) et [coverage-modules.md](coverage-modules.md).

Les exceptions sont des enums courts et fermés (statuts, priorités, catégories métier, permissions, moyens de paiement, créer/rattacher, types automobiles), les douze mois calendaires et l’échelle DPE/GES dans leur ordre. Les deux listes d’horaires de 96 entrées utilisent désormais une saisie heure native au pas de quinze minutes. Les pays et adresses libres gardent leur saisie manuelle ; la complétion d’adresse existante est conservée.

## Vérification et provenance

- Tests unitaires et de régression : 211 succès sur le moteur, les contacts et entreprises, les tâches, la pagination Foncière, les instantanés historiques, Suivi maison, la finance prestataires et les brouillons Présentations.
- Couverture statique : 72 contrôles natifs justifiés, 49 usages de sélecteurs avec recherche, 7 usages de saisie libre avec suggestions ; aucun `datalist` restant dans les composants CRM.
- TypeScript, lint complet, build Next.js et `git diff --check` exécutés. Deux avertissements lint préexistants : navigation AccessPortal et image CRMApp.
- Mesure locale sur 10 000 contacts fictifs : index environ 134 ms, requêtes p95 environ 14 ms sur ce poste ; ces mesures ne sont pas un engagement de délai Production.
- 48 scénarios navigateur réussis sur Chromium et WebKit, bureau et mobile émulé.
- Le banc navigateur utilise les vrais composants copiés avec empreintes SHA-256. Les données sont fictives, les sauvegardes utilisent une simulation `localStorage`, les appels externes sont bloqués. Voir [fixture-manifest.json](fixture-manifest.json) et [browser-results.json](browser-results.json).

La preuve navigateur porte sur Chromium et WebKit, bureau et mobile émulé, FR/EN, noms inversés, fautes entreprise/ville, identités homonymes, conservation de sélection, retrait, validation obligatoire, remise à zéro, reprise après rechargement simulé, erreurs et droits retirés au niveau de la projection. Elle ne constitue pas une session authentifiée Production, une écriture Supabase réelle ou un test sur appareil physique.

Aucune migration, modification des droits serveur, fusion de fiches ou génération/publication Publisher n’est nécessaire. Le checkout principal et ses travaux étrangers restent préservés ; le correctif est préparé sur la branche isolée `codex/crm-search-harmonization`, base `55f69dd304433255bf1db4b136ac534fdab9c8ed`.
