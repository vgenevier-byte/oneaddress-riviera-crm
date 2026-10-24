# Sélecteur de maison dans les tâches — validation

Le contexte de période d’heures et celui des charges mensuelles utilisent un seul `SearchableSelect` commun. Le catalogue autorisé est entièrement chargé par pages avant le classement et la limitation des suggestions. La recherche s’appuie sur le nom, l’adresse et la ville projetés par le serveur. Le texte recherché ne modifie pas l’identifiant sélectionné ; « Toutes les maisons » correspond à un retrait explicite de cet identifiant.

## Vérifications exécutées

- **5 tests unitaires ajoutés** : 452 candidats, cible au-delà de la deuxième page, correspondance exacte avant faute, adresse/ville et mots inversés, filtrage des références inaccessibles/supprimées, échec sans catalogue partiel, annulation des requêtes obsolètes et chargement natif des pages une seule fois via l’API de production.
- **2 contrôles serveur réels** sur le banc Supabase isolé : migration additive rejouée sans modification du workspace ni des tâches/liens/journal existants ; projection autorisée nom/adresse/ville et masquage pour le compte restreint.
- **Bureau FR, 1440 px** : période de travail, recherche avec `Eglantne`, choix explicite au clavier, conservation de la maison pendant une autre saisie, Échap, retrait puis nouvelle sélection, échéance distincte, sauvegarde canonique et relecture après connexion Auth fraîche puis rechargement du navigateur.
- **Erreur temporaire** : une seule réponse HTTP du catalogue des maisons a été remplacée par une 503 dans le navigateur local. L’identifiant sélectionné est conservé, les anciens libellés/adresses sont retirés, puis le bouton Réessayer restaure la même maison depuis le serveur. Ce contrôle est une simulation de panne du catalogue ; les connexions Auth, les autres RPC et les sauvegardes utilisent les vrais services locaux.
- **Mobile EN, 390 px** : charges mensuelles issues des heures, recherche `cedres theoule`, choix au clavier, conservation pendant une autre recherche, Échap, appui réel sur le bouton de retrait, nouvelle sélection et sauvegarde canonique. Les deux boutons intégrés mesurent 32 px et leurs zones sont séparées de 4 px ; aucun contournement par clic forcé n’a été utilisé. Ce parcours de persistance utilise un viewport responsive avec pointeur de souris.

- **Tactile mobile émulé, 390 px, EN** : contexte avec `isMobile: true`, `hasTouch: true` et pointeur grossier vérifiés ; appuis tactiles réels (`tap`) sur une suggestion, le retrait puis l’ouverture des suggestions. La maison sélectionnée reste intacte pendant la saisie d’une autre recherche ; le retrait affiche « All houses ». Brouillon annulé, aucun appel de mutation de tâche. Ce contrôle a été rejoué sur le dernier bundle de production local, après l’optimisation du chargement complet. Aucun appareil physique n’a été utilisé.

Le catalogue réel comptait **482 maisons**. La maison retenue était à l’**index 481** (base zéro), donc hors de la première page de 200. Les deux tâches sont relues avec `crm_tasks_read` sous une nouvelle connexion Auth et retrouvées avec `crm_tasks_for_target`. Les reçus contiennent les vrais identifiants fictifs et les contextes sauvegardés.

## Correction mobile vérifiée

La règle mobile générale du CRM `button { width: 100% }` élargissait les deux boutons internes et faisait passer le bouton de suggestions au-dessus du retrait. Le correctif limite uniquement les contrôles internes de `.task-house-selector` et réserve leur place dans le champ. Le composant partagé et les styles des autres formulaires sont conservés. Le parcours mobile de persistance a été rejoué après cette correction CSS ; sa preuve et le parcours bureau ont été conservés. L’optimisation finale demande ensuite tous les résultats d’affichage en un appel à l’API commune, qui parcourt déjà les pages SQL : elle évite de recharger le catalogue complet pour chaque page affichée, avec un repli paginé pour les autres adaptateurs. Les 11 tests ciblés sont passés et le contrôle tactile a été rejoué sur le dernier build contenant cette optimisation.

## Preuves

- [Résultats navigateur et reçus de persistance](house-browser-results.json)
- [Contrôles serveur](house-server-results.json)
- [Géométrie réelle des contrôles mobiles](house-mobile-controls.json)
- [Contrôle tactile émulé sur le bundle final](house-touch-results.json)
- [Maison conservée pendant la saisie tactile](screenshots/houses-touch-selected.png)
- [Retrait tactile et Toutes les maisons](screenshots/houses-touch-all-houses.png)
- [Recherche bureau avec faute](screenshots/houses-worker_period-1440-fr-search.png)
- [Période persistée](screenshots/houses-worker_period-1440-fr-persisted.png)
- [Panne temporaire sans perte de sélection](screenshots/houses-worker_period-error-preserves-id.png)
- [Recherche mobile par adresse et ville](screenshots/houses-monthly_charges-390-en-search.png)
- [Charges mensuelles persistées](screenshots/houses-monthly_charges-390-en-persisted.png)

Commandes ciblées : `node --require ./tests/i18n/register-typescript.cjs --test tests/task-links/houseOptions.test.ts tests/tasks/links.test.ts` (11 tests réussis), `node tests/task-link-corrections/houses-browser.mjs`, puis `HOUSES_CASE=monthly_charges node tests/task-link-corrections/houses-browser.mjs` après la correction CSS mobile ; `node tests/task-link-corrections/houses-touch.mjs` sur le dernier bundle optimisé. TypeScript, lint ciblé et diff-check sont propres.

Données fictives uniquement sur le banc local ; aucune écriture métier, génération payante, publication Instagram ou requête externe. Aucun jeton Auth ni mot de passe n’est inclus dans les captures ou les reçus. Deux tâches de test sont représentées dans les reçus ; les données métier sources restent inchangées.
