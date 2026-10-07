# Responsables — menu unique, sans recherche dédiée

Base publiée vérifiée : `bfc1ef853afe215e420fe5be3c7ab334964b492a`,
déploiement `dpl_2hEpdr8v1nQuAdjCdYoV9RZp2ExR`.

Seul fichier produit modifié : `components/TasksWorkspace.tsx`.
Le champ « Rechercher un responsable », son placeholder, son état, ses resets,
sa normalisation, son filtrage et son message de recherche vide sont retirés.
Le nom accessible et l'option initiale deviennent « Sélectionner un responsable ».
Le menu contient directement tous les comptes de l'annuaire, hors UUID déjà choisis.

Les options conservent noms, emails, niveau d'accès et « moi ». Les ajouts successifs,
étiquettes et retraits restent identiques. Les responsables inactifs restent conservés ;
le gestionnaire historique obligatoire reste non retirable. Chargement, panne/réessai,
actualisation, brouillons, révisions et confirmation restent ceux du composant publié.

La mutation, la soumission, les handlers d'ajout/retrait et la recherche générale
des tâches ont été comparés au contenu publié et sont inchangés. Les autres fichiers
produit, migrations, règles serveur, retrait du panneau de reprise, historique repliable,
Google, mots de passe et autres modules restent identiques.

## Validation ciblée

TypeScript sans émission ni cache incrémental, lint ciblé et build complet de
l'application de Production sont validés. Le build local emploie des valeurs publiques
fictives et bloque tout transport réseau ; aucune configuration réelle n'est chargée.
Le diff de l'index est vérifié avant commit.

Les parcours UI utilisent le composant exact dans une page locale isolée et des réponses
HTTP entièrement fictives, conservées en mémoire pour vérifier sauvegarde et rechargement.
Ils n'utilisent ni Auth, ni RPC Supabase, ni SQL, ni données métier ou comptes réels.
Ils ne prouvent pas une session authentifiée Production ou un appareil physique.
Les cinq parcours passent, sur Chromium 1440/390 et WebKit 390, avec contrôle des
affectations inactives, gestionnaire et conflit. Leurs résultats, empreintes et captures
sont conservés dans [UI-PROOF.md](UI-PROOF.md) et [ui-browser-results.json](ui-browser-results.json).

## Périmètre de publication

Commit explicite du seul fichier produit et des preuves ciblées associées ; push sur
une branche `codex/` puis publication du SHA vérifié dans le projet Vercel existant.
Le candidat de Production est préparé sans promotion automatique, puis le même build
READY est promu et les deux domaines vérifiés. Aucune migration SQL, sauvegarde globale,
pause des saisies, modification de droit ou écriture métier de test. L'activité normale
des autres modules n'est pas une condition bloquante pour ce correctif d'affichage.
Le checkout principal et les travaux Contacts → Drive restent préservés.
