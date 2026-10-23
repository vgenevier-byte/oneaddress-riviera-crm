# Foncière — formulaire guidé

Évolution du formulaire publié : inventaire initial de 44 champs, contrôles adaptés et réutilisés dans la revue d’import. Les codes structurés sont indépendants de la langue ; les libellés sont FR/EN. Seul le nom est obligatoire. Les coordonnées du bien, de l’entreprise et de la personne restent distinctes.

Les textes anciens restent enregistrés intégralement. Seules les correspondances exactes fiables préremplissent les choix. Vide, zéro, aucun, sans objet et information incertaine restent distincts. Un changement de type conserve les champs devenus incompatibles, exclus des caractéristiques actuelles jusqu’à confirmation explicite. Une proposition de réimport ne remplace pas par défaut une correction existante.

Le sélecteur CRM partagé accepte un mode contrôlé compatible avec ses anciens usages. La recherche couvre tous les contacts autorisés, avec mots combinés, ordre inversé, accents et variantes de téléphone. Agence et agent ont des identités séparées dans la projection Contacts protégée. Un simple nom d’entreprise porté par une personne ne crée aucun lien d’entreprise. Le remplacement de coordonnées locales demande confirmation ; la fiche CRM n’est pas modifiée par une correction du projet.

Les honoraires restent descriptifs, sans seconde addition au prix. Les hypothèses de location conservent leur unité : seules les valeurs explicitement hebdomadaires ou mensuelles alimentent les cases correspondantes du générateur. Les prix à la nuit ou à l’année restent dans les hypothèses lisibles. Le potentiel annoncé, l’état des vérifications et les hypothèses personnelles restent séparés ; rien n’est automatiquement vérifié ou autorisé.

Deux migrations additives conservent les données et l’ancienne signature de sauvegarde. Les nouveaux documents cités comme preuve sont contrôlés côté serveur : fichier finalisé du même projet. Les droits Contacts, les droits Foncière et le contrôle de révision continuent de s’appliquer.

## Vérifications de ce lot

- 37 tests unitaires ciblés : modèle, anciens textes, import, recherche/identité, unités, frais, type et instantanés.
- 18 groupes réels serveur locaux : Auth, RPC, PostgreSQL, RLS, droits absents/lecture, identités séparées, API historique, concurrence et documents du bon projet.
- Parcours Chromium avec la base locale fictive : maison, appartement, terrain, local commercial, nombres français, recherche par entreprise et coordonnées, sélection/changement/retrait, rechargement, erreurs conservant le brouillon, ancien texte atypique, PDF connu, réimport, FR/EN desktop/mobile et PowerPoint réellement généré puis inspecté.
- Vérifications complémentaires : création CRM, doublons, brouillon pendant une requête et changement de type avec récupération explicite.
- TypeScript, lint et build de production réussis. Deux avertissements lint préexistants hors de ce lot.

Les captures du dossier `screenshots/` montrent exclusivement des données fictives de test. Les comptes, mots de passe, clés et sessions restent hors Git. Les rapports synthétiques sont dans `verification.json`. Les runners locaux ont des chemins par défaut adaptés à cette machine ; les fixtures privées doivent être fournies pour les reproduire.

Ces essais sont locaux. Les vérifications Production de livraison portent séparément sur les migrations, les empreintes de conservation, le commit, le déploiement, l’alias et les ressources servies. Aucun parcours métier authentifié ni création de données de test en Production n’est revendiqué. L’OCR existant n’a pas fait l’objet d’une nouvelle campagne exhaustive dans ce lot.
