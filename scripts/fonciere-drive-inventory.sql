-- Read-only production preflight. No names, contacts, opinions or payload bytes.
-- Run with the authorized SQL tool; store the JSON inventory privately.
select jsonb_build_object(
 'capturedAt',clock_timestamp(),
 'sourceSha','8d8b3626fced2460b39b6b6e28fb52be35575cc7',
 'config',(select to_jsonb(c)-'reserved_root_id' from app_private.fonciere_drive_config c),
 'buckets',(select jsonb_agg(x) from (
   select bucket_id,count(*) files,sum((metadata->>'size')::bigint) bytes
   from storage.objects group by bucket_id) x),
 'assets',(select jsonb_agg(jsonb_build_object(
   'id',a.id,'project_id',a.project_id,'object_path',a.object_path,'kind',a.kind,'lifecycle',a.lifecycle,
   'expected_size',a.expected_size,'expected_mime',a.expected_mime,
   'storage_object_id',a.storage_object_id,'storage_object_version',a.storage_object_version,
   'drive_category',a.drive_category,'storage_present',o.id is not null,
   'storage_size',o.metadata->>'size','storage_mime',o.metadata->>'mimetype','actual_storage_version',o.version))
   from public.fonciere_assets a left join storage.objects o
   on o.bucket_id='fonciere-documents' and o.name=a.object_path),
 'copies',(select jsonb_agg(jsonb_build_object(
   'asset_id',asset_id,'project_id',project_id,'storage_object_version',storage_object_version,
   'category',category,'status',status,'drive_file_id',drive_file_id))
   from app_private.fonciere_drive_jobs where job_type='file'),
 'folders',(select jsonb_agg(jsonb_build_object(
   'project_id',project_id,'category',category,'parent_drive_folder_id',parent_drive_folder_id,
   'drive_folder_id',drive_folder_id,'status',status)) from app_private.fonciere_drive_folders),
 'currentReferences',(select coalesce(jsonb_agg(x),'[]') from (
   select p.id project_id,app_private.fonciere_saved_assets(p.id) asset_id from public.fonciere_projects p) x),
 'snapshotReferences',(select coalesce(jsonb_agg(x),'[]') from (
   select s.project_id,s.fingerprint,s.project_revision,e->>'id' asset_id,
   e->>'storage_object_version' storage_object_version
   from app_private.fonciere_arbitrage_snapshots s cross join lateral jsonb_array_elements(s.assets) e) x),
 'presentationAssets',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,'project_id',a.project_id,'object_path',a.object_path,'kind',a.kind,'lifecycle',a.lifecycle,
   'expected_size',a.expected_size,'expected_mime',a.expected_mime)),'[]') from public.izord_assets a),
 'presentationVersions',(select count(*) from public.izord_project_versions),
 'projects',(select count(*) from public.fonciere_projects)
) inventory;
