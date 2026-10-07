-- Local review only. Additive follow-up to the published canonical Tasks SQL
-- 32160066611932453e25fc4a6b1314b6b484e66c9db10eeccf59f5bf0c588951.
-- Ordinary eligibility is the existing active Auth/profile/OAR/Tasks boundary.
-- Contact classifications and optional identity links no longer gate assignment.
-- Keep creator/manager permissions, visibility, sessions, revisions and request
-- journals unchanged. Never rewrite existing Tasks, labels, audit or archives.
begin;

create or replace function app_private.task_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.task_account_active(p_user);
$$;

-- Optional confirmed labels are display data only. User-editable Auth metadata
-- is NEVER used in access decisions, owner verification or identity matching.
create or replace function app_private.task_account_label(p_user uuid) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(nullif(btrim(l.label),''),
  nullif(left(btrim(case when jsonb_typeof(u.raw_user_meta_data->'display_name')='string' then u.raw_user_meta_data->>'display_name' end),160),''),
  nullif(left(btrim(case when jsonb_typeof(u.raw_user_meta_data->'full_name')='string' then u.raw_user_meta_data->>'full_name' end),160),''),
  nullif(left(btrim(case when jsonb_typeof(u.raw_user_meta_data->'name')='string' then u.raw_user_meta_data->>'name' end),160),''),
  u.email)
 from auth.users u left join app_private.task_identity_links l on l.user_id=u.id
 where u.id=p_user and app_private.task_account_active(p_user);
$$;
revoke all on function app_private.task_account_label(uuid) from public,anon,authenticated;

create or replace function public.crm_tasks_directory() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not app_private.task_session_active() then raise exception 'tasks_forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',r.user_id,'label',r.label,
  'access',r.access,'email',r.email,'detail',r.email) order by lower(r.label),lower(r.email),r.user_id)
  from (select u.id user_id,app_private.task_account_label(u.id) label,g.level access,u.email
   from auth.users u join public.crm_module_grants g on g.user_id=u.id and g.module='tasks'
   where app_private.task_eligible(u.id)) r),'[]'::jsonb);
end $$;

-- These three bodies retain the published authorization and journaling exactly;
-- only current-account label resolution changes. The private recovery-owner
-- helper is intentionally untouched: session + generalAdmin + verified_owner;
-- recovery/manager mutations additionally require Tasks Contribution.
create or replace function public.crm_tasks_mutate(p_request_id uuid,p_id text,p_revision bigint,p_patch jsonb,p_delete boolean default false) returns jsonb
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
  t.creator_label:=app_private.task_account_label(auth.uid());
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
   label_value:=app_private.task_account_label(assigned);
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

create or replace function public.crm_tasks_legacy_recover(p_source text,p_id text,p_revision text,p_assignee_ids uuid[],p_request_id uuid,p_manager_id uuid) returns jsonb
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
 t.manager_id:=p_manager_id;t.manager_label:=app_private.task_account_label(p_manager_id);
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
  label_value:=app_private.task_account_label(assigned);
  insert into app_private.task_assignments(task_id,user_id,label,assigned_by) values(p_id,assigned,label_value,auth.uid()) on conflict do nothing;
 end loop;
 update app_private.task_legacy_archive set recovered_at=clock_timestamp() where source=p_source and task_id=p_id;
 insert into app_private.task_events(task_id,actor_id,revision,action,changes) values(p_id,auth.uid(),1,'legacy_recovery',jsonb_build_object('authorUnconfirmed',true,'assigneeIds',p_assignee_ids,'managerId',p_manager_id));
 insert into app_private.task_requests(actor_id,request_id,task_id,fingerprint,deleted,resulting_revision) values(auth.uid(),p_request_id,p_id,request_digest,false,1);
 return jsonb_build_object('id',p_id,'recovered',true);
end $$;

create or replace function public.crm_tasks_legacy_manager(p_id text,p_revision bigint,p_manager_id uuid,p_request_id uuid) returns jsonb
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
 prior_manager:=t.manager_id;label_value:=app_private.task_account_label(p_manager_id);
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

-- Existing public RPC grants/OIDs remain intact through CREATE OR REPLACE.
-- The only newly created helper is private and has no app EXECUTE grant.
notify pgrst,'reload schema';
commit;
