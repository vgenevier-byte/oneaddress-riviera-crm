# Référence HTML conservée et préparation du lot 2

Source originale, intacte, hors dépôt et hors assets publics :
`/Users/vg/Desktop/IZORD_Invest_Fiche_Projet_Locations_v3 (1).html`

- 2 552 493 octets, 556 lignes.
- SHA-256 vérifié le 16 septembre 2026 : `8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1`.
- Aucun portage de formules, chargement automatique du HTML ou changement du fichier.
- `EXAMPLE` ligne 120, `examplePhotos` ligne 116, mentions Dragon Island lignes 116/120 ; contrôler aussi le contenu Open XML du modèle embarqué au lot 2. Aucun bouton d’exemple ajouté.
- Aucun `<script src>` externe identifié ; JSZip est embarqué, crédits/licences à conserver.

| Module futur | Fonctions/champs source | Invariants à conserver |
|---|---|---|
| `finance` | `number` 126, `errorsFor` 134, `calculate` 135 | Extraction littérale puis tests de parité ; absent ≠ zéro, scénarios locatifs non additionnés, devis notarial prioritaire, conventions FAI et frais inchangées |
| `agencyImport` | `parseAgency` 269+, `workerRead`, `analyzeAgencyFiles`, `validateAgencyImport` | Relecture explicite avant application ; aucune approbation comité implicite ; aucun OCR/IA/envoi automatique |
| `photos` | `cropPhoto`, `renderImportPhotos`, `renderSavedGallery`, `registerGalleryPhoto`, `photoGalleryRoles` | Quatre visuels de synthèse et photothèque séparés, recadrages propres, filigranes non supprimés |
| `presentation` | `maps`, `makePpt` 208, `appendPhotoSlide`, `updatePresentationMetadata` | Textes/images modifiables, mappings/notes Open XML préservés, slide 3 optionnelle, pas de slide vide |
| `compatibility` | `IZORD_FICHE_V1` 196/198 | `state`, `photos`, `importMeta`, `importGallery`, `photoGalleryRoles` conservés en import/export |

Limites à reconfirmer par tests de parité du lot 2 : six PDF, 25 Mo/fichier, PDF numériques uniquement, 120 pages, 60 secondes, plafond de décompression et 80 JPEG selon critères de taille/ratio. L’extraction ne promet pas toutes les images d’un PDF. Les onze cas financiers mentionnés dans l’audit ne font pas partie des trois fichiers fournis ; ils n’ont pas été exécutés dans ce lot.

Les données partagées utilisent des projets/versions/assets dédiés. `izord_save_project` exige la révision attendue ; chaque version garde son auteur Auth. Un asset référence une révision précise. Le lot 1 corrigé propose le protocole SQL de finalisation et de retrait des assets ; le lot 2 devra le consommer dans son interface, ajouter la validation du contenu, le hash, le scénario et l’état de génération des exports. Ce lot ne prétend pas fournir un export PPTX intégré.

Les PDF doivent aller directement vers Storage via JWT utilisateur et transfert TUS repris (chunks de 6 Mo selon la documentation consultée lors de l’audit initial), sans contenu complet dans une fonction Vercel ni dans le payload OAR. Il reste à implémenter et tester le parcours TUS avec le cycle documentaire corrigé, le contrôle réel du type/signature, les quotas cumulés, les dimensions après décompression et le nettoyage des uploads abandonnés. La limite et la liste MIME du bucket seules ne prouvent pas la validité du contenu.

**WebP — décision requise au lot générateur :** la liste MIME actuelle de `izord-documents` n’inclut pas `image/webp`. Conserver WebP nécessitera une évolution explicite et testée du contrat Storage et des exports. L’autre option est une conversion documentée, testée pour les dimensions, la transparence, l’orientation, la qualité et les métadonnées utiles. Ne pas changer silencieusement l’extension ni affirmer une compatibilité qui n’a pas été testée. Le HTML et ses images/formules originales restent inchangés.

Identifiant permanent : UUID de l’asset + bucket/chemin, jamais URL signée. Le prototype privilégie les lectures authentifiées. Supabase permet cependant aux utilisateurs ayant SELECT de générer une URL signée via Storage : sa validité persiste jusqu’à son expiration, même après révocation. Aucun plafond court contrôlé côté serveur n’est garanti par la seule RLS. Avant ouverture réelle, fixer cette politique ou interposer un service de téléchargement si une durée maximale imposée est nécessaire. Les fichiers déjà téléchargés restent hors contrôle.

Mettre à jour toute mention promettant une exécution purement locale/sans transmission lors de l’ajout des sauvegardes partagées. La charte à préserver est ivoire `#FAF8F3`, marine `#0C2740`, or `#AC844A`.
