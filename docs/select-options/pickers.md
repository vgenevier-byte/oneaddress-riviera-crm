# Sélecteurs de contacts, entreprises et recherches

Le tri reste une opération de présentation sur les contacts déjà fournis au composant. Il ne recherche aucune donnée supplémentaire et ne change ni projection autorisée, ni identifiant, ni sélection enregistrée.

| Parcours | Ordre affiché | Éléments préservés |
| --- | --- | --- |
| `TaskContactPicker` | Libellé visible du contact, dans la langue active | Recherche prénom/nom/entreprise, homonymes, identité par ID, sélection explicite et clavier |
| `SearchableBusinessContactPicker`, mode `all` utilisé par Foncière | Libellé visible fourni par le parcours, avant la limite existante de 50 résultats du composant | Périmètre reçu, sélection et surbrillance par ID, groupe agence/personne filtré par le consommateur |
| `SearchableBusinessContactPicker`, mode prestataire | Classement de pertinence existant | Début d’entreprise, présence dans l’entreprise, personne, autres champs ; départage alphabétique existant |
| Suggestions proches Contacts | Classement de pertinence existant | Distance, correspondance de préfixe, limite et déduplication par ID |
| Suggestions d’adresses IGN | Ordre du fournisseur existant | Pertinence géographique et comportement d’admission de l’adresse |

Le mode Foncière `all` reçoit des résultats filtrés, sans score de pertinence. Son tri alphabétique ne remplace donc pas un classement de recherche. Le composant conserve l’ID du contact surligné lorsque la traduction modifie l’ordre des libellés : Entrée choisit toujours la fiche surlignée, même si sa position change. Les options révoquées ne peuvent plus être choisies par le clavier.

Le filtrage d’agence, le lien canonique agence/personne, les créations depuis Foncière, les confirmations d’enregistrement et la conservation du brouillon restent assurés par les parcours existants. Les professions personnalisées conservent leur valeur métier exacte et sont ajoutées au catalogue affiché par Contacts.

## Vérification locale

`tests/select-options/pickers.browser.mjs` assemble les composants réels avec des propriétés et traductions fictives. Il couvre les vues Chromium 1440 et 390 pixels, l’ordre alphabétique avec accents, le changement de langue pendant la surbrillance, le choix du même ID après réordonnancement, la pertinence prestataire, le tri avant la limite de 50, la sélection Tâches par ID et l’absence de soumission implicite. Toutes les requêtes réseau sont interdites et collectées ; le scénario exige zéro tentative.

```sh
node tests/select-options/pickers.browser.mjs
```

`tests/select-options/browser.mjs` parcourt l’application réelle `AccessPortal` → CRM et Foncière, avec un transport HTTP fictif intercepté et un catalogue entièrement fictif. Il vérifie les professions en création/modification/filtre, les valeurs accentuées et personnalisées, les options spéciales, FR → EN → FR, la sauvegarde explicite puis le rechargement, les projections limitées, la création Contacts depuis Foncière et le retour au projet préservé. Les sauvegardes sont simulées dans la fermeture du transport Playwright ; le rechargement vérifie cette persistance simulée. Les profils limités doivent n’effectuer aucune lecture de l’état global CRM et ne reçoivent pas le contact exclu.

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4097 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fictional-ui-only-public-key \
npm run dev -- --hostname 127.0.0.1 --port 3217

SELECT_OPTIONS_ACK=SELECT_OPTIONS_FICTION_ONLY \
node tests/select-options/browser.mjs
```

Les résultats JSON et captures sont écrits dans `/private/tmp/oar-select-options-evidence` par défaut (`SELECT_OPTIONS_OUTPUT` permet un autre dossier). Ce sont des preuves de navigateur local avec données et réponses fictives : aucun Auth/RPC/SQL réel, aucune écriture en Production et aucun appareil mobile physique ne sont utilisés.
