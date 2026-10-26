# Forfaits d’heures prépayées — dossier de validation

La fonctionnalité est implémentée dans un checkout isolé basé sur `origin/main` (`18f91ba1a858b723ec6a9812bbd6fc74bc06fe7d`), qui contient les correctifs déjà publiés des Charges, frais annexes et sélecteurs au quart d’heure. Les 149 fichiers locaux étrangers à cette mission, leur statut Git et le HEAD du checkout utilisateur ont été contrôlés sans modification.

## Fonctionnement

Le mode est choisi par identifiant canonique d’intervenant. Un registre serveur privé réserve chaque paiement à un seul forfait, calcule les minutes globalement sur tous les cours et répartit les centimes par différences cumulatives. Les lignes restent affectées à leur date civile, avec un ordre stable `date / début / création / ID`. Un cours peut traverser deux forfaits ; un renouvellement peut couvrir des cours antérieurs. Les droits et sessions Auth sont contrôlés côté serveur ; aucune liste filtrée dans l’écran ne sert de solde global.

Les paiements réservés ne financent plus les heures classiques. Les frais annexes restent dus séparément. Les Charges utilisent la consommation réelle par mois, distinguent le montant indicatif découvert et excluent uniquement les factures explicitement liées au même forfait. Une facture liée conserve sa relation si elle est masquée ; son identifiant est retiré des exports sans droit approprié. Les anciens taux restent disponibles comme provenance.

Le registre est protégé par un verrou de ligne, une révision et une clé idempotente. Les réessais et doubles clics ne créent pas de crédit supplémentaire. Les corrections et suppressions déjà autorisées recalculent les affectations ; les changements sont journalisés. Les écrans FR/EN, ordinateur/mobile, la saisie, les synthèses, historiques, rappels et exports ont été adaptés.

## Vérifications fictives locales

Les essais utilisent uniquement une pile Supabase dédiée sur la boucle locale : PostgreSQL, Auth, JWT et PostgREST réels ; aucune session de production ni fichier `.env` du dépôt.

- 46 tests de calcul et régression : forfaits, centimes, Charges et mode horaire historique.
- 5 tests du générateur de reprise administrative.
- 13 scénarios Auth/RPC : premier forfait + 32 h, second forfait, concurrence, réessai, règlement existant, réservation du paiement, filtres, 120 quarts d’heure = exactement 50 000 centimes, cours traversant les forfaits, saisie tardive/correction/suppression, frais/facture liée, nouvelle authentification, modes et droits.
- Reprise administrative fictive : instantané modifié refusé, rejeu deux fois avec un seul forfait et aucun nouveau paiement, sauvegarde et journal persistants, aucun JWT simulé.
- 2 régressions finales : suppression d’un intervenant horaire sans historique et masquage du lien de facture pour un compte ayant lecture mais pas export des factures.
- 6 parcours navigateur sur compilation de production locale : FR ordinateur, EN mobile, compte restreint, filtres sans modification du solde, sélecteurs au quart d’heure, indisponibilité du registre sans faux zéro, renouvellement par double clic avec un seul RPC, nouvelle connexion retrouvant les 28 h disponibles.
- 2 parcours navigateur supplémentaires de correction : ajout tardif de 15 minutes puis suppression via l’interface, affectations serveur et tableau de bord actualisés dans la même session.
- TypeScript et build réussis. Lint complet : aucune erreur ; deux avertissements préexistants (navigation AccessPortal et image CRMApp). `git diff --check` réussi.

Les rapports JSON et captures fictives de ce dossier détaillent ces preuves. Les clés, mots de passe, sessions et instantanés privés restent hors Git.

## Troy : vérification de production et reprise préparée

Le rapprochement est univoque : intervenant `worker-5509c9e7`, contact `c-e5af68dc`, règlement existant `payment-c07264ed` de 500 € par virement le 5 octobre 2026. Les 22 interventions existantes du 8 septembre au 26 octobre totalisent exactement 1 920 minutes : septembre 1 260 minutes, octobre 660 minutes. Aucune facture fournisseur liée au contact canonique n’a été trouvée. Troy est déjà suivi dans les Charges ; aucune sélection n’est modifiée.

L’aperçu et les identifiants des 22 lignes figurent dans `troy-reconciliation.md` et son JSON. Un instantané canonique complet et un SQL de reprise ont été préparés dans des fichiers temporaires privés. Le SQL vérifie la révision, l’empreinte de l’ensemble du workspace et les sources ciblées sous verrou ; il conserve une sauvegarde et un journal administratif explicite. Il ne simule pas une authentification utilisateur et ne crée aucun nouveau paiement.

Après cette reprise : 500 € payés, 30 h achetées, 32 h réalisées, 30 h couvertes, 0 h disponible et 2 h à couvrir. Renouvellement de 30 h à prévoir pour 500 €. Charges attendues : septembre 350 €, octobre 183,33 €, dont 33,33 € indicatifs non encore couverts. Le deuxième forfait payé existe uniquement dans les essais fictifs.

## État réel de livraison

**Migration de production non appliquée ; reprise de Troy non exécutée ; publication non effectuée.** Le contrôle automatique d’autorisation a refusé l’application de `20261026195154_house_prepaid_hours.sql`, considérant qu’une autorisation explicite de cette modification de production était nécessaire pour les tables financières, le trigger et les RPC. Aucune autre méthode d’écriture n’a été tentée. La lecture de contrôle confirme l’absence de table de forfaits et l’empreinte métier inchangée `15c5bf37763255aa31821b42c6300a9d`.

L’étape restante est l’autorisation d’appliquer cette migration précise, puis d’exécuter la reprise préparée et de publier la version validée sur le projet Vercel existant, avec contrôle du SHA servi. La procédure de publication doit conserver le checkout utilisateur et utiliser un checkout propre au SHA exact.
