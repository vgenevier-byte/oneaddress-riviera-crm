-- Independent Fonciere module, preserving the existing effective business ceiling.
-- No project, presentation, asset, membership, owner or assignment is migrated.
-- The private journal stores only permission/recovery metadata (no Auth secrets).
begin;
select pg_advisory_xact_lock(734991);
lock table public.crm_access_profiles,public.crm_module_grants,public.app_memberships,
 public.fonciere_project_assignments,public.izord_project_assignments,public.crm_access_invitations
 in share row exclusive mode;

create table app_private.fonciere_permission_migration_journal (
 migration text primary key, started_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz, before_permissions jsonb not null, before_functions jsonb not null,
 before_effective jsonb not null, after_effective jsonb, before_data_hashes jsonb not null,
 after_data_hashes jsonb, compatibility_grants jsonb, recovery_notes text not null
);
alter table app_private.fonciere_permission_migration_journal enable row level security;
revoke all on app_private.fonciere_permission_migration_journal from public,anon,authenticated;

-- Service-only comparison helper. Uses the exact existing predicates, then the
-- replaced predicates, under each account ID. It never changes a business row.
create function app_private.fonciere_effective_access_snapshot(p_new boolean) returns jsonb
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
   'fonciereCreate',case when p_new then app_private.module_allowed('fonciere',true) else app_private.module_allowed('izord',true) end
    and exists(select 1 from public.app_memberships m where m.user_id=u.id and m.workspace_id='izord' and m.status='active' and m.role in ('admin','partner','contributor')),
   'fonciereProjects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'read',app_private.can_fonciere_project(p.id),'write',app_private.can_fonciere_project(p.id,true)) order by p.id) from public.fonciere_projects p),'[]'),
   'presentations',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'read',app_private.can_project(p.id),'write',app_private.can_project(p.id,true)) order by p.id) from public.izord_projects p),'[]'),
   'fonciereTaskReferenceExport',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'allowed',app_private.task_target_export_allowed(jsonb_build_object('type','fonciere_project','id',p.id::text)) and app_private.can_fonciere_project(p.id)) order by p.id) from public.fonciere_projects p),'[]'),
   'fonciereDocumentTaskReferenceExport',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'allowed',app_private.task_target_export_allowed(jsonb_build_object('type','document','id',a.id::text,'context',jsonb_build_object('catalog','fonciere','projectId',a.project_id::text))) and app_private.can_fonciere_asset(a.object_path)) order by a.id) from public.fonciere_assets a),'[]'),
   'fonciereAssets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'read',app_private.can_fonciere_asset(a.object_path),'write',app_private.can_fonciere_asset(a.object_path,true)) order by a.id) from public.fonciere_assets a),'[]'),
   'presentationAssets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'read',app_private.can_asset(a.object_path),'write',app_private.can_asset(a.object_path,true)) order by a.id) from public.izord_assets a),'[]'));
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
revoke all on function app_private.fonciere_effective_access_snapshot(boolean) from public,anon,authenticated;

create function app_private.fonciere_permission_data_hashes() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare table_name text; result jsonb:='{}'; fingerprint text;
begin
 -- These are deliberately independent snapshots and documents. Only hashes leave
 -- this helper; the migration never copies or rewrites their business contents.
 foreach table_name in array array['crm_workspace_state','app_memberships','fonciere_projects','fonciere_project_assignments','fonciere_project_contacts','fonciere_assets','fonciere_presentation_sources','izord_projects','izord_project_assignments','izord_project_versions','izord_assets','izord_generator_asset_refs'] loop
  execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from public.%I t',table_name) into fingerprint;
  result:=result||jsonb_build_object(table_name,fingerprint);
 end loop;
 select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(o) order by to_jsonb(o)::text),'[]'::jsonb)::text,'UTF8')),'hex') into fingerprint from storage.objects o;
 return result||jsonb_build_object('storage.objects',fingerprint);
end $$;
revoke all on function app_private.fonciere_permission_data_hashes() from public,anon,authenticated;

insert into app_private.fonciere_permission_migration_journal(migration,before_permissions,before_functions,before_effective,before_data_hashes,recovery_notes)
select '20261027124814_fonciere_module_permissions',jsonb_build_object(
 'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.crm_access_profiles p),'[]'),
 'grants',coalesce((select jsonb_agg(to_jsonb(g) order by g.user_id,g.module) from public.crm_module_grants g),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id,m.workspace_id) from public.app_memberships m),'[]'),
 'fonciereAssignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.project_id,a.user_id) from public.fonciere_project_assignments a),'[]'),
 'presentationAssignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.project_id,a.user_id) from public.izord_project_assignments a),'[]'),
 'invitationPermissions',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'grants',i.grants,'izord_role',i.izord_role,'assignments',i.assignments) order by i.id) from public.crm_access_invitations i),'[]'),
 'moduleConstraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.crm_module_grants'::regclass and conname='crm_module_grants_module_check')),
 coalesce((select jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.proname=any(array['module_allowed','full_access','validate_grants','can_fonciere_project','save_fonciere_project','assign_fonciere_project','fonciere_assign_project','fonciere_access_options','crm_admin_users','crm_admin_save','crm_invite_prepare','crm_invite_accept','task_target_module','task_target_candidates','task_target_resolve_before_house_address','task_target_export_allowed'])),'{}'),
 app_private.fonciere_effective_access_snapshot(false),app_private.fonciere_permission_data_hashes(),
 'Compatibility-only change. On failure the entire transaction rolls back. For an explicitly authorized rollback, first retain current grants/events and any later admin edits, deploy the matching prior application, restore only affected function definitions and original module constraint from before_functions/before_permissions, remove the compatibility fonciere grants, and restore only migration-touched pending-invitation grants/profile revisions after checking no later administration save superseded them. Restore the old public wrappers before dropping the introduced eight-/five-argument RPC overloads and private native-assignment invalidator. Memberships, owners, assignments, business rows and files require no restoration because they were never modified. Never restore Auth secrets or overwrite later voluntary rights changes.';

alter table public.crm_module_grants drop constraint crm_module_grants_module_check;
alter table public.crm_module_grants add constraint crm_module_grants_module_check
 check(module in ('dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','monthlyCharges','documents','planning','properties','vehicles','boats','fonciere','izord','publisher'));

-- A workspace business role is a different predicate from access to either
-- module. Leave legacy has_membership unchanged so no presentation boundary is
-- weakened by introducing a Fonciere-only actor.
create function app_private.workspace_role(p_space text,p_roles text[] default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and exists(select 1 from public.crm_access_profiles p
 join public.app_memberships m using(user_id) where p.user_id=auth.uid() and p.active
 and m.workspace_id=p_space and m.status='active' and (p_roles is null or m.role=any(p_roles)));
$$;
revoke all on function app_private.workspace_role(text,text[]) from public,anon,authenticated;


create or replace function app_private.module_allowed(p_module text,p_write boolean default false,p_sensitive text default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and p_write is not null
 and p_module=any(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges','fonciere'])
 and (p_sensitive is null or case when p_module='fonciere' then false when p_module='monthlyCharges' then p_sensitive='export' when p_module='publisher' then p_sensitive=any(array['export','generate','mark_published']) else p_sensitive=any(array['delete','export','bank_read','bank_write','payment']) end)
 and exists(select 1 from public.crm_access_profiles p join public.crm_module_grants g using(user_id)
 where p.user_id=auth.uid() and p.active and g.module=p_module
 and g.level=any(case when p_write or p_sensitive in ('delete','bank_write','payment','generate','mark_published') then array['contribute'] else array['read','contribute'] end)
 and (p_module='publisher' or exists(select 1 from public.app_memberships m where m.user_id=p.user_id
 and m.workspace_id=case when p_module in ('izord','fonciere') then 'izord' else 'oar' end and m.status='active'))
 and (p_sensitive is null or g.sensitive->p_sensitive='true'::jsonb));
$$;

create or replace function app_private.full_access() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.general_admin() and not exists(select 1 from unnest(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats']) m where not app_private.module_allowed(m,true))
 and app_private.module_allowed('documents',true,'export') and app_private.module_allowed('contacts',true,'bank_read')
 and app_private.module_allowed('contacts',true,'bank_write') and app_private.module_allowed('vendorInvoices',true,'payment')
 and not exists(select 1 from public.crm_module_grants where user_id=auth.uid() and module not in ('izord','publisher','monthlyCharges','fonciere') and (sensitive->'delete' is distinct from 'true'::jsonb or sensitive->'export' is distinct from 'true'::jsonb));
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
 if g.key='fonciere' or (g.key='monthlyCharges' and s.key<>'export') or (g.key='publisher' and s.key not in ('export','generate','mark_published')) or (g.key<>'publisher' and s.key in ('generate','mark_published')) then raise exception 'invalid_module_sensitive'; end if;
 if s.value='true' then
 if g.value->>'level'='none' or (s.key in ('delete','bank_write','payment','generate','mark_published') and g.value->>'level'<>'contribute') or (s.key in ('bank_read','bank_write') and g.key<>'contacts') or (s.key='payment' and g.key<>'vendorInvoices') then raise exception 'sensitive_prerequisite'; end if;
 if s.key='bank_write' and g.value->'sensitive'->'bank_read' is distinct from 'true'::jsonb then raise exception 'bank_read_required'; end if;
 if s.key='payment' and (p_grants->'contacts'->'sensitive'->'bank_read' is distinct from 'true'::jsonb or p_grants->'contacts'->>'level' not in ('read','contribute')) then raise exception 'bank_read_required'; end if;
 end if;
 end loop;
 end loop;
end $$;

-- Seed only the actual prior ceiling, with a read-only business role capped
-- to read. Every record still passes the same owner/assignment/role predicate.
insert into public.crm_module_grants(user_id,module,level,sensitive)
select p.user_id,'fonciere',case when m.role='reader' then 'read' else g.level end,'{}'::jsonb
from public.crm_access_profiles p join public.crm_module_grants g on g.user_id=p.user_id and g.module='izord'
join public.app_memberships m on m.user_id=p.user_id and m.workspace_id='izord'
where p.active and m.status='active' and g.level in ('read','contribute') and m.role in ('admin','partner','contributor','reader');
-- Existing operation contexts are invalidated without editing a business record.
update public.crm_access_profiles p set revision=revision+1,updated_at=clock_timestamp()
where exists(select 1 from public.crm_module_grants g where g.user_id=p.user_id and g.module='fonciere');

alter table public.crm_access_invitations add column fonciere_assignments uuid[] not null default '{}';
-- Pending invitations prepared under the old shared permission keep the same
-- future ceiling; accepted/revoked/expired historical invitation rows stay exact.
with pending as (
 select i.id,coalesce(i.izord_role,(select m.role from auth.users u join public.app_memberships m on m.user_id=u.id and m.workspace_id='izord'
  where lower(u.email)=i.email and m.status='active' order by u.id limit 1)) as effective_role
 from public.crm_access_invitations i where i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp()
 and i.grants->'izord'->>'level' in ('read','contribute') and not(i.grants?'fonciere')
)
update public.crm_access_invitations i set grants=i.grants||jsonb_build_object('fonciere',jsonb_build_object(
 'level',case when p.effective_role='reader' then 'read' else i.grants->'izord'->>'level' end,'sensitive','{}'::jsonb))
from pending p where p.id=i.id and p.effective_role in ('reader','contributor','partner','admin');


create or replace function app_private.can_fonciere_project(p_id uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.module_allowed('fonciere',p_write) and
 app_private.workspace_role('izord',case when p_write then array['admin','partner','contributor'] else null end)
 and exists(select 1 from public.fonciere_projects p where p.id=p_id and (
 app_private.workspace_role('izord',array['admin','partner']) or
 (p.owner_id=auth.uid() and app_private.workspace_role('izord',array['contributor'])) or
 exists(select 1 from public.fonciere_project_assignments a where a.project_id=p.id and a.user_id=auth.uid())));
$$;

create or replace function app_private.save_fonciere_project(p_id uuid,p_expected_revision integer,p_payload jsonb,p_contact text,p_agency_contact text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.fonciere_projects%rowtype; v_id uuid:=coalesce(p_id,gen_random_uuid()); agent text; agency text; link text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_id is null then
  if auth.uid() is null or not app_private.module_allowed('fonciere',true) or not app_private.workspace_role('izord',array['admin','partner','contributor']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 else
  if not app_private.can_fonciere_project(p_id,true) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
  select * into strict p from public.fonciere_projects where id=p_id for update;
  if p.revision is distinct from p_expected_revision then raise exception 'fonciere_revision_conflict' using errcode='40001'; end if;
  if p.status<>'active' then raise exception 'fonciere_archived' using errcode='42501'; end if;
 end if;
 perform app_private.validate_fonciere_payload(v_id,p_payload);
 if not app_private.module_allowed('contacts') then
  if coalesce(p_contact,'')<>'' or coalesce(p_agency_contact,'')<>'' then raise exception 'fonciere_contact_forbidden' using errcode='42501'; end if;
  -- Empty client projections must never remove links that the caller cannot see.
 else
  select contact_id,agency_contact_id into agent,agency from public.fonciere_project_contacts where project_id=v_id;
  agent:=coalesce(p_contact,agent,''); agency:=coalesce(p_agency_contact,agency,'');
  perform 1 from public.crm_workspace_state where workspace_id='oneaddress-riviera' for share;
  foreach link in array array[agent,agency] loop
   if length(link)>180 or link<>'' and not exists(select 1 from public.crm_workspace_state w
    cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) c
    where w.workspace_id='oneaddress-riviera' and c->>'id'=link)
   then raise exception 'fonciere_contact_missing' using errcode='42501'; end if;
  end loop;
  if agency<>'' and not exists(select 1 from public.crm_workspace_state w
   cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) c
   where w.workspace_id='oneaddress-riviera' and c->>'id'=agency and c->>'entityType'='company')
  then raise exception 'fonciere_agency_company_required' using errcode='22023'; end if;
 end if;
 if p_id is null then insert into public.fonciere_projects(id,owner_id,title,payload) values(v_id,auth.uid(),p_payload->'data'->>'name',p_payload);
 else update public.fonciere_projects set title=p_payload->'data'->>'name',payload=p_payload,revision=revision+1,updated_at=clock_timestamp() where id=p_id; end if;
 if app_private.module_allowed('contacts') then
  if agent='' and agency='' then delete from public.fonciere_project_contacts where project_id=v_id;
  else insert into public.fonciere_project_contacts(project_id,contact_id,agency_contact_id) values(v_id,agent,agency)
   on conflict(project_id) do update set contact_id=excluded.contact_id,agency_contact_id=excluded.agency_contact_id; end if;
 end if;
 return v_id;
end $$;

create or replace function app_private.assign_fonciere_project(p_project uuid,p_user uuid,p_assigned boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.can_fonciere_project(p_project,true) or not app_private.workspace_role('izord',array['admin','partner']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 if p_assigned then
  if not exists(select 1 from public.app_memberships where user_id=p_user and workspace_id='izord' and status='active') then raise exception 'fonciere_member_required' using errcode='42501'; end if;
  insert into public.fonciere_project_assignments values(p_project,p_user) on conflict do nothing;
 else delete from public.fonciere_project_assignments where project_id=p_project and user_id=p_user; end if;
end $$;

-- Native project-assignment mutations invalidate the recipient's current view
-- and operation leases. Administration already bumps the same revision once in
-- its enclosing transaction and deliberately calls the unchanged private guard.
create function app_private.assign_fonciere_project_and_invalidate(p_project uuid,p_user uuid,p_assigned boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare prior_assignment boolean;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if p_project is null or p_user is null or p_assigned is null then raise exception 'invalid_fonciere_assignment' using errcode='22023'; end if;
 if not app_private.can_fonciere_project(p_project,true) or not app_private.workspace_role('izord',array['admin','partner']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 -- Serialize recipient invalidation with another native assignment mutation.
 perform 1 from public.crm_access_profiles where user_id=p_user for update;
 select exists(select 1 from public.fonciere_project_assignments where project_id=p_project and user_id=p_user) into prior_assignment;
 perform app_private.assign_fonciere_project(p_project,p_user,p_assigned);
 if prior_assignment is distinct from p_assigned then
  update public.crm_access_profiles set revision=revision+1,updated_at=clock_timestamp() where user_id=p_user;
 end if;
end $$;
revoke all on function app_private.assign_fonciere_project_and_invalidate(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.assign_fonciere_project_and_invalidate(uuid,uuid,boolean) to authenticated;
create or replace function public.fonciere_assign_project(p_project uuid,p_user uuid,p_assigned boolean) returns void
language sql security invoker set search_path=pg_catalog as $$
 select app_private.assign_fonciere_project_and_invalidate(p_project,p_user,p_assigned);
$$;

create or replace function app_private.fonciere_access_options(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.can_fonciere_project(p_project,true) or not app_private.workspace_role('izord',array['admin','partner']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'email',coalesce(u.email,''),'role',m.role,
 'assigned',exists(select 1 from public.fonciere_project_assignments a where a.project_id=p_project and a.user_id=m.user_id),
 'inherited',m.role in ('admin','partner') or m.role='contributor' and exists(select 1 from public.fonciere_projects p where p.id=p_project and p.owner_id=m.user_id)) order by lower(coalesce(u.email,'')))
 from public.app_memberships m join auth.users u on u.id=m.user_id where m.workspace_id='izord' and m.status='active'),'[]'::jsonb);
end $$;

create or replace function public.crm_admin_users() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 return jsonb_build_object('users',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'confirmed',u.email_confirmed_at is not null,'active',coalesce(p.active,false),'generalAdmin',coalesce(p.general_admin,false),'revision',coalesce(p.revision,0),
  'modules',coalesce((select jsonb_object_agg(module,jsonb_build_object('level',level,'sensitive',sensitive)) from public.crm_module_grants where user_id=u.id),'{}'),
  'izordRole',(select role from public.app_memberships where user_id=u.id and workspace_id='izord' and status='active'),
  'assignments',coalesce((select jsonb_agg(project_id order by project_id) from public.izord_project_assignments where user_id=u.id),'[]'),
  'fonciereAssignments',coalesce((select jsonb_agg(project_id order by project_id) from public.fonciere_project_assignments where user_id=u.id),'[]')) order by lower(coalesce(u.email,'')),u.id),'[]') from auth.users u left join public.crm_access_profiles p on p.user_id=u.id),
  'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title) order by lower(title),id),'[]') from public.izord_projects),
  'canAssignFonciere',app_private.module_allowed('fonciere',true) and app_private.workspace_role('izord',array['admin','partner']),
  'fonciereProjects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'ownerId',owner_id,'status',status) order by lower(title),id),'[]') from public.fonciere_projects where app_private.can_fonciere_project(id,true) and app_private.workspace_role('izord',array['admin','partner'])),
  'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'created_by',i.created_by)),'[]') from public.crm_access_invitations i where i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp()),
  'history',(select coalesce(jsonb_agg(e),'[]') from (select * from public.crm_permission_events order by id desc limit 100) e));
end $$;

-- New signature is explicit; the old signature remains a preserving wrapper.
create function public.crm_admin_save(p_user uuid,p_revision bigint,p_active boolean,p_general_admin boolean,p_grants jsonb,p_izord_role text,p_assignments uuid[],p_fonciere_assignments uuid[]) returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare actual bigint; next_revision bigint; target_project_id uuid;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
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
create or replace function public.crm_admin_save(p_user uuid,p_revision bigint,p_active boolean,p_general_admin boolean,p_grants jsonb,p_izord_role text,p_assignments uuid[]) returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare preserved_grant jsonb;
begin
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 -- An older caller cannot erase a module that its registry did not contain.
 -- Explicit fonciere:none is still an intentional revocation.
 if not(p_grants?'fonciere') then
  select jsonb_build_object('level',level,'sensitive',sensitive) into preserved_grant
   from public.crm_module_grants where user_id=p_user and module='fonciere';
  if preserved_grant is not null then p_grants:=p_grants||jsonb_build_object('fonciere',preserved_grant); end if;
 end if;
 return public.crm_admin_save(p_user,p_revision,p_active,p_general_admin,p_grants,p_izord_role,p_assignments,null);
end $$;
revoke all on function public.crm_admin_save(uuid,bigint,boolean,boolean,jsonb,text,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.crm_admin_save(uuid,bigint,boolean,boolean,jsonb,text,uuid[],uuid[]) to authenticated;


create or replace function public.crm_invite_prepare(p_email text,p_grants jsonb,p_izord_role text,p_assignments uuid[],p_fonciere_assignments uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare token text:=gen_random_uuid()::text||gen_random_uuid()::text; id uuid;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 perform app_private.validate_grants(p_grants);
 if p_email is null or length(p_email)>254 or p_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'invalid_email'; end if;
 if (coalesce(p_grants->'izord'->>'level','none')<>'none' or coalesce(p_grants->'fonciere'->>'level','none')<>'none') and (p_izord_role is null or p_izord_role not in ('reader','contributor','partner','admin')) then raise exception 'izord_role_required'; end if;
 if exists(select 1 from unnest(p_assignments) a where not exists(select 1 from public.izord_projects project where project.id=a)) then raise exception 'unknown_project'; end if;
 if p_izord_role is not null and p_izord_role not in ('reader','contributor','partner','admin') then raise exception 'invalid_izord_role' using errcode='22023'; end if;
 if cardinality(p_fonciere_assignments)>0 and p_izord_role is null then raise exception 'izord_role_required' using errcode='22023'; end if;
 if p_fonciere_assignments is null or p_assignments is null then raise exception 'invalid_access_parameters' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_fonciere_assignments) a where a is null or not app_private.can_fonciere_project(a,true) or not app_private.workspace_role('izord',array['admin','partner'])) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 update public.crm_access_invitations set revoked_at=clock_timestamp() where email=lower(btrim(p_email)) and accepted_at is null and revoked_at is null;
 insert into public.crm_access_invitations(email,token_hash,grants,izord_role,assignments,fonciere_assignments,created_by) values(lower(btrim(p_email)),sha256(convert_to(token,'UTF8')),p_grants,p_izord_role,p_assignments,p_fonciere_assignments,auth.uid()) returning crm_access_invitations.id into id;
 insert into public.crm_permission_events(actor_id,subject_id,action) values(auth.uid(),id,'invitation_prepared');
 -- Auth existence and password initialization are separate: a previous invite
 -- can already have created the account without completing its onboarding.
 -- Only this boolean leaves Auth; never expose a password hash or trust metadata.
 return jsonb_build_object('id',id,'token',token,
  'existingUser',exists(select 1 from auth.users u where lower(u.email)=lower(btrim(p_email))),
  'needsPasswordSetup',not exists(select 1 from auth.users u where lower(u.email)=lower(btrim(p_email)) and coalesce(u.encrypted_password,'')<>''));
end $$;

create or replace function public.crm_invite_prepare(p_email text,p_grants jsonb,p_izord_role text default null,p_assignments uuid[] default '{}') returns jsonb
language sql security invoker set search_path=pg_catalog as $$
 select public.crm_invite_prepare(p_email,p_grants,p_izord_role,p_assignments,'{}'::uuid[]);
$$;
revoke all on function public.crm_invite_prepare(text,jsonb,text,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.crm_invite_prepare(text,jsonb,text,uuid[],uuid[]) to authenticated;


create or replace function public.crm_invite_accept(p_token text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.crm_access_invitations%rowtype; email text;
begin
 perform pg_advisory_xact_lock(734991);
 select lower(u.email) into email from auth.users u where id=auth.uid() and email_confirmed_at is not null;
 select * into i from public.crm_access_invitations where token_hash=sha256(convert_to(p_token,'UTF8')) for update;
 if not found or email is null or i.email<>email or i.expires_at<=clock_timestamp() or i.revoked_at is not null or i.accepted_at is not null
 or not exists(select 1 from public.crm_access_profiles where user_id=i.created_by and active and general_admin) then raise exception 'invalid_invitation' using errcode='42501'; end if;
 if exists(select 1 from public.crm_module_grants where user_id=auth.uid() and level<>'none') then raise exception 'existing_access_requires_admin_review'; end if;
 if exists(select 1 from public.crm_access_profiles where user_id=auth.uid() and general_admin) then raise exception 'existing_admin_requires_review' using errcode='42501'; end if;
 if i.izord_role is not null and exists(select 1 from public.app_memberships m where m.user_id=auth.uid() and m.workspace_id='izord' and (m.role<>i.izord_role or m.status<>'active' or exists(select 1 from unnest(i.assignments) a where not exists(select 1 from public.izord_project_assignments x where x.user_id=auth.uid() and x.project_id=a)))) then raise exception 'existing_izord_requires_review' using errcode='42501'; end if;
 if cardinality(i.fonciere_assignments)>0 and not exists(select 1 from public.crm_access_profiles cp join public.crm_module_grants cg on cg.user_id=cp.user_id and cg.module='fonciere' join public.app_memberships cm on cm.user_id=cp.user_id and cm.workspace_id='izord' where cp.user_id=i.created_by and cp.active and cp.general_admin and cg.level='contribute' and cm.status='active' and cm.role in ('admin','partner')) then raise exception 'fonciere_inviter_access_changed' using errcode='42501'; end if;
 if cardinality(i.fonciere_assignments)>0 and (i.izord_role is null or exists(select 1 from unnest(i.fonciere_assignments) a where not exists(select 1 from public.fonciere_projects p where p.id=a))) then raise exception 'invalid_fonciere_assignment' using errcode='42501'; end if;
 perform app_private.validate_grants(i.grants);
 insert into public.crm_access_profiles(user_id) values(auth.uid()) on conflict(user_id) do update set active=true,general_admin=false,revision=crm_access_profiles.revision+1;
 delete from public.crm_module_grants where user_id=auth.uid();
 insert into public.crm_module_grants select auth.uid(),key,value->>'level',coalesce(value->'sensitive','{}') from jsonb_each(i.grants);
 if exists(select 1 from jsonb_each(i.grants) g where g.key not in ('fonciere','izord','publisher') and g.value->>'level'<>'none') then
 insert into public.app_memberships(user_id,workspace_id,role) values(auth.uid(),'oar','member') on conflict(user_id,workspace_id) do update set status='active'; end if;
 if i.izord_role is not null then
 -- Do not replace an existing role through invitation acceptance.
 insert into public.app_memberships(user_id,workspace_id,role) values(auth.uid(),'izord',i.izord_role) on conflict do nothing; end if;
 insert into public.izord_project_assignments select distinct x,auth.uid() from unnest(i.assignments) x where i.izord_role is not null on conflict do nothing;
 insert into public.fonciere_project_assignments select distinct x,auth.uid() from unnest(i.fonciere_assignments) x where i.izord_role is not null on conflict do nothing;
 update public.crm_access_invitations set accepted_at=clock_timestamp() where id=i.id;
 insert into public.crm_permission_events(actor_id,subject_id,action) values(auth.uid(),i.id,'invitation_accepted');
end $$;

create or replace function app_private.task_target_module(p_type text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case p_type when 'contact' then 'contacts' when 'lead' then 'leads' when 'quote' then 'quotes'
 when 'booking' then 'bookings' when 'vendor_quote' then 'vendorQuotes' when 'vendor_invoice' then 'vendorInvoices'
 when 'bank_account' then 'contacts' when 'worker' then 'houseTracking' when 'worker_period' then 'houseTracking'
 when 'time_entry' then 'houseTracking' when 'staff_payment' then 'houseTracking' when 'house' then 'houseTracking'
 when 'property' then 'properties' when 'vehicle' then 'vehicles' when 'boat' then 'boats' when 'planning_entry' then 'planning'
 when 'fonciere_project' then 'fonciere' when 'presentation' then 'izord' when 'document' then 'documents'
 when 'folder' then 'documents' when 'monthly_charges' then 'monthlyCharges' when 'publisher_creation' then 'publisher' end;
$$;

create or replace function app_private.task_target_resolve_before_house_address(p_ref jsonb,p_for_add boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ref jsonb:=app_private.task_target_ref(p_ref);kind text:=ref->>'type';identity text:=ref->>'id';ctx jsonb:=coalesce(ref->'context','{}');
 module_name text:=app_private.task_target_module(kind);collection_name text;w jsonb;r jsonb;raw_row jsonb; related jsonb;
 search_related jsonb;search_company jsonb;label_value text;detail_value text:='';status_value text:='';state_value text:='available'; result jsonb;d public.crm_document_scopes%rowtype;
 project_row record; proof app_private.task_publisher_proofs%rowtype;found_row boolean:=false;
begin
 -- Permissions are resolved for this reader on every call, never from a task's author.
 if kind='document' and ctx->>'catalog' in ('fonciere','presentation') then module_name:=case ctx->>'catalog' when 'fonciere' then 'fonciere' else 'izord' end;end if;
 if not app_private.module_allowed(module_name) then return '{"state":"inaccessible"}'::jsonb;end if;
 if kind='bank_account' and not app_private.module_allowed('contacts',false,'bank_read') then return '{"state":"inaccessible"}'::jsonb;end if;
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 collection_name:=case kind when 'contact' then 'contacts' when 'lead' then 'leads' when 'quote' then 'quotes' when 'booking' then 'quotes'
 when 'vendor_quote' then 'vendorQuotes' when 'vendor_invoice' then 'vendorInvoices' when 'worker' then 'houseTrackingWorkers'
 when 'worker_period' then 'houseTrackingWorkers' when 'time_entry' then 'houseTimeEntries' when 'staff_payment' then 'housePayments'
 when 'house' then 'houseTrackingHouses' when 'property' then 'properties' when 'vehicle' then 'vehicles' when 'boat' then 'boats' when 'planning_entry' then 'planningEntries' end;
 if collection_name is not null then
  select v into raw_row from jsonb_array_elements(coalesce(w->collection_name,'[]')) v where v->>'id'=identity;
  if raw_row is not null then
   r:=app_private.project_record(collection_name,raw_row);found_row:=true;
   label_value:=coalesce(nullif(r->>'title',''),nullif(concat_ws(' ',r->>'firstName',r->>'name'),''),nullif(r->>'companyName',''),nullif(r->>'contactName',''),nullif(r->>'workerName',''),nullif(r->>'model',''),identity);
   status_value:=coalesce(r->>'status','');
   detail_value:=concat_ws(' · ',nullif(r->>'city',''),nullif(r->>'quoteReference',''),nullif(r->>'invoiceReference',''),nullif(r->>'reference',''),nullif(r->>'date',''),nullif(r->>'role',''));
   if kind='contact' then
    if raw_row->>'entityType'='company' then label_value:=coalesce(nullif(raw_row->>'companyName',''),label_value);end if;
    if coalesce(raw_row->>'companyId','')<>'' then
     select c into related from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=raw_row->>'companyId';
    end if;
    detail_value:=concat_ws(' · ',nullif(coalesce(related->>'companyName',raw_row->>'companyName'),''),nullif(r->>'city',''),nullif(r->>'kind',''));
    if coalesce(raw_row->>'mergedIntoCompanyId','')<>'' then state_value:='archived';status_value:='Entreprise consolidée';end if;
   elsif kind='booking' then
    if raw_row->>'status' is distinct from 'Accepted' then state_value:='archived';if p_for_add then found_row:=false;end if;end if;
    status_value:=coalesce(r->>'bookingStatus',r->>'status','');
   elsif kind='worker' or kind='worker_period' then
    if not app_private.module_allowed('contacts') then label_value:='Intervenant · '||identity;end if;
    if raw_row->>'status'='Inactif' then state_value:='archived';end if;
    if kind='worker_period' then
     if ctx?'houseId' and not exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId') then found_row:=false;end if;
     detail_value:=concat_ws(' · ',ctx->>'startDate',ctx->>'endDate',case when ctx?'houseId' then (select h->>'name' from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId') end);
    end if;
   elsif kind in ('time_entry','staff_payment') then
    label_value:=concat_ws(' · ',case when app_private.module_allowed('contacts') then r->>'workerName' else 'Intervenant' end,nullif(r->>'date',''));
    detail_value:=coalesce(r->>'houseName','');
   end if;
  end if;
 elsif kind='bank_account' then
  select c into raw_row from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=ctx->>'contactId';
  select a into r from jsonb_array_elements(coalesce(raw_row->'supplierBankAccounts','[]')) a where a->>'id'=identity;
  found_row:=r is not null;
  label_value:=concat_ws(' · ',case when raw_row->>'entityType'='company' then coalesce(nullif(raw_row->>'companyName',''),'Entreprise') else coalesce(nullif(concat_ws(' ',raw_row->>'firstName',raw_row->>'name'),''),nullif(raw_row->>'companyName',''),'Contact') end,coalesce(nullif(r->>'label',''),'Compte bancaire'));
  detail_value:=coalesce(r->>'bankName','');status_value:=coalesce(r->>'status','');
  if status_value='Archivé' then state_value:='archived';end if;
 elsif kind='fonciere_project' then
  if not app_private.can_fonciere_project(identity::uuid) then return '{"state":"inaccessible"}'::jsonb;end if;
  select * into project_row from public.fonciere_projects where id=identity::uuid;
  found_row:=found;label_value:=project_row.title;status_value:=project_row.status;
  if status_value='archived' then state_value:='archived';end if;
 elsif kind='presentation' then
  if not app_private.can_project(identity::uuid) then return '{"state":"inaccessible"}'::jsonb;end if;
  if ctx?'revision' then
   select title,status,revision into project_row from public.izord_project_versions where project_id=identity::uuid and revision=(ctx->>'revision')::integer;
  else select title,status,revision into project_row from public.izord_projects where id=identity::uuid;end if;
  found_row:=found;
  if found_row then label_value:=project_row.title;status_value:=project_row.status;detail_value:='Révision '||project_row.revision;end if;
 elsif kind='document' then
  if ctx->>'catalog'='fonciere' then
   select * into project_row from public.fonciere_assets where id::text=identity and project_id::text=ctx->>'projectId';
   if not found or not app_private.can_fonciere_asset(project_row.object_path) then return '{"state":"inaccessible"}'::jsonb;end if;
   found_row:=not p_for_add or project_row.lifecycle='finalized';label_value:=project_row.original_name;status_value:=project_row.lifecycle;
  elsif ctx->>'catalog'='presentation' then
   select * into project_row from public.izord_assets where id::text=identity and project_id::text=ctx->>'projectId';
   if not found or not app_private.can_asset(project_row.object_path) then return '{"state":"inaccessible"}'::jsonb;end if;
   found_row:=not p_for_add or project_row.lifecycle='finalized';label_value:=coalesce(to_jsonb(project_row)->>'original_name',project_row.kind);status_value:=coalesce(to_jsonb(project_row)->>'lifecycle','');
  else
   select * into d from public.crm_document_scopes where provider=ctx->>'provider' and resource_id=identity;
   if not found or not app_private.document_allowed(d.provider,d.resource_id) then return '{"state":"inaccessible"}'::jsonb;end if;
   found_row:=true;label_value:=d.title;detail_value:=d.folder;status_value:=coalesce(d.lifecycle,'');
   if d.superseded_by is not null or d.lifecycle='superseded' then state_value:='archived';status_value:='Remplacé';end if;
  end if;
 elsif kind='folder' then
  -- Existing folder write/catalogue access is owner-only; never infer it from a task.
  if not app_private.full_access() then return '{"state":"inaccessible"}'::jsonb;end if;
  if ctx->>'catalog'='drive_registry' then
   select to_jsonb(f) into r from public.crm_drive_folder_registry f where workspace_id='oneaddress-riviera' and drive_folder_id=identity and status='ready';
   found_row:=r is not null;label_value:='Dossier prestataire';detail_value:=coalesce(r->>'logical_key','');
  else
   select f into r from jsonb_array_elements(coalesce(w->'documents','[]')) f where f->>'id'=identity and f->>'isFolder'='true';
   found_row:=r is not null;label_value:=coalesce(r->>'title','Dossier');
  end if;
 elsif kind='monthly_charges' then
  if not app_private.module_allowed(case ctx->>'source' when 'invoice' then 'vendorInvoices' else 'houseTracking' end) then return '{"state":"inaccessible"}'::jsonb;end if;
  found_row:=true;
  if ctx?'personId' then
   if ctx->>'source'='hours' then
    found_row:=exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingWorkers','[]')) x where x->>'id'=ctx->>'personId') or exists(select 1 from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) x where x->>'workerId'=ctx->>'personId');
   else
    found_row:=(app_private.module_allowed('contacts') and exists(select 1 from jsonb_array_elements(coalesce(w->'contacts','[]')) x where x->>'id'=ctx->>'personId' and x->>'kind'='Prestataire')) or exists(select 1 from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) x where x->>'contactId'=ctx->>'personId');
   end if;
  end if;
  if ctx?'houseId' then found_row:=found_row and exists(select 1 from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId');end if;
  label_value:='Charges mensuelles · '||identity;detail_value:=case ctx->>'source' when 'invoice' then 'Factures prestataires' else 'Personnel et interventions' end;
  if ctx?'personId' then
   if ctx->>'source'='hours' then
    select x into related from jsonb_array_elements(coalesce(w->'houseTrackingWorkers','[]')) x where x->>'id'=ctx->>'personId';
    if related is null then select x into related from jsonb_array_elements(coalesce(w->'houseTimeEntries','[]')) x where x->>'workerId'=ctx->>'personId' limit 1;end if;
    label_value:=label_value||' · '||case when app_private.module_allowed('contacts') then coalesce(nullif(related->>'contactName',''),nullif(related->>'workerName',''),'Intervenant') else 'Intervenant' end;
   else
    if app_private.module_allowed('contacts') then select x into related from jsonb_array_elements(coalesce(w->'contacts','[]')) x where x->>'id'=ctx->>'personId';end if;
    label_value:=label_value||' · '||case when app_private.module_allowed('contacts') then coalesce(nullif(related->>'companyName',''),nullif(concat_ws(' ',related->>'firstName',related->>'name'),''),'Fournisseur') else 'Fournisseur' end;
   end if;
   detail_value:=detail_value||' · '||(ctx->>'personId');
  end if;
  if ctx?'houseId' then detail_value:=concat_ws(' · ',detail_value,(select h->>'name' from jsonb_array_elements(coalesce(w->'houseTrackingHouses','[]')) h where h->>'id'=ctx->>'houseId'));end if;
 elsif kind='publisher_creation' then
  if p_for_add then select * into proof from app_private.task_publisher_proofs where user_id=auth.uid() and target_id=identity;
  else select * into proof from app_private.task_publisher_proofs where target_id=identity order by checked_at desc limit 1;end if;
  if not found then return '{"state":"inaccessible"}'::jsonb;end if;
  found_row:=proof.present and (not p_for_add or proof.checked_at>clock_timestamp()-interval '60 seconds');
  label_value:='Création Publisher';
 end if;
 if not found_row then return jsonb_build_object('ref',ref,'state','deleted','label','Élément supprimé ou indisponible');end if;
 if app_private.module_allowed('contacts') then
  if kind in ('contact','bank_account') then search_related:=raw_row;
  elsif coalesce(r->>'contactId','')<>'' then select c into search_related from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=r->>'contactId';end if;
  if coalesce(search_related->>'companyId','')<>'' then select c into search_company from jsonb_array_elements(coalesce(w->'contacts','[]')) c where c->>'id'=search_related->>'companyId';end if;
 end if;
 if kind='bank_account' then detail_value:=concat_ws(' · ',nullif(detail_value,''),nullif(search_related->>'city',''),nullif(coalesce(search_company->>'companyName',search_related->>'companyName'),''));end if;
 result:=jsonb_build_object('ref',ref,'state',state_value,'label',coalesce(nullif(label_value,''),identity),'detail',detail_value,'status',status_value);
 if r is not null then
  result:=result||jsonb_build_object('searchFields',(select jsonb_agg(value) from jsonb_array_elements(jsonb_build_array(label_value,detail_value,identity,r->>'companyName',r->>'city',r->>'reference',r->>'quoteReference',r->>'invoiceReference',r->>'clientName',r->>'contactName',r->>'brand',r->>'model',r->>'port',search_related->>'firstName',search_related->>'name',search_related->>'companyName',search_related->>'city',search_company->>'companyName')) x(value) where jsonb_typeof(value)='string'));
 end if;
 if kind='vendor_invoice' then result:=result||jsonb_build_object('financial',jsonb_build_object('amount',r->'amount','paidAmount',r->'paidAmount','dueDate',r->>'dueDate','status',r->>'status'));end if;
 if kind in ('vendor_invoice','vendor_quote','quote','booking') and app_private.task_civil_date(coalesce(r->>'dueDate',r->>'paymentDueDate',r->>'validUntil')) then result:=result||jsonb_build_object('dueDate',coalesce(r->>'dueDate',r->>'paymentDueDate',r->>'validUntil'));end if;
 return result;
end $$;

create or replace function app_private.task_target_candidates() returns setof jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w jsonb;r jsonb;c record;ref jsonb;p record;month_value text:=to_char(timezone('Europe/Paris',clock_timestamp()),'YYYY-MM');start_value text;end_value text;
begin
 start_value:=month_value||'-01';end_value:=to_char((start_value::date+interval '1 month'-interval '1 day')::date,'YYYY-MM-DD');
 select payload into w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 for c in select * from (values
 ('contacts','contact','contacts'),('leads','lead','leads'),('quotes','quote','quotes'),('quotes','booking','bookings'),
 ('vendorQuotes','vendor_quote','vendorQuotes'),('vendorInvoices','vendor_invoice','vendorInvoices'),('houseTrackingWorkers','worker','houseTracking'),
 ('houseTimeEntries','time_entry','houseTracking'),('housePayments','staff_payment','houseTracking'),('houseTrackingHouses','house','houseTracking'),
 ('properties','property','properties'),('vehicles','vehicle','vehicles'),('boats','boat','boats'),('planningEntries','planning_entry','planning')) x(collection_name,kind,module_name)
 loop
  if not app_private.module_allowed(c.module_name) then continue;end if;
  for r in select * from jsonb_array_elements(coalesce(w->c.collection_name,'[]')) loop
   if coalesce(r->>'id','')='' or (c.kind='booking' and r->>'status' is distinct from 'Accepted') then continue;end if;
   return next jsonb_build_object('type',c.kind,'id',r->>'id');
   if c.kind='worker' then
    return next jsonb_build_object('type','worker_period','id',r->>'id','context',jsonb_build_object('startDate',start_value,'endDate',end_value));
    if app_private.module_allowed('monthlyCharges') then return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','hours','personId',r->>'id'));end if;
   end if;
   if c.kind='contact' and app_private.module_allowed('contacts',false,'bank_read') then
    for ref in select * from jsonb_array_elements(coalesce(r->'supplierBankAccounts','[]')) loop
     if coalesce(ref->>'id','')<>'' then return next jsonb_build_object('type','bank_account','id',ref->>'id','context',jsonb_build_object('contactId',r->>'id'));end if;
    end loop;
   end if;
  end loop;
 end loop;
 if app_private.module_allowed('fonciere') then
  for p in select * from public.fonciere_projects where app_private.can_fonciere_project(id) loop
   return next jsonb_build_object('type','fonciere_project','id',p.id::text);
  end loop;
  for p in select a.* from public.fonciere_assets a where a.lifecycle='finalized' and app_private.can_fonciere_asset(a.object_path) loop
   return next jsonb_build_object('type','document','id',p.id::text,'context',jsonb_build_object('catalog','fonciere','projectId',p.project_id::text));
  end loop;
 end if;
 if app_private.module_allowed('izord') then
  for p in select * from public.izord_projects where app_private.can_project(id) loop
   return next jsonb_build_object('type','presentation','id',p.id::text);
  end loop;
  for p in select a.* from public.izord_assets a where a.lifecycle='finalized' and app_private.can_asset(a.object_path) loop
   return next jsonb_build_object('type','document','id',p.id::text,'context',jsonb_build_object('catalog','presentation','projectId',p.project_id::text));
  end loop;
 end if;
 if app_private.module_allowed('documents') then
  for p in select * from public.crm_document_scopes d where app_private.document_allowed(d.provider,d.resource_id) loop
   return next jsonb_build_object('type','document','id',p.resource_id,'context',jsonb_build_object('provider',p.provider));
  end loop;
  if app_private.full_access() then
   for r in select f from jsonb_array_elements(coalesce(w->'documents','[]')) f where f->>'isFolder'='true' loop
    return next jsonb_build_object('type','folder','id',r->>'id');
   end loop;
   for p in select * from public.crm_drive_folder_registry where workspace_id='oneaddress-riviera' and status='ready' loop
    return next jsonb_build_object('type','folder','id',p.drive_folder_id,'context',jsonb_build_object('catalog','drive_registry'));
   end loop;
  end if;
 end if;
 if app_private.module_allowed('monthlyCharges') then
  if app_private.module_allowed('vendorInvoices') then
   return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','invoice'));
   for r in select distinct jsonb_build_object('personId',v->>'contactId') from jsonb_array_elements(coalesce(w->'vendorInvoices','[]')) v where coalesce(v->>'contactId','')<>'' loop
    return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','invoice')||r);
   end loop;
  end if;
  if app_private.module_allowed('houseTracking') then
   return next jsonb_build_object('type','monthly_charges','id',month_value,'context',jsonb_build_object('source','hours'));
  end if;
 end if;
end $$;

create or replace function app_private.task_target_export_allowed(p_ref jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare ref jsonb:=app_private.task_target_ref(p_ref);kind text:=ref->>'type';ctx jsonb:=coalesce(ref->'context','{}');module_name text:=app_private.task_target_module(kind);d public.crm_document_scopes%rowtype;
begin
 if kind='document' and ctx->>'catalog' in ('fonciere','presentation') then module_name:=case ctx->>'catalog' when 'fonciere' then 'fonciere' else 'izord' end;end if;
 -- Preserve the pre-existing presentation-export ceiling for task CSV labels.
 -- This does not gate project reads, task search/open or private-file consulting;
 -- Fonciere exposes no new generic Export permission in Administration.
 if module_name='fonciere' then
  return app_private.module_allowed('izord',false,'export')
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

-- Fail atomically if any pre-existing effective module/business access changed.
do $$ declare previous jsonb; current_state jsonb; previous_hashes jsonb; current_hashes jsonb; begin
 select before_effective,before_data_hashes into previous,previous_hashes from app_private.fonciere_permission_migration_journal where migration='20261027124814_fonciere_module_permissions';
 current_state:=app_private.fonciere_effective_access_snapshot(true);
 current_hashes:=app_private.fonciere_permission_data_hashes();
 if previous is distinct from current_state then raise exception 'fonciere_permission_compatibility_mismatch' using errcode='23514'; end if;
 if previous_hashes is distinct from current_hashes then raise exception 'fonciere_business_data_changed' using errcode='23514'; end if;
 update app_private.fonciere_permission_migration_journal set completed_at=clock_timestamp(),after_effective=current_state,after_data_hashes=current_hashes,
  compatibility_grants=coalesce((select jsonb_agg(to_jsonb(g) order by g.user_id) from public.crm_module_grants g where g.module='fonciere'),'[]')
 where migration='20261027124814_fonciere_module_permissions';
end $$;
notify pgrst,'reload schema';
commit;
