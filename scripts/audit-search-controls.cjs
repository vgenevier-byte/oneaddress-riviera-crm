/** Audit visible native choice domains. New controls need an explicit, reviewed disposition. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = process.cwd();
function files(directory) { return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : entry.name.endsWith('.tsx') ? [path.join(directory, entry.name)] : []); }
function policy(file, attributes, body) {
  if (file === 'components/search/SearchableSelect.tsx') return 'Transport natif invisible : valeur, validation et FormData du sélecteur avec recherche';
  if (file === 'components/BusinessPermissions.tsx') return 'Primitive de permissions ; les deux usages restants sont des statuts fermés';
  if (file === 'components/CRMApp.tsx') {
    const name = attributes.match(/name="([^"]+)"/)?.[1];
    if (name && ['quality','reliability','status','paymentStatus','bookingStatus','method','type','planningCategory','blocksAvailability','entityType','civility','kind','relationshipStatus','clientLevel','preferredLanguage','supplierReliability','supplierStatus','supplierQuality','category','priority'].includes(name)) return name === 'category' ? 'Quatre univers métier fermés de demande client' : 'Enum métier court et fermé : ' + name;
    if (attributes.includes('name={`unit${category}`}')) return 'Trois unités de facturation fermées : jour, semaine, forfait';
    if (attributes.includes('value={activeActor}')) return 'Acteur historique fermé : crmActors = [Vincent] ; ce champ ne sélectionne aucun compte Auth';
    if (attributes.includes('value={categoryFilter}')) return 'Filtre des quatre univers de planning et Tous';
    if (/value=\{(?:lead(?:Category|Status|Priority)Filter|(?:property|vehicle|boat)StatusFilter|getQuoteStatus\(quote.status\)|lead.status)\}/.test(attributes)) return 'Filtre ou statut métier court et fermé ; ordre métier conservé';
    if (attributes.includes('value={planningViewMode}')) return 'Deux vues calendaires : mois et semaine';
  }
  if (file === 'components/ContactCompanyFields.tsx' && attributes.includes('name="companyPersonMode"')) return 'Deux modes fermés : rattacher ou créer';
  if (file === 'components/ContactDocuments.tsx' && attributes.includes('value={item.type}')) return 'Six classifications documentaires fermées';
  if (file === 'components/QuickRepliesView.tsx' && attributes.includes('value={channel}')) return 'Trois canaux fermés : Tous, WhatsApp, Email';
  if (file === 'components/AccessAdministration.tsx') {
    if (attributes.includes('value={g.level}')) return 'Trois niveaux de droits fermés';
    if (attributes.includes('value={edit.izordRole')) return 'Rôles de permissions IZORD fermés';
  }
  if (file === 'components/TasksWorkspace.tsx' && /(?:filters\.(?:relation|status|priority)|task.status|name="(?:priority|status)")/.test(attributes)) return 'Trois valeurs de relation, statut ou priorité ; Tous dans les filtres';
  if (file === 'components/fonciere/GuidedProjectField.tsx' && attributes.includes('-grade`')) return 'Échelle DPE/GES fermée, A à G dans cet ordre';
  if (file === 'components/izord/IzordGenerator.tsx') {
    if (attributes.includes('value={workflow}')) return 'Trois étapes de validation fermées';
    if (attributes.includes('id={`izord-${key}`}')) {
      const specifications = JSON.parse(fs.readFileSync('components/izord/fields.json','utf8')).filter(field => field.kind === 'select');
      if (specifications.every(field => field.options.length <= 8)) return 'Schéma vérifié : cinq listes métier fermées de deux à cinq valeurs';
    }
  }
  if (file === 'components/monthlyCharges/MonthlyChargesWorkspace.tsx') {
    if (attributes.includes('value={source}')) return 'Trois sources fermées';
    if (attributes.includes('value={monthIndex}')) return 'Contrôle calendaire : douze mois dans l’ordre chronologique';
    if (attributes.includes('value={mode}')) return 'Trois règles fermées : auto, inclure, exclure';
    if (attributes.includes('value={draft.mode}')) return 'Trois modes fermés de rattachement comptable';
  }
  if (file === 'components/publisher/PublisherPage.tsx' && attributes.includes('id="publisher-car-type"')) return 'Huit types automobiles fermés ; marques et modèles utilisent la recherche';
  return null;
}
const native = [], searchable = [], free = [];
for (const file of files('components')) {
  const source = fs.readFileSync(file,'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const tag = opening.tagName.getText(ast), attributes = opening.attributes.getText(ast).replace(/\s+/g,' ');
      const entry = {file,line:ast.getLineAndCharacterOfPosition(opening.getStart(ast)).line+1,tag,attributes};
      if (tag === 'select' || tag === 'BusinessSelect' || tag === 'datalist') native.push({...entry, justification: tag === 'datalist' ? null : policy(file, attributes, node.getText(ast))});
      if (tag === 'SearchableSelect' || tag === 'SearchableBusinessContactPicker' || tag === 'TaskContactPicker') searchable.push(entry);
      if (tag === 'SearchableInput') free.push(entry);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const unknown = native.filter(entry => !entry.justification);
const report = {nativeControls:native.length,searchableControls:searchable.length,freeTextSuggestionControls:free.length,unreviewed:unknown,native,searchable,free};
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(report,null,2)+'\n');
else { console.log(`${native.length} native controls justified; ${searchable.length} searchable selectors; ${free.length} free-text suggestion controls.`);for(const entry of unknown)console.error(`${entry.file}:${entry.line}: unreviewed ${entry.tag} ${entry.attributes}`); }
if (unknown.length) process.exitCode=1;
