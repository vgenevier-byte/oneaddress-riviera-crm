-- LOT 1: proposal for review. NEVER applied remotely by the test harness.
-- No automatic bootstrap: the reviewed Auth UUID allowlist is a separate operation.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table public.app_memberships (
  user_id uuid not null references auth.users(id),
  workspace_id text not null check (workspace_id in ('oar','izord')),
  role text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, workspace_id),
  check ((workspace_id='oar' and role='member') or
    (workspace_id='izord' and role in ('admin','partner','contributor','reader')))
);
alter table public.app_memberships enable row level security;
revoke all on public.app_memberships from public, anon, authenticated;
grant select on public.app_memberships to authenticated;
create policy memberships_self on public.app_memberships for select to authenticated using (user_id=(select auth.uid()));

-- Narrow non-recursive lookup, never using client-editable claims or an actor name.
create function app_private.has_membership(p_space text, p_roles text[] default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_memberships m where m.user_id=auth.uid()
      and m.workspace_id=p_space and m.status='active'
      and (p_roles is null or m.role=any(p_roles))
  );
$$;
revoke all on function app_private.has_membership(text,text[]) from public, anon, authenticated;
grant execute on function app_private.has_membership(text,text[]) to authenticated;

-- RESTRICTIVE policies AND with all existing permissive owner/workspace policies.
-- This preserves historical row scopes while closing every authenticated bypass.
-- Explicit list: a missing expected table fails the transaction rather than silently skipping it.
do $$ declare t text; begin
  foreach t in array array['crm_leads','crm_tasks','crm_properties','crm_vehicles','crm_boats','crm_quotes','crm_contacts','crm_backups','crm_workspace_state'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    if t='crm_workspace_state' then
      execute format('grant select,insert,update on public.%I to authenticated',t);
    elsif t='crm_backups' then
      execute format('grant select,insert on public.%I to authenticated',t);
    else
      execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    end if;
    execute format('create policy oar_membership_required on public.%I as restrictive for all to authenticated using (app_private.has_membership(''oar'')) with check (app_private.has_membership(''oar''))',t);
  end loop;
end $$;

-- Never let the client impersonate the author of an OAR shared-state write.
create function app_private.stamp_oar_author() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  -- Server-issued compare-and-set revision for the shared payload; never trust a client timestamp.
  if tg_op='UPDATE' then new.updated_at := greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  else new.updated_at := clock_timestamp(); end if;
  return new;
end;
$$;
revoke all on function app_private.stamp_oar_author() from public, anon, authenticated;
create trigger oar_verified_author before insert or update on public.crm_workspace_state
for each row execute function app_private.stamp_oar_author();

create policy oar_documents_membership_required on storage.objects as restrictive
for all to authenticated
using (bucket_id <> 'crm-documents' or app_private.has_membership('oar'))
with check (bucket_id <> 'crm-documents' or app_private.has_membership('oar'));

create table public.izord_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null check (length(title) between 1 and 200),
  revision integer not null default 1 check (revision>0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=1048576),
  status text not null default 'draft' check (status in ('draft','review','approved')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.izord_project_assignments (
  project_id uuid not null references public.izord_projects(id),
  user_id uuid not null references auth.users(id),
  primary key(project_id,user_id)
);
create index izord_assignments_user on public.izord_project_assignments(user_id,project_id);
create table public.izord_project_versions (
  project_id uuid not null references public.izord_projects(id),
  revision integer not null,
  title text not null,
  payload jsonb not null,
  status text not null,
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,revision)
);
create table public.izord_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  project_revision integer not null,
  kind text not null check (kind in ('pdf','photo','presentation')),
  object_path text not null unique,
  reader_download boolean not null default false,
  lifecycle text not null default 'pending' check (lifecycle in ('pending','finalized','withdrawn')),
  storage_object_id uuid,
  storage_object_version text,
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(project_id,project_revision) references public.izord_project_versions(project_id,revision),
  check (object_path=project_id::text || '/' || id::text),
  check (not reader_download or (kind='presentation' and lifecycle='finalized')),
  check ((lifecycle='pending' and finalized_at is null and finalized_by is null and storage_object_id is null and storage_object_version is null)
    or (lifecycle in ('finalized','withdrawn') and ((finalized_at is not null and finalized_by is not null and storage_object_id is not null and storage_object_version is not null)
      or (lifecycle='withdrawn' and finalized_at is null and finalized_by is null and storage_object_id is null and storage_object_version is null)))),
  check ((lifecycle='withdrawn')=(withdrawn_at is not null and withdrawn_by is not null))
);
create table public.izord_access_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  action text not null,
  subject_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create table public.izord_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email=lower(btrim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('admin','partner','contributor','reader')),
  token_hash bytea not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index izord_projects_owner on public.izord_projects(owner_id);
create index izord_invitations_creator on public.izord_invitations(created_by);

create function app_private.can_project(p_id uuid, p_write boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.has_membership('izord', case when p_write then array['admin','partner','contributor'] else null end)
 and exists (select 1 from public.izord_projects p where p.id=p_id and
   (app_private.has_membership('izord',array['admin','partner'])
    or (p.owner_id=auth.uid() and app_private.has_membership('izord',array['contributor']))
    or exists (select 1 from public.izord_project_assignments a where a.project_id=p.id and a.user_id=auth.uid())));
$$;
-- Uploads/finalization target the current unapproved project revision only.
create function app_private.can_document_write(p_id uuid,p_revision integer) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.can_project(p_id,true) and exists(select 1 from public.izord_projects p
  where p.id=p_id and p.revision=p_revision and p.status<>'approved');
$$;
create function app_private.can_asset(p_path text, p_write boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.izord_assets a where a.object_path=p_path and
  case when p_write then a.lifecycle='pending' and a.created_by=auth.uid() and app_private.can_document_write(a.project_id,a.project_revision)
  else (a.lifecycle='pending' and a.created_by=auth.uid() and app_private.can_document_write(a.project_id,a.project_revision))
   or (a.lifecycle='finalized' and app_private.can_project(a.project_id)
    and (not app_private.has_membership('izord',array['reader']) or (a.kind='presentation' and a.reader_download))) end);
$$;
revoke all on function app_private.can_project(uuid,boolean), app_private.can_document_write(uuid,integer), app_private.can_asset(text,boolean) from public,anon,authenticated;
grant execute on function app_private.can_project(uuid,boolean), app_private.can_document_write(uuid,integer), app_private.can_asset(text,boolean) to authenticated;

-- Signed-upload capabilities run as Storage's superuser and bypass RLS. Keep the
-- immutable-path invariant at the row mutation boundary too. This guard does not
-- write Storage metadata; Storage API remains its sole writer. It only rejects
-- mutations of finalized/withdrawn content, including previously signed upserts.
create function app_private.guard_izord_storage_lifecycle() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare v_path text; v_state text;
begin
 if tg_op='DELETE' then
  if old.bucket_id<>'izord-documents' then return old; end if;
  raise exception 'izord_use_logical_withdrawal' using errcode='42501';
 end if;
 if tg_op='UPDATE' and old.bucket_id='izord-documents' then
  if new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
   raise exception 'izord_immutable_path' using errcode='42501';
  end if;
 end if;
 if new.bucket_id<>'izord-documents' then return new; end if;
 v_path:=new.name;
 select lifecycle into v_state from public.izord_assets where object_path=v_path for update;
 if not found or v_state<>'pending' then raise exception 'izord_immutable_document' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function app_private.guard_izord_storage_lifecycle() from public,anon,authenticated;
create trigger izord_document_lifecycle before insert or update or delete on storage.objects
for each row execute function app_private.guard_izord_storage_lifecycle();

do $$ declare t text; begin
 foreach t in array array['izord_projects','izord_project_assignments','izord_project_versions','izord_assets','izord_access_events','izord_invitations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
grant select on public.izord_projects,public.izord_project_assignments,public.izord_project_versions,public.izord_assets,public.izord_access_events to authenticated;
-- Invitation tokens/hashes are never selectable by client roles.
create policy project_read on public.izord_projects for select to authenticated using (app_private.can_project(id));
create policy assignment_read on public.izord_project_assignments for select to authenticated using (user_id=auth.uid() and app_private.can_project(project_id) or app_private.has_membership('izord',array['admin']));
create policy version_read on public.izord_project_versions for select to authenticated using (app_private.can_project(project_id));
create policy asset_read on public.izord_assets for select to authenticated using (app_private.can_asset(object_path));
create policy audit_admin_read on public.izord_access_events for select to authenticated using (app_private.has_membership('izord',array['admin']));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('izord-documents','izord-documents',false,26214400,array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
create policy izord_storage_read on storage.objects for select to authenticated using (bucket_id='izord-documents' and app_private.can_asset(name));
create policy izord_storage_insert on storage.objects for insert to authenticated with check (bucket_id='izord-documents' and app_private.can_asset(name,true));
-- Documents are retired by RPC; no authenticated physical deletion or path reuse.
-- Restrictive boundaries also cover unrelated/future permissive bucket policies.
create policy izord_storage_read_boundary on storage.objects as restrictive for select to authenticated using (bucket_id<>'izord-documents' or app_private.can_asset(name));
create policy izord_storage_insert_boundary on storage.objects as restrictive for insert to authenticated with check (bucket_id<>'izord-documents' or app_private.can_asset(name,true));
create policy izord_storage_delete_boundary on storage.objects as restrictive for delete to authenticated using (bucket_id<>'izord-documents');
create policy izord_storage_no_update on storage.objects as restrictive for update to authenticated using (bucket_id<>'izord-documents') with check (bucket_id<>'izord-documents');

-- Mutation implementations live outside exposed schemas. Public wrappers are INVOKER.
create function app_private.create_project(p_title text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid;
begin
 if not app_private.has_membership('izord',array['admin','partner','contributor']) then raise exception 'forbidden' using errcode='42501'; end if;
 insert into public.izord_projects(owner_id,title) values(auth.uid(),btrim(p_title)) returning id into v_id;
 insert into public.izord_project_versions(project_id,revision,title,payload,status,author_id)
 select id,revision,title,payload,status,auth.uid() from public.izord_projects where id=v_id;
 return v_id;
end $$;
create function app_private.save_project(p_id uuid,p_expected_revision integer,p_title text,p_payload jsonb,p_status text) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.izord_projects%rowtype;
begin
 if not app_private.can_project(p_id,true) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into strict p from public.izord_projects where id=p_id for update;
 if p.revision is distinct from p_expected_revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 if p_status is null or p_status not in ('draft','review','approved') then raise exception 'invalid_status' using errcode='22023'; end if;
 if (p_status='approved' or p.status='approved') and not app_private.has_membership('izord',array['admin','partner']) then raise exception 'approval_forbidden' using errcode='42501'; end if;
 update public.izord_projects set title=btrim(p_title),payload=p_payload,status=p_status,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into p;
 insert into public.izord_project_versions(project_id,revision,title,payload,status,author_id) values(p.id,p.revision,p.title,p.payload,p.status,auth.uid());
 return p.revision;
end $$;
create function app_private.register_asset(p_project uuid,p_revision integer,p_kind text) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid := gen_random_uuid(); v_path text;
begin
 perform pg_advisory_xact_lock(734991);
 perform 1 from public.izord_projects where id=p_project for update;
 if not app_private.can_document_write(p_project,p_revision) then raise exception 'forbidden_document_revision' using errcode='42501'; end if;
 v_path := p_project::text || '/' || v_id::text;
 insert into public.izord_assets(id,project_id,project_revision,kind,object_path,created_by) values(v_id,p_project,p_revision,p_kind,v_path,auth.uid());
 return v_path;
end $$;
create function app_private.finalize_asset(p_asset uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.izord_assets%rowtype; o record;
begin
 perform pg_advisory_xact_lock(734991);
 select * into a from public.izord_assets where id=p_asset;
 if not found then raise exception 'forbidden_document' using errcode='42501'; end if;
 perform 1 from public.izord_projects where id=a.project_id for update;
 -- Lock order: project then asset. The Storage trigger locks only the asset;
 -- reading the completed Storage row needs no second lock and cannot deadlock it.
 select * into a from public.izord_assets where id=p_asset for update;
 if a.lifecycle<>'pending' or not app_private.can_document_write(a.project_id,a.project_revision)
  or (a.created_by<>auth.uid() and not app_private.has_membership('izord',array['admin','partner'])) then
  raise exception 'forbidden_document_finalization' using errcode='42501'; end if;
 select id,version,metadata into o from storage.objects where bucket_id='izord-documents' and name=a.object_path;
 if not found or o.version is null or coalesce((o.metadata->>'size')::bigint,0)<=0 then
  raise exception 'document_upload_incomplete' using errcode='23514'; end if;
 update public.izord_assets set lifecycle='finalized',storage_object_id=o.id,storage_object_version=o.version,
  finalized_at=clock_timestamp(),finalized_by=auth.uid(),reader_download=false where id=a.id;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'finalize_document',a.id);
end $$;
create function app_private.withdraw_asset(p_asset uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.izord_assets%rowtype;
begin
 perform pg_advisory_xact_lock(734991);
 select * into a from public.izord_assets where id=p_asset for update;
 if not found or a.lifecycle='withdrawn' or not
  (app_private.has_membership('izord',array['admin','partner']) or
   (a.lifecycle='pending' and a.created_by=auth.uid() and app_private.can_document_write(a.project_id,a.project_revision))) then
  raise exception 'forbidden_document_withdrawal' using errcode='42501'; end if;
 update public.izord_assets set lifecycle='withdrawn',reader_download=false,withdrawn_at=clock_timestamp(),withdrawn_by=auth.uid() where id=a.id;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'withdraw_document',a.id);
end $$;
create function app_private.allow_reader_download(p_asset uuid,p_allowed boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin','partner']) then raise exception 'forbidden' using errcode='42501'; end if;
 update public.izord_assets set reader_download=p_allowed where id=p_asset and kind='presentation' and lifecycle='finalized';
 if not found then raise exception 'invalid_or_unfinalized_asset'; end if;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),case when p_allowed then 'allow_download' else 'deny_download' end,p_asset);
end $$;
create function app_private.assign_project(p_project uuid,p_user uuid,p_assigned boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.app_memberships where user_id=p_user and workspace_id='izord' and status='active') then raise exception 'inactive_member'; end if;
 if p_assigned then insert into public.izord_project_assignments values(p_project,p_user) on conflict do nothing;
 else delete from public.izord_project_assignments where project_id=p_project and user_id=p_user; end if;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),case when p_assigned then 'assign:' else 'unassign:' end || p_project::text,p_user);
end $$;
create function app_private.set_izord_member(p_user uuid,p_role text,p_status text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_user=auth.uid() and (p_role is distinct from 'admin' or p_status is distinct from 'active') and
   not exists(select 1 from public.app_memberships where workspace_id='izord' and role='admin' and status='active' and user_id<>auth.uid()) then raise exception 'last_admin'; end if;
 -- No INSERT: only an accepted invitation/bootstrap creates a membership.
 update public.app_memberships set role=p_role,status=p_status,updated_at=clock_timestamp() where user_id=p_user and workspace_id='izord';
 if not found then raise exception 'membership_missing'; end if;
 if p_status='revoked' or p_role<>'admin' then
  update public.izord_invitations set revoked_at=clock_timestamp() where created_by=p_user and accepted_at is null and revoked_at is null;
 end if;
 if p_status='revoked' then delete from public.izord_project_assignments where user_id=p_user; end if;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'member:'||p_role||':'||p_status,p_user);
end $$;
create function app_private.invite_izord(p_email text,p_role text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v_token text := gen_random_uuid()::text || gen_random_uuid()::text; v_id uuid;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 insert into public.izord_invitations(email,role,token_hash,created_by,expires_at)
 values(lower(btrim(p_email)),p_role,sha256(convert_to(v_token,'UTF8')),auth.uid(),clock_timestamp()+interval '48 hours') returning id into v_id;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'invite',v_id);
 return jsonb_build_object('id',v_id,'token',v_token);
end $$;
create function app_private.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.has_membership('izord',array['admin']) then raise exception 'forbidden' using errcode='42501'; end if;
 update public.izord_invitations set revoked_at=clock_timestamp() where id=p_id and accepted_at is null;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'revoke_invitation',p_id);
end $$;
create function app_private.accept_invitation(p_token text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.izord_invitations%rowtype; v_email text;
begin
 perform pg_advisory_xact_lock(734991);
 if auth.uid() is null then raise exception 'forbidden' using errcode='42501'; end if;
 select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into i from public.izord_invitations where token_hash=sha256(convert_to(p_token,'UTF8')) for update;
 if not found or v_email is null or i.email is distinct from v_email or i.revoked_at is not null or i.accepted_at is not null or i.expires_at<=clock_timestamp()
 or not exists(select 1 from public.app_memberships where user_id=i.created_by and workspace_id='izord' and role='admin' and status='active') then raise exception 'invalid_invitation' using errcode='42501'; end if;
 -- Re-invitation after revocation is allowed, but cannot silently replace an active role.
 if exists(select 1 from public.app_memberships where user_id=auth.uid() and workspace_id='izord' and status='active') then raise exception 'already_member'; end if;
 insert into public.app_memberships(user_id,workspace_id,role) values(auth.uid(),'izord',i.role)
 on conflict(user_id,workspace_id) do update set role=excluded.role,status='active',updated_at=clock_timestamp();
 update public.izord_invitations set accepted_at=clock_timestamp(),accepted_by=auth.uid() where id=i.id;
 insert into public.izord_access_events(actor_id,action,subject_id) values(auth.uid(),'accept_invitation',i.id);
end $$;

revoke all on function app_private.create_project(text) from public,anon,authenticated;
grant execute on function app_private.create_project(text) to authenticated;
create function public.izord_create_project(p_title text) returns uuid
language sql security invoker set search_path=pg_catalog as $$ select app_private.create_project(p_title); $$;
revoke all on function public.izord_create_project(text) from public,anon,authenticated;
grant execute on function public.izord_create_project(text) to authenticated;

revoke all on function app_private.save_project(uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function app_private.save_project(uuid,integer,text,jsonb,text) to authenticated;
create function public.izord_save_project(p_id uuid,p_expected_revision integer,p_title text,p_payload jsonb,p_status text) returns integer
language sql security invoker set search_path=pg_catalog as $$ select app_private.save_project(p_id,p_expected_revision,p_title,p_payload,p_status); $$;
revoke all on function public.izord_save_project(uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.izord_save_project(uuid,integer,text,jsonb,text) to authenticated;

revoke all on function app_private.register_asset(uuid,integer,text) from public,anon,authenticated;
grant execute on function app_private.register_asset(uuid,integer,text) to authenticated;
create function public.izord_register_asset(p_project uuid,p_revision integer,p_kind text) returns text
language sql security invoker set search_path=pg_catalog as $$ select app_private.register_asset(p_project,p_revision,p_kind); $$;
revoke all on function public.izord_register_asset(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.izord_register_asset(uuid,integer,text) to authenticated;

revoke all on function app_private.finalize_asset(uuid), app_private.withdraw_asset(uuid) from public,anon,authenticated;
grant execute on function app_private.finalize_asset(uuid), app_private.withdraw_asset(uuid) to authenticated;
create function public.izord_finalize_asset(p_asset uuid) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.finalize_asset(p_asset); $$;
create function public.izord_withdraw_asset(p_asset uuid) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.withdraw_asset(p_asset); $$;
revoke all on function public.izord_finalize_asset(uuid), public.izord_withdraw_asset(uuid) from public,anon,authenticated;
grant execute on function public.izord_finalize_asset(uuid), public.izord_withdraw_asset(uuid) to authenticated;

revoke all on function app_private.allow_reader_download(uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.allow_reader_download(uuid,boolean) to authenticated;
create function public.izord_allow_reader_download(p_asset uuid,p_allowed boolean) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.allow_reader_download(p_asset,p_allowed); $$;
revoke all on function public.izord_allow_reader_download(uuid,boolean) from public,anon,authenticated;
grant execute on function public.izord_allow_reader_download(uuid,boolean) to authenticated;

revoke all on function app_private.assign_project(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.assign_project(uuid,uuid,boolean) to authenticated;
create function public.izord_assign_project(p_project uuid,p_user uuid,p_assigned boolean) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.assign_project(p_project,p_user,p_assigned); $$;
revoke all on function public.izord_assign_project(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.izord_assign_project(uuid,uuid,boolean) to authenticated;

revoke all on function app_private.set_izord_member(uuid,text,text) from public,anon,authenticated;
grant execute on function app_private.set_izord_member(uuid,text,text) to authenticated;
create function public.izord_set_izord_member(p_user uuid,p_role text,p_status text) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.set_izord_member(p_user,p_role,p_status); $$;
revoke all on function public.izord_set_izord_member(uuid,text,text) from public,anon,authenticated;
grant execute on function public.izord_set_izord_member(uuid,text,text) to authenticated;

revoke all on function app_private.invite_izord(text,text) from public,anon,authenticated;
grant execute on function app_private.invite_izord(text,text) to authenticated;
create function public.izord_invite_izord(p_email text,p_role text) returns jsonb
language sql security invoker set search_path=pg_catalog as $$ select app_private.invite_izord(p_email,p_role); $$;
revoke all on function public.izord_invite_izord(text,text) from public,anon,authenticated;
grant execute on function public.izord_invite_izord(text,text) to authenticated;

revoke all on function app_private.revoke_invitation(uuid) from public,anon,authenticated;
grant execute on function app_private.revoke_invitation(uuid) to authenticated;
create function public.izord_revoke_invitation(p_id uuid) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.revoke_invitation(p_id); $$;
revoke all on function public.izord_revoke_invitation(uuid) from public,anon,authenticated;
grant execute on function public.izord_revoke_invitation(uuid) to authenticated;

revoke all on function app_private.accept_invitation(text) from public,anon,authenticated;
grant execute on function app_private.accept_invitation(text) to authenticated;
create function public.izord_accept_invitation(p_token text) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.accept_invitation(p_token); $$;
revoke all on function public.izord_accept_invitation(text) from public,anon,authenticated;
grant execute on function public.izord_accept_invitation(text) to authenticated;

-- Original coordination bodies preserved verbatim except the membership check.
create or replace function public.crm_drive_folder_claim(
  p_workspace_id text, p_logical_key text, p_parent_id text, p_lease_token uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare
  r public.crm_drive_folder_registry%rowtype;
  v_now timestamptz;
  v_old_token uuid;
  v_old_expiry timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not app_private.has_membership('oar') then raise exception 'oar_forbidden' using errcode = '42501'; end if;
  if p_workspace_id is distinct from 'oneaddress-riviera' then
    raise exception 'invalid_workspace' using errcode = '22023';
  end if;
  if p_logical_key is null or length(p_logical_key) > 500
    or p_logical_key !~ '^vendor:([A-Za-z0-9_.!~*''()-]|%[0-9A-F]{2})+(:rib)?$' then
    raise exception 'invalid_logical_key' using errcode = '22023';
  end if;
  if p_lease_token is null then raise exception 'Lease token required'; end if;
  insert into public.crm_drive_folder_registry (
    workspace_id, logical_key, parent_drive_folder_id, lease_token, lease_expires_at
  ) values (p_workspace_id, p_logical_key, p_parent_id, p_lease_token, clock_timestamp() + interval '30 seconds')
  on conflict (workspace_id, logical_key) do nothing;

  -- Row lock plus unique key serializes competing claims across all instances.
  select * into strict r from public.crm_drive_folder_registry
    where workspace_id = p_workspace_id and logical_key = p_logical_key for update;
  if r.parent_drive_folder_id <> p_parent_id then
    raise exception 'Drive registry parent mismatch' using errcode = '23514';
  end if;
  v_now := clock_timestamp();
  if r.status = 'creating' and r.lease_expires_at <= v_now then
    v_old_token := r.lease_token;
    v_old_expiry := r.lease_expires_at;
    -- Explicit CAS: the token AND expiry must still be those observed under lock.
    update public.crm_drive_folder_registry set
      lease_token = p_lease_token, lease_expires_at = v_now + interval '30 seconds', updated_at = v_now
    where workspace_id = p_workspace_id and logical_key = p_logical_key
      and status = 'creating' and lease_token = v_old_token
      and lease_expires_at = v_old_expiry and lease_expires_at <= v_now
    returning * into r;
  end if;
  return jsonb_build_object('workspace_id', r.workspace_id, 'logical_key', r.logical_key,
    'parent_drive_folder_id', r.parent_drive_folder_id, 'drive_folder_id', r.drive_folder_id, 'status', r.status) || jsonb_build_object('claimed',
    r.status = 'creating' and r.lease_token = p_lease_token and r.lease_expires_at > clock_timestamp());
end;
$$;

create or replace function public.crm_drive_folder_reserve(
  p_workspace_id text, p_logical_key text, p_lease_token uuid, p_drive_folder_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare r public.crm_drive_folder_registry%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not app_private.has_membership('oar') then raise exception 'oar_forbidden' using errcode = '42501'; end if;
  if p_workspace_id is distinct from 'oneaddress-riviera' then
    raise exception 'invalid_workspace' using errcode = '22023';
  end if;
  if p_logical_key is null or length(p_logical_key) > 500
    or p_logical_key !~ '^vendor:([A-Za-z0-9_.!~*''()-]|%[0-9A-F]{2})+(:rib)?$' then
    raise exception 'invalid_logical_key' using errcode = '22023';
  end if;
  if p_drive_folder_id is null or length(p_drive_folder_id) = 0 then raise exception 'Drive ID required'; end if;
  update public.crm_drive_folder_registry set
    drive_folder_id = coalesce(drive_folder_id, p_drive_folder_id), updated_at = clock_timestamp()
  where workspace_id = p_workspace_id and logical_key = p_logical_key
    and status = 'creating' and lease_token = p_lease_token and lease_expires_at > clock_timestamp()
  returning * into r;
  if not found then return null; end if;
  -- A retry always returns the previously committed ID, never a replacement.
  return jsonb_build_object('workspace_id', r.workspace_id, 'logical_key', r.logical_key,
    'parent_drive_folder_id', r.parent_drive_folder_id, 'drive_folder_id', r.drive_folder_id, 'status', r.status);
end;
$$;

create or replace function public.crm_drive_folder_ready(
  p_workspace_id text, p_logical_key text, p_lease_token uuid, p_drive_folder_id text
) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not app_private.has_membership('oar') then raise exception 'oar_forbidden' using errcode = '42501'; end if;
  if p_workspace_id is distinct from 'oneaddress-riviera' then
    raise exception 'invalid_workspace' using errcode = '22023';
  end if;
  if p_logical_key is null or length(p_logical_key) > 500
    or p_logical_key !~ '^vendor:([A-Za-z0-9_.!~*''()-]|%[0-9A-F]{2})+(:rib)?$' then
    raise exception 'invalid_logical_key' using errcode = '22023';
  end if;
  update public.crm_drive_folder_registry set status = 'ready', lease_token = null,
    lease_expires_at = null, updated_at = clock_timestamp()
  where workspace_id = p_workspace_id and logical_key = p_logical_key
    and status = 'creating' and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp() and drive_folder_id = p_drive_folder_id;
  return found;
end;
$$;

revoke all on function public.crm_drive_folder_claim(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_drive_folder_reserve(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.crm_drive_folder_ready(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.crm_drive_folder_claim(text, text, text, uuid) to authenticated;
grant execute on function public.crm_drive_folder_reserve(text, text, uuid, text) to authenticated;
grant execute on function public.crm_drive_folder_ready(text, text, uuid, text) to authenticated;

commit;
