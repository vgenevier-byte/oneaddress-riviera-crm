-- Explicit file/user sharing for the existing general Documents library only.
-- No production identities, resource IDs, automatic grants, or business-data writes.
begin;

insert into app_private.module_collections(collection,module,fields)
values('documents','documents','{}'::jsonb);

create table public.crm_document_shares (
 provider text not null,
 resource_id text not null,
 user_id uuid not null references public.crm_access_profiles(user_id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 primary key(provider,resource_id,user_id),
 foreign key(provider,resource_id) references public.crm_document_scopes(provider,resource_id)
);
alter table public.crm_document_shares enable row level security;
revoke all on public.crm_document_shares from public,anon,authenticated;

create function app_private.document_actor_active(p_user uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_user is not null and exists(select 1 from auth.users u
 where u.id=p_user and u.email_confirmed_at is not null and u.deleted_at is null
 and (u.banned_until is null or u.banned_until<=now()));
$$;

-- Exact references outside Documents protect banking and business resources even
-- when those resources have not yet been inventoried in crm_document_scopes.
create function app_private.document_has_business_reference(p_resource text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 with recursive refs(value) as (
  select e.value from public.crm_workspace_state w
  cross join lateral jsonb_each(w.payload) e
  where w.workspace_id='oneaddress-riviera' and e.key<>'documents'
  union all
  select child.value from refs r cross join lateral (
   select value from jsonb_each(case when jsonb_typeof(r.value)='object' then r.value else '{}'::jsonb end)
   union all
   select value from jsonb_array_elements(case when jsonb_typeof(r.value)='array' then r.value else '[]'::jsonb end)
  ) child
 ) select exists(select 1 from refs where value=to_jsonb(p_resource)
 or (jsonb_typeof(value)='string' and (value#>>'{}') ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
 and position(p_resource in value#>>'{}')>0));
$$;

create function app_private.general_document_entry(p_provider text,p_resource text,p_record text) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select case when count(*)=1 and count(*) filter(where r->>'id'=p_record)=1 then jsonb_agg(r)->0 else null end
 from public.crm_workspace_state w
 cross join lateral jsonb_array_elements(coalesce(w.payload->'documents','[]')) r
 where w.workspace_id='oneaddress-riviera'
 and (select count(*) from jsonb_array_elements(coalesce(w.payload->'documents','[]')) entry where entry->>'id'=p_record)=1
 and coalesce(r->>'isFolder','false')='false'
 and case p_provider when 'google-drive' then r->>'driveFileId'=p_resource
 when 'storage' then r->>'storagePath'=p_resource else false end;
$$;

-- Adding the library to the catalogue must not create a mutation route for
-- Documents contributors. The existing owner payload workflow remains intact.
create function app_private.guard_general_documents() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if (old.payload->'documents') is distinct from (new.payload->'documents')
 and auth.uid() is not null and not app_private.full_access() then
  raise exception 'general_document_write_forbidden' using errcode='42501';
 end if;
 return new;
end $$;
create trigger crm_guard_general_documents before update on public.crm_workspace_state
for each row execute function app_private.guard_general_documents();

create function app_private.guard_general_document_scopes() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op<>'DELETE' and (new.collection='documents' or new.module='documents') then
  if new.collection<>'documents' or new.module<>'documents' or new.bank
   or app_private.general_document_entry(new.provider,new.resource_id,new.record_id) is null
   or app_private.document_has_business_reference(new.resource_id) then
   raise exception 'invalid_general_document_owner' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (old.collection<>'documents' or old.module<>'documents' or old.bank) then
   raise exception 'protected_document_scope' using errcode='42501';
  end if;
 end if;
 if ((tg_op<>'INSERT' and (old.collection='documents' or old.module='documents'))
 or (tg_op<>'DELETE' and (new.collection='documents' or new.module='documents')))
 and auth.uid() is not null and not app_private.full_access() then
  raise exception 'general_document_write_forbidden' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger crm_guard_general_document_scopes before insert or update or delete on public.crm_document_scopes
for each row execute function app_private.guard_general_document_scopes();

create function app_private.guard_document_shares() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is not null and not app_private.full_access() then
  raise exception 'document_sharing_forbidden' using errcode='42501';
 end if;
 if tg_op<>'DELETE' and not exists(select 1 from public.crm_document_scopes d
 where d.provider=new.provider and d.resource_id=new.resource_id
 and d.module='documents' and d.collection='documents' and not d.bank) then
  raise exception 'protected_document_scope' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger crm_guard_document_shares before insert or update or delete on public.crm_document_shares
for each row execute function app_private.guard_document_shares();

create or replace function app_private.document_allowed(p_provider text,p_resource text,p_write boolean default false,p_download boolean default false) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select p_write is not null and p_download is not null and
 (app_private.full_access() and (not exists(select 1 from public.crm_document_scopes d
  where d.provider=p_provider and d.resource_id=p_resource and d.collection='documents')
  or app_private.document_actor_active(auth.uid()))
 or exists(select 1 from public.crm_document_scopes d
  join public.crm_workspace_state w on w.workspace_id='oneaddress-riviera'
  where d.provider=p_provider and d.resource_id=p_resource
  and app_private.module_allowed('documents',p_write,case when p_download then 'export' end)
  and case when d.module='documents' or d.collection='documents' then
   d.module='documents' and d.collection='documents' and not d.bank and not p_write
   and app_private.document_actor_active(auth.uid())
   and app_private.general_document_entry(d.provider,d.resource_id,d.record_id) is not null
   and not app_private.document_has_business_reference(d.resource_id)
   and exists(select 1 from public.crm_document_shares s
    where s.provider=d.provider and s.resource_id=d.resource_id and s.user_id=auth.uid() and s.revoked_at is null)
  else
   app_private.module_allowed(d.module,p_write,case when p_download then 'export' end)
   and (not d.bank or app_private.module_allowed('contacts',p_write,case when p_write then 'bank_write' else 'bank_read' end))
   and exists(select 1 from jsonb_array_elements(coalesce(w.payload->d.collection,'[]')) r where r->>'id'=d.record_id)
  end));
$$;

create function public.crm_share_general_document(p_provider text,p_resource text,p_record text,p_user uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb; old_scope public.crm_document_scopes%rowtype; parent_id text; folder_title text:='Documents';
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.full_access() or not app_private.document_actor_active(auth.uid()) then
  raise exception 'document_sharing_forbidden' using errcode='42501';
 end if;
 if not app_private.document_actor_active(p_user) or not exists(
  select 1 from public.crm_access_profiles p join public.crm_module_grants g using(user_id)
  join public.app_memberships m using(user_id)
  where p.user_id=p_user and p.active and g.module='documents' and g.level in ('read','contribute')
  and m.workspace_id='oar' and m.status='active') then
  raise exception 'inactive_document_recipient' using errcode='42501';
 end if;
 if p_resource is null or length(p_resource) not between 1 and 500 then
  raise exception 'invalid_general_document_owner' using errcode='22023';
 end if;
 select payload into strict r from public.crm_workspace_state where workspace_id='oneaddress-riviera' for share;
 r:=app_private.general_document_entry(p_provider,p_resource,p_record);
 if r is null or length(coalesce(r->>'title','')) not between 1 and 240
 or app_private.document_has_business_reference(p_resource) then
  raise exception 'invalid_general_document_owner' using errcode='42501';
 end if;
 parent_id:=coalesce(nullif(r->>'folderId',''),nullif(r->>'parentFolderId',''));
 if parent_id is not null then
  select f->>'title' into strict folder_title from public.crm_workspace_state w
  cross join lateral jsonb_array_elements(coalesce(w.payload->'documents','[]')) f
  where w.workspace_id='oneaddress-riviera' and f->>'id'=parent_id and f->>'isFolder'='true'
  and (p_provider<>'google-drive' or coalesce(nullif(r->>'driveParentFolderId',''),nullif(r->>'driveFolderId',''),'')=''
   or f->>'driveFolderId'=coalesce(nullif(r->>'driveParentFolderId',''),r->>'driveFolderId'));
 end if;
 select * into old_scope from public.crm_document_scopes where provider=p_provider and resource_id=p_resource for update;
 if found and (old_scope.module<>'documents' or old_scope.collection<>'documents' or old_scope.bank
  or old_scope.record_id<>p_record) then raise exception 'protected_document_scope' using errcode='42501'; end if;
 insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title,folder,bank)
 values(p_provider,p_resource,'documents','documents',p_record,r->>'title',folder_title,false)
 on conflict(provider,resource_id) do nothing;
 insert into public.crm_document_shares(provider,resource_id,user_id,created_by)
 values(p_provider,p_resource,p_user,auth.uid())
 on conflict(provider,resource_id,user_id) do update set revoked_at=null,created_by=excluded.created_by,created_at=clock_timestamp();
 insert into public.crm_permission_events(actor_id,subject_id,action,detail)
 values(auth.uid(),p_user,'document_shared',jsonb_build_object('provider',p_provider,'resource_id',p_resource,'record_id',p_record));
end $$;

create function public.crm_revoke_document_share(p_provider text,p_resource text,p_user uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(734991);
 if not app_private.full_access() or not app_private.document_actor_active(auth.uid()) then
  raise exception 'document_sharing_forbidden' using errcode='42501';
 end if;
 update public.crm_document_shares set revoked_at=clock_timestamp()
 where provider=p_provider and resource_id=p_resource and user_id=p_user and revoked_at is null;
 if found then
  insert into public.crm_permission_events(actor_id,subject_id,action,detail)
  values(auth.uid(),p_user,'document_share_revoked',jsonb_build_object('provider',p_provider,'resource_id',p_resource));
 end if;
end $$;

create or replace function public.crm_read_module(p_module text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare w jsonb; result jsonb:='{}'; c record; rows jsonb;
begin
 if not app_private.module_allowed(p_module) then raise exception 'module_forbidden' using errcode='42501'; end if;
 select payload into strict w from public.crm_workspace_state where workspace_id='oneaddress-riviera';
 if p_module='dashboard' then
  for c in select * from app_private.module_collections where app_private.module_allowed(module) loop
   if c.collection='documents' then
    result:=result||jsonb_build_object('documents',(select count(*) from public.crm_document_scopes d where app_private.document_allowed(d.provider,d.resource_id)));
   else
    result:=result||jsonb_build_object(c.collection,jsonb_array_length(coalesce(w->c.collection,'[]')));
   end if;
  end loop;
 elsif p_module='documents' then
  if not app_private.document_actor_active(auth.uid()) then raise exception 'document_actor_inactive' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'resource_id',resource_id,'title',title,'module',module,'bank',bank,'folder',folder,'collection',collection,'record_id',record_id,'superseded_by',superseded_by,'readonly',module='documents' and collection='documents' and not app_private.full_access(),'replaceable',provider='storage' and app_private.document_replaceable(resource_id),'deletable',provider='storage' and app_private.document_deletable(resource_id))),'[]') into rows from public.crm_document_scopes where app_private.document_allowed(provider,resource_id);
  result:=jsonb_build_object('documents',rows);
 elsif p_module='bookings' then
  select coalesce(jsonb_agg(app_private.project_record('quotes',r)||jsonb_build_object('bookingStatus',r->'bookingStatus')),'[]') into rows from jsonb_array_elements(coalesce(w->'quotes','[]')) r where r->>'status'='Accepted';
  result:=jsonb_build_object('bookings',rows);
 else
  for c in select * from app_private.module_collections where module=p_module loop
   select coalesce(jsonb_agg(app_private.project_record(c.collection,r)),'[]') into rows from jsonb_array_elements(coalesce(w->c.collection,'[]')) r;
   result:=result||jsonb_build_object(c.collection,rows);
  end loop;
 end if;
 -- Revision fingerprint contains no payload and is scoped to the module, including hidden fields for conflict detection.
 return jsonb_build_object('collections',result,'revision',app_private.module_revision(p_module,w));
end $$;
create or replace function app_private.module_revision(p_module text,p_payload jsonb) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select case when p_module='documents' then
 md5(coalesce((select jsonb_agg(to_jsonb(d) order by d.provider,d.resource_id) from public.crm_document_scopes d
 where app_private.document_allowed(d.provider,d.resource_id)),'[]'::jsonb)::text)
 else md5(coalesce((select jsonb_object_agg(collection,p_payload->collection) from app_private.module_collections where module=p_module or (p_module='bookings' and collection='quotes')),'{}')::text) end;
$$;

revoke all on function app_private.document_actor_active(uuid),app_private.document_has_business_reference(text),
 app_private.general_document_entry(text,text,text),app_private.guard_general_documents(),
 app_private.guard_general_document_scopes(),app_private.guard_document_shares(),
 public.crm_share_general_document(text,text,text,uuid),public.crm_revoke_document_share(text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.crm_share_general_document(text,text,text,uuid),public.crm_revoke_document_share(text,text,uuid)
 to authenticated;
notify pgrst,'reload schema';
commit;
