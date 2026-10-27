# Arbitrage — preuves de vérification isolée

Campagne du 27 octobre 2026, avec six comptes fictifs `@example.invalid` dans une
pile Supabase possédée par le banc et publiée uniquement sur `127.0.0.1`.
Aucune donnée de production n’a été utilisée ou modifiée par ces campagnes.
Les secrets locaux, mots de passe, JWT, sauvegardes et fichiers de statut ne sont
pas dans ce dossier.

- Serveur : 10 groupes Auth/PostgREST/PostgreSQL/Storage réels, dont les 16
  combinaisons de choix, auteurs imposés par les comptes, confidentialité des
  réponses et refus directs, persistance après nouvelle authentification,
  simultanéité, conflits métier/documents, retrait d’accès et changement de compte.
- Dossier bancaire : 5 groupes réels, comprenant copie PDF exacte, données de
  l’instantané approuvé malgré un changement ultérieur, reprise sans doublon,
  préservation d’un dossier travaillé et retrait d’avis. La perte d’une réponse
  après finalisation réellement commise est simulée à la frontière du client.
- Compléments : 4 groupes réels, dont espaces/tabulations seuls, modification
  puis retour exact au contenu antérieur, modification pendant le chargement
  réel du repository et protection d’un brouillon bancaire réservé déjà édité.
- Schéma final : création complète de la migration finale depuis le schéma
  antérieur dans une transaction locale ensuite annulée ; contrôles des droits
  et de la journalisation de configuration. Les données fictives sont conservées.
- Navigateur final : 7 groupes sur le build de production isolé et les sources
  finales. Les 256 fichiers app/components/lib correspondent à leurs SHA-256
  enregistrés, sans différence. Administration, compte distinct et recherche,
  enregistrement/rechargement, nouvelle connexion, conflit réel conservant la
  remarque, FR, EN, clavier et mobile passent. Aucun appel hors du banc ni erreur
  JavaScript observé.
- Exports réels du navigateur : JSON et PowerPoint téléchargés ; les 45 fichiers
  XML/rels du PowerPoint, y compris deux diapositives et deux notes, ont été
  décompressés et inspectés. Aucune occurrence du marqueur privé de test.

Les captures présentent uniquement des données fictives. Le mobile utilise
Chromium à 390 px avec émulation tactile ; aucun appareil physique n’a été testé.
Les vérifications des APIs Google Drive ne sont pas simulées dans cette campagne :
aucun appel Google n’est effectué. L’absence d’effet Drive d’un vote est vérifiée
sur la file persistante réelle en base locale.

Les premières itérations navigateur ont ajusté les sélecteurs du banc et son
assertion de conflit à la réponse SQL `40001` réelle de PostgREST. Le rapport final
`browser-results.json` provient d’une exécution complète, sans filtre de réparation.

Les commandes reproductibles figurent dans `tests/fonciere-arbitrage/README.md`.
