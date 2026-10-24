-- Administrative recovery only. Replace the exact plan ID after reviewing the
-- private journal. Do not run from a browser or an authenticated CRM client.
-- The lock prevents another write while restoring a previously valid legacy
-- snapshot; only the relation guard is suspended inside this transaction.
begin;
select pg_advisory_xact_lock(734991);
lock table public.crm_workspace_state in access exclusive mode;
-- Account identity administration can write outside the workspace advisory-lock
-- protocol. Block reference-table writes during the final check and restoration.
lock table app_private.task_records,app_private.task_identity_links,app_private.task_events,public.fonciere_project_contacts,public.crm_document_scopes in share mode;
alter table public.crm_workspace_state disable trigger zz_crm_contact_company_relations;
do $rollback$
declare run app_private.contact_company_reconciliation_runs%rowtype; w public.crm_workspace_state%rowtype; created_ids text[];
begin
 select * into strict run from app_private.contact_company_reconciliation_runs where plan_id='REVIEWED_PLAN_ID' for update;
 if run.rolled_back_at is not null then return; end if;
 select * into strict w from public.crm_workspace_state where workspace_id=run.workspace_id for update;
 if w.payload->'contacts' is distinct from run.after_contacts then raise exception 'rollback_contacts_changed' using errcode='40001'; end if;
 -- Identities created by this run might have received new cross-module links.
 -- Refuse recovery if any unrelated module changed since the backup; review
 -- its links manually before preparing a narrower rollback.
 if w.payload-'contacts' is distinct from run.before_payload-'contacts' then raise exception 'rollback_other_modules_changed' using errcode='40001'; end if;
 -- Canonical tasks, account identity links, Foncière links and document scopes
 -- live outside the JSON workspace. The table locks prevent a new reference
 -- between this check and restoration, including administrative writers. Retain deleted
 -- tasks and historical task events too: their original contact IDs still matter.
 select coalesce(array_agg(c->>'id'),array[]::text[]) into created_ids
 from jsonb_array_elements(run.after_contacts) c
 where not exists(select 1 from jsonb_array_elements(run.before_payload->'contacts') original where original->>'id'=c->>'id');
 if exists(select 1 from app_private.task_records where contact_id=any(created_ids) or legacy_original->>'contactId'=any(created_ids))
  or exists(select 1 from app_private.task_identity_links where contact_id=any(created_ids))
  or exists(select 1 from app_private.task_events where changes->>'contactId'=any(created_ids))
  or exists(select 1 from public.fonciere_project_contacts where contact_id=any(created_ids) or agency_contact_id=any(created_ids))
  or exists(select 1 from public.crm_document_scopes where collection='contacts' and record_id=any(created_ids))
 then raise exception 'rollback_external_contact_reference' using errcode='40001'; end if;
 update public.crm_workspace_state set payload=jsonb_set(w.payload,'{contacts}',run.before_payload->'contacts') where workspace_id=run.workspace_id;
 update app_private.contact_company_reconciliation_runs set rolled_back_at=clock_timestamp() where plan_id=run.plan_id;
end $rollback$;
alter table public.crm_workspace_state enable trigger zz_crm_contact_company_relations;
commit;
