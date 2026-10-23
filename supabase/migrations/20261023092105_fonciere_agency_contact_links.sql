-- Add a second canonical CRM identity, behind the existing Contacts RLS.
-- Existing agent links, public payloads and old save-call signatures survive.
begin;
alter table public.fonciere_project_contacts drop constraint fonciere_project_contacts_contact_id_check;
alter table public.fonciere_project_contacts alter column contact_id set default '';
alter table public.fonciere_project_contacts add constraint fonciere_project_contact_length check(length(contact_id) between 0 and 180);
alter table public.fonciere_project_contacts add column agency_contact_id text not null default '' check(length(agency_contact_id) between 0 and 180);
alter table public.fonciere_project_contacts add constraint fonciere_project_contact_present check(contact_id<>'' or agency_contact_id<>'');

create or replace function app_private.guard_fonciere_contact_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.workspace_id='oneaddress-riviera' and old.payload->'contacts' is distinct from new.payload->'contacts' and exists(
 select 1 from public.fonciere_project_contacts f cross join lateral unnest(array[f.contact_id,f.agency_contact_id]) link(id)
 where link.id<>'' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'contacts','[]')) c where c->>'id'=link.id))
 then raise exception 'fonciere_linked_contact_requires_unlink' using errcode='23503'; end if;
 return new;
end $$;
revoke all on function app_private.guard_fonciere_contact_identity() from public,anon,authenticated;

create function app_private.save_fonciere_project(p_id uuid,p_expected_revision integer,p_payload jsonb,p_contact text,p_agency_contact text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype; v_id uuid:=coalesce(p_id,gen_random_uuid()); agent text; agency text; link text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_id is null then
  if auth.uid() is null or not app_private.module_allowed('izord',true) or not app_private.has_membership('izord',array['admin','partner','contributor']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 else
  if not app_private.can_fonciere_project(p_id,true) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
  select * into strict p from public.fonciere_projects where id=p_id for update;
  if p.revision is distinct from p_expected_revision then raise exception 'fonciere_revision_conflict' using errcode='40001'; end if;
  if p.status<>'active' then raise exception 'fonciere_archived' using errcode='42501'; end if;
 end if;
 perform app_private.validate_fonciere_payload(v_id,p_payload);
 if not app_private.module_allowed('contacts') then
  if coalesce(p_contact,'')<>'' or coalesce(p_agency_contact,'')<>'' then raise exception 'fonciere_contact_forbidden' using errcode='42501'; end if;
  -- Empty client projections must never remove links that the caller cannot see.
 else
  select contact_id,agency_contact_id into agent,agency from public.fonciere_project_contacts where project_id=v_id;
  agent:=coalesce(p_contact,agent,''); agency:=coalesce(p_agency_contact,agency,'');
  perform 1 from public.crm_workspace_state where workspace_id='oneaddress-riviera' for share;
  foreach link in array array[agent,agency] loop
   if length(link)>180 or link<>'' and not exists(select 1 from public.crm_workspace_state w
    cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) c
    where w.workspace_id='oneaddress-riviera' and c->>'id'=link)
   then raise exception 'fonciere_contact_missing' using errcode='42501'; end if;
  end loop;
  if agency<>'' and not exists(select 1 from public.crm_workspace_state w
   cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) c
   where w.workspace_id='oneaddress-riviera' and c->>'id'=agency and c->>'entityType'='company')
  then raise exception 'fonciere_agency_company_required' using errcode='22023'; end if;
 end if;
 if p_id is null then insert into public.fonciere_projects(id,owner_id,title,payload) values(v_id,auth.uid(),p_payload->'data'->>'name',p_payload);
 else update public.fonciere_projects set title=p_payload->'data'->>'name',payload=p_payload,revision=revision+1,updated_at=clock_timestamp() where id=p_id; end if;
 if app_private.module_allowed('contacts') then
  if agent='' and agency='' then delete from public.fonciere_project_contacts where project_id=v_id;
  else insert into public.fonciere_project_contacts(project_id,contact_id,agency_contact_id) values(v_id,agent,agency)
   on conflict(project_id) do update set contact_id=excluded.contact_id,agency_contact_id=excluded.agency_contact_id; end if;
 end if;
 return v_id;
end $$;

-- Preserve the original four-argument API; omission preserves the agency link.
create or replace function app_private.save_fonciere_project(p_id uuid,p_expected_revision integer,p_payload jsonb,p_contact text default null) returns uuid
language sql security invoker set search_path=pg_catalog as $$ select app_private.save_fonciere_project(p_id,p_expected_revision,p_payload,p_contact,null); $$;
create function public.fonciere_save_project(p_id uuid,p_expected_revision integer,p_payload jsonb,p_contact text,p_agency_contact text) returns uuid
language sql security invoker set search_path=pg_catalog as $$ select app_private.save_fonciere_project(p_id,p_expected_revision,p_payload,p_contact,p_agency_contact); $$;
revoke all on function app_private.save_fonciere_project(uuid,integer,jsonb,text,text),public.fonciere_save_project(uuid,integer,jsonb,text,text) from public,anon,authenticated;
grant execute on function app_private.save_fonciere_project(uuid,integer,jsonb,text,text),public.fonciere_save_project(uuid,integer,jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
