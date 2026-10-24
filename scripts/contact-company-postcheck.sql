-- Read-only administrative verification. Replace REVIEWED_PLAN_ID with the
-- exact approved SHA-256 plan ID. Compare reference_fingerprints to the private
-- pre-migration reference-fingerprints snapshot. This is SQL metadata evidence,
-- not an authenticated Production CRM/API session.
with journal as (
 select * from app_private.contact_company_reconciliation_runs where plan_id='REVIEWED_PLAN_ID'
), workspace as (
 select * from public.crm_workspace_state where workspace_id='oneaddress-riviera'
), contacts as (
 select c from workspace cross join lateral jsonb_array_elements(payload->'contacts') c
), originals as (
 select c from journal cross join lateral jsonb_array_elements(before_payload->'contacts') c
), operations as (
 select op from journal cross join lateral jsonb_array_elements(operations) op
)
select jsonb_build_object(
 'journal',(select jsonb_build_object('plan_id',plan_id,'before_revision',before_revision,'after_revision',after_revision,'rolled_back',rolled_back_at is not null,'before_payload_md5',md5(before_payload::text),'operation_count',jsonb_array_length(operations)) from journal),
 'contacts',jsonb_build_object(
  'total',(select count(*) from contacts),
  'companies',(select count(*) from contacts where c->>'entityType'='company'),
  'explicit_people',(select count(*) from contacts where c->>'entityType'='person'),
  'legacy_unqualified',(select count(*) from contacts where not c?'entityType'),
  'linked_people',(select count(*) from contacts where coalesce(c->>'companyId','')<>''),
  'company_aliases',(select count(*) from contacts where coalesce(c->>'mergedIntoCompanyId','')<>''),
  'companies_needing_contact',(select count(*) from contacts company where company.c->>'entityType'='company' and coalesce(company.c->>'mergedIntoCompanyId','')='' and not exists(select 1 from contacts person where person.c->>'companyId'=company.c->>'id' and person.c->>'entityType'='person' and coalesce(btrim(person.c->>'name'),'')<>'')),
  'missing_original_ids',(select count(*) from originals original where not exists(select 1 from contacts current where current.c->>'id'=original.c->>'id')),
  'original_fields_changed',(select count(*) from originals original join contacts current on current.c->>'id'=original.c->>'id' where original.c-array['companyId','primaryContactId','mergedIntoCompanyId','entityType'] is distinct from current.c-array['companyId','primaryContactId','mergedIntoCompanyId','entityType']),
  'approved_entity_classifications',(select count(*) from operations where op->>'type'='patch' and (op->'patch')?'entityType' and op->>'explicitClassification'='true'),
  'unplanned_entity_classifications',(select count(*) from originals original join contacts current on current.c->>'id'=original.c->>'id' where original.c->'entityType' is distinct from current.c->'entityType' and not exists(select 1 from operations where op->>'type'='patch' and op->>'id'=current.c->>'id' and op->>'explicitClassification'='true' and (op->'patch')->'entityType'=current.c->'entityType' and not original.c?'entityType')),
  'invalid_company_links',(select count(*) from contacts person where coalesce(person.c->>'companyId','')<>'' and (person.c->>'entityType' is distinct from 'person' or not exists(select 1 from contacts company where company.c->>'id'=person.c->>'companyId' and company.c->>'entityType'='company' and coalesce(company.c->>'mergedIntoCompanyId','')=''))),
  'invalid_primary_links',(select count(*) from contacts company where coalesce(company.c->>'primaryContactId','')<>'' and not exists(select 1 from contacts person where person.c->>'id'=company.c->>'primaryContactId' and person.c->>'companyId'=company.c->>'id' and person.c->>'entityType' is distinct from 'company')),
  'planned_patch_mismatches',(select count(*) from operations where op->>'type'='patch' and not exists(select 1 from contacts current where current.c->>'id'=op->>'id' and current.c @> (op->'patch'))),
  'planned_creation_mismatches',(select count(*) from operations where op->>'type'='create' and not exists(select 1 from contacts current where current.c->>'id'=op->>'id' and current.c=op->'contact'))
 ),
 'workspace',jsonb_build_object(
  'updated_at',(select updated_at from workspace),
  'matches_journal_contacts',(select payload->'contacts' is not distinct from after_contacts from workspace cross join journal),
  'noncontacts_unchanged',(select payload-'contacts' is not distinct from before_payload-'contacts' from workspace cross join journal),
  'collection_md5',(select jsonb_object_agg(key,md5(value::text)) from workspace cross join lateral jsonb_each(payload))
 ),
 'projection_catalogue',(select jsonb_build_object('companyId',fields?'companyId','primaryContactId',fields?'primaryContactId','alias_not_client_writable',not fields?'mergedIntoCompanyId','status_not_client_writable',not fields?'companyContactStatus') from app_private.module_collections where collection='contacts' and module='contacts'),
 'reference_fingerprints',jsonb_build_object(
  'fonciere_projects',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id),''))) from public.fonciere_projects x),
  'fonciere_project_contacts',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.project_id),''))) from public.fonciere_project_contacts x),
  'izord_projects',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id),''))) from public.izord_projects x),
  'izord_project_versions',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.project_id,x.revision),''))) from public.izord_project_versions x),
  'crm_document_scopes',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.provider,x.resource_id),''))) from public.crm_document_scopes x),
  'crm_document_shares',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.provider,x.resource_id,x.user_id),''))) from public.crm_document_shares x),
  'task_records',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id),''))) from app_private.task_records x),
  'task_identity_links',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.user_id),''))) from app_private.task_identity_links x),
  'task_events',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id),''))) from app_private.task_events x),
  'document_drive_trash',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.operation_id),''))) from app_private.document_drive_trash x),
  'crm_contacts_legacy',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by x.id),''))) from public.crm_contacts x)
 )
) as postcheck;
