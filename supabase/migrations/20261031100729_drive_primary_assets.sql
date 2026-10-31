begin;
-- Metadata and resumable-session capabilities remain private and server-only.
create table app_private.crm_drive_primary_config(singleton boolean primary key default true check(singleton),enabled boolean not null default false,activated_at timestamptz);
insert into app_private.crm_drive_primary_config(singleton) values(true);
create table app_private.crm_drive_files(
 operation_id uuid primary key, domain text not null check(domain in ('fonciere','izord')),
 asset_id uuid not null unique,project_id uuid not null,source_project uuid not null references public.fonciere_projects(id),
 created_by uuid not null references auth.users(id),expected_revision integer not null,
 expected_size bigint not null check(expected_size between 1 and 26214400),expected_mime text not null,
 original_name text not null,category text not null check(category in ('agency','plans','photos','other')),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),md5 text,
 source_version text,drive_id text,folder_id text,file_id text unique,revision_id text,
 session_uri text,received bigint not null default 0,lease uuid,lease_until timestamptz,
 status text not null default 'pending' check(status in ('pending','verified')),
 read_provider text not null default 'supabase' check(read_provider in ('supabase','drive')),
 legacy boolean not null default false,verified_at timestamptz,created_at timestamptz not null default clock_timestamp()
);
alter table app_private.crm_drive_primary_config enable row level security;
alter table app_private.crm_drive_files enable row level security;
revoke all on app_private.crm_drive_primary_config,app_private.crm_drive_files from public,anon,authenticated;
alter table public.fonciere_assets add column storage_provider text not null default 'supabase' check(storage_provider in ('supabase','drive'));
alter table public.izord_assets add column storage_provider text not null default 'supabase' check(storage_provider in ('supabase','drive'));
alter table public.fonciere_assets drop constraint fonciere_assets_check1;
alter table public.fonciere_assets add constraint fonciere_finalized_provider check((lifecycle='finalized')=(finalized_at is not null and storage_object_version is not null and (storage_object_id is not null or storage_provider='drive')));
alter table public.izord_assets drop constraint izord_assets_check2;
alter table public.izord_assets add constraint izord_finalized_provider check(
 (lifecycle='pending' and finalized_at is null and finalized_by is null and storage_object_id is null and storage_object_version is null)
 or (lifecycle in ('finalized','withdrawn') and ((finalized_at is not null and finalized_by is not null and storage_object_version is not null and (storage_object_id is not null or storage_provider='drive'))
 or (lifecycle='withdrawn' and finalized_at is null and finalized_by is null and storage_object_id is null and storage_object_version is null))));

create function app_private.crm_drive_mode() returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select coalesce((select enabled from app_private.crm_drive_primary_config where singleton),false) and auth.uid() is not null;
$$;
create function public.crm_drive_mode() returns boolean language sql security invoker set search_path=pg_catalog as $$select app_private.crm_drive_mode();$$;
revoke all on function app_private.crm_drive_mode(),public.crm_drive_mode() from public,anon;
grant execute on function app_private.crm_drive_mode(),public.crm_drive_mode() to authenticated;

create function app_private.crm_drive_upload_allowed(f app_private.crm_drive_files) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select f.created_by=auth.uid() and case when f.domain='fonciere' then
 app_private.can_fonciere_project(f.project_id,true) and exists(select 1 from public.fonciere_projects where id=f.project_id and status='active')
 else app_private.can_document_write(f.project_id,f.expected_revision) and app_private.can_fonciere_project(f.source_project)
 and app_private.module_allowed('fonciere',false,'export') end;
$$;
revoke all on function app_private.crm_drive_upload_allowed(app_private.crm_drive_files) from public,anon,authenticated;

create function app_private.crm_drive_begin(p_operation uuid,p_domain text,p_project uuid,p_source uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text,p_category text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app_private.crm_drive_files%rowtype; path text; a uuid;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.crm_drive_mode() then raise exception 'drive_primary_not_active' using errcode='42501'; end if;
 if p_operation is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_sha256 is null or p_category not in ('agency','plans','photos','other') then raise exception 'invalid_transfer' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,54));
 select * into f from app_private.crm_drive_files where operation_id=p_operation;
 if found then
  if not app_private.crm_drive_upload_allowed(f) or (f.domain,f.project_id,f.source_project,f.expected_size,f.expected_mime,f.original_name,f.category,f.sha256) is distinct from (p_domain,p_project,p_source,p_size,p_mime,p_name,p_category,p_sha256) then raise exception 'transfer_identity_conflict' using errcode='42501'; end if;
  return jsonb_build_object('operationId',f.operation_id,'assetId',f.asset_id,'complete',f.status='verified');
 end if;
 if p_domain='fonciere' and p_source=p_project then
  path:=app_private.register_fonciere_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name,p_category);
 elsif p_domain='izord' and app_private.can_fonciere_project(p_source) and app_private.module_allowed('fonciere',false,'export') then
  path:=app_private.register_generator_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name);
 else raise exception 'transfer_forbidden' using errcode='42501'; end if;
 a:=split_part(path,'/',2)::uuid;
 if p_domain='fonciere' then update public.fonciere_assets set storage_provider='drive' where id=a;
 else update public.izord_assets set storage_provider='drive' where id=a;end if;
 insert into app_private.crm_drive_files(operation_id,domain,asset_id,project_id,source_project,created_by,expected_revision,expected_size,expected_mime,original_name,category,sha256,read_provider)
 values(p_operation,p_domain,a,p_project,p_source,auth.uid(),p_revision,p_size,p_mime,p_name,p_category,p_sha256,'drive');
 return jsonb_build_object('operationId',p_operation,'assetId',a,'complete',false);
end $$;
create function public.crm_drive_begin(p_operation uuid,p_domain text,p_project uuid,p_source uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text,p_category text,p_sha256 text) returns jsonb
language sql security invoker set search_path=pg_catalog as $$select app_private.crm_drive_begin(p_operation,p_domain,p_project,p_source,p_revision,p_kind,p_size,p_mime,p_name,p_category,p_sha256);$$;
revoke all on function app_private.crm_drive_begin(uuid,text,uuid,uuid,integer,text,bigint,text,text,text,text),public.crm_drive_begin(uuid,text,uuid,uuid,integer,text,bigint,text,text,text,text) from public,anon;
grant execute on function app_private.crm_drive_begin(uuid,text,uuid,uuid,integer,text,bigint,text,text,text,text),public.crm_drive_begin(uuid,text,uuid,uuid,integer,text,bigint,text,text,text,text) to authenticated;

-- Generator's historical Storage guard delegates only server-verified Drive assets.
create or replace function app_private.guard_generator_finalization() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$declare m jsonb;
begin
 if old.lifecycle='pending' and new.lifecycle='finalized' and old.expected_size is not null then
  if old.storage_provider='drive' then
   if not exists(select 1 from app_private.crm_drive_files f where f.asset_id=old.id and f.domain='izord' and f.status='verified' and f.expected_size=old.expected_size and f.expected_mime=old.expected_mime) then raise exception 'drive_not_verified' using errcode='23514';end if;
  else
   select metadata into m from storage.objects where bucket_id='izord-documents' and name=old.object_path;
   if coalesce((m->>'size')::bigint,0) is distinct from old.expected_size or m->>'mimetype' is distinct from old.expected_mime then raise exception 'generator_upload_size_or_type_mismatch' using errcode='23514';end if;
  end if;
 end if; return new;
end $$;

-- Service interface: no user can read session URIs or supply a Drive identity.
create function app_private.crm_drive_worker(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app_private.crm_drive_files%rowtype; cfg app_private.fonciere_drive_config%rowtype; saved_claims text:=current_setting('request.jwt.claims',true); result jsonb; a public.fonciere_assets%rowtype; actor uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501';end if;
 perform pg_advisory_xact_lock_shared(734991);
 if p_action='config' then return (select to_jsonb(c) from app_private.fonciere_drive_config c);end if;
 if p_action='activate' then update app_private.crm_drive_primary_config set enabled=(p_data->>'enabled')::boolean,activated_at=coalesce(activated_at,clock_timestamp());return '{}';end if;
 if p_action='migration_list' then
  return (select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('copy_id',j.drive_file_id,'reserved_id',j.reserved_file_id,'binding',to_jsonb(f))),'[]') from public.fonciere_assets a
   left join app_private.fonciere_drive_jobs j on j.asset_id=a.id and j.storage_object_version=a.storage_object_version
   left join app_private.crm_drive_files f on f.asset_id=a.id where a.lifecycle='finalized' and a.storage_provider='supabase');
 end if;
 if p_action='migration_reserve' then
  select * into a from public.fonciere_assets where id=(p_data->>'asset_id')::uuid for update;
  if not found or a.lifecycle<>'finalized' or a.storage_object_version is distinct from p_data->>'source_version' then raise exception 'source_changed';end if;
  insert into app_private.crm_drive_files(operation_id,domain,asset_id,project_id,source_project,created_by,expected_revision,expected_size,expected_mime,original_name,category,sha256,source_version,file_id,legacy)
  values(a.id,'fonciere',a.id,a.project_id,a.project_id,a.created_by,0,a.expected_size,a.expected_mime,a.original_name,a.drive_category,repeat('0',64),a.storage_object_version,p_data->>'file_id',true)
  on conflict(operation_id) do nothing;
  return (select to_jsonb(x) from app_private.crm_drive_files x where operation_id=a.id);
 end if;
 if p_action='folders' then return jsonb_build_object('config',(select to_jsonb(c) from app_private.fonciere_drive_config c),'folders',(select jsonb_agg(to_jsonb(x)-'lease_token') from app_private.fonciere_drive_folders x where project_id=(p_data->>'source_project')::uuid));end if;
 select * into f from app_private.crm_drive_files where operation_id=(p_data->>'operation_id')::uuid for update;
 if not found then raise exception 'transfer_unknown';end if;
 if not f.legacy then
  actor:=(p_data->>'actor')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  if not app_private.crm_drive_upload_allowed(f) then raise exception 'transfer_forbidden' using errcode='42501';end if;
  perform set_config('request.jwt.claims',saved_claims,true);
 end if;
 if p_action='claim' then
  if f.lease is not null and f.lease_until>clock_timestamp() then raise exception 'transfer_busy' using errcode='40001';end if;
  update app_private.crm_drive_files set lease=(p_data->>'lease')::uuid,lease_until=clock_timestamp()+interval '2 minutes' where operation_id=f.operation_id returning * into f;
 elsif f.lease is distinct from (p_data->>'lease')::uuid or f.lease_until<clock_timestamp() then raise exception 'lease_lost' using errcode='40001';
 elsif p_action='state' then
  update app_private.crm_drive_files set file_id=coalesce(file_id,p_data->>'file_id'),drive_id=coalesce(drive_id,p_data->>'drive_id'),folder_id=coalesce(folder_id,p_data->>'folder_id'),
   session_uri=case when p_data ? 'session_uri' then p_data->>'session_uri' else session_uri end,
   received=coalesce((p_data->>'received')::bigint,received) where operation_id=f.operation_id returning * into f;
 elsif p_action='release' then update app_private.crm_drive_files set lease=null,lease_until=null where operation_id=f.operation_id returning * into f;
 elsif p_action='complete' then
  if f.legacy then
   select * into a from public.fonciere_assets where id=f.asset_id for update;
   if a.storage_object_version is distinct from f.source_version or a.lifecycle<>'finalized' or not exists(select 1 from storage.objects o where o.id=a.storage_object_id and o.version=a.storage_object_version and o.metadata->>'size'=a.expected_size::text and o.metadata->>'mimetype'=a.expected_mime) then raise exception 'source_changed';end if;
  elsif f.sha256 is distinct from p_data->>'sha256' then raise exception 'checksum_mismatch';end if;
  if p_data->>'revision_id' is null or p_data->>'md5' !~ '^[a-f0-9]{32}$' or p_data->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'proof_required';end if;
  update app_private.crm_drive_files set status='verified',read_provider='drive',session_uri=null,received=expected_size,revision_id=p_data->>'revision_id',md5=p_data->>'md5',sha256=p_data->>'sha256',verified_at=clock_timestamp() where operation_id=f.operation_id returning * into f;
  if f.domain='fonciere' then
   if not f.legacy then update public.fonciere_assets set lifecycle='finalized',storage_object_version=f.sha256,finalized_at=clock_timestamp() where id=f.asset_id;end if;
   update public.fonciere_assets set storage_provider='drive' where id=f.asset_id;
  else update public.izord_assets set lifecycle='finalized',storage_object_version=f.sha256,finalized_at=clock_timestamp(),finalized_by=f.created_by,storage_provider='drive' where id=f.asset_id;end if;
 elsif p_action='rollback' and f.legacy then
  update app_private.crm_drive_files set read_provider='supabase' where operation_id=f.operation_id returning * into f;
  update public.fonciere_assets set storage_provider='supabase' where id=f.asset_id;
 else raise exception 'invalid_action';end if;
 return to_jsonb(f);
end $$;
create function public.crm_drive_worker(p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.crm_drive_worker(p_action,p_data);$$;
revoke all on function app_private.crm_drive_worker(text,jsonb),public.crm_drive_worker(text,jsonb) from public,anon,authenticated;
grant execute on function app_private.crm_drive_worker(text,jsonb),public.crm_drive_worker(text,jsonb) to service_role;

create function app_private.crm_drive_read(p_domain text,p_asset uuid,p_operation text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare path text; f app_private.crm_drive_files%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_domain='fonciere' then
  select object_path into path from public.fonciere_assets where id=p_asset and lifecycle='finalized';
  if path is null or not app_private.can_fonciere_asset(path) or (p_operation='download' and not app_private.can_fonciere_download(path)) or (p_operation='photo_preview' and not exists(select 1 from public.fonciere_assets where id=p_asset and kind='photo')) then raise exception 'forbidden' using errcode='42501';end if;
  select to_jsonb(a) into result from public.fonciere_assets a where id=p_asset;
 elsif p_domain='izord' and p_operation='download' then
  select object_path into path from public.izord_assets where id=p_asset and lifecycle='finalized';
  if path is null or not app_private.can_asset(path) or not app_private.module_allowed('izord',false,'export') then raise exception 'forbidden' using errcode='42501';end if;
  select to_jsonb(a) into result from public.izord_assets a where id=p_asset;
 else raise exception 'invalid_read' using errcode='22023';end if;
 if p_operation not in ('download','photo_preview') then raise exception 'invalid_read';end if;
 select * into f from app_private.crm_drive_files where domain=p_domain and asset_id=p_asset and status='verified' and read_provider='drive';
 return result||jsonb_build_object('permission_revision',(select revision from public.crm_access_profiles where user_id=auth.uid() and active),
 'drive',case when found then jsonb_build_object('file_id',f.file_id,'revision_id',f.revision_id,'drive_id',f.drive_id,'folder_id',f.folder_id,'source_project',f.source_project,'sha256',f.sha256,'md5',f.md5,'category',f.category,'legacy',f.legacy,'source_version',f.source_version) else null end);
end $$;
create function public.crm_drive_read(p_domain text,p_asset uuid,p_operation text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.crm_drive_read(p_domain,p_asset,p_operation);$$;
revoke all on function app_private.crm_drive_read(text,uuid,text),public.crm_drive_read(text,uuid,text) from public,anon;
grant execute on function app_private.crm_drive_read(text,uuid,text),public.crm_drive_read(text,uuid,text) to authenticated;

-- Drive-backed objects must never enter the legacy Storage-copy worker.
create or replace function app_private.enqueue_fonciere_drive(p_project uuid,p_rename boolean default true) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if p_rename then insert into app_private.fonciere_drive_jobs(project_id,job_type,category,storage_object_version) values(p_project,'folder','other','folder')
 on conflict(project_id) where job_type='folder' do update set status='pending',permanent=false,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp();end if;
 insert into app_private.fonciere_drive_jobs(project_id,asset_id,storage_object_version,job_type,category)
 select p_project,a.id,a.storage_object_version,'file',a.drive_category from public.fonciere_assets a where a.storage_provider='supabase' and a.id in(select app_private.fonciere_saved_assets(p_project))
 on conflict(project_id,asset_id,storage_object_version) do update set status='pending',permanent=false,next_attempt_at=clock_timestamp() where fonciere_drive_jobs.status='cancelled';
end $$;
-- Block stale clients from persisting new Project objects after activation.
create policy fonciere_drive_primary_no_storage on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'fonciere-documents' or not app_private.crm_drive_mode());
commit;
