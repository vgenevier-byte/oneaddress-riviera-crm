begin;
create or replace function app_private.crm_drive_source_allowed(p_target uuid,p_source uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select (app_private.can_fonciere_project(p_source) and app_private.module_allowed('fonciere',false,'export'))
 or exists(select 1 from public.izord_projects p where p.id=p_target and p.payload#>>'{data,importMeta,fonciereSource,id}'=p_source::text);
$$;
revoke all on function app_private.crm_drive_source_allowed(uuid,uuid) from public,anon,authenticated;
create or replace function app_private.crm_drive_upload_allowed(f app_private.crm_drive_files) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select f.created_by=auth.uid() and case when f.domain='fonciere' then
 app_private.can_fonciere_project(f.project_id,true) and exists(select 1 from public.fonciere_projects where id=f.project_id and status='active')
 else app_private.can_document_write(f.project_id,f.expected_revision) and app_private.crm_drive_source_allowed(f.project_id,f.source_project) end;
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
 'state',case when f.status='verified' and f.read_provider='drive' then 'synced' else coalesce(q.status,'pending') end,
 'error',case when f.status='verified' and f.read_provider='drive' then null else q.error end) order by a.created_at,a.id),'[]') into file_rows
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
commit;
