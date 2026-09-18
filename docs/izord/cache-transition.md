# Transition des caches OAR — proposition non exécutée sur les profils réels

La séparation serveur des comptes ne rend pas confidentiel un ancien payload déjà conservé en clair dans le même profil navigateur. Un préfixe UUID ne chiffre pas `localStorage`. Le nouveau portail doit donc être précédé d’une récupération explicite des anciens caches sur les profils concernés.

## Préparation avant ouverture à un autre compte

1. Réserver le profil navigateur à son ancien utilisateur OAR autorisé pendant la transition. Ne pas remettre un profil contenant un ancien cache à un utilisateur IZORD seul : la barrière applicative ne révoque pas la lecture directe de ce stockage par le propriétaire du profil.
2. Fermer les anciens onglets CRM, autres fenêtres et instances susceptibles de réécrire les anciennes clés. Conserver une fenêtre de récupération. L’opération concerne une origine exacte ; inventorier séparément les profils et origines réellement utilisés, sans exporter de cookies ou de session Auth.
3. Exporter explicitement les seules anciennes clés CRM reconnues depuis la barrière de récupération du portail. Conserver le fichier hors de l’origine, dans un emplacement privé. Ce fichier contient potentiellement des données métier et ne doit pas être ajouté à Git, aux preuves ou aux archives partagées.
4. Vérifier le fichier obtenu et faire rapprocher son contenu de l’état serveur par l’utilisateur OAR habilité. Préserver toute saisie non synchronisée ; aucun import automatique dans le compte suivant. L’export ne constitue pas une sauvegarde distante ni une confirmation de synchronisation.
5. Confirmer explicitement la conservation de la copie et la fermeture des anciens onglets avant la purge. Si le stockage a changé depuis l’export, refaire l’export et la vérification. Seules les clés CRM reconnues sont supprimées ; les clés Auth et les données étrangères restent intactes.
6. Vérifier les valeurs brutes restantes, fermer/recharger les anciens onglets, puis ouvrir le portail. Une réapparition de clé legacy impose une nouvelle récupération avant reprise. Les fichiers exportés restent sous la responsabilité de leur propriétaire : la purge du navigateur ne les efface pas.

Les nouveaux caches de travail CRM résident en mémoire de la page et sont vidés au changement d’identité. Les modifications non synchronisées doivent être enregistrées ou exportées avant fermeture ; une alerte de départ ne garantit pas la récupération après un crash ou un arrêt forcé. Le conflit de synchronisation conserve le travail local jusqu’au choix explicite de l’utilisateur.

## Portée des preuves

Les essais de lecture brute, export, purge, redémarrage et coordination des onglets sont réalisés uniquement dans des profils temporaires contenant des marqueurs fictifs. Aucun cache du profil Chrome réel n’a été lu, exporté ou supprimé. La migration des caches réels reste à planifier et à autoriser séparément. Aucune liste d’utilisateurs ni aucun identifiant personnel n’est nécessaire dans ce document.
