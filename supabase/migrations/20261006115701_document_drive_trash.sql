-- General Documents only. Recovery metadata and the action survive the removal
-- from the active catalogue; Google Drive is never permanently deleted here.
begin;

create table app_private.document_drive_trash (
 operation_id uuid primary key,
 provider text not null default 'google-drive' check(provider='google-drive'),
 record_id text not null unique,
 resource_id text not null unique,
 parent_record_id text not null,
 parent_resource_id text not null,
 is_folder boolean not null,
 actor_id uuid not null references auth.users(id),
 status text not null default 'pending' check(status in ('pending','completed')),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 scope_snapshot jsonb,
 shares_snapshot jsonb not null default '[]' check(jsonb_typeof(shares_snapshot)='array'),
 folder_title text not null,
 start_workspace_revision timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 drive_confirmation jsonb,
 check((status='pending' and completed_at is null and drive_confirmation is null)
 or (status='completed' and completed_at is not null and drive_confirmation->>'id'=resource_id
 and drive_confirmation->'trashed'='true'::jsonb and drive_confirmation->'explicitlyTrashed'='true'::jsonb))
);
alter table app_private.document_drive_trash enable row level security;
revoke all on app_private.document_drive_trash from public,anon,authenticated;

-- Exact values and Drive URLs count as references. Names alone never do.
create function app_private.document_trash_referenced(p_payload jsonb,p_record text,p_resource text) returns boolean
language sql immutable set search_path=pg_catalog as $$
 with recursive refs(value) as (
  select value from jsonb_each(p_payload-'documents')
  union all
  select e.value from jsonb_array_elements(coalesce(p_payload->'documents','[]')) r
  cross join lateral jsonb_each(r) e
  where r->>'id' is distinct from p_record
  union all
  select child.value from refs r cross join lateral (
   select value from jsonb_each(case when jsonb_typeof(r.value)='object' then r.value else '{}'::jsonb end)
   union all
   select value from jsonb_array_elements(case when jsonb_typeof(r.value)='array' then r.value else '[]'::jsonb end)
  ) child
 ) select exists(select 1 from refs where value=to_jsonb(p_resource) or value=to_jsonb(p_record)
 or (jsonb_typeof(value)='string' and (value#>>'{}') ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
 and position(p_resource in value#>>'{}')>0));
$$;

-- Block all CRM byte/sharing routes as soon as Drive may have changed.
create or replace function app_private.document_allowed(p_provider text,p_resource text,p_write boolean default false,p_download boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_write is not null and p_download is not null
 and not exists(select 1 from app_private.document_drive_trash t where t.provider=p_provider and t.resource_id=p_resource)
 and (app_private.full_access() and (not exists(select 1 from public.crm_document_scopes d
  where d.provider=p_provider and d.resource_id=p_resource and d.collection='documents')
  or app_private.document_actor_active(auth.uid()))
 or exists(select 1 from public.crm_document_scopes d
  join public.crm_workspace_state w on w.workspace_id='oneaddress-riviera'
  where d.provider=p_provider and d.resource_id=p_resource
  and app_private.module_allowed('documents',p_write,case when p_download then 'export' end)
  and case when d.module='documents' or d.collection='documents' then
   d.module='documents' and d.collection='documents' and not d.bank and not p_write
   and app_private.document_actor_active(auth.uid())
   and app_private.general_document_entry(d.provider,d.resource_id,d.record_id) is not null
   and not app_private.document_has_business_reference(d.resource_id)
   and exists(select 1 from public.crm_document_shares s
    where s.provider=d.provider and s.resource_id=d.resource_id and s.user_id=auth.uid() and s.revoked_at is null)
  else
   app_private.module_allowed(d.module,p_write,case when p_download then 'export' end)
   and (not d.bank or app_private.module_allowed('contacts',p_write,case when p_write then 'bank_write' else 'bank_read' end))
   and exists(select 1 from jsonb_array_elements(coalesce(w.payload->d.collection,'[]')) r where r->>'id'=d.record_id)
  end));
$$;

-- Preserve the existing full-access write ceiling for the shared general
-- library. Contribution/Delete without exact write authority is insufficient.
create function public.crm_document_trash_begin(
 p_operation uuid,p_record text,p_resource text,p_parent_record text,p_parent_resource text,
 p_revision text default null,p_preview boolean default false
) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare w public.crm_workspace_state%rowtype; t app_private.document_drive_trash%rowtype;
 r jsonb; parent jsonb; parent_record text; parent_resource text; folder_title text:='CRM Documents';
 scope public.crm_document_scopes%rowtype; candidate jsonb; folder boolean;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.document_actor_active(auth.uid())
 or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id')
 or not app_private.module_allowed('documents',true,'delete') or not app_private.full_access() then
  raise exception 'document_trash_forbidden' using errcode='42501';
 end if;
 if p_operation is null or p_preview is null or p_record is null or p_record !~ '^[A-Za-z0-9_-]{1,100}$'
 or p_record in ('root','crm-root','crm-documents-root') or p_resource is null or p_resource !~ '^[A-Za-z0-9_-]{1,200}$'
 or p_parent_record is null or p_parent_resource is null then
  raise exception 'invalid_document_target' using errcode='22023';
 end if;
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 select * into t from app_private.document_drive_trash where operation_id=p_operation;
 if not found then
  select * into t from app_private.document_drive_trash where record_id=p_record or resource_id=p_resource;
 end if;
 if found then
  if t.record_id<>p_record or t.resource_id<>p_resource or t.parent_record_id<>p_parent_record
  or t.parent_resource_id<>p_parent_resource then
   raise exception 'document_trash_identity_conflict' using errcode='40900';
  end if;
  if t.actor_id is distinct from auth.uid() then raise exception 'document_trash_other_actor' using errcode='42501'; end if;
  return to_jsonb(t)-array['scope_snapshot','shares_snapshot']
   ||jsonb_build_object('workspace_revision',w.updated_at,'workspace_payload',w.payload,'preview',p_preview);
 end if;
 if p_revision is not null and p_revision::timestamptz is distinct from w.updated_at then
  raise exception 'revision_conflict' using errcode='40001';
 end if;
 if (select count(*) from jsonb_array_elements(coalesce(w.payload->'documents','[]')) d where d->>'id'=p_record)<>1 then
  raise exception 'document_missing_or_ambiguous' using errcode='42501';
 end if;
 select d into r from jsonb_array_elements(coalesce(w.payload->'documents','[]')) d where d->>'id'=p_record;
 folder:=coalesce(r->>'isFolder','false')='true';
 if coalesce(r->>'isRoot','false')='true' or length(coalesce(r->>'title','')) not between 1 and 240
 or (case when folder then r->>'driveFolderId' else r->>'driveFileId' end) is distinct from p_resource
 or coalesce(r->>'storagePath','')<>'' then
  raise exception 'invalid_document_target' using errcode='42501';
 end if;
 parent_record:=coalesce(nullif(r->>'folderId',''),nullif(r->>'parentFolderId',''),'');
 parent_resource:=coalesce(nullif(r->>'driveParentFolderId',''),case when not folder then nullif(r->>'driveFolderId','') end,'');
 if parent_record is distinct from p_parent_record or parent_resource is distinct from p_parent_resource
 or parent_record=p_record or parent_resource=p_resource
 or (coalesce(r->>'folderId','')<>'' and coalesce(r->>'parentFolderId','')<>'' and r->>'folderId'<>r->>'parentFolderId') then
  raise exception 'document_parent_mismatch' using errcode='42501';
 end if;
 if parent_record<>'' then
  if (select count(*) from jsonb_array_elements(coalesce(w.payload->'documents','[]')) d where d->>'id'=parent_record and d->>'isFolder'='true')<>1 then
   raise exception 'document_parent_mismatch' using errcode='42501';
  end if;
  select d into parent from jsonb_array_elements(w.payload->'documents') d where d->>'id'=parent_record and d->>'isFolder'='true';
  if parent->>'driveFolderId' is distinct from parent_resource then
   raise exception 'document_parent_mismatch' using errcode='42501';
  end if;
  folder_title:=parent->>'title';
 end if;
 if folder and exists(select 1 from jsonb_array_elements(coalesce(w.payload->'documents','[]')) d
  where d->>'id'<>p_record and (d->>'folderId'=p_record or d->>'parentFolderId'=p_record
   or d->>'driveParentFolderId'=p_resource or (d->>'isFolder' is distinct from 'true' and d->>'driveFolderId'=p_resource))) then
  raise exception 'document_folder_not_empty' using errcode='23503';
 end if;
 if app_private.document_trash_referenced(w.payload,p_record,p_resource)
 or exists(select 1 from public.crm_drive_folder_registry f where f.drive_folder_id=p_resource)
 or exists(select 1 from public.crm_document_scopes d where d.resource_id=p_resource
  and (d.provider<>'google-drive' or d.module<>'documents' or d.collection<>'documents' or d.bank or d.record_id<>p_record or d.superseded_by is not null)) then
  raise exception 'document_referenced_or_protected' using errcode='23503';
 end if;
 select * into scope from public.crm_document_scopes where provider='google-drive' and resource_id=p_resource;
 candidate:=jsonb_build_object('operation_id',p_operation,'provider','google-drive','record_id',p_record,
  'resource_id',p_resource,'parent_record_id',parent_record,'parent_resource_id',parent_resource,
  'is_folder',folder,'actor_id',auth.uid(),'status','pending','snapshot',r,'folder_title',folder_title,
  'start_workspace_revision',w.updated_at,'workspace_revision',w.updated_at,'preview',p_preview);
 if p_preview then return candidate; end if;
 insert into app_private.document_drive_trash(operation_id,record_id,resource_id,parent_record_id,parent_resource_id,
  is_folder,actor_id,snapshot,scope_snapshot,shares_snapshot,folder_title,start_workspace_revision)
 values(p_operation,p_record,p_resource,parent_record,parent_resource,folder,auth.uid(),r,
  case when scope.resource_id is not null then to_jsonb(scope) end,
  coalesce((select jsonb_agg(to_jsonb(s)) from public.crm_document_shares s where s.provider='google-drive' and s.resource_id=p_resource),'[]'),
  folder_title,w.updated_at);
 insert into public.crm_permission_events(actor_id,action,detail) values(auth.uid(),'document_trash_started',
  jsonb_build_object('operation_id',p_operation,'record_id',p_record,'resource_id',p_resource,'parent_record_id',parent_record,'parent_resource_id',parent_resource));
 return candidate;
end $$;

-- Pending targets cannot be edited, removed, reassigned or newly referenced by
-- a stale workspace save. Completed snapshots are stripped from stale saves;
-- conflicting resurrection fails closed. Other payload fields remain intact.
create function app_private.guard_document_drive_trash() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare t app_private.document_drive_trash%rowtype; r jsonb; matches integer;
begin
 if new.workspace_id<>'oneaddress-riviera' then return new; end if;
 for t in select * from app_private.document_drive_trash loop
  select count(*) into matches from jsonb_array_elements(coalesce(new.payload->'documents','[]')) d
  where d->>'id'=t.record_id or d->>'driveFileId'=t.resource_id or (d->>'isFolder'='true' and d->>'driveFolderId'=t.resource_id);
  if t.status='pending' then
   if matches<>1 or not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'documents','[]')) d where d=t.snapshot) then
    raise exception 'document_trash_pending' using errcode='40001';
   end if;
  elsif matches>0 then
   if matches<>1 or not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'documents','[]')) d where d=t.snapshot) then
    raise exception 'document_trash_resurrection_forbidden' using errcode='40001';
   end if;
   new.payload:=jsonb_set(new.payload,'{documents}',coalesce((select jsonb_agg(d order by ordinal) from jsonb_array_elements(new.payload->'documents') with ordinality rows(d,ordinal) where d<>t.snapshot),'[]'));
  end if;
  if app_private.document_trash_referenced(new.payload,t.record_id,t.resource_id) then
   raise exception 'document_trash_reference_forbidden' using errcode='23503';
  end if;
 end loop;
 return new;
end $$;
create trigger crm_guard_document_drive_trash before insert or update of payload on public.crm_workspace_state
for each row execute function app_private.guard_document_drive_trash();

create function app_private.guard_document_drive_trash_scope() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from app_private.document_drive_trash t
  where (tg_op<>'INSERT' and t.provider=old.provider and t.resource_id=old.resource_id)
  or (tg_op<>'DELETE' and t.provider=new.provider and t.resource_id=new.resource_id)) then
  raise exception 'document_trash_scope_locked' using errcode='40001';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger crm_guard_document_drive_trash_scope before insert or update or delete on public.crm_document_scopes
for each row execute function app_private.guard_document_drive_trash_scope();

-- Only the existing privileged server credential can confirm Drive. The
-- browser has no grant to this function or to the recovery journal.
create function public.crm_document_trash_complete(p_operation uuid,p_actor uuid,p_drive jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare t app_private.document_drive_trash%rowtype; w public.crm_workspace_state%rowtype;
 previous_revision timestamptz; rows jsonb;
begin
 perform pg_advisory_xact_lock(734991);
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 select * into t from app_private.document_drive_trash where operation_id=p_operation for update;
 if not found or t.actor_id is distinct from p_actor then raise exception 'document_trash_identity_conflict' using errcode='42501'; end if;
 previous_revision:=w.updated_at;
 if t.status='pending' then
  if jsonb_typeof(p_drive) is distinct from 'object' or p_drive->>'id' is distinct from t.resource_id
  or p_drive->'trashed' is distinct from 'true'::jsonb or p_drive->'explicitlyTrashed' is distinct from 'true'::jsonb then
   raise exception 'document_drive_confirmation_required' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(w.payload->'documents','[]')) d where d=t.snapshot)<>1
  or app_private.document_trash_referenced(w.payload,t.record_id,t.resource_id) then
   raise exception 'document_trash_revision_conflict' using errcode='40001';
  end if;
  select coalesce(jsonb_agg(d order by ordinal),'[]') into rows
  from jsonb_array_elements(w.payload->'documents') with ordinality records(d,ordinal) where d<>t.snapshot;
  update app_private.document_drive_trash set status='completed',completed_at=clock_timestamp(),drive_confirmation=p_drive
  where operation_id=p_operation returning * into t;
  update public.crm_workspace_state set payload=jsonb_set(w.payload,'{documents}',rows),updated_by=t.actor_id
  where workspace_id='oneaddress-riviera' returning * into w;
  insert into public.crm_permission_events(actor_id,action,detail) values(t.actor_id,'document_trashed',
   jsonb_build_object('operation_id',t.operation_id,'record_id',t.record_id,'resource_id',t.resource_id,
    'parent_record_id',t.parent_record_id,'parent_resource_id',t.parent_resource_id,'completed_at',t.completed_at,'recovery_days',30));
 end if;
 return to_jsonb(t)-array['scope_snapshot','shares_snapshot']||jsonb_build_object(
  'previous_workspace_revision',previous_revision,'workspace_revision',w.updated_at,'workspace_payload',w.payload);
end $$;

revoke all on function app_private.document_trash_referenced(jsonb,text,text),app_private.guard_document_drive_trash(),app_private.guard_document_drive_trash_scope(),
 public.crm_document_trash_begin(uuid,text,text,text,text,text,boolean),public.crm_document_trash_complete(uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.crm_document_trash_begin(uuid,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.crm_document_trash_complete(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
