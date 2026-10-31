begin;
create or replace function app_private.crm_drive_source_allowed(p_target uuid,p_source uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select (app_private.can_fonciere_project(p_source) and app_private.module_allowed('fonciere',false,'export'))
 or exists(select 1 from public.izord_projects p where p.id=p_target and p.payload#>>'{data,importMeta,fonciereSource,id}'=p_source::text);
$$;
revoke all on function app_private.crm_drive_source_allowed(uuid,uuid) from public,anon,authenticated;
create or replace function app_private.crm_drive_upload_allowed(f app_private.crm_drive_files) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select f.created_by=auth.uid() and (case when f.domain='fonciere' then exists(select 1 from public.fonciere_assets a where a.id=f.asset_id and a.project_id=f.project_id and a.lifecycle in ('pending','finalized')) else exists(select 1 from public.izord_assets a where a.id=f.asset_id and a.project_id=f.project_id and a.lifecycle in ('pending','finalized')) end) and case when f.domain='fonciere' then
 app_private.can_fonciere_project(f.project_id,true) and exists(select 1 from public.fonciere_projects where id=f.project_id and status='active')
 else app_private.can_project(f.project_id,true) and exists(select 1 from public.izord_projects where id=f.project_id and status<>'approved') and (f.status='verified' or app_private.can_document_write(f.project_id,f.expected_revision)) and app_private.crm_drive_source_allowed(f.project_id,f.source_project) end;
$$;
create or replace function app_private.crm_drive_begin(p_operation uuid,p_domain text,p_project uuid,p_source uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text,p_category text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app_private.crm_drive_files%rowtype; path text; a uuid;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.crm_drive_mode() then raise exception 'drive_primary_not_active' using errcode='42501'; end if;
 if p_operation is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_sha256 is null or p_category not in ('agency','plans','photos','other') then raise exception 'invalid_transfer' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,54));
 select * into f from app_private.crm_drive_files where operation_id=p_operation;
 if found then
  if f.domain='izord' and f.status='pending' and f.expected_revision is distinct from p_revision then
   if f.created_by<>auth.uid() or f.project_id<>p_project or not app_private.can_document_write(p_project,p_revision) then raise exception 'transfer_revision_conflict' using errcode='42501';end if;
   update public.izord_assets set project_revision=p_revision where id=f.asset_id and lifecycle='pending';
   if not found then raise exception 'transfer_withdrawn' using errcode='42501';end if;
   update app_private.crm_drive_files set expected_revision=p_revision where operation_id=f.operation_id returning * into f;
  end if;
  if not app_private.crm_drive_upload_allowed(f) or (f.domain,f.project_id,f.source_project,f.expected_size,f.expected_mime,f.original_name,f.category,f.sha256) is distinct from (p_domain,p_project,p_source,p_size,p_mime,p_name,p_category,p_sha256) then raise exception 'transfer_identity_conflict' using errcode='42501'; end if;
  return jsonb_build_object('operationId',f.operation_id,'assetId',f.asset_id,'complete',f.status='verified');
 end if;
 if p_domain='fonciere' and p_source=p_project then
  path:=app_private.register_fonciere_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name,p_category);
 elsif p_domain='izord' and app_private.crm_drive_source_allowed(p_project,p_source) then
  path:=app_private.register_generator_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name);
 else raise exception 'transfer_forbidden' using errcode='42501'; end if;
 a:=split_part(path,'/',2)::uuid;
 if p_domain='fonciere' then update public.fonciere_assets set storage_provider='drive' where id=a;
 else update public.izord_assets set storage_provider='drive' where id=a;end if;
 insert into app_private.crm_drive_files(operation_id,domain,asset_id,project_id,source_project,created_by,expected_revision,expected_size,expected_mime,original_name,category,sha256,read_provider)
 values(p_operation,p_domain,a,p_project,p_source,auth.uid(),p_revision,p_size,p_mime,p_name,p_category,p_sha256,'drive');
 return jsonb_build_object('operationId',p_operation,'assetId',a,'complete',false);
end $$;


create or replace function app_private.fonciere_drive_status(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare file_rows jsonb; counts jsonb; state_value text; folder_state text; primary_mode boolean;
begin
 if not app_private.can_fonciere_project(p_project) then raise exception 'fonciere_forbidden' using errcode='42501';end if;
 primary_mode:=app_private.crm_drive_mode();
 select status into folder_state from app_private.fonciere_drive_jobs where project_id=p_project and job_type='folder';
 select coalesce(jsonb_agg(jsonb_build_object('asset_id',a.id,'original_name',a.original_name,'category',a.drive_category,
 'state',case when f.status='verified' and f.read_provider='drive' then 'synced' when primary_mode and a.storage_provider='supabase' then 'retry' else coalesce(q.status,'pending') end,
 'error',case when f.status='verified' and f.read_provider='drive' then null when primary_mode and a.storage_provider='supabase' then 'drive_primary_not_verified' else q.error end) order by a.created_at,a.id),'[]') into file_rows
 from public.fonciere_assets a left join app_private.crm_drive_files f on f.asset_id=a.id and f.domain='fonciere'
 left join app_private.fonciere_drive_jobs q on q.asset_id=a.id and q.storage_object_version=a.storage_object_version
 where a.id in(select app_private.fonciere_saved_assets(p_project));
 select coalesce(jsonb_object_agg(state,n),'{}') into counts from(select value->>'state' state,count(*) n from jsonb_array_elements(file_rows) group by value->>'state') x;
 state_value:=case when counts ? 'retry' or folder_state='retry' then 'retry' when counts ? 'processing' or folder_state='processing' then 'processing' when counts ? 'pending' or folder_state='pending' then 'pending' else 'synced' end;
 return jsonb_build_object('primary',primary_mode,'state',state_value,'configured',coalesce((select enabled from app_private.fonciere_drive_config where singleton),false),'can_retry',not primary_mode and app_private.can_fonciere_project(p_project,true),'can_open',app_private.module_allowed('fonciere',false,'export'),
 'project_state',folder_state,'project_error',(select error from app_private.fonciere_drive_jobs where project_id=p_project and job_type='folder'),
 'folder_id',case when app_private.module_allowed('fonciere',false,'export') then (select drive_folder_id from app_private.fonciere_drive_folders where project_id=p_project and category='project' and status='ready') else null end,
 'files',file_rows,'counts',counts);
end $$;

create or replace function app_private.crm_drive_worker(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f app_private.crm_drive_files%rowtype; cfg app_private.fonciere_drive_config%rowtype; saved_claims text:=current_setting('request.jwt.claims',true); result jsonb; a public.fonciere_assets%rowtype; actor uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_only' using errcode='42501';end if;
 perform pg_advisory_xact_lock_shared(734991);
 if p_action='read_binding' then
  select * into f from app_private.crm_drive_files where domain=p_data->>'domain' and asset_id=(p_data->>'asset_id')::uuid and status='verified' and read_provider='drive';
  if not found then raise exception 'drive_binding_unverified' using errcode='42501';end if;
  return jsonb_build_object('file_id',f.file_id,'revision_id',f.revision_id,'drive_id',f.drive_id,'folder_id',f.folder_id,'source_project',f.source_project,'sha256',f.sha256,'md5',f.md5,'category',f.category,'legacy',f.legacy,'source_version',f.source_version);
 end if;
 if p_action='config' then return (select to_jsonb(c) from app_private.fonciere_drive_config c);end if;
 if p_action='activate' then update app_private.crm_drive_primary_config set enabled=(p_data->>'enabled')::boolean,activated_at=coalesce(activated_at,clock_timestamp());return '{}';end if;
 if p_action='migration_list' then
  return (select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('copy_id',j.drive_file_id,'reserved_id',j.reserved_file_id,'binding',to_jsonb(f))),'[]') from public.fonciere_assets a
   left join app_private.fonciere_drive_jobs j on j.asset_id=a.id and j.storage_object_version=a.storage_object_version
   left join app_private.crm_drive_files f on f.asset_id=a.id where a.lifecycle='finalized' and a.storage_provider='supabase' and coalesce(f.attempts,0)<3);
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
 perform pg_advisory_xact_lock(hashtextextended(p_data->>'operation_id',54));
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
  update app_private.crm_drive_files set attempts=attempts+case when legacy then 1 else 0 end,lease=(p_data->>'lease')::uuid,lease_until=clock_timestamp()+interval '2 minutes' where operation_id=f.operation_id returning * into f;
 elsif f.lease is distinct from (p_data->>'lease')::uuid or f.lease_until<clock_timestamp() then raise exception 'lease_lost' using errcode='40001';
 elsif p_action='state' then
  update app_private.crm_drive_files set file_id=coalesce(file_id,p_data->>'file_id'),drive_id=coalesce(drive_id,p_data->>'drive_id'),folder_id=coalesce(folder_id,p_data->>'folder_id'),
   session_uri=case when p_data ? 'session_uri' then p_data->>'session_uri' else session_uri end,
   received=coalesce((p_data->>'received')::bigint,received) where operation_id=f.operation_id returning * into f;
 elsif p_action='fail' then update app_private.crm_drive_files set last_error='verification_not_confirmed' where operation_id=f.operation_id returning * into f;
 elsif p_action='release' then update app_private.crm_drive_files set lease=null,lease_until=null where operation_id=f.operation_id returning * into f;
 elsif p_action='complete' then
  if f.legacy then
   select * into a from public.fonciere_assets where id=f.asset_id for update;
   if a.storage_object_version is distinct from f.source_version or a.lifecycle<>'finalized' or not exists(select 1 from storage.objects o where o.id=a.storage_object_id and o.version=a.storage_object_version and o.metadata->>'size'=a.expected_size::text and o.metadata->>'mimetype'=a.expected_mime) then raise exception 'source_changed';end if;
  elsif f.sha256 is distinct from p_data->>'sha256' then raise exception 'checksum_mismatch';end if;
  if p_data->>'revision_id' is null or p_data->>'md5' is null or p_data->>'sha256' is null or p_data->>'md5' !~ '^[a-f0-9]{32}$' or p_data->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'proof_required';end if;
  update app_private.crm_drive_files set status='verified',read_provider='drive',session_uri=null,received=expected_size,revision_id=p_data->>'revision_id',md5=p_data->>'md5',sha256=p_data->>'sha256',verified_at=clock_timestamp() where operation_id=f.operation_id returning * into f;
  if f.domain='fonciere' then
   if not f.legacy then update public.fonciere_assets set lifecycle='finalized',storage_object_version=f.sha256,finalized_at=clock_timestamp() where id=f.asset_id;end if;
   update public.fonciere_assets set storage_provider='drive' where id=f.asset_id;
  else
   update public.izord_assets set lifecycle='finalized',storage_object_version=f.sha256,finalized_at=clock_timestamp(),finalized_by=f.created_by,storage_provider='drive' where id=f.asset_id and lifecycle='pending';
   if found then insert into public.izord_access_events(actor_id,action,subject_id) values(f.created_by,'finalize_document',f.asset_id);
   elsif not exists(select 1 from public.izord_assets where id=f.asset_id and lifecycle='finalized') then raise exception 'asset_withdrawn' using errcode='42501';end if;
  end if;
 elsif p_action='rollback' and f.legacy then
  update app_private.crm_drive_files set read_provider='supabase' where operation_id=f.operation_id returning * into f;
  update public.fonciere_assets set storage_provider='supabase' where id=f.asset_id;
 else raise exception 'invalid_action';end if;
 return to_jsonb(f);
end $$;

create or replace function app_private.crm_drive_read(p_domain text,p_asset uuid,p_operation text) returns jsonb
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
  if path is null or not app_private.can_asset(path) or (exists(select 1 from public.izord_assets where id=p_asset and kind='presentation') and not app_private.module_allowed('izord',false,'export')) then raise exception 'forbidden' using errcode='42501';end if;
  select to_jsonb(a) into result from public.izord_assets a where id=p_asset;
 else raise exception 'invalid_read' using errcode='22023';end if;
 if p_operation not in ('download','photo_preview') then raise exception 'invalid_read';end if;
 select * into f from app_private.crm_drive_files where domain=p_domain and asset_id=p_asset and status='verified' and read_provider='drive';
 if result->>'storage_provider'='drive' and not found then raise exception 'drive_binding_unverified' using errcode='42501';end if;
 return result||jsonb_build_object('permission_revision',(select revision from public.crm_access_profiles where user_id=auth.uid() and active),
 'drive',found);
end $$;


do $$ begin
 if not exists(select 1 from pg_constraint where conname='crm_drive_verified_proof' and conrelid='app_private.crm_drive_files'::regclass) then
 alter table app_private.crm_drive_files add constraint crm_drive_verified_proof check(status<>'verified' or (file_id is not null and drive_id is not null and folder_id is not null and revision_id is not null and verified_at is not null and md5 is not null and md5 ~ '^[a-f0-9]{32}$' and received=expected_size));
 end if;
end $$;
commit;
