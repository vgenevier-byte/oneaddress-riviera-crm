-- Local review only. Canonical Tasks, without a global administrator read exception.
-- Keep private original payloads before extracting Tasks; never infer Auth identities
-- from historical labels, email domains, updatedBy, or the migration operator.
begin;

create table app_private.task_identity_links (
 user_id uuid primary key,
 contact_id text unique,
 label text not null check(length(btrim(label)) between 1 and 160),
 verified_owner boolean not null default false,
 confirmed_by uuid not null,
 confirmed_at timestamptz not null default clock_timestamp(),
 revision bigint not null default 1,
 check ((verified_owner and contact_id is null) or (not verified_owner and contact_id is not null))
);
create table app_private.task_records (
 id text primary key check(id ~ '^[A-Za-z0-9_-]{1,100}$'),
 title text not null check(length(btrim(title)) between 1 and 500),
 notes text not null default '' check(length(notes)<=10000),
 due_date date,
 priority text not null default 'normal' check(priority in ('normal','important','urgent')),
 status text not null default 'À faire' check(status in ('À faire','En cours','Terminé')),
 creator_id uuid,
 creator_label text not null,
 created_at timestamptz,
 updated_by uuid,
 updated_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 -- A lead has one stored reference. linkedTo is an RPC compatibility alias only.
 contact_id text not null default '', lead_id text not null default '',
 manager_id uuid, manager_label text,
 revision bigint not null default 1 check(revision>0),
 deleted_at timestamptz,
 legacy_original jsonb,
 check(creator_id is not null or legacy_original is not null),
 check(manager_id is null or (creator_id is null and legacy_original is not null))
);
create table app_private.task_assignments (
 task_id text not null references app_private.task_records(id),
 user_id uuid not null,
 label text not null,
 assigned_by uuid not null,
 assigned_at timestamptz not null default clock_timestamp(),
 removed_at timestamptz,
 primary key(task_id,user_id)
);
create index task_assignments_user on app_private.task_assignments(user_id,task_id) where removed_at is null;
create table app_private.task_events (
 id bigint generated always as identity primary key,
 task_id text not null references app_private.task_records(id),
 actor_id uuid not null,
 at timestamptz not null default clock_timestamp(),
 revision bigint not null,
 action text not null,
 changes jsonb not null
);
create table app_private.task_requests (
 actor_id uuid not null, request_id uuid not null,
 task_id text not null, fingerprint text not null, deleted boolean not null,
 resulting_revision bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
create table app_private.task_transition_backup (
 source text primary key, payload jsonb not null,
 captured_at timestamptz not null default clock_timestamp()
);
create table app_private.task_legacy_archive (
 source text not null, task_id text not null, original jsonb not null,
 reason text not null default 'auteur historique non confirmé',
 captured_at timestamptz not null default clock_timestamp(), recovered_at timestamptz,
 primary key(source,task_id)
);

-- Non-exposed schema and RLS are both intentional. Browser clients only get RPC projections.
do $$ declare t text; begin
 foreach t in array array['task_identity_links','task_records','task_assignments','task_events','task_requests','task_transition_backup','task_legacy_archive'] loop
  execute format('alter table app_private.%I enable row level security',t);
  execute format('revoke all on app_private.%I from public,anon,authenticated',t);
 end loop;
end $$;

create function app_private.task_account_active(p_user uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_user is not null and exists(select 1 from auth.users u
  join public.crm_access_profiles p on p.user_id=u.id
  join public.app_memberships m on m.user_id=u.id
  join public.crm_module_grants g on g.user_id=u.id and g.module='tasks'
  where u.id=p_user and u.email_confirmed_at is not null and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp())
  and coalesce(to_jsonb(u)->>'is_anonymous','false')<>'true'
  and p.active and m.workspace_id='oar' and m.status='active' and g.level in ('read','contribute')
  and not exists(select 1 from public.crm_access_invitations i where lower(i.email)=lower(u.email)
   and i.accepted_at is null and i.revoked_at is null and i.expires_at>clock_timestamp() and i.grants?'tasks'));
$$;
create function app_private.task_session_active() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.task_account_active(auth.uid())
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
 and (nullif(to_jsonb(s)->>'not_after','') is null or (to_jsonb(s)->>'not_after')::timestamptz>clock_timestamp()));
$$;
create function app_private.task_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.task_account_active(p_user) and exists(select 1 from app_private.task_identity_links l
 where l.user_id=p_user and (l.verified_owner or exists(select 1 from public.crm_workspace_state w
 cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) r
 where w.workspace_id='oneaddress-riviera' and r->>'id'=l.contact_id and r->>'kind'='Membre de l’organisation')));
$$;
create function app_private.task_visible(p_id text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.task_session_active() and exists(select 1 from app_private.task_records t
 where t.id=p_id and t.deleted_at is null and (t.creator_id=auth.uid()
 or exists(select 1 from app_private.task_assignments a where a.task_id=t.id and a.user_id=auth.uid()
 and a.removed_at is null and app_private.task_eligible(a.user_id))));
$$;
create policy task_participant_rows on app_private.task_records for select to authenticated using(app_private.task_visible(id));
create policy task_participant_assignments on app_private.task_assignments for select to authenticated using(app_private.task_visible(task_id));
create policy task_participant_audit on app_private.task_events for select to authenticated using(app_private.task_visible(task_id));

create function app_private.task_project(t app_private.task_records) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('id',t.id,'title',t.title,'notes',t.notes,
 'dueDate',coalesce(to_char(t.due_date,'YYYY-MM-DD'),''),'priority',t.priority,'status',t.status,
 'createdBy',t.creator_id,'createdByLabel',t.creator_label,'createdAt',t.created_at,
 'updatedAt',t.updated_at,'updatedBy',t.updated_by,'completedAt',t.completed_at,'revision',t.revision,
 'assignees',coalesce((select jsonb_agg(jsonb_build_object('userId',a.user_id,'label',a.label,
  'access',coalesce((select g.level from public.crm_module_grants g where g.user_id=a.user_id and g.module='tasks'),'none'),
  'active',app_private.task_eligible(a.user_id)) order by a.assigned_at,a.user_id)
  from app_private.task_assignments a where a.task_id=t.id and a.removed_at is null),'[]'::jsonb),
 'managerId',t.manager_id,'managerLabel',t.manager_label,
 'managerActive',t.manager_id is not null and app_private.task_eligible(t.manager_id)
  and exists(select 1 from app_private.task_assignments a where a.task_id=t.id and a.user_id=t.manager_id and a.removed_at is null),
 'linkedTo',case when app_private.module_allowed('leads') and exists(select 1 from public.crm_workspace_state w
  cross join lateral jsonb_array_elements(coalesce(w.payload->'leads','[]')) r where w.workspace_id='oneaddress-riviera' and r->>'id'=t.lead_id) then t.lead_id else '' end,
 'contactId',case when app_private.module_allowed('contacts') and exists(select 1 from public.crm_workspace_state w
  cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) r where w.workspace_id='oneaddress-riviera' and r->>'id'=t.contact_id) then t.contact_id else '' end,
 'leadId',case when app_private.module_allowed('leads') and exists(select 1 from public.crm_workspace_state w
  cross join lateral jsonb_array_elements(coalesce(w.payload->'leads','[]')) r where w.workspace_id='oneaddress-riviera' and r->>'id'=t.lead_id) then t.lead_id else '' end);
$$;

-- One effective lead value, with a documented compatibility rule for old clients:
-- one empty alias and one nonempty alias mean the supplied nonempty ID; two
-- different nonempty IDs are a conflict. A single empty alias explicitly clears.
create function app_private.task_lead_alias(p_patch jsonb) returns text
language plpgsql immutable set search_path=pg_catalog as $$
declare lead_value text; alias_value text;
begin
 if not(p_patch?'leadId' or p_patch?'linkedTo') then return null;end if;
 if (p_patch?'leadId' and jsonb_typeof(p_patch->'leadId')<>'string')
  or (p_patch?'linkedTo' and jsonb_typeof(p_patch->'linkedTo')<>'string') then raise exception 'invalid_task_field' using errcode='22023';end if;
 lead_value:=p_patch->>'leadId';alias_value:=p_patch->>'linkedTo';
 if coalesce(lead_value,'')<>'' and coalesce(alias_value,'')<>'' and lead_value<>alias_value then
  raise exception 'task_lead_alias_conflict' using errcode='22023';end if;
 return coalesce(nullif(lead_value,''),alias_value,lead_value,'');
end $$;
create function app_private.task_metadata_actor(t app_private.task_records) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select t.creator_id=auth.uid() or (t.creator_id is null and t.manager_id=auth.uid()
 and app_private.task_eligible(t.manager_id) and exists(select 1 from app_private.task_assignments a
 where a.task_id=t.id and a.user_id=t.manager_id and a.removed_at is null));
$$;

create function public.crm_tasks_read(p_id text default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_session_active() then raise exception 'tasks_forbidden' using errcode='42501'; end if;
 if p_id is not null and not app_private.task_visible(p_id) then raise exception 'task_forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(app_private.task_project(t) order by t.created_at,t.id)
 from app_private.task_records t where (p_id is null or t.id=p_id) and app_private.task_visible(t.id)),'[]'::jsonb);
end $$;
create function public.crm_tasks_directory() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_session_active() then raise exception 'tasks_forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',l.user_id,'label',l.label,'access',g.level)
 order by l.label,l.user_id) from app_private.task_identity_links l
 join public.crm_module_grants g on g.user_id=l.user_id and g.module='tasks' where app_private.task_eligible(l.user_id)),'[]'::jsonb);
end $$;
create function public.crm_tasks_export() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_session_active() or not app_private.module_allowed('tasks',false,'export') then raise exception 'tasks_export_forbidden' using errcode='42501'; end if;
 return public.crm_tasks_read();
end $$;
create function public.crm_tasks_history(p_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_visible(p_id) then raise exception 'task_forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('revision',revision,'actorId',actor_id,'at',at,'action',action,
  'changes',changes-array['linkedTo','contactId','leadId']) order by revision) from app_private.task_events where task_id=p_id),'[]'::jsonb);
end $$;

create function public.crm_tasks_mutate(p_request_id uuid,p_id text,p_revision bigint,p_patch jsonb,p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare t app_private.task_records%rowtype; prior app_private.task_records%rowtype;
 req app_private.task_requests%rowtype; kv record; assigned uuid; ids uuid[]; digest text;
 now_at timestamptz:=clock_timestamp(); label_value text; due_value date; link_value text; changes jsonb;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.task_session_active() or not app_private.module_allowed('tasks',true) then raise exception 'tasks_write_forbidden' using errcode='42501'; end if;
 if p_request_id is null or p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,100}$' or p_delete is null
 or p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>64000 then raise exception 'invalid_task_mutation' using errcode='22023'; end if;
 -- Request and task locks make lost responses/double clicks deterministic, including creation.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('task:'||p_id,0));
 digest:=md5(jsonb_build_object('id',p_id,'revision',p_revision,'patch',p_patch,'delete',p_delete)::text);
 select * into req from app_private.task_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if req.fingerprint<>digest then raise exception 'task_request_reused' using errcode='22023'; end if;
  if req.deleted then
   if not exists(select 1 from app_private.task_records x where x.id=req.task_id and (x.creator_id=auth.uid() or (x.creator_id is null and x.manager_id=auth.uid() and app_private.task_eligible(x.manager_id)))) then raise exception 'task_forbidden' using errcode='42501'; end if;
   return null;
  end if;
  if not app_private.task_visible(req.task_id) then raise exception 'task_forbidden' using errcode='42501'; end if;
  select * into strict t from app_private.task_records where id=req.task_id;
  return app_private.task_project(t);
 end if;
 select * into t from app_private.task_records where id=p_id for update;
 prior:=t;
 if found then
  if not app_private.task_visible(p_id) then raise exception 'task_forbidden' using errcode='42501'; end if;
  if p_revision is distinct from t.revision then raise exception 'task_revision_conflict' using errcode='40001'; end if;
 else
  if p_delete or p_revision is not null or exists(select 1 from app_private.task_legacy_archive where task_id=p_id) then raise exception 'task_missing_or_reserved' using errcode='22023'; end if;
  t.id:=p_id;t.notes:='';t.priority:='normal';t.status:='À faire';t.contact_id:='';t.lead_id:='';
  t.creator_id:=auth.uid();t.created_at:=now_at;t.revision:=0;
  select label into label_value from app_private.task_identity_links where user_id=auth.uid();
  if label_value is null then select email into label_value from auth.users where id=auth.uid();end if;
  t.creator_label:=label_value;
 end if;
 if p_delete then
  if not coalesce(app_private.task_metadata_actor(t),false) or not app_private.module_allowed('tasks',true,'delete') then raise exception 'task_delete_forbidden' using errcode='42501';end if;
  if p_patch<>'{}'::jsonb then raise exception 'invalid_task_delete' using errcode='22023';end if;
  t.deleted_at:=now_at;
 else
  if p_patch-array['title','notes','dueDate','priority','status','assigneeIds','linkedTo','contactId','leadId']<>'{}'::jsonb then raise exception 'task_field_forbidden' using errcode='22023';end if;
  if prior.id is not null and not coalesce(app_private.task_metadata_actor(t),false) and p_patch-array['notes','status']<>'{}'::jsonb then raise exception 'task_creator_required' using errcode='42501';end if;
  for kv in select * from jsonb_each(p_patch) loop
   if kv.key='assigneeIds' then
    if jsonb_typeof(kv.value)<>'array' or jsonb_array_length(kv.value)>50 or exists(select 1 from jsonb_array_elements(kv.value) v where jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-fA-F-]{36}$') then raise exception 'invalid_task_assignees' using errcode='22023';end if;
    select coalesce(array_agg(distinct (v#>>'{}')::uuid),'{}'::uuid[]) into ids from jsonb_array_elements(kv.value) v;
    foreach assigned in array ids loop if not app_private.task_eligible(assigned) then raise exception 'task_assignee_ineligible' using errcode='42501';end if;end loop;
    if t.creator_id is null and t.manager_id is not null and not(t.manager_id=any(ids)) then raise exception 'task_manager_assignment_required' using errcode='42501';end if;
   else
    if jsonb_typeof(kv.value)<>'string' then raise exception 'invalid_task_field' using errcode='22023';end if;
    case kv.key
    when 'title' then t.title:=kv.value#>>'{}';
    when 'notes' then t.notes:=kv.value#>>'{}';
    when 'priority' then t.priority:=kv.value#>>'{}';
    when 'status' then t.status:=kv.value#>>'{}';
    when 'dueDate' then
     link_value:=kv.value#>>'{}';
     if link_value='' then t.due_date:=null;
     else
      if link_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_task_due_date' using errcode='22023';end if;
      begin due_value:=link_value::date;exception when others then raise exception 'invalid_task_due_date' using errcode='22023';end;
      if to_char(due_value,'YYYY-MM-DD')<>link_value then raise exception 'invalid_task_due_date' using errcode='22023';end if;
      t.due_date:=due_value;
     end if;
    when 'linkedTo' then null;
    when 'contactId' then t.contact_id:=kv.value#>>'{}';
    when 'leadId' then null;
    else raise exception 'task_field_forbidden' using errcode='22023';
    end case;
   end if;
  end loop;
  if p_patch?'leadId' or p_patch?'linkedTo' then t.lead_id:=app_private.task_lead_alias(p_patch);end if;
  if t.title is null or length(btrim(t.title)) not between 1 and 500 or length(t.notes)>10000
   or t.priority not in ('normal','important','urgent') or t.status not in ('À faire','En cours','Terminé') then raise exception 'invalid_task_fields' using errcode='22023';end if;
  foreach link_value in array array['contactId','leadId'] loop
   if (p_patch?link_value or (link_value='leadId' and p_patch?'linkedTo')) and (case when link_value='leadId' then t.lead_id else t.contact_id end)<>'' then
    if not exists(select 1 from public.crm_workspace_state w
     cross join lateral jsonb_each(w.payload) c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value)='array' then c.value else '[]'::jsonb end) r
     where w.workspace_id='oneaddress-riviera' and c.key=any(case link_value when 'contactId' then array['contacts'] else array['leads'] end)
     and app_private.module_allowed(c.key) and r->>'id'=(case when link_value='leadId' then t.lead_id else t.contact_id end)) then raise exception 'task_link_forbidden' using errcode='42501';end if;
   end if;
  end loop;
  if t.status='Terminé' and (prior.id is null or prior.status<>'Terminé') then t.completed_at:=now_at;
  elsif t.status<>'Terminé' then t.completed_at:=null;end if;
 end if;
 t.revision:=t.revision+1;t.updated_at:=now_at;t.updated_by:=auth.uid();
 if prior.id is null then insert into app_private.task_records select (t).*;
 else update app_private.task_records set title=t.title,notes=t.notes,due_date=t.due_date,priority=t.priority,status=t.status,
  updated_by=t.updated_by,updated_at=t.updated_at,completed_at=t.completed_at,
  contact_id=t.contact_id,lead_id=t.lead_id,revision=t.revision,deleted_at=t.deleted_at where id=t.id;end if;
 if ids is not null then
  update app_private.task_assignments set removed_at=now_at where task_id=p_id and removed_at is null and not(user_id=any(ids));
  foreach assigned in array ids loop
   select label into strict label_value from app_private.task_identity_links where user_id=assigned;
   insert into app_private.task_assignments(task_id,user_id,label,assigned_by,assigned_at) values(p_id,assigned,label_value,auth.uid(),now_at)
   on conflict(task_id,user_id) do update set label=excluded.label,assigned_by=excluded.assigned_by,
    assigned_at=case when task_assignments.removed_at is null then task_assignments.assigned_at else excluded.assigned_at end,removed_at=null;
  end loop;
 end if;
 changes:=p_patch;
 insert into app_private.task_events(task_id,actor_id,revision,action,changes) values(p_id,auth.uid(),t.revision,
  case when p_delete then 'delete' when prior.id is null then 'create' else 'update' end,changes||jsonb_build_object('previousStatus',prior.status,'status',t.status,'completedAt',t.completed_at));
 insert into app_private.task_requests(actor_id,request_id,task_id,fingerprint,deleted,resulting_revision) values(auth.uid(),p_request_id,p_id,digest,p_delete,t.revision);
 if p_delete then return null;end if;
 return app_private.task_project(t);
end $$;

-- Administrative confirmation is explicit; a contact category never grants Auth rights.
create function public.crm_tasks_admin_identity(p_user uuid,p_label text,p_contact text default null,p_owner boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_session_active() or not app_private.general_admin() then raise exception 'task_admin_forbidden' using errcode='42501';end if;
 if p_user is null or p_label is null or length(btrim(p_label)) not between 1 and 160 or p_owner is null
 or not app_private.task_account_active(p_user) or (p_owner and p_contact is not null) or (not p_owner and p_contact is null) then raise exception 'invalid_task_identity' using errcode='22023';end if;
 if not p_owner and (select count(*) from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) r
  where w.workspace_id='oneaddress-riviera' and r->>'id'=p_contact and r->>'kind'='Membre de l’organisation')<>1 then raise exception 'organization_contact_required' using errcode='22023';end if;
 insert into app_private.task_identity_links(user_id,contact_id,label,verified_owner,confirmed_by) values(p_user,p_contact,btrim(p_label),p_owner,auth.uid())
 on conflict(user_id) do update set contact_id=excluded.contact_id,label=excluded.label,verified_owner=excluded.verified_owner,
 confirmed_by=excluded.confirmed_by,confirmed_at=clock_timestamp(),revision=task_identity_links.revision+1;
 return jsonb_build_object('userId',p_user,'label',btrim(p_label),'confirmed',true);
end $$;
create function public.crm_tasks_admin_directory() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_session_active() or not app_private.general_admin() then raise exception 'task_admin_forbidden' using errcode='42501';end if;
 return jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('userId',u.id,'email',u.email,
  'label',l.label,'contactId',l.contact_id,'verifiedOwner',coalesce(l.verified_owner,false))) from auth.users u
  left join app_private.task_identity_links l on l.user_id=u.id where app_private.task_account_active(u.id)),'[]'::jsonb),
  'contacts',coalesce((select jsonb_agg(jsonb_build_object('contactId',r->>'id','label',concat_ws(' ',nullif(r->>'firstName',''),r->>'name')))
  from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) r
  where w.workspace_id='oneaddress-riviera' and r->>'kind'='Membre de l’organisation'),'[]'::jsonb));
end $$;

-- Preserve all legacy rows in a private recovery queue; none has a proven author
-- merely because a mutable historical JSON object contains a UUID field.
insert into app_private.task_transition_backup(source,payload)
 select 'workspace:'||workspace_id,payload from public.crm_workspace_state for update;
insert into app_private.task_legacy_archive(source,task_id,original)
 select 'workspace:'||w.workspace_id,coalesce(nullif(r->>'id',''),'missing-id-'||ordinal),r
 from public.crm_workspace_state w cross join lateral jsonb_array_elements(coalesce(w.payload->'tasks','[]')) with ordinality e(r,ordinal);
insert into app_private.task_transition_backup(source,payload)
 select 'old-table:'||id::text,to_jsonb(t) from public.crm_tasks t;
insert into app_private.task_legacy_archive(source,task_id,original)
 select 'old-table:'||id::text,id::text,to_jsonb(t) from public.crm_tasks t;
insert into app_private.task_transition_backup(source,payload)
 select 'backup:'||id::text,to_jsonb(b) from public.crm_backups b;

create function app_private.tasks_strip_payload(v jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb; kv record;
begin
 if jsonb_typeof(v)='object' then
  result:='{}';for kv in select * from jsonb_each(v) loop
   if kv.key<>'tasks' then result:=result||jsonb_build_object(kv.key,app_private.tasks_strip_payload(kv.value));end if;
  end loop;return result;
 elsif jsonb_typeof(v)='array' then return coalesce((select jsonb_agg(app_private.tasks_strip_payload(x) order by n) from jsonb_array_elements(v) with ordinality e(x,n)),'[]'::jsonb);
 else return v;end if;
end $$;
update public.crm_workspace_state set payload=app_private.tasks_strip_payload(payload);
create function app_private.guard_canonical_tasks_payload() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 new.payload:=app_private.tasks_strip_payload(new.payload);
 return new;
end $$;
create trigger zzz_crm_canonical_tasks_payload before insert or update of payload on public.crm_workspace_state
for each row execute function app_private.guard_canonical_tasks_payload();
-- All historical raw Tasks and backup/snapshot payload endpoints close, including fullAccess.
revoke all on public.crm_tasks from public,anon,authenticated;
create policy tasks_old_api_closed on public.crm_tasks as restrictive for all to authenticated using(false) with check(false);
-- Preserve the unrelated cloud-backup workflow after privately archiving originals.
update public.crm_backups set payload=app_private.tasks_strip_payload(payload),tasks_count=0;
create function app_private.guard_tasks_backup() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin new.payload:=app_private.tasks_strip_payload(new.payload);new.tasks_count:=0;return new;end $$;
create trigger zzz_crm_canonical_tasks_backup before insert or update of payload,tasks_count on public.crm_backups
for each row execute function app_private.guard_tasks_backup();

-- Wrap existing business RPCs instead of copying/replacing unrelated module behavior.
alter function public.crm_read_module(text) set schema app_private;
alter function app_private.crm_read_module(text) rename to tasks_previous_read_module;
create function public.crm_read_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; tasks jsonb;
begin
 if p_module='tasks' then tasks:=public.crm_tasks_read();return jsonb_build_object('collections',jsonb_build_object('tasks',tasks),'revision',md5(tasks::text));end if;
 result:=app_private.tasks_previous_read_module(p_module);
 if p_module='dashboard' and app_private.module_allowed('tasks') then
  tasks:=public.crm_tasks_read();result:=jsonb_set(result,'{collections,tasks}',to_jsonb(jsonb_array_length(tasks)));
  result:=jsonb_set(result,'{revision}',to_jsonb(md5((result->'collections')::text)));
 end if;
 return result;
end $$;
alter function public.crm_mutate_record(text,text,text,jsonb,text,boolean) set schema app_private;
alter function app_private.crm_mutate_record(text,text,text,jsonb,text,boolean) rename to tasks_previous_mutate_record;
create function public.crm_mutate_record(p_module text,p_collection text,p_id text,p_patch jsonb,p_revision text,p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_collection='tasks' or p_module='tasks' then raise exception 'canonical_tasks_api_required' using errcode='42501';end if;
 return app_private.tasks_previous_mutate_record(p_module,p_collection,p_id,p_patch,p_revision,p_delete);
end $$;

-- Full module exports delegate to the canonical filtered source.
alter function public.crm_export_module(text) set schema app_private;
alter function app_private.crm_export_module(text) rename to tasks_previous_export_module;
create function public.crm_export_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare tasks jsonb;
begin
 if p_module='tasks' then tasks:=public.crm_tasks_export();return jsonb_build_object('collections',jsonb_build_object('tasks',tasks),'revision',md5(tasks::text));end if;
 return app_private.tasks_previous_export_module(p_module);
end $$;
-- The fullAccess shortcut in old document ACLs must not open a private task attachment.
-- Copy the old body under a private helper; replace the ORIGINAL OID so parsed
-- Storage policy dependencies keep calling the new participant check.
do $$ declare definition text;begin
 select pg_get_functiondef('app_private.document_allowed(text,text,boolean,boolean)'::regprocedure) into definition;
 execute replace(definition,'FUNCTION app_private.document_allowed(','FUNCTION app_private.tasks_previous_document_allowed(');
end $$;
create or replace function app_private.document_allowed(p_provider text,p_resource text,p_write boolean default false,p_download boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select case when exists(select 1 from public.crm_document_scopes d where d.provider=p_provider and d.resource_id=p_resource and (d.module='tasks' or d.collection='tasks'))
 then exists(select 1 from public.crm_document_scopes d where d.provider=p_provider and d.resource_id=p_resource and d.module='tasks' and d.collection='tasks'
  and app_private.task_visible(d.record_id) and app_private.module_allowed('documents',p_write,case when p_download then 'export' end)
  and app_private.module_allowed('tasks',p_write,case when p_download then 'export' end))
 else app_private.tasks_previous_document_allowed(p_provider,p_resource,p_write,p_download) end;
$$;

-- Private historical recovery remains separate from the collaborative board.
create function app_private.tasks_recovery_owner() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.task_session_active() and app_private.general_admin()
 and exists(select 1 from app_private.task_identity_links l where l.user_id=auth.uid() and l.verified_owner);
$$;
create function public.crm_tasks_legacy_read() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.tasks_recovery_owner() then raise exception 'task_recovery_forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('source',a.source,'taskId',a.task_id,'original',a.original,
  'reason',a.reason,'revision',md5(a.original::text),'recovered',a.recovered_at is not null,
  'taskRevision',t.revision,'managerId',t.manager_id,'managerLabel',t.manager_label,
  'managerActive',t.manager_id is not null and app_private.task_eligible(t.manager_id)
   and exists(select 1 from app_private.task_assignments x where x.task_id=t.id and x.user_id=t.manager_id and x.removed_at is null))
  order by a.captured_at,a.source,a.task_id) from app_private.task_legacy_archive a
  left join app_private.task_records t on t.id=a.task_id and a.recovered_at is not null),'[]'::jsonb);
end $$;
create function public.crm_tasks_legacy_recover(p_source text,p_id text,p_revision text,p_assignee_ids uuid[],p_request_id uuid,p_manager_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a app_private.task_legacy_archive%rowtype; t app_private.task_records%rowtype;
 original_row jsonb; assigned uuid; label_value text; request_digest text; saved_digest text; legacy_alias text;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.tasks_recovery_owner() or not app_private.module_allowed('tasks',true) then raise exception 'task_recovery_forbidden' using errcode='42501';end if;
 if p_request_id is null or p_assignee_ids is null or cardinality(p_assignee_ids) not between 1 and 50
 or array_position(p_assignee_ids,null) is not null or p_manager_id is null or not(p_manager_id=any(p_assignee_ids))
 or not app_private.task_eligible(p_manager_id) then raise exception 'task_recovery_assignment_required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('task:'||p_id,0));
 select * into a from app_private.task_legacy_archive where source=p_source and task_id=p_id for update;
 if not found or p_revision is distinct from md5(a.original::text) then raise exception 'task_recovery_conflict' using errcode='40001';end if;
 request_digest:=md5(jsonb_build_object('source',p_source,'id',p_id,'revision',p_revision,'assignees',p_assignee_ids,'managerId',p_manager_id)::text);
 select fingerprint into saved_digest from app_private.task_requests where actor_id=auth.uid() and request_id=p_request_id;
 if saved_digest is not null then
  if saved_digest<>request_digest then raise exception 'task_request_reused' using errcode='22023';end if;
  return jsonb_build_object('id',p_id,'recovered',true);
 end if;
 if a.recovered_at is not null or exists(select 1 from app_private.task_records where id=p_id) then raise exception 'task_recovery_already_done' using errcode='40001';end if;
 foreach assigned in array p_assignee_ids loop
  if not app_private.task_eligible(assigned) then raise exception 'task_assignee_ineligible' using errcode='42501';end if;
 end loop;
 original_row:=case when a.source like 'old-table:%' then coalesce(a.original->'payload',a.original) else a.original end;
 t.id:=p_id;t.title:=original_row->>'title';t.notes:=coalesce(original_row->>'notes','');
 t.status:=original_row->>'status';t.priority:=coalesce(nullif(original_row->>'priority',''),'normal');
 t.creator_id:=null;t.creator_label:='auteur historique non confirmé';t.legacy_original:=a.original;
 t.contact_id:=coalesce(original_row->>'contactId','');t.lead_id:=coalesce(original_row->>'leadId','');
 legacy_alias:=coalesce(original_row->>'linkedTo','');
 -- A historical Contact alias is preserved as a separate Contact reference. All
 -- original fields stay unchanged in legacy_original and the private archive.
 if legacy_alias<>'' and exists(select 1 from public.crm_workspace_state w
  cross join lateral jsonb_array_elements(coalesce(w.payload->'contacts','[]')) r
  where w.workspace_id='oneaddress-riviera' and r->>'id'=legacy_alias) then
  if (t.contact_id<>'' and t.contact_id<>legacy_alias) or exists(select 1 from public.crm_workspace_state w
   cross join lateral jsonb_array_elements(coalesce(w.payload->'leads','[]')) r where w.workspace_id='oneaddress-riviera' and r->>'id'=legacy_alias) then
   raise exception 'task_legacy_reference_conflict' using errcode='22023';end if;
  t.contact_id:=legacy_alias;
 else
  t.lead_id:=app_private.task_lead_alias(jsonb_build_object('leadId',t.lead_id,'linkedTo',legacy_alias));
 end if;
 t.manager_id:=p_manager_id;select label into strict t.manager_label from app_private.task_identity_links where user_id=p_manager_id;
 begin
  if nullif(original_row->>'dueDate','') is not null then
   if original_row->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_date';end if;
   t.due_date:=(original_row->>'dueDate')::date;
   if to_char(t.due_date,'YYYY-MM-DD')<>original_row->>'dueDate' then raise exception 'invalid_date';end if;
  end if;
  t.created_at:=nullif(original_row->>'createdAt','')::timestamptz;
  t.completed_at:=nullif(original_row->>'completedAt','')::timestamptz;
 exception when others then raise exception 'task_legacy_needs_review' using errcode='22023';end;
 if t.id !~ '^[A-Za-z0-9_-]{1,100}$' or t.title is null or length(btrim(t.title)) not between 1 and 500
 or length(t.notes)>10000 or t.status not in ('À faire','En cours','Terminé')
 or t.priority not in ('normal','important','urgent') then raise exception 'task_legacy_needs_review' using errcode='22023';end if;
 t.updated_at:=clock_timestamp();t.updated_by:=auth.uid();t.revision:=1;
 insert into app_private.task_records select (t).*;
 foreach assigned in array p_assignee_ids loop
  select label into strict label_value from app_private.task_identity_links where user_id=assigned;
  insert into app_private.task_assignments(task_id,user_id,label,assigned_by) values(p_id,assigned,label_value,auth.uid()) on conflict do nothing;
 end loop;
 update app_private.task_legacy_archive set recovered_at=clock_timestamp() where source=p_source and task_id=p_id;
 insert into app_private.task_events(task_id,actor_id,revision,action,changes) values(p_id,auth.uid(),1,'legacy_recovery',jsonb_build_object('authorUnconfirmed',true,'assigneeIds',p_assignee_ids,'managerId',p_manager_id));
 insert into app_private.task_requests(actor_id,request_id,task_id,fingerprint,deleted,resulting_revision) values(auth.uid(),p_request_id,p_id,request_digest,false,1);
 return jsonb_build_object('id',p_id,'recovered',true);
end $$;

-- Controlled correction for a previous recovery. This never changes authorship
-- or grants the private owner a general collaborative-task read exception.
create function public.crm_tasks_legacy_manager(p_id text,p_revision bigint,p_manager_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare t app_private.task_records%rowtype; prior_manager uuid; label_value text;
 request_digest text; saved_digest text; new_participant boolean;
begin
 perform pg_advisory_xact_lock_shared(734991);
 if not app_private.tasks_recovery_owner() or not app_private.module_allowed('tasks',true) then raise exception 'task_recovery_forbidden' using errcode='42501';end if;
 if p_request_id is null or p_id is null or p_manager_id is null or not app_private.task_eligible(p_manager_id) then raise exception 'task_manager_ineligible' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('task:'||p_id,0));
 select * into t from app_private.task_records where id=p_id for update;
 if not found or t.creator_id is not null or t.legacy_original is null or t.deleted_at is not null then raise exception 'task_recovery_not_applicable' using errcode='42501';end if;
 request_digest:=md5(jsonb_build_object('id',p_id,'revision',p_revision,'managerId',p_manager_id,'operation','legacy_manager')::text);
 select fingerprint into saved_digest from app_private.task_requests where actor_id=auth.uid() and request_id=p_request_id;
 if saved_digest is not null then
  if saved_digest<>request_digest then raise exception 'task_request_reused' using errcode='22023';end if;
  return jsonb_build_object('id',t.id,'managerId',t.manager_id,'revision',t.revision);
 end if;
 if p_revision is distinct from t.revision then raise exception 'task_revision_conflict' using errcode='40001';end if;
 prior_manager:=t.manager_id;select label into strict label_value from app_private.task_identity_links where user_id=p_manager_id;
 new_participant:=not exists(select 1 from app_private.task_assignments a where a.task_id=p_id and a.user_id=p_manager_id and a.removed_at is null);
 insert into app_private.task_assignments(task_id,user_id,label,assigned_by) values(p_id,p_manager_id,label_value,auth.uid())
 on conflict(task_id,user_id) do update set label=excluded.label,assigned_by=excluded.assigned_by,
 assigned_at=case when task_assignments.removed_at is null then task_assignments.assigned_at else excluded.assigned_at end,removed_at=null;
 update app_private.task_records set manager_id=p_manager_id,manager_label=label_value,
  revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_id returning * into t;
 insert into app_private.task_events(task_id,actor_id,revision,action,changes) values(p_id,auth.uid(),t.revision,
  'legacy_manager',jsonb_build_object('previousManagerId',prior_manager,'managerId',p_manager_id,'participantExplicitlyAdded',new_participant));
 insert into app_private.task_requests(actor_id,request_id,task_id,fingerprint,deleted,resulting_revision) values(auth.uid(),p_request_id,p_id,request_digest,false,t.revision);
 return jsonb_build_object('id',t.id,'managerId',t.manager_id,'revision',t.revision);
end $$;

-- No attachment editing UI is included in this Tasks lot. Existing task scopes
-- stay private and cannot be relabelled as a broadly readable document by any
-- application account, including fullAccess. Service/database maintenance remains private.
create function app_private.guard_task_document_scope() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is not null and
  ((tg_op<>'INSERT' and (old.module='tasks' or old.collection='tasks'))
   or (tg_op<>'DELETE' and (new.module='tasks' or new.collection='tasks'))) then
  raise exception 'task_document_scope_immutable' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger crm_guard_task_document_scope before insert or update or delete on public.crm_document_scopes
for each row execute function app_private.guard_task_document_scope();

-- Existing app-private helpers must not be callable directly to bypass the wrappers.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and (p.proname like 'task_%' or p.proname like 'tasks_%' or p.proname in ('guard_canonical_tasks_payload','guard_tasks_backup','guard_task_document_scope')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'crm_tasks_%' or p.proname in ('crm_read_module','crm_mutate_record','crm_export_module')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
-- Policies may use the narrow participant predicate; no raw table grants are added.
grant execute on function app_private.task_visible(text) to authenticated;
grant execute on function app_private.document_allowed(text,text,boolean,boolean) to authenticated;
commit;
