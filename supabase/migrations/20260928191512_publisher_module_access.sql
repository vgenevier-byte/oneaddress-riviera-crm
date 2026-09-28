-- Add Publisher explicitly; existing profiles and historical data receive no grants.
-- Local preparation only. Apply remotely only as part of the coordinated cutover.
begin;
alter table public.crm_module_grants drop constraint crm_module_grants_module_check;
alter table public.crm_module_grants add constraint crm_module_grants_module_check
 check(module in ('dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher'));
alter table public.crm_module_grants drop constraint crm_module_grants_sensitive_check;
alter table public.crm_module_grants add constraint crm_module_grants_sensitive_check
 check(jsonb_typeof(sensitive)='object' and sensitive - array['delete','export','bank_read','bank_write','payment','generate','mark_published'] = '{}'::jsonb);

-- Publisher is independent of OAR and IZORD memberships. Every access still needs
-- the actor's active profile and an explicit module grant from the current DB.
create or replace function app_private.module_allowed(p_module text,p_write boolean default false,p_sensitive text default null) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and p_write is not null
 and p_module=any(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher'])
 and (p_sensitive is null or case when p_module='publisher' then p_sensitive=any(array['export','generate','mark_published']) else p_sensitive=any(array['delete','export','bank_read','bank_write','payment']) end)
 and exists(select 1 from public.crm_access_profiles p join public.crm_module_grants g using(user_id)
 where p.user_id=auth.uid() and p.active and g.module=p_module
 and g.level=any(case when p_write or p_sensitive in ('delete','bank_write','payment','generate','mark_published') then array['contribute'] else array['read','contribute'] end)
 and (p_module='publisher' or exists(select 1 from public.app_memberships m where m.user_id=p.user_id
 and m.workspace_id=case when p_module='izord' then 'izord' else 'oar' end and m.status='active'))
 and (p_sensitive is null or g.sensitive->p_sensitive='true'::jsonb));
$$;

create or replace function app_private.full_access() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select app_private.general_admin() and not exists(select 1 from unnest(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats']) m where not app_private.module_allowed(m,true))
 and app_private.module_allowed('documents',true,'export') and app_private.module_allowed('contacts',true,'bank_read')
 and app_private.module_allowed('contacts',true,'bank_write') and app_private.module_allowed('vendorInvoices',true,'payment')
 and not exists(select 1 from public.crm_module_grants where user_id=auth.uid() and module not in ('izord','publisher') and (sensitive->'delete' is distinct from 'true'::jsonb or sensitive->'export' is distinct from 'true'::jsonb));
$$;

create or replace function app_private.validate_grants(p_grants jsonb) returns void language plpgsql set search_path=pg_catalog as $$
declare g record; s record;
begin
 if p_grants is null or jsonb_typeof(p_grants)<>'object' then raise exception 'invalid_grants'; end if;
 for g in select * from jsonb_each(p_grants) loop
 if g.key<>all(array['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher'])
 or jsonb_typeof(g.value)<>'object' or g.value-array['level','sensitive']<>'{}' or jsonb_typeof(g.value->'level') is distinct from 'string' or g.value->>'level' not in ('none','read','contribute') or not(g.value?'level') or jsonb_typeof(coalesce(g.value->'sensitive','{}'))<>'object' then raise exception 'invalid_grants'; end if;
 for s in select * from jsonb_each(coalesce(g.value->'sensitive','{}')) loop
 if s.key<>all(array['delete','export','bank_read','bank_write','payment','generate','mark_published']) or jsonb_typeof(s.value)<>'boolean' then raise exception 'invalid_sensitive'; end if;
 if (g.key='publisher' and s.key not in ('export','generate','mark_published')) or (g.key<>'publisher' and s.key in ('generate','mark_published')) then raise exception 'invalid_module_sensitive'; end if;
 if s.value='true' then
 if g.value->>'level'='none' or (s.key in ('delete','bank_write','payment','generate','mark_published') and g.value->>'level'<>'contribute') or (s.key in ('bank_read','bank_write') and g.key<>'contacts') or (s.key='payment' and g.key<>'vendorInvoices') then raise exception 'sensitive_prerequisite'; end if;
 if s.key='bank_write' and g.value->'sensitive'->'bank_read' is distinct from 'true'::jsonb then raise exception 'bank_read_required'; end if;
 if s.key='payment' and (p_grants->'contacts'->'sensitive'->'bank_read' is distinct from 'true'::jsonb or p_grants->'contacts'->>'level' not in ('read','contribute')) then raise exception 'bank_read_required'; end if;
 end if;
 end loop;
 end loop;
end $$;

create or replace function public.crm_admin_save(p_user uuid,p_revision bigint,p_active boolean,p_general_admin boolean,p_grants jsonb,p_izord_role text,p_assignments uuid[]) returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare actual bigint; next_revision bigint; before_state jsonb;
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.general_admin() then raise exception 'general_admin_required' using errcode='42501'; end if;
 perform app_private.validate_grants(p_grants);
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'verified_recipient_required'; end if;
 select revision,to_jsonb(p) into actual,before_state from public.crm_access_profiles p where user_id=p_user for update;
 if p_revision is null or p_user is null or p_active is null or p_general_admin is null or p_assignments is null then raise exception 'invalid_access_parameters' using errcode='22023'; end if;
 if coalesce(actual,0) is distinct from p_revision then raise exception 'access_revision_conflict' using errcode='40001'; end if;
 if (not p_active or not p_general_admin) and exists(select 1 from public.crm_access_profiles where user_id=p_user and active and general_admin) and not exists(select 1 from public.crm_access_profiles where user_id<>p_user and active and general_admin) then raise exception 'last_general_admin'; end if;
 if p_izord_role is not null and p_izord_role not in ('admin','partner','contributor','reader') then raise exception 'invalid_izord_role'; end if;
 if coalesce(p_grants->'izord'->>'level','none')<>'none' and p_izord_role is null then raise exception 'izord_role_required'; end if;
 if exists(select 1 from unnest(p_assignments) a where not exists(select 1 from public.izord_projects project where project.id=a)) then raise exception 'unknown_project'; end if;
 insert into public.crm_access_profiles(user_id,active,general_admin) values(p_user,p_active,p_general_admin)
 on conflict(user_id) do update set active=excluded.active,general_admin=excluded.general_admin,revision=crm_access_profiles.revision+1,updated_at=clock_timestamp() returning revision into next_revision;
 delete from public.crm_module_grants where user_id=p_user;
 insert into public.crm_module_grants select p_user,key,value->>'level',coalesce(value->'sensitive','{}') from jsonb_each(p_grants);
 if exists(select 1 from jsonb_each(p_grants) g where g.key not in ('izord','publisher') and g.value->>'level'<>'none') then
 insert into public.app_memberships(user_id,workspace_id,role) values(p_user,'oar','member') on conflict(user_id,workspace_id) do update set status='active',updated_at=clock_timestamp(); end if;
 -- Revocation lives in the profile: do not destroy historical IZORD role or assignments.
 if p_izord_role is not null then
 insert into public.app_memberships(user_id,workspace_id,role) values(p_user,'izord',p_izord_role) on conflict(user_id,workspace_id) do update set role=excluded.role,status='active',updated_at=clock_timestamp();
 end if;
 delete from public.izord_project_assignments where user_id=p_user and not(project_id=any(coalesce(p_assignments,'{}')));
 insert into public.izord_project_assignments select distinct x,p_user from unnest(p_assignments) x on conflict do nothing;
 insert into public.crm_permission_events(actor_id,subject_id,action,detail) values(auth.uid(),p_user,'access_saved',jsonb_build_object('previousRevision',coalesce(actual,0),'revision',next_revision,'active',p_active,'generalAdmin',p_general_admin,'grants',p_grants,'izordRole',p_izord_role,'assignments',p_assignments));
 return next_revision;
end $$;

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
 perform app_private.validate_grants(i.grants);
 insert into public.crm_access_profiles(user_id) values(auth.uid()) on conflict(user_id) do update set active=true,general_admin=false,revision=crm_access_profiles.revision+1;
 delete from public.crm_module_grants where user_id=auth.uid();
 insert into public.crm_module_grants select auth.uid(),key,value->>'level',coalesce(value->'sensitive','{}') from jsonb_each(i.grants);
 if exists(select 1 from jsonb_each(i.grants) g where g.key not in ('izord','publisher') and g.value->>'level'<>'none') then
 insert into public.app_memberships(user_id,workspace_id,role) values(auth.uid(),'oar','member') on conflict(user_id,workspace_id) do update set status='active'; end if;
 if i.izord_role is not null then
 -- Do not replace an existing role through invitation acceptance.
 insert into public.app_memberships(user_id,workspace_id,role) values(auth.uid(),'izord',i.izord_role) on conflict do nothing; end if;
 insert into public.izord_project_assignments select distinct x,auth.uid() from unnest(i.assignments) x where i.izord_role is not null on conflict do nothing;
 update public.crm_access_invitations set accepted_at=clock_timestamp() where id=i.id;
 insert into public.crm_permission_events(actor_id,subject_id,action) values(auth.uid(),i.id,'invitation_accepted');
end $$;

-- Fixed operations only. Unknown/null actions never fall back to read access.
-- This RPC authorizes the current actor; API adapters still validate content/media
-- identifiers and recheck before returning results or invoking external providers.
create function public.crm_authorize_publisher(p_action text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id')
 and coalesce(case
 when p_action in ('session','today','history','status','image') then app_private.module_allowed('publisher')
 when p_action in ('export','export-text') then app_private.module_allowed('publisher',false,'export')
 when p_action in ('generate','regenerate-text','regenerate-image') then app_private.module_allowed('publisher',true,'generate')
 when p_action='publish' then app_private.module_allowed('publisher',true,'mark_published')
 when p_action='music-status' then app_private.module_allowed('publisher',true)
 else false end,false);
$$;
revoke all on function public.crm_authorize_publisher(text) from public,anon;
grant execute on function public.crm_authorize_publisher(text) to authenticated;
notify pgrst, 'reload schema';
commit;
