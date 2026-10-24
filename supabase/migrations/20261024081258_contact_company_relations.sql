-- Persistent person/company links in the existing JSON workspace. No identity
-- merge, document ACL propagation, accounting rewrite or presentation change.
begin;
select pg_advisory_xact_lock(734991);
update app_private.module_collections set fields=fields||'{"companyId":{"type":"string","label":"Entreprise liée"},"primaryContactId":{"type":"string","label":"Interlocuteur principal"}}'::jsonb where collection='contacts' and module='contacts';

-- All writers, including the full-workspace owner route and message creation,
-- pass through this final-state guard. It never guesses links from text.
create function app_private.guard_contact_company_relations() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare prior_rows jsonb:='[]'; rows jsonb; row jsonb; prior jsonb; target jsonb; key text; member_count integer; previous_count integer; previous_primary text; next_primary text; normalized jsonb:='[]';
begin
 if new.workspace_id<>'oneaddress-riviera' then return new; end if;
 if tg_op='UPDATE' then
  if new.payload->'contacts' is not distinct from old.payload->'contacts' then return new; end if;
  prior_rows:=coalesce(old.payload->'contacts','[]');
 end if;
 rows:=coalesce(new.payload->'contacts','[]');
 if jsonb_typeof(rows) is distinct from 'array' then raise exception 'contact_collection_invalid' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(rows) r group by r->>'id' having count(*)>1) then raise exception 'contact_identity_duplicate' using errcode='22023'; end if;
 -- Preserve fields unknown to older global-save clients. Intentional detach uses
 -- an empty string; omissions cannot erase an established relation or alias.
 for row in select value from jsonb_array_elements(rows) loop
  select value into prior from jsonb_array_elements(prior_rows) where value->>'id'=row->>'id';
  foreach key in array array['companyId','primaryContactId','mergedIntoCompanyId'] loop
   if prior?key and not row?key then row:=row||jsonb_build_object(key,prior->key); end if;
   if row?key and (jsonb_typeof(row->key) is distinct from 'string' or (row->>key<>'' and row->>key !~ '^[A-Za-z0-9_-]{1,100}$')) then raise exception 'contact_relation_invalid:%',key using errcode='22023'; end if;
  end loop;
  if row?'companyContactStatus' then
   -- This is derived on read; a client cannot manufacture a grandfather status.
   row:=row-'companyContactStatus';
  end if;
  normalized:=normalized||jsonb_build_array(row);
 end loop;
 rows:=normalized; normalized:='[]';
 for row in select value from jsonb_array_elements(rows) loop
  select value into prior from jsonb_array_elements(prior_rows) where value->>'id'=row->>'id';
  if coalesce(row->>'companyId','')<>'' then
   if row->>'entityType' is distinct from 'person' or jsonb_typeof(row->'id') is distinct from 'string' or row->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' or app_private.contact_identity_blank(row->'name') then raise exception 'contact_company_link_requires_person' using errcode='22023'; end if;
   select value into target from jsonb_array_elements(rows) where value->>'id'=row->>'companyId';
   if target is null or target->>'entityType' is distinct from 'company' or coalesce(target->>'mergedIntoCompanyId','')<>'' then raise exception 'contact_company_reference_invalid' using errcode='23503'; end if;
  end if;
  if row->>'entityType' is distinct from 'company' then
   if coalesce(row->>'primaryContactId','')<>'' or coalesce(row->>'mergedIntoCompanyId','')<>'' then raise exception 'contact_company_field_requires_company' using errcode='22023'; end if;
  elsif prior is null and (jsonb_typeof(row->'id') is distinct from 'string' or row->>'id' !~ '^[A-Za-z0-9_-]{1,100}$') then
   raise exception 'contact_company_identity_invalid' using errcode='22023';
  elsif coalesce(row->>'mergedIntoCompanyId','')<>'' then
   -- Aliases retain original IDs and their independent document scopes. Only
   -- the complete owner workflow (or a database administrator) can consolidate.
   if row->'mergedIntoCompanyId' is distinct from prior->'mergedIntoCompanyId'
    and not app_private.full_access() and not(auth.uid() is null and session_user in ('postgres','supabase_admin')) then raise exception 'contact_company_merge_forbidden' using errcode='42501'; end if;
   select value into target from jsonb_array_elements(rows) where value->>'id'=row->>'mergedIntoCompanyId';
   if prior is null or prior->>'entityType' is distinct from 'company' or target is null or target->>'id'=row->>'id' or target->>'entityType' is distinct from 'company' or coalesce(target->>'mergedIntoCompanyId','')<>''
    or coalesce(row->>'primaryContactId','')<>'' or exists(select 1 from jsonb_array_elements(rows) p where p->>'companyId'=row->>'id') then raise exception 'contact_company_alias_invalid' using errcode='22023'; end if;
  else
   if coalesce(prior->>'mergedIntoCompanyId','')<>'' then raise exception 'contact_company_alias_locked' using errcode='22023'; end if;
   select count(*) into member_count from jsonb_array_elements(rows) p where p->>'companyId'=row->>'id' and p->>'entityType'='person' and not app_private.contact_identity_blank(p->'name');
   if member_count=0 then
    select count(*) into previous_count from jsonb_array_elements(prior_rows) p where p->>'companyId'=row->>'id' and p->>'entityType'='person' and not app_private.contact_identity_blank(p->'name');
    -- Historical incomplete companies remain byte-for-byte present during any
    -- unrelated save. Their next Contacts edit must supply an actual person.
    if prior is null or prior->>'entityType' is distinct from 'company' or previous_count<>0 or row is distinct from (prior-'companyContactStatus') then raise exception 'contact_company_person_required' using errcode='23514'; end if;
   end if;
   if coalesce(row->>'primaryContactId','')<>'' and not exists(select 1 from jsonb_array_elements(rows) p where p->>'id'=row->>'primaryContactId' and p->>'companyId'=row->>'id' and p->>'entityType'='person') then
    -- Removing one of several people must remain possible when that person was
    -- primary; an explicit invalid primary choice still fails.
    previous_primary:=prior->>'primaryContactId';
    if member_count>0 and row->>'primaryContactId'=previous_primary then
     select p->>'id' into next_primary from jsonb_array_elements(rows) p where p->>'companyId'=row->>'id' order by p->>'id' limit 1;
     row:=jsonb_set(row,'{primaryContactId}',to_jsonb(next_primary));
    else raise exception 'contact_company_primary_invalid' using errcode='23514'; end if;
   end if;
  end if;
  normalized:=normalized||jsonb_build_array(row);
 end loop;
 new.payload:=jsonb_set(new.payload,'{contacts}',normalized);
 return new;
end $$;
revoke all on function app_private.guard_contact_company_relations() from public,anon,authenticated;
create trigger zz_crm_contact_company_relations before insert or update of payload on public.crm_workspace_state for each row execute function app_private.guard_contact_company_relations();

-- Use the same curated catalogue, identity checks and sensitive-field boundary
-- as scoped contact mutation; private scalar notes remain owner-only.
create function app_private.contact_bundle_row(p_input jsonb,p_prior jsonb,p_payload jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare fields jsonb; patch jsonb; kv record; result jsonb; contact_id text:=p_input->>'id';
begin
 if jsonb_typeof(p_input) is distinct from 'object' or contact_id is null or contact_id !~ '^[A-Za-z0-9_-]{1,100}$' or octet_length(p_input::text)>32000 then raise exception 'invalid_contact_bundle' using errcode='22023'; end if;
 select c.fields into strict fields from app_private.module_collections c where c.collection='contacts';
 if app_private.full_access() then fields:=fields||'{"notes":{"type":"string"},"preferences":{"type":"string"},"importantNotes":{"type":"string"},"supplierPriceNotes":{"type":"string"},"supplierCommissionNotes":{"type":"string"}}'; end if;
 patch:=p_input-'id';
 for kv in select * from jsonb_each(patch) loop
  if not(fields?kv.key) or jsonb_typeof(kv.value) is distinct from fields->kv.key->>'type' then raise exception 'field_forbidden_or_invalid:%',kv.key using errcode='22023'; end if;
  if jsonb_typeof(kv.value)='string' and length(kv.value#>>'{}')>4000 then raise exception 'field_too_long'; end if;
  if jsonb_typeof(kv.value)='number' and ((kv.value#>>'{}')::numeric<0 or (kv.value#>>'{}')::numeric>100000000000) then raise exception 'number_out_of_range'; end if;
 end loop;
 perform app_private.validate_business_patch('contacts',patch,p_prior,p_payload,fields);
 result:=coalesce(p_prior,'{"name":"","kind":"Client","email":"","phone":"","city":"","postalAddress":"","budget":0,"source":"","notes":""}'::jsonb||jsonb_build_object('id',contact_id,'createdAt',clock_timestamp(),'createdBy',auth.uid()))||patch||jsonb_build_object('updatedAt',clock_timestamp(),'updatedBy',auth.uid());
 if patch?'kind' and patch->>'kind'<>'Membre de l’organisation' then result:=result||jsonb_build_object('relationshipStatus',case when patch->>'kind'='Prestataire' then 'Prestataire' when p_prior->>'relationshipStatus'='Prestataire' then 'Prospect' else coalesce(result->>'relationshipStatus','Prospect') end); if patch->>'kind'<>'Prestataire' then result:=result||'{"supplierCategory":""}'; end if; end if;
 perform app_private.validate_contact_identity(result,p_prior);
 return result;
end $$;
revoke all on function app_private.contact_bundle_row(jsonb,jsonb,jsonb) from public,anon,authenticated;

create function public.crm_save_contact_bundle(p_contact jsonb,p_person jsonb default null,p_existing_person_id text default null,p_revision text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w public.crm_workspace_state%rowtype; prior jsonb; company jsonb; person jsonb; rows jsonb; existing_id text:=nullif(p_existing_person_id,''); result jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if auth.uid() is null or not app_private.module_allowed('contacts',true) or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (nullif(to_jsonb(s)->>'not_after','') is null or (to_jsonb(s)->>'not_after')::timestamptz>clock_timestamp())) then raise exception 'module_forbidden' using errcode='42501'; end if;
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 if p_revision is distinct from app_private.module_revision('contacts',w.payload) then raise exception 'revision_conflict' using errcode='40001'; end if;
 if p_person is not null and existing_id is not null then raise exception 'contact_bundle_person_choice_invalid' using errcode='22023'; end if;
 select value into prior from jsonb_array_elements(coalesce(w.payload->'contacts','[]')) where value->>'id'=p_contact->>'id';
 company:=app_private.contact_bundle_row(p_contact,prior,w.payload);
 if p_person is not null or existing_id is not null then
  if company->>'entityType' is distinct from 'company' or coalesce(company->>'mergedIntoCompanyId','')<>'' then raise exception 'contact_bundle_company_required' using errcode='22023'; end if;
  if p_person is not null then
   if p_person->>'entityType' is distinct from 'person' or p_person->>'id'=company->>'id' or exists(select 1 from jsonb_array_elements(coalesce(w.payload->'contacts','[]')) p where p->>'id'=p_person->>'id') then raise exception 'contact_bundle_new_person_invalid' using errcode='22023'; end if;
   person:=app_private.contact_bundle_row(p_person||jsonb_build_object('companyId',company->>'id'),null,w.payload);
  else
   select value into person from jsonb_array_elements(coalesce(w.payload->'contacts','[]')) where value->>'id'=existing_id;
   if person is null or person->>'entityType'='company' or app_private.contact_identity_blank(person->'name') then raise exception 'contact_bundle_existing_person_invalid' using errcode='23503'; end if;
   person:=person||jsonb_build_object('entityType','person','companyId',company->>'id','updatedAt',clock_timestamp(),'updatedBy',auth.uid());
  end if;
  if coalesce(company->>'primaryContactId','')='' then company:=company||jsonb_build_object('primaryContactId',person->>'id'); end if;
 end if;
 select coalesce(jsonb_agg(case when r->>'id'=company->>'id' then company when r->>'id'=person->>'id' then person else r end),'[]') into rows from jsonb_array_elements(coalesce(w.payload->'contacts','[]')) r;
 if prior is null then rows:=rows||jsonb_build_array(company); end if;
 if p_person is not null then rows:=rows||jsonb_build_array(person); end if;
 update public.crm_workspace_state set payload=jsonb_set(w.payload,'{contacts}',rows),updated_by=auth.uid() where workspace_id=w.workspace_id returning * into w;
 result:=public.crm_read_module('contacts');
 return result||jsonb_build_object('workspaceRevision',w.updated_at);
end $$;
revoke all on function public.crm_save_contact_bundle(jsonb,jsonb,text,text) from public,anon;
grant execute on function public.crm_save_contact_bundle(jsonb,jsonb,text,text) to authenticated;

-- Read-only aliases/status are outside the writable field catalogue. Original
-- record/document IDs stay intact and document_allowed is never replaced.
do $$ declare definition text; begin
 select pg_get_functiondef('app_private.project_record(text,jsonb)'::regprocedure) into definition;
 execute replace(definition,'FUNCTION app_private.project_record(','FUNCTION app_private.contact_relations_previous_project_record(');
end $$;
revoke all on function app_private.contact_relations_previous_project_record(text,jsonb) from public,anon,authenticated;
create or replace function app_private.project_record(p_collection text,p_row jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 result:=app_private.contact_relations_previous_project_record(p_collection,p_row);
 if p_collection='contacts' and app_private.module_allowed('contacts') then
  if p_row?'mergedIntoCompanyId' then result:=result||jsonb_build_object('mergedIntoCompanyId',p_row->'mergedIntoCompanyId'); end if;
  if p_row->>'entityType'='company' and coalesce(p_row->>'mergedIntoCompanyId','')='' and not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) p where w.workspace_id='oneaddress-riviera' and p->>'companyId'=p_row->>'id' and p->>'entityType'='person' and not app_private.contact_identity_blank(p->'name')) then result:=result||'{"companyContactStatus":"needs_contact"}'::jsonb; end if;
 end if;
 return result;
end $$;
-- Selectors keep canonical relation metadata without adding a new module or
-- broadening any authorized collection. Preserve the current function body.
do $$ declare definition text; begin
 select pg_get_functiondef('public.crm_reference_options(text)'::regprocedure) into definition;
 if position('''companyName'',''entityType'',''kind''' in definition)=0 then raise exception 'contact_reference_projection_changed'; end if;
 execute replace(definition,'''companyName'',''entityType'',''kind''','''companyName'',''entityType'',''companyId'',''primaryContactId'',''mergedIntoCompanyId'',''companyContactStatus'',''kind''');
end $$;
notify pgrst,'reload schema';
commit;
