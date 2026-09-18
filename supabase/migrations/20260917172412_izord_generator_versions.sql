-- Lot 2: additive generator persistence. Earlier access/R1 migrations stay intact.
-- Apply only to the disposable local test stack until separately reviewed.
begin;

alter table public.izord_assets
  add column expected_size bigint check (expected_size between 1 and 26214400),
  add column expected_mime text,
  add column original_name text check (length(original_name) between 1 and 180),
  add constraint izord_generator_upload_metadata check (
    (expected_size is null and expected_mime is null and original_name is null)
    or (expected_size is not null and expected_mime is not null and original_name is not null));
create unique index izord_asset_project_identity on public.izord_assets(project_id,id);

-- These are references to existing immutable objects, not copies of photo bytes.
-- A new revision can retain an older finalized photo without granting publication.
create table public.izord_generator_asset_refs (
  project_id uuid not null,
  project_revision integer not null,
  slot text not null check (slot ~ '^(photo:(main|view|inside|operation)|gallery:[0-9]{1,3}|source:[0-5])$'),
  asset_id uuid not null,
  primary key(project_id,project_revision,slot),
  foreign key(project_id,project_revision) references public.izord_project_versions(project_id,revision),
  foreign key(project_id,asset_id) references public.izord_assets(project_id,id)
);
alter table public.izord_generator_asset_refs enable row level security;
revoke all on public.izord_generator_asset_refs from public,anon,authenticated;
grant select on public.izord_generator_asset_refs to authenticated;
create policy generator_ref_read on public.izord_generator_asset_refs for select to authenticated
  using (app_private.can_project(project_id) and exists (select 1 from public.izord_assets a
    where a.id=asset_id and app_private.can_asset(a.object_path)));

create function app_private.register_generator_asset(p_project uuid,p_revision integer,p_kind text,
  p_size bigint,p_mime text,p_name text) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare v_path text;
begin
 if p_size is null or p_size not between 1 and 26214400 or p_name is null or length(p_name) not between 1 and 180
   or p_name ~ '[[:cntrl:]/\\]' or not (
    p_kind='pdf' and p_mime='application/pdf' or
    p_kind='photo' and p_mime in ('image/jpeg','image/png') or
    p_kind='presentation' and p_mime='application/vnd.openxmlformats-officedocument.presentationml.presentation') then
   raise exception 'invalid_generator_upload' using errcode='22023';
 end if;
 v_path:=app_private.register_asset(p_project,p_revision,p_kind);
 update public.izord_assets set expected_size=p_size,expected_mime=p_mime,original_name=p_name where object_path=v_path;
 return v_path;
end $$;

-- Validate Storage's actual completed object metadata, including when the old
-- finalize RPC is invoked directly. No client-provided size can stand in for it.
create function app_private.guard_generator_finalization() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare v_metadata jsonb;
begin
 if old.lifecycle='pending' and new.lifecycle='finalized' and old.expected_size is not null then
  select metadata into v_metadata from storage.objects where bucket_id='izord-documents' and name=old.object_path;
  if coalesce((v_metadata->>'size')::bigint,0) is distinct from old.expected_size
    or v_metadata->>'mimetype' is distinct from old.expected_mime then
   raise exception 'generator_upload_size_or_type_mismatch' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function app_private.guard_generator_finalization() from public,anon,authenticated;
create trigger izord_generator_finalization before update on public.izord_assets
 for each row execute function app_private.guard_generator_finalization();

create function app_private.add_generator_ref(p_id uuid,p_revision integer,p_slot text,p_asset text,p_kind text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.izord_assets%rowtype;
begin
 if p_asset is null or p_asset='' then return; end if;
 if p_asset !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'invalid_generator_asset_reference' using errcode='22023';
 end if;
 select * into a from public.izord_assets where id=p_asset::uuid;
 if not found or a.project_id<>p_id or a.kind<>p_kind or a.lifecycle<>'finalized' or not app_private.can_asset(a.object_path) then
  raise exception 'forbidden_generator_asset_reference' using errcode='42501';
 end if;
 insert into public.izord_generator_asset_refs values(p_id,p_revision,p_slot,a.id);
end $$;
revoke all on function app_private.add_generator_ref(uuid,integer,text,text,text) from public,anon,authenticated;

create function app_private.save_generator(p_id uuid,p_expected_revision integer,p_title text,p_payload jsonb,p_status text) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare v_revision integer; v_role text; v_item jsonb; v_index integer:=0;
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
   or jsonb_array_length(p_payload->'sourceDocuments')>6 then
  raise exception 'invalid_generator_payload' using errcode='22023';
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
 return v_revision;
end $$;

revoke all on function app_private.register_generator_asset(uuid,integer,text,bigint,text,text),
 app_private.save_generator(uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function app_private.register_generator_asset(uuid,integer,text,bigint,text,text),
 app_private.save_generator(uuid,integer,text,jsonb,text) to authenticated;
create function public.izord_register_generator_asset(p_project uuid,p_revision integer,p_kind text,p_size bigint,p_mime text,p_name text) returns text
language sql security invoker set search_path=pg_catalog as $$
 select app_private.register_generator_asset(p_project,p_revision,p_kind,p_size,p_mime,p_name);
$$;
create function public.izord_save_generator(p_id uuid,p_expected_revision integer,p_title text,p_payload jsonb,p_status text) returns integer
language sql security invoker set search_path=pg_catalog as $$
 select app_private.save_generator(p_id,p_expected_revision,p_title,p_payload,p_status);
$$;
revoke all on function public.izord_register_generator_asset(uuid,integer,text,bigint,text,text),
 public.izord_save_generator(uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.izord_register_generator_asset(uuid,integer,text,bigint,text,text),
 public.izord_save_generator(uuid,integer,text,jsonb,text) to authenticated;
commit;
