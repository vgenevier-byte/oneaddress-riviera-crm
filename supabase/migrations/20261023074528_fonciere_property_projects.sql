-- Additive property catalogue. izord_projects remains the immutable-versioned
-- presentation store; existing memberships, scopes and documents are untouched.
begin;

create table public.fonciere_projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 title text not null check(length(btrim(title)) between 1 and 200), revision integer not null default 1 check(revision>0),
 status text not null default 'active' check(status in ('active','archived')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=1048576),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index fonciere_projects_owner on public.fonciere_projects(owner_id);
create table public.fonciere_project_assignments (
 project_id uuid not null references public.fonciere_projects(id), user_id uuid not null references auth.users(id), primary key(project_id,user_id)
);
create index fonciere_assignments_user on public.fonciere_project_assignments(user_id,project_id);
-- Contacts live in the canonical CRM JSON. Keep only the actual CRM identity,
-- separately protected by Contacts permission rather than leaking it in payloads.
create table public.fonciere_project_contacts (
 project_id uuid primary key references public.fonciere_projects(id), contact_id text not null check(length(contact_id) between 1 and 180)
);
create table public.fonciere_assets (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.fonciere_projects(id),
 object_path text not null unique, kind text not null check(kind in ('pdf','photo','attachment')),
 lifecycle text not null default 'pending' check(lifecycle in ('pending','finalized','withdrawn')),
 expected_size bigint not null check(expected_size between 1 and 25000000), expected_mime text not null,
 original_name text not null check(length(original_name) between 1 and 180),
 storage_object_id uuid, storage_object_version text, finalized_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 check(object_path=project_id::text||'/'||id::text),
 check((lifecycle='finalized')=(finalized_at is not null and storage_object_id is not null and storage_object_version is not null)),
 unique(project_id,id)
);
create index fonciere_assets_project on public.fonciere_assets(project_id);
create index fonciere_assets_creator on public.fonciere_assets(created_by);

create function app_private.can_fonciere_project(p_id uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.module_allowed('izord',p_write) and
 app_private.has_membership('izord',case when p_write then array['admin','partner','contributor'] else null end)
 and exists(select 1 from public.fonciere_projects p where p.id=p_id and (
 app_private.has_membership('izord',array['admin','partner']) or
 (p.owner_id=auth.uid() and app_private.has_membership('izord',array['contributor'])) or
 exists(select 1 from public.fonciere_project_assignments a where a.project_id=p.id and a.user_id=auth.uid())));
$$;
create function app_private.can_fonciere_asset(p_path text,p_write boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.fonciere_assets a join public.fonciere_projects p on p.id=a.project_id
 where a.object_path=p_path and app_private.can_fonciere_project(a.project_id,p_write) and
 case when p_write then a.lifecycle='pending' and a.created_by=auth.uid() and p.status='active'
 else a.lifecycle='finalized' or a.lifecycle='pending' and a.created_by=auth.uid() end);
$$;
revoke all on function app_private.can_fonciere_project(uuid,boolean),app_private.can_fonciere_asset(text,boolean) from public,anon,authenticated;
grant execute on function app_private.can_fonciere_project(uuid,boolean),app_private.can_fonciere_asset(text,boolean) to authenticated;

do $$ declare t text; begin
 foreach t in array array['fonciere_projects','fonciere_project_assignments','fonciere_project_contacts','fonciere_assets'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy fonciere_project_read on public.fonciere_projects for select to authenticated using(app_private.can_fonciere_project(id));
create policy fonciere_assignment_read on public.fonciere_project_assignments for select to authenticated using(app_private.can_fonciere_project(project_id));
create policy fonciere_contact_read on public.fonciere_project_contacts for select to authenticated using(app_private.can_fonciere_project(project_id) and app_private.module_allowed('contacts'));
create policy fonciere_asset_read on public.fonciere_assets for select to authenticated using(app_private.can_fonciere_asset(object_path));

-- FK semantics for the existing JSON contact store: an actively linked canonical
-- identity cannot silently disappear through a full-state save or Contacts RPC.
create function app_private.guard_fonciere_contact_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.workspace_id='oneaddress-riviera' and old.payload->'contacts' is distinct from new.payload->'contacts' and exists(
 select 1 from public.fonciere_project_contacts f where not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'contacts','[]')) c where c->>'id'=f.contact_id))
 then raise exception 'fonciere_linked_contact_requires_unlink' using errcode='23503'; end if;
 return new;
end $$;
revoke all on function app_private.guard_fonciere_contact_identity() from public,anon,authenticated;
create trigger fonciere_contact_identity before update on public.crm_workspace_state for each row execute function app_private.guard_fonciere_contact_identity();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('fonciere-documents','fonciere-documents',false,25000000,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy fonciere_storage_read on storage.objects for select to authenticated using(bucket_id='fonciere-documents' and app_private.can_fonciere_asset(name));
create policy fonciere_storage_insert on storage.objects for insert to authenticated with check(bucket_id='fonciere-documents' and app_private.can_fonciere_asset(name,true));
-- A restrictive boundary also protects against older broad permissive policies.
create policy fonciere_storage_boundary on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'fonciere-documents' or app_private.can_fonciere_asset(name))
 with check(bucket_id<>'fonciere-documents' or app_private.can_fonciere_asset(name,true));
create function app_private.guard_fonciere_storage() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.fonciere_assets%rowtype;
begin
 if tg_op='DELETE' then
  if old.bucket_id='fonciere-documents' then raise exception 'fonciere_logical_withdrawal_required' using errcode='42501'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.bucket_id='fonciere-documents' and (new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name) then raise exception 'fonciere_immutable_path' using errcode='42501'; end if;
 if new.bucket_id<>'fonciere-documents' then return new; end if;
 select * into a from public.fonciere_assets where object_path=new.name;
 if not found or a.lifecycle<>'pending' or not exists(select 1 from public.fonciere_projects where id=a.project_id and status='active') then raise exception 'fonciere_immutable_asset' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function app_private.guard_fonciere_storage() from public,anon,authenticated;
create trigger fonciere_storage_lifecycle before insert or update or delete on storage.objects for each row execute function app_private.guard_fonciere_storage();

create function app_private.validate_fonciere_payload(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare k text; v jsonb; a text; r text; allowed text[]:=array[
 'name','propertyType','agencyReference','propertyAddress','city','postalCode','location',
 'agencyName','agencyAddress','agencyPhone','agencyEmail','agentName','agentPhone','agentEmail',
 'askingPrice','fees','area','areaKind','land','rooms','bedrooms','condition','equipment','annexes','exterior','pool','view',
 'description','agencyPotential','renovation','division','extension','resale','rental','pointsOfInterest','pointsToVerify',
 'diagnostics','charges','constraints','worksHypothesis','resaleHypothesis','rentalHypothesis','notes'];
begin
 if p_payload->>'schema' is distinct from 'FONCIERE_PROPERTY_V1' or jsonb_typeof(p_payload->'data') is distinct from 'object'
 or jsonb_typeof(p_payload->'sourceDocuments') is distinct from 'array' or jsonb_array_length(p_payload->'sourceDocuments')>30
 or octet_length(p_payload::text)>1048576 then raise exception 'invalid_fonciere_payload' using errcode='22023'; end if;
 for k,v in select key,value from jsonb_each(p_payload->'data') loop
  if k=any(allowed) then
   if jsonb_typeof(v)<>'string' or length(v#>>'{}')>(case when k='name' then 200 else 12000 end) then raise exception 'invalid_fonciere_field' using errcode='22023'; end if;
  elsif k not in ('presentationData','provenance') then raise exception 'unknown_fonciere_field' using errcode='22023'; end if;
 end loop;
 if length(btrim(coalesce(p_payload->'data'->>'name',''))) not between 1 and 200
 or jsonb_typeof(p_payload->'data'->'provenance') is distinct from 'array' or jsonb_array_length(p_payload->'data'->'provenance')>30
 or jsonb_typeof(p_payload->'data'->'presentationData'->'state') is distinct from 'object'
 or jsonb_typeof(p_payload->'data'->'presentationData'->'photos') is distinct from 'object'
 or jsonb_typeof(p_payload->'data'->'presentationData'->'importGallery') is distinct from 'array'
 or jsonb_array_length(p_payload->'data'->'presentationData'->'importGallery')>480 then raise exception 'invalid_fonciere_data' using errcode='22023'; end if;
 -- Every persisted image/document is an immutable asset of this exact property.
 for a,r in
 select value,'photo' from jsonb_each_text(p_payload->'data'->'presentationData'->'photos')
 union all select value->>'data','photo' from jsonb_array_elements(p_payload->'data'->'presentationData'->'importGallery')
 union all select value#>>'{}','source' from jsonb_array_elements(p_payload->'sourceDocuments') loop
  if a='' and r='photo' then continue; end if;
  if a is null or a !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists(
   select 1 from public.fonciere_assets x where x.id::text=a and x.project_id=p_id and x.lifecycle='finalized'
   and (r='photo' and x.kind='photo' or r='source' and x.kind in ('pdf','attachment')) and app_private.can_fonciere_asset(x.object_path))
   then raise exception 'forbidden_fonciere_asset_reference' using errcode='42501'; end if;
 end loop;
end $$;
revoke all on function app_private.validate_fonciere_payload(uuid,jsonb) from public,anon,authenticated;

create function app_private.save_fonciere_project(p_id uuid,p_expected_revision integer,p_payload jsonb,p_contact text default null) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype; v_id uuid:=coalesce(p_id,gen_random_uuid());
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
 if coalesce(p_contact,'')<>'' and (not app_private.module_allowed('contacts') or not exists(
  select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) c
  where w.workspace_id='oneaddress-riviera' and c->>'id'=p_contact)) then raise exception 'fonciere_contact_forbidden' using errcode='42501'; end if;
 -- Serialize canonical contact verification with the CRM mutation row lock.
 if p_contact is not null and app_private.module_allowed('contacts') then
  perform 1 from public.crm_workspace_state where workspace_id='oneaddress-riviera' for share;
  if p_contact<>'' and not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) c where w.workspace_id='oneaddress-riviera' and c->>'id'=p_contact) then raise exception 'fonciere_contact_missing' using errcode='42501'; end if;
 end if;
 if p_id is null then insert into public.fonciere_projects(id,owner_id,title,payload) values(v_id,auth.uid(),p_payload->'data'->>'name',p_payload);
 else update public.fonciere_projects set title=p_payload->'data'->>'name',payload=p_payload,revision=revision+1,updated_at=clock_timestamp() where id=p_id; end if;
 if p_contact is not null and app_private.module_allowed('contacts') then
  if p_contact='' then delete from public.fonciere_project_contacts where project_id=v_id;
  else insert into public.fonciere_project_contacts values(v_id,p_contact) on conflict(project_id) do update set contact_id=excluded.contact_id; end if;
 end if;
 return v_id;
end $$;

create function app_private.archive_fonciere_project(p_id uuid,p_expected_revision integer,p_archived boolean) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.can_fonciere_project(p_id,true) or p_archived is null then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 select * into strict p from public.fonciere_projects where id=p_id for update;
 if p.revision is distinct from p_expected_revision then raise exception 'fonciere_revision_conflict' using errcode='40001'; end if;
 update public.fonciere_projects set status=case when p_archived then 'archived' else 'active' end,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning revision into p.revision;
 return p.revision;
end $$;

create function app_private.register_fonciere_asset(p_project uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid:=gen_random_uuid(); v_path text:=p_project::text||'/'||v_id::text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.can_fonciere_project(p_project,true) or not exists(select 1 from public.fonciere_projects where id=p_project and revision=p_revision and status='active') then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 if p_size is null or p_size not between 1 and 25000000 or p_name is null or length(p_name) not between 1 and 180 or p_name ~ '[[:cntrl:]/\\]' or not(
 p_kind='pdf' and p_mime='application/pdf' or p_kind='photo' and p_mime in ('image/jpeg','image/png') or p_kind='attachment' and p_mime in ('image/jpeg','image/png','image/webp')) then raise exception 'invalid_fonciere_upload' using errcode='22023'; end if;
 insert into public.fonciere_assets(id,project_id,object_path,kind,expected_size,expected_mime,original_name,created_by) values(v_id,p_project,v_path,p_kind,p_size,p_mime,p_name,auth.uid());
 return v_path;
end $$;
create function app_private.finalize_fonciere_asset(p_asset uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.fonciere_assets%rowtype; o storage.objects%rowtype;
begin
 perform pg_advisory_xact_lock_shared(734991);
 select * into a from public.fonciere_assets where id=p_asset for update;
 if not found or a.created_by<>auth.uid() or not app_private.can_fonciere_project(a.project_id,true) or not exists(select 1 from public.fonciere_projects where id=a.project_id and status='active') then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 if a.lifecycle='finalized' then return; end if;
 if a.lifecycle<>'pending' then raise exception 'fonciere_asset_withdrawn' using errcode='42501'; end if;
 select * into o from storage.objects where bucket_id='fonciere-documents' and name=a.object_path for share;
 if not found or coalesce((o.metadata->>'size')::bigint,0)<>a.expected_size or o.metadata->>'mimetype' is distinct from a.expected_mime or o.version is null then raise exception 'fonciere_upload_unconfirmed' using errcode='23514'; end if;
 update public.fonciere_assets set lifecycle='finalized',storage_object_id=o.id,storage_object_version=o.version,finalized_at=clock_timestamp() where id=p_asset;
end $$;

create function app_private.assign_fonciere_project(p_project uuid,p_user uuid,p_assigned boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.can_fonciere_project(p_project,true) or not app_private.has_membership('izord',array['admin','partner']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 if p_assigned then
  if not exists(select 1 from public.app_memberships where user_id=p_user and workspace_id='izord' and status='active') then raise exception 'fonciere_member_required' using errcode='42501'; end if;
  insert into public.fonciere_project_assignments values(p_project,p_user) on conflict do nothing;
 else delete from public.fonciere_project_assignments where project_id=p_project and user_id=p_user; end if;
end $$;

create function app_private.fonciere_access_options(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.can_fonciere_project(p_project,true) or not app_private.has_membership('izord',array['admin','partner']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'email',coalesce(u.email,''),'role',m.role,
 'assigned',exists(select 1 from public.fonciere_project_assignments a where a.project_id=p_project and a.user_id=m.user_id),
 'inherited',m.role in ('admin','partner') or m.role='contributor' and exists(select 1 from public.fonciere_projects p where p.id=p_project and p.owner_id=m.user_id)) order by lower(coalesce(u.email,'')))
 from public.app_memberships m join auth.users u on u.id=m.user_id where m.workspace_id='izord' and m.status='active'),'[]'::jsonb);
end $$;
revoke all on function app_private.fonciere_access_options(uuid) from public,anon,authenticated;
grant execute on function app_private.fonciere_access_options(uuid) to authenticated;
create function public.fonciere_access_options(p_project uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select app_private.fonciere_access_options(p_project); $$;
revoke all on function public.fonciere_access_options(uuid) from public,anon,authenticated;
grant execute on function public.fonciere_access_options(uuid) to authenticated;

create function public.fonciere_save_project(p_id uuid,p_expected_revision integer,p_payload jsonb,p_contact text default null) returns uuid language sql security invoker set search_path=pg_catalog as $$ select app_private.save_fonciere_project(p_id,p_expected_revision,p_payload,p_contact); $$;
create function public.fonciere_archive_project(p_id uuid,p_expected_revision integer,p_archived boolean) returns integer language sql security invoker set search_path=pg_catalog as $$ select app_private.archive_fonciere_project(p_id,p_expected_revision,p_archived); $$;
create function public.fonciere_register_asset(p_project uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text) returns text language sql security invoker set search_path=pg_catalog as $$ select app_private.register_fonciere_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name); $$;
create function public.fonciere_finalize_asset(p_asset uuid) returns void language sql security invoker set search_path=pg_catalog as $$ select app_private.finalize_fonciere_asset(p_asset); $$;
create function public.fonciere_assign_project(p_project uuid,p_user uuid,p_assigned boolean) returns void language sql security invoker set search_path=pg_catalog as $$ select app_private.assign_fonciere_project(p_project,p_user,p_assigned); $$;

revoke all on function app_private.save_fonciere_project(uuid,integer,jsonb,text),app_private.archive_fonciere_project(uuid,integer,boolean),app_private.register_fonciere_asset(uuid,integer,text,bigint,text,text),app_private.finalize_fonciere_asset(uuid),app_private.assign_fonciere_project(uuid,uuid,boolean),
 public.fonciere_save_project(uuid,integer,jsonb,text),public.fonciere_archive_project(uuid,integer,boolean),public.fonciere_register_asset(uuid,integer,text,bigint,text,text),public.fonciere_finalize_asset(uuid),public.fonciere_assign_project(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.save_fonciere_project(uuid,integer,jsonb,text),app_private.archive_fonciere_project(uuid,integer,boolean),app_private.register_fonciere_asset(uuid,integer,text,bigint,text,text),app_private.finalize_fonciere_asset(uuid),app_private.assign_fonciere_project(uuid,uuid,boolean),
 public.fonciere_save_project(uuid,integer,jsonb,text),public.fonciere_archive_project(uuid,integer,boolean),public.fonciere_register_asset(uuid,integer,text,bigint,text,text),public.fonciere_finalize_asset(uuid),public.fonciere_assign_project(uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
