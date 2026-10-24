/** Offline, explicit-evidence reconciliation. This script never connects to a
 * database. A preview is mandatory; applying its SQL requires administrative
 * access, a durable journal, row lock and exact snapshot comparison. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// JSONB may reorder object keys on read. Compare values, preserving array order.
const stableJSON = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);

export function prepareReconciliation(snapshot, plan) {
  if (snapshot.workspace_id !== 'oneaddress-riviera' || !Array.isArray(snapshot.payload?.contacts) || !snapshot.updated_at || !Array.isArray(plan.operations)) throw new Error('invalid_reconciliation_input');
  const contacts = structuredClone(snapshot.payload.contacts), originals = new Map(contacts.map(row => [row.id, structuredClone(row)]));
  const seen = new Set();
  for (const operation of plan.operations) {
    if (!operation.evidence || !operation.reason || !operation.id || seen.has(operation.id)) throw new Error('explicit_unique_evidence_required');
    seen.add(operation.id);
    if (operation.type === 'patch') {
      const row = contacts.find(row => row.id === operation.id);
      if (!row || stableJSON(row) !== stableJSON(operation.before)) throw new Error('source_record_changed');
      if (!operation.patch || Object.keys(operation.patch).some(key => !['companyId','primaryContactId','mergedIntoCompanyId','entityType'].includes(key))) throw new Error('reconciliation_patch_forbidden');
      if ('entityType' in operation.patch && (!operation.explicitClassification || row.entityType !== undefined || !['person','company'].includes(operation.patch.entityType))) throw new Error('explicit_legacy_classification_required');
      Object.assign(row, operation.patch);
    } else if (operation.type === 'create') {
      if (originals.has(operation.id) || contacts.some(row => row.id === operation.id) || operation.contact?.id !== operation.id || !['person','company'].includes(operation.contact.entityType)) throw new Error('reconciliation_create_invalid');
      contacts.push(structuredClone(operation.contact));
    } else throw new Error('reconciliation_operation_invalid');
  }
  if (new Set(contacts.map(row => row.id)).size !== contacts.length) throw new Error('duplicate_contact_id');
  for (const row of contacts) {
    if (row.companyId) {
      const company = contacts.find(company => company.id === row.companyId && company.entityType === 'company' && !company.mergedIntoCompanyId);
      if (row.entityType !== 'person' || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || !row.name?.trim() || !company) throw new Error('invalid_company_link');
    }
    if (row.mergedIntoCompanyId) {
      const company = contacts.find(company => company.id === row.mergedIntoCompanyId && company.entityType === 'company' && !company.mergedIntoCompanyId);
      if (row.entityType !== 'company' || !company || company.id === row.id || row.primaryContactId || contacts.some(person => person.companyId === row.id)) throw new Error('invalid_company_alias');
    }
    if (row.entityType === 'company' && !row.mergedIntoCompanyId) {
      if (!row.companyName?.trim()) throw new Error('company_name_required');
      const people = contacts.filter(person => person.companyId === row.id && person.entityType === 'person' && person.name?.trim());
      if (!people.length && stableJSON(row) !== stableJSON(originals.get(row.id))) throw new Error('company_person_required');
      if (row.primaryContactId && !people.some(person => person.id === row.primaryContactId)) throw new Error('primary_person_must_be_linked');
    }
  }
  // No original identity, financial value, contact coordinate, note, document
  // or historical field is overwritten by a relation-only operation.
  for (const row of contacts) {
    const original = originals.get(row.id);
    if (original) for (const [key,value] of Object.entries(original)) if (!['companyId','primaryContactId','mergedIntoCompanyId'].includes(key) && stableJSON(row[key]) !== stableJSON(value)) throw new Error('historical_information_changed');
  }
  const planId = createHash('sha256').update(stableJSON({workspace:snapshot.workspace_id,revision:snapshot.updated_at,operations:plan.operations})).digest('hex');
  return {planId, contacts, operations:plan.operations, summary:{originalContacts:originals.size, finalContacts:contacts.length, createdPersons:plan.operations.filter(op=>op.type==='create'&&op.contact.entityType==='person').length, createdCompanies:plan.operations.filter(op=>op.type==='create'&&op.contact.entityType==='company').length, linkedPersons:plan.operations.filter(op=>op.type==='patch'&&op.patch.companyId).length, consolidatedCompanies:plan.operations.filter(op=>op.type==='patch'&&op.patch.mergedIntoCompanyId).length, mergedPersons:0}};
}

const literal = value => "'" + value.replaceAll("'", "''") + "'";
export function reconciliationSQL(snapshot, prepared) {
  const plan = literal(prepared.planId), workspace = literal(snapshot.workspace_id), operations = literal(JSON.stringify(prepared.operations));
  // A captured PostgreSQL JSONB digest avoids retransmitting the whole private
  // workspace. Fixtures without that server-issued digest compare JSONB values.
  const sourceChanged = /^[a-f0-9]{32}$/.test(snapshot.payload_md5 || '')
    ? `md5(w.payload::text) is distinct from ${literal(snapshot.payload_md5)}`
    : `w.payload is distinct from ${literal(JSON.stringify(snapshot.payload))}::jsonb`;
  return `begin;
select pg_advisory_xact_lock(734991);
do $reconcile$
declare w public.crm_workspace_state%rowtype; previous_run app_private.contact_company_reconciliation_runs%rowtype; rows jsonb; operation jsonb; plan_operations jsonb:=${operations}::jsonb;
begin
 select * into previous_run from app_private.contact_company_reconciliation_runs where plan_id=${plan};
 if found then
  if previous_run.rolled_back_at is not null then raise exception 'reconciliation_plan_rolled_back' using errcode='40001'; end if;
  return;
 end if;
 select * into strict w from public.crm_workspace_state where workspace_id=${workspace} for update;
 if w.updated_at is distinct from ${literal(snapshot.updated_at)}::timestamptz or ${sourceChanged} then raise exception 'reconciliation_source_changed' using errcode='40001'; end if;
 rows:=coalesce(w.payload->'contacts','[]');
 for operation in select value from jsonb_array_elements(plan_operations) loop
  if operation->>'type'='patch' then
   if not exists(select 1 from jsonb_array_elements(w.payload->'contacts') r where r->>'id'=operation->>'id' and r=operation->'before') then raise exception 'reconciliation_record_changed' using errcode='40001'; end if;
   select jsonb_agg(case when r->>'id'=operation->>'id' then r||(operation->'patch') else r end) into rows from jsonb_array_elements(rows) r;
  elsif operation->>'type'='create' then
   if exists(select 1 from jsonb_array_elements(rows) r where r->>'id'=operation->>'id') then raise exception 'reconciliation_identity_exists' using errcode='40001'; end if;
   rows:=rows||jsonb_build_array(operation->'contact');
  else raise exception 'reconciliation_operation_invalid' using errcode='22023'; end if;
 end loop;
 insert into app_private.contact_company_reconciliation_runs(plan_id,workspace_id,before_revision,before_payload,after_contacts,operations)
 values(${plan},w.workspace_id,w.updated_at,w.payload,rows,plan_operations);
 update public.crm_workspace_state set payload=jsonb_set(w.payload,'{contacts}',rows) where workspace_id=w.workspace_id returning * into w;
 update app_private.contact_company_reconciliation_runs set after_revision=w.updated_at,after_contacts=w.payload->'contacts' where plan_id=${plan};
end $reconcile$;
commit;
select plan_id,applied_at,before_revision,after_revision,jsonb_array_length(operations) operations from app_private.contact_company_reconciliation_runs where plan_id=${plan};
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [snapshotFile,planFile,outputPrefix] = process.argv.slice(2);
  if (!outputPrefix) throw new Error('Usage: node scripts/contact-company-reconcile.mjs PRIVATE_SNAPSHOT PRIVATE_PLAN PRIVATE_OUTPUT_PREFIX');
  const snapshot = JSON.parse(readFileSync(snapshotFile,'utf8')), plan = JSON.parse(readFileSync(planFile,'utf8'));
  const prepared = prepareReconciliation(snapshot,plan);
  writeFileSync(outputPrefix+'.preview.json',JSON.stringify(prepared,null,2)+'\n',{mode:0o600});
  writeFileSync(outputPrefix+'.apply.sql',reconciliationSQL(snapshot,prepared),{mode:0o600});
  console.log(JSON.stringify({planId:prepared.planId,...prepared.summary}));
}
