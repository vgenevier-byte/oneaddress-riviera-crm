-- Permanently close the former Intervenant document feature. No file is removed
-- by installing this schema. Real deletion is exclusively Storage API remove.
begin;
create table app_private.house_worker_document_removal_jobs (
 operation_id uuid primary key, actor_id uuid not null references auth.users(id),
 bucket_id text not null check(bucket_id='crm-documents'), object_path text not null,
 object_id uuid not null, object_version text not null, object_updated_at timestamptz not null,
 metadata_md5 text not null check(metadata_md5 ~ '^[0-9a-f]{32}$'),
 worker_revisions jsonb not null, worker_documents jsonb not null, worker_manifest_md5 text not null, provenance_md5 text not null,
 action text not null check(action in ('delete','keep')),
 status text not null default 'pending' check(status in ('pending','completed')),
 expires_at timestamptz not null, lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 refs_removed integer not null default 0, unique(bucket_id,object_path)
);
alter table app_private.house_worker_document_removal_jobs enable row level security;
revoke all on app_private.house_worker_document_removal_jobs from public,anon,authenticated;

create function app_private.worker_document_fields(p_row jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(coalesce(p_row,'{}'))
 where key like 'document%' or key in ('storagePath','fileName','uploadedAt');
$$;
create function app_private.worker_without_document_fields(p_row jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(coalesce(p_row,'{}'))
 where key not like 'document%' and key not in ('storagePath','fileName','uploadedAt');
$$;
create function app_private.worker_document_removal_actor(p_actor uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare previous text:=current_setting('request.jwt.claim.sub',true); allowed boolean;
begin
 perform set_config('request.jwt.claim.sub',coalesce(p_actor::text,''),true);
 allowed:=app_private.document_actor_active(p_actor) and app_private.full_access();
 perform set_config('request.jwt.claim.sub',coalesce(previous,''),true);
 return coalesce(allowed,false);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(previous,''),true);raise;
end $$;

create function app_private.worker_document_other_payload_reference(p_payload jsonb,p_path text,p_workers jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 with recursive refs(value) as (
  select (p_payload-'houseTrackingWorkers')||jsonb_build_object('houseTrackingWorkers',coalesce((
   select jsonb_agg(case when exists(select 1 from jsonb_array_elements(p_workers) x where x->>'id'=r->>'id')
    then app_private.worker_without_document_fields(r) else r end)
   from jsonb_array_elements(coalesce(p_payload->'houseTrackingWorkers','[]')) r),'[]'::jsonb))
  union all
  select child.value from refs r cross join lateral (
   select value from jsonb_each(case when jsonb_typeof(r.value)='object' then r.value else '{}'::jsonb end)
   union all select value from jsonb_array_elements(case when jsonb_typeof(r.value)='array' then r.value else '[]'::jsonb end)
  ) child
 ) select exists(select 1 from refs where value=to_jsonb(p_path)
  or (jsonb_typeof(value)='string' and position(p_path in value#>>'{}')>0));
$$;
create function app_private.worker_document_has_other_reference(p_path text,p_workers jsonb) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.crm_workspace_state w where w.workspace_id='oneaddress-riviera'
  and app_private.worker_document_other_payload_reference(w.payload,p_path,p_workers))
 or exists(select 1 from public.crm_document_scopes d where
  (d.resource_id=p_path and not(d.provider='storage' and d.collection='houseTrackingWorkers' and d.module='houseTracking'
   and not d.bank and not d.personal_contact
   and exists(select 1 from jsonb_array_elements(p_workers) x where x->>'id'=d.record_id)))
  or app_private.worker_document_other_payload_reference(to_jsonb(d)-'resource_id',p_path,'[]'))
 or exists(select 1 from public.crm_document_shares s where s.resource_id=p_path)
 or exists(select 1 from app_private.document_drive_trash t
  where app_private.worker_document_other_payload_reference(to_jsonb(t),p_path,'[]'));
$$;
create function app_private.worker_document_removal_context(p_worker text,p_fields jsonb,p_path text default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from app_private.house_worker_document_removal_jobs j
  where j.operation_id::text=current_setting('app.worker_document_removal',true)
  and j.status='pending' and j.lease_token is not null and j.lease_until>clock_timestamp()
  and app_private.worker_document_removal_actor(j.actor_id)
  and (j.action='keep' or not exists(select 1 from storage.objects o where o.bucket_id=j.bucket_id and o.name=j.object_path))
  and (p_path is null or p_path=j.object_path)
  and exists(select 1 from jsonb_array_elements(j.worker_documents) x where x->>'id'=p_worker
   and (p_fields is null or x->'fields'=p_fields)));
$$;
create function app_private.is_legacy_worker_document(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_path like 'oneaddress-riviera/house-workers/%'
 or exists(select 1 from public.crm_document_scopes d where d.provider='storage'
  and d.resource_id=p_path and d.collection='houseTrackingWorkers');
$$;

-- Field allowlist closes old crm_mutate_record calls. A workspace trigger also
-- closes stale owner/full-payload saves while untouched legacy fields survive
-- until their explicitly authorized API deletion has been confirmed.
update app_private.module_collections set fields=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
 from jsonb_each(fields) where key not like 'document%' and key not in ('storagePath','fileName','uploadedAt'))
 where collection='houseTrackingWorkers';
create function app_private.guard_removed_worker_documents() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb; prior jsonb; entry jsonb; job app_private.house_worker_document_removal_jobs%rowtype;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if new.workspace_id<>'oneaddress-riviera' then return new;end if;
 for r in select value from jsonb_array_elements(coalesce(new.payload->'houseTrackingWorkers','[]')) loop
  prior:=null;
  if tg_op='UPDATE' then select value into prior from jsonb_array_elements(coalesce(old.payload->'houseTrackingWorkers','[]')) where value->>'id'=r->>'id';end if;
  if app_private.worker_document_fields(r) is distinct from app_private.worker_document_fields(prior) then
   if not app_private.worker_document_removal_context(r->>'id',app_private.worker_document_fields(prior))
    or app_private.worker_document_fields(r)<>'{}'::jsonb then
    raise exception 'worker_documents_permanently_disabled' using errcode='42501';end if;
  end if;
 end loop;
 for job in select * from app_private.house_worker_document_removal_jobs where status='pending' loop
  for entry in select value from jsonb_array_elements(job.worker_documents) loop
   if (select count(*) from jsonb_array_elements(coalesce(new.payload->'houseTrackingWorkers','[]')) q where q->>'id'=entry->>'id')<>1 then
    raise exception 'worker_document_removal_worker_locked' using errcode='40001';end if;
   select q into r from jsonb_array_elements(new.payload->'houseTrackingWorkers') q where q->>'id'=entry->>'id';
   if app_private.worker_document_fields(r) is distinct from entry->'fields'
    and not(app_private.worker_document_fields(r)='{}'::jsonb
     and app_private.worker_document_removal_context(r->>'id',entry->'fields')) then
    raise exception 'worker_document_removal_worker_locked' using errcode='40001';end if;
  end loop;
  if job.action='delete' and app_private.worker_document_other_payload_reference(new.payload,job.object_path,job.worker_documents) then
   raise exception 'worker_document_removal_reference_locked' using errcode='40001';end if;
 end loop;
 return new;
end $$;
create trigger crm_guard_removed_worker_documents before insert or update of payload on public.crm_workspace_state
for each row execute function app_private.guard_removed_worker_documents();

create function app_private.guard_removed_worker_document_scope() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if tg_op<>'DELETE' and new.collection='houseTrackingWorkers' then
  raise exception 'worker_documents_permanently_disabled' using errcode='42501';end if;
 if not(tg_op='DELETE' and old.provider='storage' and old.collection='houseTrackingWorkers'
  and old.module='houseTracking' and not old.bank and not old.personal_contact
  and app_private.worker_document_removal_context(old.record_id,null,old.resource_id))
 and exists(select 1 from app_private.house_worker_document_removal_jobs j where j.status='pending' and j.action='delete'
  and ((tg_op<>'DELETE' and app_private.worker_document_other_payload_reference(to_jsonb(new),j.object_path,'[]'))
   or (tg_op<>'INSERT' and app_private.worker_document_other_payload_reference(to_jsonb(old),j.object_path,'[]')))) then
  raise exception 'worker_document_removal_reference_locked' using errcode='40001';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger crm_guard_removed_worker_document_scope before insert or update or delete on public.crm_document_scopes
for each row execute function app_private.guard_removed_worker_document_scope();
create function app_private.guard_removed_worker_document_share() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if exists(select 1 from app_private.house_worker_document_removal_jobs j where j.status='pending' and j.action='delete'
  and ((tg_op<>'DELETE' and new.resource_id=j.object_path) or (tg_op<>'INSERT' and old.resource_id=j.object_path))) then
  raise exception 'worker_document_removal_reference_locked' using errcode='40001';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger crm_guard_removed_worker_document_share before insert or update or delete on public.crm_document_shares
for each row execute function app_private.guard_removed_worker_document_share();
create function app_private.guard_worker_removal_trash_reference() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if exists(select 1 from app_private.house_worker_document_removal_jobs j where j.status='pending' and j.action='delete'
  and ((tg_op<>'DELETE' and app_private.worker_document_other_payload_reference(to_jsonb(new),j.object_path,'[]'))
   or (tg_op<>'INSERT' and app_private.worker_document_other_payload_reference(to_jsonb(old),j.object_path,'[]')))) then
  raise exception 'worker_document_removal_reference_locked' using errcode='40001';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger crm_guard_worker_removal_trash_reference before insert or update or delete on app_private.document_drive_trash
for each row execute function app_private.guard_worker_removal_trash_reference();

create or replace function public.crm_new_document(p_collection text,p_record text,p_title text,p_bank boolean default false) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare m text; path text:='classified/'||gen_random_uuid()::text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_collection='houseTrackingWorkers' then raise exception 'worker_documents_permanently_disabled' using errcode='42501';end if;
 if p_collection='contacts' and not coalesce(p_bank,false) then raise exception 'contact_document_explicit_operation_required' using errcode='42501';end if;
 select module into m from app_private.module_collections where collection=p_collection;
 if m is null or not app_private.module_allowed('documents',true) or not app_private.module_allowed(m,true) then raise exception 'document_write_forbidden' using errcode='42501';end if;
 if p_bank and (p_collection<>'contacts' or not app_private.module_allowed('contacts',true,'bank_write')) then raise exception 'bank_write_forbidden' using errcode='42501';end if;
 if length(p_title) not between 1 and 200 or not exists(select 1 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->p_collection,'[]')) r where w.workspace_id='oneaddress-riviera' and r->>'id'=p_record) then raise exception 'invalid_document_owner';end if;
 insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,bank) values('storage',path,m,p_collection,p_record,p_title,p_bank);return path;
end $$;
create policy removed_worker_documents_no_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'crm-documents' or not app_private.is_legacy_worker_document(name));
create policy removed_worker_documents_no_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'crm-documents' or not app_private.is_legacy_worker_document(name))
with check(bucket_id<>'crm-documents' or not app_private.is_legacy_worker_document(name));
create policy removed_worker_documents_no_direct_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'crm-documents' or not app_private.is_legacy_worker_document(name));

-- Reserved exact objects cannot be replaced or recreated while API deletion is
-- in progress. Reference guards above cover the interval across HTTP calls.
create function app_private.guard_worker_removal_storage() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.house_worker_document_removal_jobs%rowtype;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if tg_op<>'DELETE' then
  if new.bucket_id='crm-documents' and app_private.is_legacy_worker_document(new.name) then
   raise exception 'worker_documents_permanently_disabled' using errcode='42501';end if;
  if tg_op='UPDATE' and old.bucket_id='crm-documents' and app_private.is_legacy_worker_document(old.name) then
   raise exception 'worker_documents_permanently_disabled' using errcode='42501';end if;
  if exists(select 1 from app_private.house_worker_document_removal_jobs x
   where (x.status='pending' or x.action='delete') and ((x.bucket_id=new.bucket_id and x.object_path=new.name)
    or (tg_op='UPDATE' and x.bucket_id=old.bucket_id and x.object_path=old.name))) then
   raise exception 'worker_document_removal_object_locked' using errcode='40001';end if;
  return new;
 end if;
 select * into j from app_private.house_worker_document_removal_jobs where bucket_id=old.bucket_id and object_path=old.name;
 if found then
  if j.status<>'pending' or j.action<>'delete' or not app_private.worker_document_removal_actor(j.actor_id)
   or j.lease_token is null or j.lease_until<clock_timestamp()
   or old.id is distinct from j.object_id or old.version is distinct from j.object_version
   or old.updated_at is distinct from j.object_updated_at or md5(old.metadata::text) is distinct from j.metadata_md5
   or app_private.worker_document_has_other_reference(j.object_path,j.worker_documents) then
   raise exception 'worker_document_removal_delete_unconfirmed' using errcode='40001';end if;
 end if;
 return old;
end $$;
create trigger crm_guard_worker_removal_storage before insert or update or delete on storage.objects
for each row execute function app_private.guard_worker_removal_storage();

create function public.crm_house_worker_document_removal_begin(
 p_operation uuid,p_actor uuid,p_bucket text,p_path text,p_object_id uuid,p_version text,
 p_updated_at timestamptz,p_metadata_md5 text,p_workers jsonb,p_expires timestamptz default clock_timestamp()+interval '15 minutes',
 p_provenance jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.house_worker_document_removal_jobs%rowtype; o storage.objects%rowtype;
 payload jsonb; worker_row jsonb; worker_entry jsonb; documents jsonb:='[]'; positive boolean:=false;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.worker_document_removal_actor(p_actor) then raise exception 'worker_document_removal_forbidden' using errcode='42501';end if;
 if p_operation is null or p_bucket is distinct from 'crm-documents' or p_path is null or p_path not like 'oneaddress-riviera/house-workers/%'
  or p_object_id is null or p_version is null or p_updated_at is null or p_metadata_md5 is null or p_metadata_md5 !~ '^[0-9a-f]{32}$'
  or p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '1 hour'
  or p_workers is null or jsonb_typeof(p_workers)<>'array' or jsonb_array_length(p_workers) not between 0 and 100
  or (select count(distinct x->>'id') from jsonb_array_elements(p_workers) x)<>jsonb_array_length(p_workers) then
  raise exception 'worker_document_removal_target_invalid' using errcode='23514';end if;
 select * into j from app_private.house_worker_document_removal_jobs where operation_id=p_operation for update;
 if found then
  if j.actor_id is distinct from p_actor or j.bucket_id is distinct from p_bucket or j.object_path is distinct from p_path
   or j.object_id is distinct from p_object_id or j.object_version is distinct from p_version
   or j.object_updated_at is distinct from p_updated_at or j.metadata_md5 is distinct from p_metadata_md5
   or j.worker_manifest_md5 is distinct from md5(p_workers::text)
   or j.provenance_md5 is distinct from md5(coalesce(p_provenance::text,'')) then raise exception 'worker_document_removal_operation_conflict' using errcode='40001';end if;
  if j.status='pending' then update app_private.house_worker_document_removal_jobs set expires_at=p_expires where operation_id=p_operation;end if;
  return jsonb_build_object('operation_id',j.operation_id,'status',j.status,'action',j.action,'expires_at',p_expires,'refs_removed',j.refs_removed);
 end if;
 select * into o from storage.objects where bucket_id=p_bucket and name=p_path for update;
 if not found or o.id is distinct from p_object_id or o.version is distinct from p_version
  or o.updated_at is distinct from p_updated_at or md5(o.metadata::text) is distinct from p_metadata_md5 then
  raise exception 'worker_document_removal_object_changed' using errcode='40001';end if;
 select w.payload into strict payload from public.crm_workspace_state w where workspace_id='oneaddress-riviera' for update;
 for worker_entry in select value from jsonb_array_elements(p_workers) loop
  if jsonb_typeof(worker_entry)<>'object' or worker_entry->>'id' is null or worker_entry->>'revision' is null
   or exists(select 1 from jsonb_object_keys(worker_entry) k where k not in ('id','revision'))
   or (select count(*) from jsonb_array_elements(coalesce(payload->'houseTrackingWorkers','[]')) q where q->>'id'=worker_entry->>'id')<>1 then
   raise exception 'worker_document_removal_worker_ambiguous' using errcode='23514';end if;
  select value into worker_row from jsonb_array_elements(payload->'houseTrackingWorkers') where value->>'id'=worker_entry->>'id';
  if md5(worker_row::text) is distinct from worker_entry->>'revision' then raise exception 'revision_conflict' using errcode='40001';end if;
  if coalesce(worker_row->>'documentStoragePath',worker_row->>'storagePath')=p_path then positive:=true;
  elsif exists(select 1 from jsonb_each(app_private.worker_document_fields(worker_row)) f where f.value not in ('null'::jsonb,'""'::jsonb)) then
   raise exception 'worker_document_removal_worker_target_mismatch' using errcode='23514';end if;
  documents:=documents||jsonb_build_array(jsonb_build_object('id',worker_row->>'id','fields',app_private.worker_document_fields(worker_row)));
 end loop;
 if not positive then
  -- External request logs are attested exclusively by the SQL administrator.
  -- The HTTP executor cannot submit or create this provenance authorization.
  if jsonb_array_length(p_workers)<>0 or p_provenance is null or jsonb_typeof(p_provenance)<>'object'
   or coalesce(o.owner_id,o.owner::text) is null or o.created_at is null or p_provenance->>'objectCreatedAt' is null
   or p_provenance->>'kind' is distinct from 'storage-upload-event-metadata'
   or p_provenance->>'projectRef' is distinct from 'jcmnwvlmysecrahupfkk'
   or p_provenance->>'bucketId' is distinct from p_bucket or p_provenance->>'path' is distinct from p_path
   or p_provenance->>'objectId' is distinct from o.id::text
   or p_provenance->>'ownerId' is distinct from coalesce(o.owner_id,o.owner::text)
   or (p_provenance->>'objectCreatedAt')::timestamptz is distinct from o.created_at
   or p_provenance->>'method' is distinct from 'POST' or p_provenance->'status' is distinct from '200'::jsonb
   or p_provenance->>'origin' is distinct from 'https://oneaddress-riviera-crm.vercel.app/'
   or p_provenance->>'event' is distinct from 'ObjectCreated:Post' or p_provenance->>'eventPath' is distinct from p_path
   or p_provenance->>'evidenceStatus' is distinct from 'attested-former-worker-upload-path'
   or p_provenance->>'postTimestamp' is null or p_provenance->>'eventTimestamp' is null
   or abs(extract(epoch from (p_provenance->>'postTimestamp')::timestamptz-o.created_at))>2
   or abs(extract(epoch from (p_provenance->>'eventTimestamp')::timestamptz-o.created_at))>2
   or (p_provenance->>'eventTimestamp')::timestamptz<(p_provenance->>'postTimestamp')::timestamptz then
   raise exception 'worker_document_removal_positive_scope_required' using errcode='23514';end if;
 end if;
 insert into app_private.house_worker_document_removal_jobs(operation_id,actor_id,bucket_id,object_path,object_id,
  object_version,object_updated_at,metadata_md5,worker_revisions,worker_documents,worker_manifest_md5,provenance_md5,action,expires_at)
 values(p_operation,p_actor,p_bucket,p_path,p_object_id,p_version,p_updated_at,p_metadata_md5,p_workers,documents,md5(p_workers::text),md5(coalesce(p_provenance::text,'')),
  case when app_private.worker_document_has_other_reference(p_path,documents) then 'keep' else 'delete' end,p_expires) returning * into j;
 return jsonb_build_object('operation_id',j.operation_id,'status',j.status,'action',j.action,'expires_at',j.expires_at,'refs_removed',j.refs_removed);
end $$;

create function public.crm_house_worker_document_removal_check(p_operation uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.house_worker_document_removal_jobs%rowtype; o storage.objects%rowtype; worker_entry jsonb; worker_row jsonb; missing boolean;
begin
 perform pg_advisory_xact_lock(734991);
 select * into j from app_private.house_worker_document_removal_jobs where operation_id=p_operation for update;
 if not found or not app_private.worker_document_removal_actor(j.actor_id) then raise exception 'worker_document_removal_forbidden' using errcode='42501';end if;
 if j.status='completed' then return jsonb_build_object('operation_id',j.operation_id,'status',j.status,'action',j.action,'refs_removed',j.refs_removed);end if;
 if p_lease is null or j.expires_at<=clock_timestamp() then raise exception 'worker_document_removal_expired' using errcode='42501';end if;
 if j.lease_token is not null and j.lease_token<>p_lease and j.lease_until>clock_timestamp() then
  raise exception 'worker_document_removal_busy' using errcode='40001';end if;
 select * into o from storage.objects where bucket_id=j.bucket_id and name=j.object_path for update;missing:=not found;
 if (missing and j.action<>'delete') or (not missing and (o.id is distinct from j.object_id or o.version is distinct from j.object_version
  or o.updated_at is distinct from j.object_updated_at or md5(o.metadata::text) is distinct from j.metadata_md5)) then
  raise exception 'worker_document_removal_object_changed' using errcode='40001';end if;
 for worker_entry in select value from jsonb_array_elements(j.worker_documents) loop
  select q into worker_row from public.crm_workspace_state w cross join lateral jsonb_array_elements(w.payload->'houseTrackingWorkers') q
   where w.workspace_id='oneaddress-riviera' and q->>'id'=worker_entry->>'id';
  if worker_row is null or app_private.worker_document_fields(worker_row) is distinct from worker_entry->'fields' then
   raise exception 'worker_document_removal_worker_changed' using errcode='40001';end if;
 end loop;
 if j.action='delete' and app_private.worker_document_has_other_reference(j.object_path,j.worker_documents) then
  raise exception 'worker_document_removal_referenced' using errcode='40001';end if;
 update app_private.house_worker_document_removal_jobs set lease_token=p_lease,lease_until=clock_timestamp()+interval '2 minutes' where operation_id=p_operation;
 return (to_jsonb(j)-array['actor_id','worker_revisions','worker_documents'])||jsonb_build_object('lease_token',p_lease,'object_missing',missing);
end $$;
create function public.crm_house_worker_document_removal_release(p_operation uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 update app_private.house_worker_document_removal_jobs set lease_token=null,lease_until=null
  where operation_id=p_operation and status='pending' and lease_token=p_lease;
 return jsonb_build_object('released',found);
end $$;

create function public.crm_house_worker_document_removal_complete(p_operation uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.house_worker_document_removal_jobs%rowtype; o storage.objects%rowtype; w public.crm_workspace_state%rowtype;
 worker_entry jsonb; worker_row jsonb; missing boolean; removed integer:=0; prior_context text:=current_setting('app.worker_document_removal',true);
begin
 perform pg_advisory_xact_lock(734991);
 select * into j from app_private.house_worker_document_removal_jobs where operation_id=p_operation for update;
 if not found or not app_private.worker_document_removal_actor(j.actor_id) then raise exception 'worker_document_removal_forbidden' using errcode='42501';end if;
 if j.status='completed' then return jsonb_build_object('operation_id',j.operation_id,'status',j.status,'action',j.action,'refs_removed',j.refs_removed);end if;
 if p_lease is null or j.lease_token is distinct from p_lease or j.lease_until<clock_timestamp() then
  raise exception 'worker_document_removal_lease_invalid' using errcode='40001';end if;
 select * into o from storage.objects where bucket_id=j.bucket_id and name=j.object_path;missing:=not found;
 if (j.action='delete' and not missing) or (j.action='keep' and (missing or o.id is distinct from j.object_id
  or o.version is distinct from j.object_version or o.updated_at is distinct from j.object_updated_at
  or md5(o.metadata::text) is distinct from j.metadata_md5)) then
  raise exception 'worker_document_removal_storage_not_confirmed' using errcode='40001';end if;
 select * into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update;
 for worker_entry in select value from jsonb_array_elements(j.worker_documents) loop
  select value into worker_row from jsonb_array_elements(w.payload->'houseTrackingWorkers') where value->>'id'=worker_entry->>'id';
  if worker_row is null or app_private.worker_document_fields(worker_row) is distinct from worker_entry->'fields' then
   raise exception 'worker_document_removal_worker_changed' using errcode='40001';end if;
  if worker_entry->'fields'<>'{}'::jsonb then removed:=removed+1;end if;
 end loop;
 perform set_config('app.worker_document_removal',j.operation_id::text,true);
 if jsonb_array_length(j.worker_documents)>0 then
 update public.crm_workspace_state set payload=jsonb_set(payload,'{houseTrackingWorkers}',(
  select jsonb_agg(case when exists(select 1 from jsonb_array_elements(j.worker_documents) x where x->>'id'=r->>'id')
   then app_private.worker_without_document_fields(r) else r end) from jsonb_array_elements(payload->'houseTrackingWorkers') r))
 where workspace_id='oneaddress-riviera';
 end if;
 delete from public.crm_document_scopes
  where provider='storage' and resource_id=j.object_path and collection='houseTrackingWorkers' and module='houseTracking'
   and not bank and not personal_contact and exists(select 1 from jsonb_array_elements(j.worker_documents) x where x->>'id'=record_id);
 update app_private.house_worker_document_removal_jobs set status='completed',completed_at=clock_timestamp(),refs_removed=removed,
  lease_token=null,lease_until=null,worker_revisions='[]',worker_documents=(
   select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id')),'[]'::jsonb) from jsonb_array_elements(worker_documents) x)
  where operation_id=p_operation;
 insert into public.crm_permission_events(actor_id,action,detail) values(j.actor_id,'worker_documents_removed',
  jsonb_build_object('operation_id',p_operation,'physical_deleted',j.action='delete','physical_shared_retained',j.action='keep','refs_removed',removed));
 perform set_config('app.worker_document_removal',coalesce(prior_context,''),true);
 return jsonb_build_object('operation_id',j.operation_id,'status','completed','action',j.action,'refs_removed',removed);
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='app_private' and p.proname in ('worker_document_fields','worker_without_document_fields',
 'worker_document_removal_actor','worker_document_other_payload_reference','worker_document_has_other_reference','worker_document_removal_context',
 'is_legacy_worker_document','guard_removed_worker_documents','guard_removed_worker_document_scope','guard_removed_worker_document_share','guard_worker_removal_trash_reference','guard_worker_removal_storage'))
 or (n.nspname='public' and p.proname like 'crm_house_worker_document_removal_%') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.nspname='public' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
grant execute on function app_private.is_legacy_worker_document(text) to authenticated;
notify pgrst,'reload schema';
commit;
