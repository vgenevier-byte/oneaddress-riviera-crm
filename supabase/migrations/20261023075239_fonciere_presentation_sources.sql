-- Agency originals may be PDF or images. Keep presentation project/asset ACL,
-- immutable asset finalization, expected bytes/MIME and revision checks unchanged.
-- Source slots alone admit image originals; gallery slots still require photos.
alter table public.izord_generator_asset_refs drop constraint izord_generator_asset_refs_slot_check;
alter table public.izord_generator_asset_refs add constraint izord_generator_asset_refs_slot_check
 check(slot ~ '^(photo:(main|view|inside|operation)|gallery:[0-9]{1,3}|source:([0-9]|[12][0-9]))$');

create table public.fonciere_presentation_sources (
 presentation_id uuid not null,
 presentation_revision integer not null,
 source_project_id uuid not null references public.fonciere_projects(id),
 source_revision integer not null check(source_revision>0),
 primary key(presentation_id,presentation_revision),
 foreign key(presentation_id,presentation_revision) references public.izord_project_versions(project_id,revision)
);
create index fonciere_presentation_source_project on public.fonciere_presentation_sources(source_project_id);
alter table public.fonciere_presentation_sources enable row level security;
revoke all on public.fonciere_presentation_sources from public,anon,authenticated;
grant select on public.fonciere_presentation_sources to authenticated;
create policy fonciere_presentation_source_read on public.fonciere_presentation_sources
 for select to authenticated using(app_private.can_project(presentation_id));

create or replace function app_private.register_generator_asset(p_project uuid,p_revision integer,p_kind text,
  p_size bigint,p_mime text,p_name text) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare v_path text;
begin
 if p_size is null or p_size not between 1 and 26214400 or p_name is null or length(p_name) not between 1 and 180
   or p_name ~ '[[:cntrl:]/\\]' or not (
    p_kind='pdf' and p_mime='application/pdf' or
    p_kind='photo' and p_mime in ('image/jpeg','image/png','image/webp') or
    p_kind='presentation' and p_mime='application/vnd.openxmlformats-officedocument.presentationml.presentation') then
   raise exception 'invalid_generator_upload' using errcode='22023';
 end if;
 v_path:=app_private.register_asset(p_project,p_revision,p_kind);
 update public.izord_assets set expected_size=p_size,expected_mime=p_mime,original_name=p_name where object_path=v_path;
 return v_path;
end $$;

create or replace function app_private.add_generator_ref(p_id uuid,p_revision integer,p_slot text,p_asset text,p_kind text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare a public.izord_assets%rowtype;
begin
 if p_asset is null or p_asset='' then return; end if;
 if p_asset !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'invalid_generator_asset_reference' using errcode='22023';
 end if;
 select * into a from public.izord_assets where id=p_asset::uuid;
 if not found or a.project_id<>p_id or (a.kind<>p_kind and not (p_kind='pdf' and p_slot like 'source:%' and a.kind='photo' and a.expected_mime in ('image/jpeg','image/png','image/webp'))) or (p_slot not like 'source:%' and a.expected_mime='image/webp') or a.lifecycle<>'finalized' or not app_private.can_asset(a.object_path) then
  raise exception 'forbidden_generator_asset_reference' using errcode='42501';
 end if;
 insert into public.izord_generator_asset_refs values(p_id,p_revision,p_slot,a.id);
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
   and (not app_private.can_fonciere_project(v_source_id) or not exists(select 1 from public.fonciere_projects p where p.id=v_source_id and p.revision>=v_source_revision))
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

update storage.buckets set allowed_mime_types = array_append(allowed_mime_types,'image/webp')
where id='izord-documents' and allowed_mime_types is not null and not ('image/webp'=any(allowed_mime_types));
notify pgrst,'reload schema';
