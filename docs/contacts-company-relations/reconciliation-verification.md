# Vérification de la reprise et du retour arrière

Le 24 octobre 2026, les 17 contrôles SQL et les 6 contrôles Node ont réussi. Les résultats anonymisés et les empreintes SHA-256 des fichiers vérifiés sont enregistrés dans [reconciliation-verification-results.json](reconciliation-verification-results.json).

## SQL réellement exécuté

PostgreSQL 17.6 local, dans une base dédiée créée puis supprimée à chaque exécution. La migration réelle `20261024081412_contact_company_reconciliation_journal.sql` et les scripts SQL administratifs réels sont exécutés. Les tables de référence utilisent un schéma minimal compatible ; les fixtures applicatives existantes ne sont pas modifiées.

Les contrôles couvrent la confidentialité du journal (RLS active et aucun droit de table pour anon, authenticated ou service_role), la sauvegarde exacte, deux applications sans doublon, deux retours arrière sans effet supplémentaire et le refus de réappliquer silencieusement un plan déjà annulé. Une modification concurrente de la source, une correction personnelle ou une modification comptable après reprise provoquent un refus sans écrasement.

Le générateur transmet les opérations explicites et une condition de révision, accompagnée de l'empreinte MD5 du JSONB calculée par PostgreSQL lors de la sauvegarde. Le serveur vérifie cette empreinte sous verrou, contrôle chaque fiche source JSONB, puis applique les seules opérations au workspace réellement verrouillé. Le journal conserve ce payload serveur exact avant reprise et les Contacts après reprise. Les fixtures couvrent cette branche utilisant l'empreinte ; une comparaison JSONB complète reste disponible pour les fixtures dépourvues d'empreinte serveur.

Le retour arrière refuse de supprimer une personne créée si un lien externe la référence : tâche active, tâche supprimée, identité historique de tâche, identité de compte, événement historique, agent Foncière, agence Foncière ou document Contacts. Une transaction concurrente écrivant une identité de compte a été maintenue ouverte : `pg_blocking_pids` confirme que le retour arrière attend, puis refuse après la validation de cette référence. Les données et la référence sont conservées.

Empreinte SHA-256 de la migration journal vérifiée : `34786ae5bb82d67b1206d439067b69863032680e8d84f6853e060cd449deb51a`.

## Contrôles Node

Les 6 tests vérifient la conservation des identités et valeurs originales, l'absence de rapprochement issu d'une ressemblance, le refus des sources modifiées ou preuves manquantes, la conservation des anciens identifiants lors d'une consolidation explicite et les identifiants déterministes des nouvelles personnes. Ils couvrent également les classifications historiques expressément confirmées et la stabilité de comparaison et du plan lorsque PostgreSQL réordonne les clés d'objets JSON. Les coordonnées personnelles ne sont pas inventées.

Le plan certain actualisé après confirmations humaines prévoit 53 fiches avant et 55 après, 2 nouvelles personnes et 7 personnes existantes rattachées. Deux fiches historiques sont explicitement qualifiées, l'une comme entreprise et l'autre comme personne. Aucune nouvelle fiche entreprise, aucun identifiant consolidé et aucune personne fusionnée. Les classifications sont vérifiées sur PostgreSQL avec restauration exacte ; le contrôle après application distingue ces 2 changements approuvés de toute modification de nature absente du plan.

## Portée des preuves

Ces tests valident les scripts administratifs et la migration journal sur des données fictives persistantes. Ils n'établissent aucune session utilisateur authentifiée en Production, aucun comportement visuel et aucun parcours API de l'application. Les validations de permissions, des gardes serveur réelles et de l'interface font l'objet des contrôles complémentaires de la tâche principale.

Aucune écriture Production n'a été effectuée par cette vérification. Le contrôle après application doit comparer les champs planifiés et les empreintes des références à la sauvegarde privée initiale, avec le script de lecture `scripts/contact-company-postcheck.sql`.
