-- Bind each new creation key to its complete initial request. Existing project
-- identities, references, payloads, permissions, Drive configuration and jobs stay untouched.
begin;
create table app_private.fonciere_creation_intents (
 creation_key uuid primary key,
 project_id uuid not null unique references public.fonciere_projects(id),
 owner_id uuid not null references auth.users(id),
 initial_payload jsonb not null check(jsonb_typeof(initial_payload)='object' and octet_length(initial_payload::text)<=1048576),
 contact_id text not null, agency_contact_id text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table app_private.fonciere_creation_intents enable row level security;
revoke all on app_private.fonciere_creation_intents from public,anon,authenticated,service_role;
create function app_private.guard_fonciere_creation_intent() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 raise exception 'immutable_fonciere_creation_intent' using errcode='42501';
end $$;
revoke all on function app_private.guard_fonciere_creation_intent() from public,anon,authenticated,service_role;
create trigger fonciere_creation_intent_immutable before update or delete on app_private.fonciere_creation_intents
 for each row execute function app_private.guard_fonciere_creation_intent();

create or replace function app_private.create_fonciere_project(p_creation_key uuid,p_payload jsonb,p_contact text,p_agency_contact text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare existing public.fonciere_projects%rowtype; binding app_private.fonciere_creation_intents%rowtype; identity uuid;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if auth.uid() is null or not app_private.module_allowed('fonciere',true) or not app_private.workspace_role('izord',array['admin','partner','contributor']) then
  raise exception 'fonciere_forbidden' using errcode='42501';
 end if;
 if p_creation_key is null then raise exception 'creation_key_required' using errcode='22023';end if;
 if jsonb_typeof(p_payload->'creationIntentHash') is distinct from 'string'
  or coalesce(p_payload->>'creationIntentHash','') !~ '^[0-9a-f]{64}$' then
  raise exception 'creation_intent_hash_required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('fonciere-create:'||p_creation_key::text,0));
 select * into existing from public.fonciere_projects where creation_key=p_creation_key;
 if found then
  -- Check current ownership/scope before returning any canonical identity in an error.
  if existing.owner_id<>auth.uid() or not app_private.can_fonciere_project(existing.id,true) then
   raise exception 'fonciere_forbidden' using errcode='42501';
  end if;
  select * into binding from app_private.fonciere_creation_intents where creation_key=p_creation_key;
  if not found or binding.project_id<>existing.id or binding.owner_id<>auth.uid() then
   -- Older keys have no trustworthy initial-request ledger. Never guess or rebind them.
   raise exception 'fonciere_creation_reconciliation_required' using errcode='40001',
    detail=jsonb_build_object('projectId',existing.id,'projectReference',existing.project_reference,'revision',existing.revision)::text;
  end if;
  -- JSONB equality compares the server-observed payload, independently of the
  -- caller's digest of photos/files that are transferred only after creation.
  if binding.initial_payload is distinct from p_payload
   or binding.contact_id is distinct from coalesce(p_contact,'')
   or binding.agency_contact_id is distinct from coalesce(p_agency_contact,'') then
   raise exception 'fonciere_creation_intent_conflict' using errcode='40001',
    detail=jsonb_build_object('projectId',existing.id,'projectReference',existing.project_reference,'revision',existing.revision)::text;
  end if;
  return existing.id;
 end if;
 perform set_config('app.fonciere_creation_key',p_creation_key::text,true);
 identity:=app_private.save_fonciere_project(null,null,p_payload,p_contact,p_agency_contact);
 perform set_config('app.fonciere_creation_key','',true);
 insert into app_private.fonciere_creation_intents(creation_key,project_id,owner_id,initial_payload,contact_id,agency_contact_id)
  values(p_creation_key,identity,auth.uid(),p_payload,coalesce(p_contact,''),coalesce(p_agency_contact,''));
 return identity;
end $$;
revoke all on function app_private.create_fonciere_project(uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function app_private.create_fonciere_project(uuid,jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
