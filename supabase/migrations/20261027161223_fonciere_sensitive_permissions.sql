-- Separate reversible archive and original-download controls for Fonciere.
-- Metadata, photo consultation and preserved historical snapshots retain their
-- existing ACL. No level, role, assignment, business row or file is changed.
begin;
select pg_advisory_xact_lock(734991);
lock table public.crm_access_profiles,public.crm_module_grants,public.app_memberships,
 public.fonciere_project_assignments,public.izord_project_assignments,public.crm_access_invitations
 in share row exclusive mode;

create table app_private.fonciere_sensitive_permission_migration_journal (
 migration text primary key, started_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 before_permissions jsonb not null, before_functions jsonb not null, before_policies jsonb not null,
 before_effective jsonb not null, after_effective jsonb, before_data_hashes jsonb not null,
 after_data_hashes jsonb, compatibility_grants jsonb, recovery_notes text not null
);
alter table app_private.fonciere_sensitive_permission_migration_journal enable row level security;
revoke all on app_private.fonciere_sensitive_permission_migration_journal from public,anon,authenticated;

create function app_private.can_fonciere_download(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.module_allowed('fonciere',false,'export') and app_private.can_fonciere_asset(p_path);
$$;
create function app_private.can_fonciere_storage_read(p_path text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 -- Own pending immutable paths must remain selectable for upload RETURNING.
 -- Every finalized original, including photos, requires the live export right.
 select app_private.can_fonciere_asset(p_path) and exists(select 1 from public.fonciere_assets a
 where a.object_path=p_path and (a.lifecycle='pending' and a.created_by=auth.uid()
  or a.lifecycle='finalized' and app_private.module_allowed('fonciere',false,'export')));
$$;
create function app_private.can_archive_fonciere_project(p_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.can_fonciere_project(p_id,true) and app_private.module_allowed('fonciere',true,'delete');
$$;
revoke all on function app_private.can_fonciere_download(text),app_private.can_fonciere_storage_read(text),app_private.can_archive_fonciere_project(uuid) from public,anon,authenticated;
grant execute on function app_private.can_fonciere_download(text),app_private.can_fonciere_storage_read(text),app_private.can_archive_fonciere_project(uuid) to authenticated;

-- Service-only before/after comparison of actual operations, not newly named
-- controls. It restores request identity even if a compatibility check fails.
create function app_private.fonciere_sensitive_effective_snapshot(p_new boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare u record; result jsonb:='{}'; row_state jsonb; previous_claims text:=current_setting('request.jwt.claims',true);
 previous_sub text:=current_setting('request.jwt.claim.sub',true); module_name text; module_state jsonb;
 modules text[]:=array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges'];
begin
 for u in select id from auth.users order by id loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u.id,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',u.id::text,true);
  module_state:='{}';
  foreach module_name in array modules loop
   module_state:=module_state||jsonb_build_object(module_name,jsonb_build_object(
    'read',app_private.module_allowed(module_name),'write',app_private.module_allowed(module_name,true),
    'sensitive',(select jsonb_object_agg(s,app_private.module_allowed(module_name,false,s)) from unnest(array['delete','export','bank_read','bank_write','payment','generate','mark_published']) s)));
  end loop;
  row_state:=jsonb_build_object('modules',module_state,'generalAdmin',app_private.general_admin(),'fullAccess',app_private.full_access(),
   'fonciereRead',app_private.module_allowed('fonciere'),'fonciereWrite',app_private.module_allowed('fonciere',true),
   'fonciereProjects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,
    'read',app_private.can_fonciere_project(p.id),'write',app_private.can_fonciere_project(p.id,true),
    'archive',case when p_new then app_private.can_archive_fonciere_project(p.id) else app_private.can_fonciere_project(p.id,true) end,
    'transfer',app_private.can_fonciere_project(p.id) and (not p_new or app_private.module_allowed('fonciere',false,'export'))) order by p.id) from public.fonciere_projects p),'[]'),
   'fonciereAssets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,
    'metadataRead',app_private.can_fonciere_asset(a.object_path),'write',app_private.can_fonciere_asset(a.object_path,true),
    'original',case when p_new then app_private.can_fonciere_storage_read(a.object_path) else app_private.can_fonciere_asset(a.object_path) end,
    'photoConsultation',a.lifecycle='finalized' and a.kind='photo' and app_private.can_fonciere_asset(a.object_path)) order by a.id) from public.fonciere_assets a),'[]'),
   'fonciereTaskReferenceExport',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'allowed',app_private.task_target_export_allowed(jsonb_build_object('type','fonciere_project','id',p.id::text)) and app_private.can_fonciere_project(p.id)) order by p.id) from public.fonciere_projects p),'[]'),
   'fonciereDocumentTaskReferenceExport',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'allowed',app_private.task_target_export_allowed(jsonb_build_object('type','document','id',a.id::text,'context',jsonb_build_object('catalog','fonciere','projectId',a.project_id::text))) and app_private.can_fonciere_asset(a.object_path)) order by a.id) from public.fonciere_assets a),'[]'));
  result:=result||jsonb_build_object(u.id::text,row_state);
 end loop;
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 return result;
exception when others then
 perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 raise;
end $$;
revoke all on function app_private.fonciere_sensitive_effective_snapshot(boolean) from public,anon,authenticated;

insert into app_private.fonciere_sensitive_permission_migration_journal(migration,before_permissions,before_functions,before_policies,before_effective,before_data_hashes,recovery_notes)
select '20261027155027_fonciere_sensitive_permissions',jsonb_build_object(
 'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.crm_access_profiles p),'[]'),
 'grants',coalesce((select jsonb_agg(to_jsonb(g) order by g.user_id,g.module) from public.crm_module_grants g),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id,m.workspace_id) from public.app_memberships m),'[]'),
 'fonciereAssignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.project_id,a.user_id) from public.fonciere_project_assignments a),'[]'),
 'presentationAssignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.project_id,a.user_id) from public.izord_project_assignments a),'[]'),
 'invitationPermissions',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'grants',i.grants,'izord_role',i.izord_role,'assignments',i.assignments,'fonciere_assignments',i.fonciere_assignments) order by i.id) from public.crm_access_invitations i),'[]')),
 coalesce((select jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.proname=any(array['module_allowed','validate_grants','crm_admin_save','archive_fonciere_project','save_generator','task_target_export_allowed'])),'{}'),
 coalesce((select jsonb_agg(to_jsonb(p) order by p.policyname) from pg_policies p where p.schemaname='storage' and p.tablename='objects' and p.policyname in ('fonciere_storage_read','fonciere_storage_boundary')),'[]'),
 app_private.fonciere_sensitive_effective_snapshot(false),app_private.fonciere_permission_data_hashes(),
 'Atomic compatibility migration: failure rolls back all changes. For an explicitly authorized rollback retain later permission edits and events first; restore only replaced definitions/policies from this private journal, then restore migration-touched Fonciere sensitive flags, pending invitation flags and profile revisions only when no later administration save superseded them. Deploy the matching application and remove new admission wrappers/helpers only after callers no longer use them. Never restore Auth secrets, rewrite business documents or remove later voluntary rights changes.';


create or replace function app_private.module_allowed(p_module text,p_write boolean default false,p_sensitive text default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and p_write is not null
 and p_module=any(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges','fonciere'])
 and (p_sensitive is null or case when p_module='fonciere' then p_sensitive=any(array['delete','export']) when p_module='monthlyCharges' then p_sensitive='export' when p_module='publisher' then p_sensitive=any(array['export','generate','mark_published']) else p_sensitive=any(array['delete','export','bank_read','bank_write','payment']) end)
 and exists(select 1 from public.crm_access_profiles p join public.crm_module_grants g using(user_id)
 where p.user_id=auth.uid() and p.active and g.module=p_module
 and g.level=any(case when p_write or p_sensitive in ('delete','bank_write','payment','generate','mark_published') then array['contribute'] else array['read','contribute'] end)
 and (p_module='publisher' or exists(select 1 from public.app_memberships m where m.user_id=p.user_id
 and m.workspace_id=case when p_module in ('izord','fonciere') then 'izord' else 'oar' end and m.status='active'))
 and (p_sensitive is null or g.sensitive->p_sensitive='true'::jsonb));
$$;

create or replace function app_private.validate_grants(p_grants jsonb) returns void language plpgsql set search_path=pg_catalog as $$
declare g record; s record;
begin
 if p_grants is null or jsonb_typeof(p_grants)<>'object' then raise exception 'invalid_grants'; end if;
 for g in select * from jsonb_each(p_grants) loop
 if g.key<>all(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges','fonciere'])
 or jsonb_typeof(g.value)<>'object' or g.value-array['level','sensitive']<>'{}' or jsonb_typeof(g.value->'level') is distinct from 'string' or g.value->>'level' not in ('none','read','contribute') or not(g.value?'level') or jsonb_typeof(coalesce(g.value->'sensitive','{}'))<>'object' then raise exception 'invalid_grants'; end if;
 for s in select * from jsonb_each(coalesce(g.value->'sensitive','{}')) loop
 if s.key<>all(array['delete','export','bank_read','bank_write','payment','generate','mark_published']) or jsonb_typeof(s.value)<>'boolean' then raise exception 'invalid_sensitive'; end if;
 if (g.key='fonciere' and s.key not in ('delete','export')) or (g.key='monthlyCharges' and s.key<>'export') or (g.key='publisher' and s.key not in ('export','generate','mark_published')) or (g.key<>'publisher' and s.key in ('generate','mark_published')) then raise exception 'invalid_module_sensitive'; end if;
 if s.value='true' then
 if g.value->>'level'='none' or (s.key in ('delete','bank_write','payment','generate','mark_published') and g.value->>'level'<>'contribute') or (s.key in ('bank_read','bank_write') and g.key<>'contacts') or (s.key='payment' and g.key<>'vendorInvoices') then raise exception 'sensitive_prerequisite'; end if;
 if s.key='bank_write' and g.value->'sensitive'->'bank_read' is distinct from 'true'::jsonb then raise exception 'bank_read_required'; end if;
 if s.key='payment' and (p_grants->'contacts'->'sensitive'->'bank_read' is distinct from 'true'::jsonb or p_grants->'contacts'->>'level' not in ('read','contribute')) then raise exception 'bank_read_required'; end if;
 end if;
 end loop;
 end loop;
end $$;

-- Compatibility derives from the actual old module/role ceiling. No user is
-- assigned a new level, membership, role or project. Inactive access stays false.
with effective as (
 select g.user_id,
  coalesce(p.active and g.level in ('read','contribute') and m.status='active',false) as can_export,
  coalesce(p.active and g.level='contribute' and m.status='active' and m.role in ('admin','partner','contributor'),false) as can_archive
 from public.crm_module_grants g left join public.crm_access_profiles p using(user_id)
 left join public.app_memberships m on m.user_id=g.user_id and m.workspace_id='izord'
 where g.module='fonciere'
)
update public.crm_module_grants g set sensitive=g.sensitive||jsonb_build_object('delete',e.can_archive,'export',e.can_export)
from effective e where g.user_id=e.user_id and g.module='fonciere';
update public.crm_access_profiles p set revision=revision+1,updated_at=clock_timestamp()
where exists(select 1 from public.crm_module_grants g where g.user_id=p.user_id and g.module='fonciere');

-- Existing live invitations retain their previously planned capabilities.
-- Accepted, revoked and expired historical invitations remain byte-for-byte.
with pending as (
 select i.id,coalesce(i.izord_role,(select m.role from auth.users u join public.app_memberships m on m.user_id=u.id and m.workspace_id='izord'
  where lower(u.email)=i.email and m.status='active' order by u.id limit 1)) as effective_role
 from public.crm_access_invitations i where i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp()
 and i.grants?'fonciere'
)
update public.crm_access_invitations i set grants=jsonb_set(i.grants,'{fonciere,sensitive}',coalesce(i.grants->'fonciere'->'sensitive','{}'::jsonb)||jsonb_build_object(
 'delete',coalesce(i.grants->'fonciere'->>'level'='contribute' and p.effective_role in ('admin','partner','contributor'),false),
 'export',coalesce(i.grants->'fonciere'->>'level' in ('read','contribute') and p.effective_role in ('admin','partner','contributor','reader'),false)),true)
from pending p where p.id=i.id;


create or replace function public.crm_admin_save(p_user uuid,p_revision bigint,p_active boolean,p_general_admin boolean,p_grants jsonb,p_izord_role text,p_assignments uuid[],p_fonciere_assignments uuid[]) returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare actual bigint; next_revision bigint; target_project_id uuid; previous_sensitive jsonb; sensitive_name text;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 -- Older clients know the module but not these two controls. Preserve only
 -- missing keys at an unchanged level; an explicit false always revokes.
 if jsonb_typeof(p_grants->'fonciere')='object'
  and jsonb_typeof(coalesce(p_grants->'fonciere'->'sensitive','{}'::jsonb))='object' then
  select sensitive into previous_sensitive from public.crm_module_grants
   where user_id=p_user and module='fonciere' and level=p_grants->'fonciere'->>'level';
  if previous_sensitive is not null then
   foreach sensitive_name in array array['delete','export'] loop
    if not(coalesce(p_grants->'fonciere'->'sensitive','{}'::jsonb)?sensitive_name) and previous_sensitive?sensitive_name then
     p_grants:=jsonb_set(p_grants,'{fonciere,sensitive}',coalesce(p_grants->'fonciere'->'sensitive','{}'::jsonb)||jsonb_build_object(sensitive_name,previous_sensitive->sensitive_name),true);
    end if;
   end loop;
  end if;
 end if;
 perform app_private.validate_grants(p_grants);
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'verified_recipient_required'; end if;
 select revision into actual from public.crm_access_profiles where user_id=p_user for update;
 if p_revision is null or p_user is null or p_active is null or p_general_admin is null or p_assignments is null then raise exception 'invalid_access_parameters' using errcode='22023'; end if;
 if coalesce(actual,0) is distinct from p_revision then raise exception 'access_revision_conflict' using errcode='40001'; end if;
 if (not p_active or not p_general_admin) and exists(select 1 from public.crm_access_profiles where user_id=p_user and active and general_admin) and not exists(select 1 from public.crm_access_profiles where user_id<>p_user and active and general_admin) then raise exception 'last_general_admin'; end if;
 if p_izord_role is not null and p_izord_role not in ('admin','partner','contributor','reader') then raise exception 'invalid_izord_role'; end if;
 if (coalesce(p_grants->'izord'->>'level','none')<>'none' or coalesce(p_grants->'fonciere'->>'level','none')<>'none') and p_izord_role is null then raise exception 'izord_role_required'; end if;
 if exists(select 1 from unnest(p_assignments) a where a is null or not exists(select 1 from public.izord_projects project where project.id=a)) then raise exception 'unknown_project'; end if;
 if p_fonciere_assignments is not null and exists(select 1 from unnest(p_fonciere_assignments) a where a is null or not exists(select 1 from public.fonciere_projects project where project.id=a)) then raise exception 'unknown_fonciere_project'; end if;
 -- Validate only changed IDs through the existing business assignment guard.
 -- An unchanged hidden assignment never prevents editing another module.
 if p_fonciere_assignments is not null then
  for target_project_id in select project.id from public.fonciere_projects project
   where (project.id=any(p_fonciere_assignments)) is distinct from exists(select 1 from public.fonciere_project_assignments a where a.project_id=project.id and a.user_id=p_user)
  loop
   if not app_private.can_fonciere_project(target_project_id,true) or not app_private.workspace_role('izord',array['admin','partner']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
  end loop;
 end if;
 insert into public.crm_access_profiles(user_id,active,general_admin) values(p_user,p_active,p_general_admin)
 on conflict(user_id) do update set active=excluded.active,general_admin=excluded.general_admin,revision=crm_access_profiles.revision+1,updated_at=clock_timestamp() returning revision into next_revision;
 delete from public.crm_module_grants where user_id=p_user;
 insert into public.crm_module_grants select p_user,key,value->>'level',coalesce(value->'sensitive','{}') from jsonb_each(p_grants);
 if exists(select 1 from jsonb_each(p_grants) g where g.key not in ('fonciere','izord','publisher') and g.value->>'level'<>'none') then
  insert into public.app_memberships(user_id,workspace_id,role) values(p_user,'oar','member') on conflict(user_id,workspace_id) do update set status='active',updated_at=clock_timestamp();
 end if;
 if p_izord_role is not null then
  insert into public.app_memberships(user_id,workspace_id,role) values(p_user,'izord',p_izord_role) on conflict(user_id,workspace_id) do update set role=excluded.role,status='active',updated_at=clock_timestamp();
 end if;
 delete from public.izord_project_assignments where user_id=p_user and not(project_id=any(p_assignments));
 insert into public.izord_project_assignments select distinct x,p_user from unnest(p_assignments) x on conflict do nothing;
 if p_fonciere_assignments is not null then
  for target_project_id in select project.id from public.fonciere_projects project where project.id=any(p_fonciere_assignments)
   and not exists(select 1 from public.fonciere_project_assignments a where a.project_id=project.id and a.user_id=p_user)
  loop perform app_private.assign_fonciere_project(target_project_id,p_user,true); end loop;
  for target_project_id in select a.project_id from public.fonciere_project_assignments a where a.user_id=p_user and not(a.project_id=any(p_fonciere_assignments))
  loop perform app_private.assign_fonciere_project(target_project_id,p_user,false); end loop;
 end if;
 insert into public.crm_permission_events(actor_id,subject_id,action,detail) values(auth.uid(),p_user,'access_saved',jsonb_build_object('previousRevision',coalesce(actual,0),'revision',next_revision,'active',p_active,'generalAdmin',p_general_admin,'grants',p_grants,'izordRole',p_izord_role,'assignments',p_assignments,'fonciereAssignments',p_fonciere_assignments));
 return next_revision;
end $$;

-- Returns canonical metadata only. The server-only preview route must fetch,
-- transform and then repeat this admission before releasing derivative bytes.
-- No caller-controlled purpose can retrieve an original through this RPC.
create function app_private.fonciere_asset_access(p_asset uuid,p_operation text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.fonciere_assets%rowtype; permission_revision bigint;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_operation is null or p_operation not in ('photo_preview','download') then raise exception 'invalid_fonciere_asset_operation' using errcode='22023'; end if;
 select * into a from public.fonciere_assets where id=p_asset;
 if not found or a.lifecycle<>'finalized' or not app_private.can_fonciere_asset(a.object_path)
  or (p_operation='photo_preview' and a.kind<>'photo')
  or (p_operation='download' and not app_private.can_fonciere_download(a.object_path)) then
  raise exception 'fonciere_forbidden' using errcode='42501';
 end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='fonciere-documents' and o.name=a.object_path
  and o.id=a.storage_object_id and o.version=a.storage_object_version
  and o.metadata->>'size'=a.expected_size::text and o.metadata->>'mimetype'=a.expected_mime) then
  raise exception 'fonciere_asset_binding_changed' using errcode='42501';
 end if;
 select p.revision into permission_revision from public.crm_access_profiles p where p.user_id=auth.uid() and p.active;
 return jsonb_build_object('id',a.id,'project_id',a.project_id,'object_path',a.object_path,'kind',a.kind,
  'expected_size',a.expected_size,'expected_mime',a.expected_mime,'storage_object_version',a.storage_object_version,
  'permission_revision',permission_revision);
end $$;
create function public.fonciere_asset_access(p_asset uuid,p_operation text) returns jsonb
language sql security invoker set search_path=pg_catalog as $$ select app_private.fonciere_asset_access(p_asset,p_operation); $$;

-- NULL revision admits a staged snapshot after an independent source edit.
-- A numbered revision admits exactly one current selection for before/after
-- transfer checks. Neither variant creates or modifies a project or an asset.
create function app_private.fonciere_authorize_transfer(p_project uuid,p_revision integer default null) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.can_fonciere_project(p_project) or not app_private.module_allowed('fonciere',false,'export') then
  raise exception 'forbidden_fonciere_source' using errcode='42501';
 end if;
 if p_revision is not null and not exists(select 1 from public.fonciere_projects p where p.id=p_project and p.revision=p_revision) then
  raise exception 'fonciere_revision_conflict' using errcode='40001';
 end if;
end $$;
create function public.fonciere_authorize_transfer(p_project uuid,p_revision integer default null) returns void
language sql security invoker set search_path=pg_catalog as $$ select app_private.fonciere_authorize_transfer(p_project,p_revision); $$;
revoke all on function app_private.fonciere_asset_access(uuid,text),public.fonciere_asset_access(uuid,text),app_private.fonciere_authorize_transfer(uuid,integer),public.fonciere_authorize_transfer(uuid,integer) from public,anon,authenticated;
grant execute on function app_private.fonciere_asset_access(uuid,text),public.fonciere_asset_access(uuid,text),app_private.fonciere_authorize_transfer(uuid,integer),public.fonciere_authorize_transfer(uuid,integer) to authenticated;

-- Preserve metadata/photo-reference RLS. Only original bytes are gated here;
-- the restrictive policy prevents an older permissive policy bypass.
-- Never issue signed read/upload capabilities: they outlive a later rights
-- revocation. Each original read uses a current JWT; upload RETURNING may select
-- only the actor's own pending immutable object. Unused copy/transform routes
-- are deliberately absent, and other buckets retain their existing policies.
alter policy fonciere_storage_read on storage.objects
 using(bucket_id='fonciere-documents' and app_private.can_fonciere_storage_read(name)
  and storage.allow_any_operation(array['object.get_authenticated','object.list','object.list_v2','object.upload']));
alter policy fonciere_storage_boundary on storage.objects
 using(bucket_id<>'fonciere-documents' or (app_private.can_fonciere_storage_read(name)
  and storage.allow_any_operation(array['object.get_authenticated','object.list','object.list_v2','object.upload'])))
 with check(bucket_id<>'fonciere-documents' or (app_private.can_fonciere_asset(name,true)
  and storage.allow_only_operation('object.upload')));


create or replace function app_private.archive_fonciere_project(p_id uuid,p_expected_revision integer,p_archived boolean) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.can_archive_fonciere_project(p_id) or p_archived is null then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 select * into strict p from public.fonciere_projects where id=p_id for update;
 if p.revision is distinct from p_expected_revision then raise exception 'fonciere_revision_conflict' using errcode='40001'; end if;
 update public.fonciere_projects set status=case when p_archived then 'archived' else 'active' end,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning revision into p.revision;
 return p.revision;
end $$;

create or replace function app_private.save_generator(p_id uuid,p_expected_revision integer,p_title text,p_payload jsonb,p_status text) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare v_revision integer; v_role text; v_item jsonb; v_index integer:=0; v_source jsonb; v_source_id uuid; v_source_revision integer;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.can_project(p_id,true) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_payload->>'schema' is distinct from 'IZORD_GENERATOR_V1'
   or jsonb_typeof(p_payload->'data') is distinct from 'object'
   or jsonb_typeof(p_payload->'data'->'state') is distinct from 'object'
   or jsonb_typeof(p_payload->'data'->'photos') is distinct from 'object'
   or jsonb_typeof(p_payload->'data'->'importGallery') is distinct from 'array'
   or jsonb_typeof(p_payload->'sourceDocuments') is distinct from 'array'
   or jsonb_array_length(p_payload->'data'->'importGallery')>480
   or jsonb_array_length(p_payload->'sourceDocuments')>30 then
  raise exception 'invalid_generator_payload' using errcode='22023';
 end if;
 v_source:=p_payload#>'{data,importMeta,fonciereSource}';
 if v_source is not null then
  if jsonb_typeof(v_source)<>'object' or coalesce(v_source->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(v_source->>'revision','') !~ '^[1-9][0-9]{0,8}$' then raise exception 'invalid_fonciere_source' using errcode='22023'; end if;
  v_source_id:=(v_source->>'id')::uuid; v_source_revision:=(v_source->>'revision')::integer;
  if not exists(select 1 from public.fonciere_presentation_sources f where f.presentation_id=p_id and f.presentation_revision=p_expected_revision and f.source_project_id=v_source_id and f.source_revision=v_source_revision)
   and (not app_private.can_fonciere_project(v_source_id) or not app_private.module_allowed('fonciere',false,'export') or not exists(select 1 from public.fonciere_projects p where p.id=v_source_id and p.revision>=v_source_revision))
   then raise exception 'forbidden_fonciere_source' using errcode='42501'; end if;
 end if;
 -- Existing function retains the authenticated author, optimistic lock and
 -- workflow rules. A reference failure rolls back this save and its version.
 v_revision:=app_private.save_project(p_id,p_expected_revision,p_title,p_payload,p_status);
 foreach v_role in array array['main','view','inside','operation'] loop
  perform app_private.add_generator_ref(p_id,v_revision,'photo:'||v_role,p_payload->'data'->'photos'->>v_role,'photo');
 end loop;
 for v_item in select value from jsonb_array_elements(p_payload->'data'->'importGallery') loop
  perform app_private.add_generator_ref(p_id,v_revision,'gallery:'||v_index,v_item->>'data','photo');
  v_index:=v_index+1;
 end loop;
 v_index:=0;
 for v_item in select value from jsonb_array_elements(p_payload->'sourceDocuments') loop
  if jsonb_typeof(v_item)<>'string' then raise exception 'invalid_generator_source' using errcode='22023'; end if;
  perform app_private.add_generator_ref(p_id,v_revision,'source:'||v_index,v_item#>>'{}','pdf');
  v_index:=v_index+1;
 end loop;
 if v_source is not null then
  insert into public.fonciere_presentation_sources values(p_id,v_revision,v_source_id,v_source_revision);
 end if;
 return v_revision;
end $$;

create or replace function app_private.task_target_export_allowed(p_ref jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ref jsonb:=app_private.task_target_ref(p_ref);kind text:=ref->>'type';ctx jsonb:=coalesce(ref->'context','{}');module_name text:=app_private.task_target_module(kind);d public.crm_document_scopes%rowtype;
begin
 if kind='document' and ctx->>'catalog' in ('fonciere','presentation') then module_name:=case ctx->>'catalog' when 'fonciere' then 'fonciere' else 'izord' end;end if;
 -- Preserve the pre-existing presentation-export ceiling for task CSV labels.
 -- The new Fonciere control can narrow this ceiling, never open a label
 -- which the pre-existing IZORD export permission already prohibited.
 if module_name='fonciere' then
  return app_private.module_allowed('fonciere',false,'export')
   and app_private.module_allowed('izord',false,'export')
   and coalesce(app_private.task_target_resolve(ref)->>'state' in ('available','archived'),false);
 end if;
 if not app_private.module_allowed(module_name,false,'export') then return false;end if;
 if kind='document' and not(ctx?'catalog') then return app_private.document_allowed(ctx->>'provider',ref->>'id',false,true);end if;
 if kind='bank_account' then return app_private.module_allowed('contacts',false,'bank_read');end if;
 if kind in ('vendor_quote','vendor_invoice','worker','worker_period','time_entry','staff_payment','quote','booking','monthly_charges') and app_private.module_allowed('contacts') and not app_private.module_allowed('contacts',false,'export') then return false;end if;
 if kind='monthly_charges' and ctx?'houseId' and not app_private.module_allowed('houseTracking',false,'export') then return false;end if;
 if kind='monthly_charges' and not app_private.module_allowed(case ctx->>'source' when 'invoice' then 'vendorInvoices' else 'houseTracking' end,false,'export') then return false;end if;
 return true;
end $$;

-- Verify effective pre-existing operations and every independent business
-- snapshot before committing compatibility flags. All differences fail closed.
do $$ declare previous jsonb; current_state jsonb; previous_hashes jsonb; current_hashes jsonb; begin
 select before_effective,before_data_hashes into previous,previous_hashes from app_private.fonciere_sensitive_permission_migration_journal where migration='20261027155027_fonciere_sensitive_permissions';
 current_state:=app_private.fonciere_sensitive_effective_snapshot(true);
 current_hashes:=app_private.fonciere_permission_data_hashes();
 if previous is distinct from current_state then raise exception 'fonciere_sensitive_compatibility_mismatch' using errcode='23514'; end if;
 if previous_hashes is distinct from current_hashes then raise exception 'fonciere_sensitive_business_data_changed' using errcode='23514'; end if;
 update app_private.fonciere_sensitive_permission_migration_journal set completed_at=clock_timestamp(),after_effective=current_state,after_data_hashes=current_hashes,
  compatibility_grants=coalesce((select jsonb_agg(to_jsonb(g) order by g.user_id) from public.crm_module_grants g where g.module='fonciere'),'[]')
 where migration='20261027155027_fonciere_sensitive_permissions';
end $$;
notify pgrst,'reload schema';
commit;
