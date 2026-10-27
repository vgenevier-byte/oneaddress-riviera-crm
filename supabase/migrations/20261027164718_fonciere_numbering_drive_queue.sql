-- Stable business references and a transactionally populated, server-owned outbox.
-- Existing UUIDs, dates, permissions, source objects and presentation snapshots remain unchanged.
begin;
lock table public.fonciere_projects in exclusive mode;
create table app_private.fonciere_numbering_backup (
 project_id uuid primary key, original_row jsonb not null, project_number bigint unique,
 backed_up_at timestamptz not null default clock_timestamp()
);
insert into app_private.fonciere_numbering_backup(project_id,original_row)
 select id,to_jsonb(p) from public.fonciere_projects p order by created_at,id;
create sequence app_private.fonciere_project_number_seq as bigint minvalue 1 no cycle;
alter table public.fonciere_projects add column project_number bigint,
 add column creation_key uuid unique;
with numbered as (select id,row_number() over(order by created_at asc,id asc) n from public.fonciere_projects)
 update public.fonciere_projects p set project_number=n.n from numbered n where p.id=n.id;
update app_private.fonciere_numbering_backup b set project_number=p.project_number from public.fonciere_projects p where p.id=b.project_id;
select setval('app_private.fonciere_project_number_seq',greatest(coalesce((select max(project_number) from public.fonciere_projects),0),1),exists(select 1 from public.fonciere_projects));
alter table public.fonciere_projects alter column project_number set not null,
 alter column project_number set default nextval('app_private.fonciere_project_number_seq'),
 add constraint fonciere_project_number_positive check(project_number>0),
 add constraint fonciere_project_number_unique unique(project_number),
 add column project_reference text generated always as ('PRJ-'||lpad(project_number::text,greatest(6,length(project_number::text)),'0')) stored;
create function app_private.guard_fonciere_number() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then
  if nullif(current_setting('app.fonciere_creation_key',true),'') is null then raise exception 'creation_key_required' using errcode='22023';end if;
  new.creation_key:=current_setting('app.fonciere_creation_key',true)::uuid;
  return new;
 end if;
 if new.project_number is distinct from old.project_number or new.creation_key is distinct from old.creation_key then
  raise exception 'immutable_fonciere_reference' using errcode='42501';
 end if;
 return new;
end $$;
create trigger fonciere_immutable_reference before insert or update on public.fonciere_projects for each row execute function app_private.guard_fonciere_number();
-- Creation replay serializes by the durable random key, before allocating a number.
create function app_private.create_fonciere_project(p_creation_key uuid,p_payload jsonb,p_contact text,p_agency_contact text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare existing public.fonciere_projects%rowtype; identity uuid;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if auth.uid() is null or not app_private.module_allowed('fonciere',true) or not app_private.workspace_role('izord',array['admin','partner','contributor']) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
 if p_creation_key is null then raise exception 'creation_key_required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fonciere-create:'||p_creation_key::text,0));
 select * into existing from public.fonciere_projects where creation_key=p_creation_key;
 if found then
  if existing.owner_id<>auth.uid() or not app_private.can_fonciere_project(existing.id,true) then raise exception 'fonciere_forbidden' using errcode='42501'; end if;
  return existing.id;
 end if;
 perform set_config('app.fonciere_creation_key',p_creation_key::text,true);
 identity:=app_private.save_fonciere_project(null,null,p_payload,p_contact,p_agency_contact);
 perform set_config('app.fonciere_creation_key','',true);
 return identity;
end $$;
create function public.fonciere_create_project(p_creation_key uuid,p_payload jsonb,p_contact text default null,p_agency_contact text default null) returns uuid
language sql security invoker set search_path=pg_catalog as $$ select app_private.create_fonciere_project(p_creation_key,p_payload,p_contact,p_agency_contact); $$;


-- The import's known category is recorded before finalization/save and copied to the outbox.
alter table public.fonciere_assets add column drive_category text not null default 'other' check(drive_category in ('agency','plans','photos','other'));
update public.fonciere_assets set drive_category=case when kind='photo' then 'photos' when kind='pdf' then 'agency' else 'other' end;
create function app_private.register_fonciere_asset(p_project uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text,p_category text) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare path text;
begin
 if p_category is null or p_category not in ('agency','plans','photos','other') then raise exception 'invalid_fonciere_drive_category' using errcode='22023';end if;
 path:=app_private.register_fonciere_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name);
 update public.fonciere_assets set drive_category=p_category where object_path=path;
 return path;
end $$;
create function public.fonciere_register_asset(p_project uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text,p_category text) returns text
language sql security invoker set search_path=pg_catalog as $$select app_private.register_fonciere_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name,p_category);$$;
revoke all on function app_private.register_fonciere_asset(uuid,integer,text,bigint,text,text,text),public.fonciere_register_asset(uuid,integer,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function app_private.register_fonciere_asset(uuid,integer,text,bigint,text,text,text),public.fonciere_register_asset(uuid,integer,text,bigint,text,text,text) to authenticated;

create table app_private.fonciere_drive_config (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 shared_drive_id text, root_folder_id text, root_parent_id text, reserved_root_id text,
 updated_at timestamptz not null default clock_timestamp()
);
insert into app_private.fonciere_drive_config(singleton) values(true);
create table app_private.fonciere_drive_folders (
 project_id uuid not null references public.fonciere_projects(id), category text not null check(category in ('project','agency','plans','photos','other')),
 parent_drive_folder_id text not null, drive_folder_id text unique,
 status text not null default 'creating' check(status in ('creating','ready','error')),
 lease_token uuid, lease_until timestamptz, error text,
 updated_at timestamptz not null default clock_timestamp(), primary key(project_id,category)
);
create table app_private.fonciere_drive_jobs (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.fonciere_projects(id),
 asset_id uuid references public.fonciere_assets(id), storage_object_version text not null,
 job_type text not null check(job_type in ('folder','file')), category text not null check(category in ('agency','plans','photos','other')),
 status text not null default 'pending' check(status in ('pending','processing','synced','retry','cancelled')),
 reserved_file_id text unique, drive_file_id text unique, attempts integer not null default 0,
 next_attempt_at timestamptz not null default clock_timestamp(), lease_token uuid, lease_until timestamptz,
 error text, permanent boolean not null default false, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check((job_type='folder')=(asset_id is null)), unique(project_id,asset_id,storage_object_version)
);
create unique index fonciere_drive_one_folder_job on app_private.fonciere_drive_jobs(project_id) where job_type='folder';
create index fonciere_drive_due on app_private.fonciere_drive_jobs(next_attempt_at) where status in ('pending','retry','processing');
create table app_private.fonciere_drive_events (
 id bigint generated always as identity primary key, job_id uuid, project_id uuid,
 event text not null, detail jsonb not null default '{}', created_at timestamptz not null default clock_timestamp()
);
-- Extract canonical, currently saved references; finalized-but-unreferenced objects never enter the outbox.
create function app_private.fonciere_saved_assets(p_project uuid) returns setof uuid
language sql stable security definer set search_path=pg_catalog as $$
 select distinct a.id from public.fonciere_projects p
 cross join lateral (
  select value from jsonb_each_text(coalesce(p.payload#>'{data,presentationData,photos}','{}'))
  union all select value->>'data' from jsonb_array_elements(coalesce(p.payload#>'{data,presentationData,importGallery}','[]'))
  union all select value#>>'{}' from jsonb_array_elements(coalesce(p.payload->'sourceDocuments','[]'))
 ) refs(value)
 join public.fonciere_assets a on a.project_id=p.id and a.id::text=refs.value and a.lifecycle='finalized'
 where p.id=p_project;
$$;
create function app_private.enqueue_fonciere_drive(p_project uuid,p_rename boolean default true) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_rename then
  insert into app_private.fonciere_drive_jobs(project_id,job_type,category,storage_object_version)
   values(p_project,'folder','other','folder')
   on conflict(project_id) where job_type='folder' do update set status='pending',permanent=false,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp();
 end if;
 insert into app_private.fonciere_drive_jobs(project_id,asset_id,storage_object_version,job_type,category)
 select p_project,a.id,a.storage_object_version,'file',a.drive_category
 from public.fonciere_assets a where a.id in (select app_private.fonciere_saved_assets(p_project))
 on conflict(project_id,asset_id,storage_object_version) do update set status='pending',permanent=false,next_attempt_at=clock_timestamp() where fonciere_drive_jobs.status='cancelled';
end $$;
create function app_private.fonciere_drive_outbox() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then perform app_private.enqueue_fonciere_drive(new.id,true);
 elsif new.payload is distinct from old.payload or new.title is distinct from old.title then
  perform app_private.enqueue_fonciere_drive(new.id,new.title is distinct from old.title);
 end if;
 return new;
end $$;
create trigger fonciere_drive_saved_outbox after insert or update of payload,title on public.fonciere_projects for each row execute function app_private.fonciere_drive_outbox();

-- This single service-only interface is intentionally distinct from general CRM Drive permissions.
create function app_private.fonciere_drive_worker(p_operation text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.fonciere_drive_jobs%rowtype; f app_private.fonciere_drive_folders%rowtype; cfg app_private.fonciere_drive_config%rowtype;
 identity uuid; token uuid; category_value text; file_value text; result jsonb; n integer;
begin
 if p_operation='get_config' then return (select to_jsonb(c) from app_private.fonciere_drive_config c where singleton); end if;
 if p_operation='root_reserve' then
  update app_private.fonciere_drive_config set reserved_root_id=coalesce(reserved_root_id,p_data->>'folder_id'),updated_at=clock_timestamp() where singleton and (reserved_root_id is null or reserved_root_id=p_data->>'folder_id');
  if not found then raise exception 'root_id_already_reserved' using errcode='40001'; end if;
  return (select to_jsonb(c) from app_private.fonciere_drive_config c where singleton);
 end if;
 if p_operation='configure' then
  select * into cfg from app_private.fonciere_drive_config where singleton for update;
  if cfg.root_folder_id is not null and (cfg.root_folder_id is distinct from p_data->>'root_folder_id' or cfg.shared_drive_id is distinct from p_data->>'shared_drive_id' or cfg.root_parent_id is distinct from p_data->>'root_parent_id') then raise exception 'configured_destination_immutable' using errcode='42501'; end if;
  if coalesce(p_data->>'root_folder_id','')='' or coalesce(p_data->>'shared_drive_id','')='' or coalesce(p_data->>'root_parent_id','')='' then raise exception 'destination_required' using errcode='22023'; end if;
  update app_private.fonciere_drive_config set shared_drive_id=p_data->>'shared_drive_id',root_folder_id=p_data->>'root_folder_id',root_parent_id=p_data->>'root_parent_id',enabled=coalesce((p_data->>'enabled')::boolean,true),updated_at=clock_timestamp() where singleton;
  return (select to_jsonb(c) from app_private.fonciere_drive_config c where singleton);
 end if;
 if p_operation='backfill' then
  perform app_private.enqueue_fonciere_drive(p.id,true) from public.fonciere_projects p;
  return jsonb_build_object('projects',(select count(*) from public.fonciere_projects),'files',(select count(*) from app_private.fonciere_drive_jobs where job_type='file'));
 end if;
 if p_operation='report' then
  return jsonb_build_object('config',(select to_jsonb(c) from app_private.fonciere_drive_config c),'references',(select count(*) from public.fonciere_projects),'projects',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select p.id,p.project_reference,p.title,f.drive_folder_id,f.status,f.error from public.fonciere_projects p left join app_private.fonciere_drive_folders f on f.project_id=p.id and f.category='project' order by p.project_number) x),'jobs',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select job_type,status,count(*) count from app_private.fonciere_drive_jobs group by job_type,status) x),'errors',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'asset_id',asset_id,'error',error)),'[]') from app_private.fonciere_drive_jobs where status='retry'));
 end if;
 if p_operation='claim' then
  if not exists(select 1 from app_private.fonciere_drive_config where singleton and enabled and root_folder_id is not null) then return '[]'; end if;
  token:=(p_data->>'lease_token')::uuid;if token is null then raise exception 'lease_token_required';end if;
  -- Removed/withdrawn references are retained in history, but never newly exported.
  update app_private.fonciere_drive_jobs q set status='cancelled',lease_token=null,lease_until=null,updated_at=clock_timestamp()
   where q.job_type='file' and q.status<>'synced' and not exists(select 1 from app_private.fonciere_saved_assets(q.project_id) a where a=q.asset_id);
  with due as (select q.id from app_private.fonciere_drive_jobs q where
   ((q.status in ('pending','retry') and not q.permanent and q.next_attempt_at<=clock_timestamp()) or (q.status='processing' and q.lease_until<clock_timestamp()))
   order by case when q.job_type='folder' then 0 else 1 end,q.next_attempt_at,q.id for update skip locked limit least(greatest(coalesce((p_data->>'limit')::integer,1),1),5)),
  claimed as (update app_private.fonciere_drive_jobs q set status='processing',lease_token=token,lease_until=clock_timestamp()+interval '10 minutes',attempts=attempts+1,updated_at=clock_timestamp() from due where q.id=due.id returning q.*)
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('title',p.title,'project_reference',p.project_reference,'object_path',a.object_path,'expected_size',a.expected_size,'expected_mime',a.expected_mime,'original_name',a.original_name,'storage_object_id',a.storage_object_id)),'[]') into result
  from claimed c join public.fonciere_projects p on p.id=c.project_id left join public.fonciere_assets a on a.id=c.asset_id;
  return result;
 end if;
 if p_operation in ('folder_claim','folder_reserve','folder_ready','folder_fail') then
  identity:=(p_data->>'project_id')::uuid;token:=(p_data->>'lease_token')::uuid;category_value:=p_data->>'category';
  if identity is null or token is null or category_value not in ('project','agency','plans','photos','other') then raise exception 'invalid_folder_identity' using errcode='22023'; end if;
  if p_operation='folder_claim' then
   insert into app_private.fonciere_drive_folders(project_id,category,parent_drive_folder_id,lease_token,lease_until) values(identity,category_value,p_data->>'parent_id',token,clock_timestamp()+interval '10 minutes') on conflict do nothing;
   select * into strict f from app_private.fonciere_drive_folders where project_id=identity and category=category_value for update;
   if f.parent_drive_folder_id is distinct from p_data->>'parent_id' then raise exception 'managed_folder_parent_changed' using errcode='42501'; end if;
   if f.lease_token is distinct from token and f.lease_until>clock_timestamp() then return to_jsonb(f)||jsonb_build_object('claimed',false); end if;
   update app_private.fonciere_drive_folders set lease_token=token,lease_until=clock_timestamp()+interval '10 minutes',status=case when status='error' then 'creating' else status end,updated_at=clock_timestamp() where project_id=identity and category=category_value returning * into f;
   return to_jsonb(f)||jsonb_build_object('claimed',true,'title',(select title from public.fonciere_projects where id=identity),'project_reference',(select project_reference from public.fonciere_projects where id=identity));
  end if;
  select * into strict f from app_private.fonciere_drive_folders where project_id=identity and category=category_value for update;
  if f.lease_token is distinct from token or f.lease_until<=clock_timestamp() then raise exception 'folder_lease_lost' using errcode='40001'; end if;
  file_value:=p_data->>'folder_id';
  if p_operation in ('folder_reserve','folder_ready') then
   if coalesce(file_value,'')='' or (f.drive_folder_id is not null and f.drive_folder_id<>file_value) then raise exception 'managed_folder_identity_changed' using errcode='42501'; end if;
   update app_private.fonciere_drive_folders set drive_folder_id=file_value,status=case when p_operation='folder_ready' then 'ready' else status end,lease_token=case when p_operation='folder_ready' then null else lease_token end,lease_until=case when p_operation='folder_ready' then null else lease_until end,error=null,updated_at=clock_timestamp() where project_id=identity and category=category_value returning * into f;
  else update app_private.fonciere_drive_folders set status='error',error=left(p_data->>'error',500),updated_at=clock_timestamp() where project_id=identity and category=category_value returning * into f;
  end if;
  return to_jsonb(f);
 end if;
 identity:=(p_data->>'id')::uuid;token:=(p_data->>'lease_token')::uuid;
 select * into j from app_private.fonciere_drive_jobs where id=identity for update;
 if not found or j.status<>'processing' or j.lease_token is distinct from token or j.lease_until<=clock_timestamp() then raise exception 'drive_job_lease_lost' using errcode='40001'; end if;
 if p_operation='asset_validate' then
  if j.job_type<>'file' or not exists(select 1 from app_private.fonciere_saved_assets(j.project_id) a where a=j.asset_id) or not exists(select 1 from public.fonciere_assets a join storage.objects o on o.bucket_id='fonciere-documents' and o.name=a.object_path
   where a.id=j.asset_id and a.project_id=j.project_id and a.lifecycle='finalized' and a.storage_object_version=j.storage_object_version
   and o.id=a.storage_object_id and o.version=a.storage_object_version and o.metadata->>'size'=a.expected_size::text and o.metadata->>'mimetype'=a.expected_mime) then raise exception 'fonciere_original_binding_changed' using errcode='42501'; end if;
  return jsonb_build_object('valid',true);
 end if;
 if p_operation='reserve_file' then
  file_value:=p_data->>'file_id';
  if j.job_type<>'file' or coalesce(file_value,'')='' or (j.reserved_file_id is not null and j.reserved_file_id<>file_value) then raise exception 'managed_file_identity_changed' using errcode='42501';end if;
  update app_private.fonciere_drive_jobs set reserved_file_id=file_value,updated_at=clock_timestamp() where id=identity returning * into j;return to_jsonb(j);
 elsif p_operation='complete' then
  if j.job_type='file' and (j.reserved_file_id is null or j.reserved_file_id is distinct from p_data->>'file_id') then raise exception 'unconfirmed_drive_identity' using errcode='42501';end if;
  update app_private.fonciere_drive_jobs set status='synced',drive_file_id=case when job_type='file' then reserved_file_id else null end,error=null,permanent=false,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=identity returning * into j;
 elsif p_operation='fail' then
  update app_private.fonciere_drive_folders set lease_token=null,lease_until=null where lease_token=token and project_id=j.project_id;
  update app_private.fonciere_drive_jobs set status='retry',error=left(coalesce(p_data->>'error','drive_copy_failed'),500),permanent=coalesce((p_data->>'permanent')::boolean,false),next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,15*power(2,least(attempts,8))::integer)),lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=identity returning * into j;
 else raise exception 'unknown_drive_operation' using errcode='22023';end if;
 insert into app_private.fonciere_drive_events(job_id,project_id,event,detail) values(j.id,j.project_id,p_operation,jsonb_build_object('attempt',j.attempts,'state',j.status,'error',j.error));
 return to_jsonb(j);
end $$;
create function public.fonciere_drive_worker(p_operation text,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path=pg_catalog as $$ select app_private.fonciere_drive_worker(p_operation,p_data); $$;

create function app_private.fonciere_drive_status(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; state_value text;
begin
 if not app_private.can_fonciere_project(p_project) then raise exception 'fonciere_forbidden' using errcode='42501';end if;
 select case when bool_or(status='retry') then 'retry' when bool_or(status='processing') then 'processing' when bool_or(status='pending') then 'pending' when count(*)>0 and bool_and(status in ('synced','cancelled')) then 'synced' else 'pending' end into state_value from app_private.fonciere_drive_jobs where project_id=p_project;
 return jsonb_build_object('state',state_value,'configured',coalesce((select enabled from app_private.fonciere_drive_config where singleton),false),'can_retry',app_private.can_fonciere_project(p_project,true),'can_open',app_private.module_allowed('fonciere',false,'export'),
 'project_state',(select status from app_private.fonciere_drive_jobs where project_id=p_project and job_type='folder'),
 'project_error',(select error from app_private.fonciere_drive_jobs where project_id=p_project and job_type='folder'),
 'folder_id',case when app_private.module_allowed('fonciere',false,'export') then (select drive_folder_id from app_private.fonciere_drive_folders where project_id=p_project and category='project' and status='ready') else null end,
 'files',coalesce((select jsonb_agg(jsonb_build_object('asset_id',q.asset_id,'original_name',a.original_name,'state',q.status,'error',q.error,'category',q.category) order by q.created_at,q.id) from app_private.fonciere_drive_jobs q join public.fonciere_assets a on a.id=q.asset_id where q.project_id=p_project and q.status<>'cancelled'),'[]'),
 'counts',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from app_private.fonciere_drive_jobs where project_id=p_project and job_type='file' group by status) counts),'{}'));
end $$;
create function public.fonciere_drive_status(p_project uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_drive_status(p_project);$$;
create function app_private.fonciere_drive_retry(p_project uuid,p_asset uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.can_fonciere_project(p_project,true) then raise exception 'fonciere_forbidden' using errcode='42501';end if;
 update app_private.fonciere_drive_jobs set status='pending',permanent=false,next_attempt_at=clock_timestamp(),error=null,updated_at=clock_timestamp()
 where project_id=p_project and status='retry' and (p_asset is null or asset_id=p_asset);
 insert into app_private.fonciere_drive_events(project_id,event,detail) values(p_project,'retry_requested',jsonb_build_object('asset_id',p_asset,'actor',auth.uid()));
end $$;
create function public.fonciere_drive_retry(p_project uuid,p_asset uuid default null) returns void language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_drive_retry(p_project,p_asset);$$;
create function app_private.fonciere_drive_folder(p_project uuid) returns text
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.can_fonciere_project(p_project) or not app_private.module_allowed('fonciere',false,'export') then raise exception 'fonciere_forbidden' using errcode='42501';end if;
 return (select drive_folder_id from app_private.fonciere_drive_folders where project_id=p_project and category='project' and status='ready');
end $$;
create function public.fonciere_drive_folder(p_project uuid) returns text language sql security invoker set search_path=pg_catalog as $$select app_private.fonciere_drive_folder(p_project);$$;

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
  'fonciereProjects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'ownerId',owner_id,'status',status,'project_number',project_number,'project_reference',project_reference) order by project_number,id),'[]') from public.fonciere_projects where app_private.can_fonciere_project(id,true) and app_private.workspace_role('izord',array['admin','partner'])),
  'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'expires_at',i.expires_at,'created_by',i.created_by)),'[]') from public.crm_access_invitations i where i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp()),
  'history',(select coalesce(jsonb_agg(e),'[]') from (select * from public.crm_permission_events order by id desc limit 100) e));
end $$;

do $$ declare definition text; begin
 select pg_get_functiondef('app_private.task_target_resolve(jsonb,boolean)'::regprocedure) into definition;
 execute replace(definition,'FUNCTION app_private.task_target_resolve(','FUNCTION app_private.task_target_resolve_before_project_reference(');
end $$;
create or replace function app_private.task_target_resolve(p_ref jsonb,p_for_add boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; p public.fonciere_projects%rowtype;
begin
 result:=app_private.task_target_resolve_before_project_reference(p_ref,p_for_add);
 if p_ref->>'type'='fonciere_project' and result->>'state' in ('available','archived') then
  select * into p from public.fonciere_projects where id=(result->'ref'->>'id')::uuid;
  result:=result||jsonb_build_object('projectReference',p.project_reference,'projectNumber',p.project_number,
   'searchFields',coalesce(result->'searchFields','[]')||jsonb_build_array(p.project_reference,p.project_number::text,p.title,p.payload#>>'{data,city}',p.payload#>>'{data,propertyAddress}',p.payload#>>'{data,agencyName}',p.payload#>>'{data,agentName}'));
 end if;
 return result;
end $$;
-- All new state is private; authenticated users receive only checked projections.
alter table app_private.fonciere_numbering_backup enable row level security;
alter table app_private.fonciere_drive_config enable row level security;
alter table app_private.fonciere_drive_folders enable row level security;
alter table app_private.fonciere_drive_jobs enable row level security;
alter table app_private.fonciere_drive_events enable row level security;
revoke all on app_private.fonciere_numbering_backup,app_private.fonciere_drive_config,app_private.fonciere_drive_folders,app_private.fonciere_drive_jobs,app_private.fonciere_drive_events from public,anon,authenticated;
revoke all on sequence app_private.fonciere_project_number_seq from public,anon,authenticated;
revoke all on function app_private.guard_fonciere_number(),app_private.create_fonciere_project(uuid,jsonb,text,text),public.fonciere_create_project(uuid,jsonb,text,text),app_private.fonciere_saved_assets(uuid),app_private.enqueue_fonciere_drive(uuid,boolean),app_private.fonciere_drive_outbox(),app_private.fonciere_drive_worker(text,jsonb),public.fonciere_drive_worker(text,jsonb),app_private.fonciere_drive_status(uuid),public.fonciere_drive_status(uuid),app_private.fonciere_drive_retry(uuid,uuid),public.fonciere_drive_retry(uuid,uuid),app_private.fonciere_drive_folder(uuid),public.fonciere_drive_folder(uuid),app_private.task_target_resolve_before_project_reference(jsonb,boolean) from public,anon,authenticated;
grant execute on function app_private.create_fonciere_project(uuid,jsonb,text,text),public.fonciere_create_project(uuid,jsonb,text,text),app_private.fonciere_drive_status(uuid),public.fonciere_drive_status(uuid),app_private.fonciere_drive_retry(uuid,uuid),public.fonciere_drive_retry(uuid,uuid),app_private.fonciere_drive_folder(uuid),public.fonciere_drive_folder(uuid) to authenticated;
grant usage on schema app_private to service_role;
grant execute on function app_private.fonciere_drive_worker(text,jsonb),public.fonciere_drive_worker(text,jsonb) to service_role;
-- Initial backfill creates outbox records only. Drive activation is a separate, verified operation.
select app_private.enqueue_fonciere_drive(id,true) from public.fonciere_projects order by project_number;
notify pgrst,'reload schema';
commit;
