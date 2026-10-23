begin;

-- Additive guided values. Existing project rows and presentation snapshots are untouched.
-- All guided enums are stable language-neutral codes; legacy strings remain byte-preserved.
create function app_private.fonciere_guided_catalog() returns jsonb
language sql immutable set search_path=pg_catalog as $catalog$
 select $json${"propertyType":{"kind":"choice","options":["house","villa","apartment","building","land","commercial","offices","industrial","parking","mixed","to_confirm","not_applicable","other"]},"askingPrice":{"kind":"number","min":0},"fees":{"kind":"composite","subfields":{"inclusion":{"kind":"choice","options":["included","extra","to_confirm","not_applicable"]},"payer":{"kind":"choice","options":["seller","buyer","shared","to_confirm"]},"amount":{"kind":"number","min":0},"percent":{"kind":"number","min":0,"max":100},"note":{"kind":"text"}}},"area":{"kind":"number","min":0},"areaKind":{"kind":"choice","options":["habitable","carrez","usable","floor","advertised","to_confirm","not_applicable","other"]},"land":{"kind":"number","min":0},"rooms":{"kind":"number","min":0,"integer":true},"bedrooms":{"kind":"number","min":0,"integer":true},"condition":{"kind":"choice","options":["new","excellent","good","refresh","renovate","heavy","to_confirm","not_applicable","other"]},"equipment":{"kind":"multi","options":["none","air_conditioning","heating","lift","fireplace","smart_home","alarm","accessibility","to_confirm","not_applicable","other"]},"annexes":{"kind":"multi","options":["none","garage","parking","cellar","outbuilding","guest_house","caretaker","plant_room","to_confirm","not_applicable","other"]},"exterior":{"kind":"multi","options":["none","garden","terrace","balcony","patio","courtyard","rooftop","water_access","to_confirm","not_applicable","other"]},"pool":{"kind":"choice","options":["absent","private","shared","planned","to_confirm","not_applicable","other"]},"view":{"kind":"multi","options":["none","sea","canal","mountain","countryside","garden","city","open","overlooked","to_confirm","not_applicable","other"]},"annexCount":{"kind":"number","min":0,"integer":true},"annexArea":{"kind":"number","min":0},"exteriorArea":{"kind":"number","min":0},"poolDetails":{"kind":"composite","subfields":{"heating":{"kind":"choice","options":["yes","no","to_confirm"]},"position":{"kind":"choice","options":["outdoor","indoor","to_confirm"]},"condition":{"kind":"text"}}},"seaExtent":{"kind":"choice","options":["partial","panoramic","to_confirm","not_applicable","other"]},"agencyPotential":{"kind":"multi","options":["none","renovation","redistribution","division","extension","change_use","resale","rental","to_confirm","not_applicable","other"]},"renovation":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"division":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"extension":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"resale":{"kind":"multi","options":["none","resale","long_term","seasonal","rent_then_resell","to_confirm","not_applicable","other"]},"rental":{"kind":"multi","options":["none","long_term","seasonal","rent_then_resell","to_confirm","not_applicable","other"]},"pointsOfInterest":{"kind":"multi","options":["none","sea_beach","centre","shops","schools","transport","port","quiet","view","upside","to_confirm","not_applicable","other"]},"pointsToVerify":{"kind":"checklist","options":["title","planning","division","structure","area","boundaries","risks","drainage","occupancy","charges","diagnostics","other"]},"diagnostics":{"kind":"diagnostics","options":["dpe","ges","asbestos","lead","electricity","gas","termites","risks","drainage","other"]},"charges":{"kind":"composite","subfields":{"amount":{"kind":"number","min":0},"period":{"kind":"choice","options":["month","quarter","year","once","to_confirm","not_applicable"]},"nature":{"kind":"text"},"note":{"kind":"text"}}},"constraints":{"kind":"multi","options":["none","condominium","easement","planning","risks","access","drainage","occupancy","to_confirm","not_applicable","other"]},"worksHypothesis":{"kind":"composite","subfields":{"amount":{"kind":"number","min":0},"level":{"kind":"choice","options":["refresh","renovation","heavy","extension","to_confirm","not_applicable","other"]},"comment":{"kind":"text"}}},"resaleHypothesis":{"kind":"composite","subfields":{"amount":{"kind":"number","min":0},"timing":{"kind":"text"},"comment":{"kind":"text"}}},"rentalHypothesis":{"kind":"composite","subfields":{"mode":{"kind":"choice","options":["long_term","seasonal","mixed","to_confirm","not_applicable","other"]},"amount":{"kind":"number","min":0},"period":{"kind":"choice","options":["night","week","month","year","to_confirm","not_applicable"]},"occupiedUnits":{"kind":"number","min":0},"occupancyPercent":{"kind":"number","min":0,"max":100},"comment":{"kind":"text"}}},"locationPrecision":{"kind":"choice","options":["exact","approximate","to_confirm","not_applicable","other"]},"coordinates":{"kind":"composite","subfields":{"latitude":{"kind":"number","min":-90,"max":90},"longitude":{"kind":"number","min":-180,"max":180}}},"floor":{"kind":"number","min":-1000000,"integer":true},"lots":{"kind":"number","min":0,"integer":true},"uses":{"kind":"multi","options":["none","residential","commercial","offices","industrial","to_confirm","not_applicable","other"]},"occupancy":{"kind":"choice","options":["vacant","occupied","tenanted","partial","to_confirm","not_applicable","other"]},"servicing":{"kind":"choice","options":["serviced","partial","not_serviced","to_confirm","not_applicable","other"]},"buildability":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"parkingSpaces":{"kind":"number","min":0,"integer":true},"parkingType":{"kind":"choice","options":["garage","covered","outdoor","underground","to_confirm","not_applicable","other"]},"access":{"kind":"choice","options":["direct","shared","restricted","step_free","to_confirm","not_applicable","other"]}}$json$::jsonb;
$catalog$;
revoke all on function app_private.fonciere_guided_catalog() from public,anon,authenticated;

create function app_private.validate_fonciere_guided_scalar(p_value jsonb,p_def jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$
declare n numeric; k text:=p_def->>'kind'; v jsonb; x text; seen text[]:=array[]::text[];
begin
 if p_value='null'::jsonb then return; end if;
 if k='number' then
  if jsonb_typeof(p_value) is distinct from 'number' then raise exception 'invalid_fonciere_guided_number' using errcode='22023'; end if;
  n:=(p_value#>>'{}')::numeric;
  if abs(n)>1000000000000000 or (p_def ? 'min' and n<(p_def->>'min')::numeric) or (p_def ? 'max' and n>(p_def->>'max')::numeric) or (coalesce((p_def->>'integer')::boolean,false) and trunc(n)<>n) then raise exception 'invalid_fonciere_guided_number' using errcode='22023'; end if;
 elsif k='text' then
  if jsonb_typeof(p_value) is distinct from 'string' or length(p_value#>>'{}')>12000 then raise exception 'invalid_fonciere_guided_text' using errcode='22023'; end if;
 elsif k='choice' then
  if jsonb_typeof(p_value) is distinct from 'string' or not (p_def->'options' @> jsonb_build_array(p_value)) then raise exception 'invalid_fonciere_guided_choice' using errcode='22023'; end if;
 elsif k='multi' then
  if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value)>40 then raise exception 'invalid_fonciere_guided_multi' using errcode='22023'; end if;
  for v in select value from jsonb_array_elements(p_value) loop
   x:=v#>>'{}';
   if jsonb_typeof(v) is distinct from 'string' or not (p_def->'options' @> jsonb_build_array(v)) or x=any(seen) or (x in ('none','to_confirm','not_applicable') and jsonb_array_length(p_value)>1) then raise exception 'invalid_fonciere_guided_multi' using errcode='22023'; end if;
   seen:=array_append(seen,x);
  end loop;
 else raise exception 'invalid_fonciere_guided_kind' using errcode='22023'; end if;
end $$;
revoke all on function app_private.validate_fonciere_guided_scalar(jsonb,jsonb) from public,anon,authenticated;

alter function app_private.validate_fonciere_payload(uuid,jsonb) rename to validate_fonciere_payload_legacy_v1;
create function app_private.validate_fonciere_payload(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb:=p_payload->'data'; g jsonb:=d->'guided'; catalog jsonb:=app_private.fonciere_guided_catalog();
 k text; v jsonb; def jsonb; sk text; sv jsonb; row jsonb; source text; role text; baseline jsonb; seen text[]; allowed text[];
begin
 if octet_length(p_payload::text)>1048576 then raise exception 'invalid_fonciere_payload' using errcode='22023'; end if;
 -- Keep all established auth/project/storage checks in the original validator.
 perform app_private.validate_fonciere_payload_legacy_v1(p_id,jsonb_set(p_payload,'{data}',d-'guided'-'contactSources'));
 if d ? 'contactSources' then
  if jsonb_typeof(d->'contactSources') is distinct from 'object' then raise exception 'invalid_fonciere_contact_sources' using errcode='22023'; end if;
  for role,v in select key,value from jsonb_each(d->'contactSources') loop
   if role not in ('agent','agency') or jsonb_typeof(v) is distinct from 'object' or v-'baseline'<>'{}'::jsonb or jsonb_typeof(v->'baseline') is distinct from 'object' then raise exception 'invalid_fonciere_contact_sources' using errcode='22023'; end if;
   allowed:=case when role='agent' then array['agentName','agentEmail','agentPhone','agencyName'] else array['agencyName','agencyAddress','agencyPhone','agencyEmail'] end;
   for sk,sv in select key,value from jsonb_each(v->'baseline') loop
    if not(sk=any(allowed)) or jsonb_typeof(sv) is distinct from 'string' or length(sv#>>'{}')>12000 then raise exception 'invalid_fonciere_contact_sources' using errcode='22023'; end if;
   end loop;
  end loop;
 end if;
 if g is null then return; end if;
 if jsonb_typeof(g) is distinct from 'object' or g->'version' is distinct from '1'::jsonb or jsonb_typeof(g->'values') is distinct from 'object' or g-'version'-'values'-'inactive'-'details'<>'{}'::jsonb then raise exception 'invalid_fonciere_guided' using errcode='22023'; end if;
 if g ? 'inactive' then
  if jsonb_typeof(g->'inactive') is distinct from 'array' then raise exception 'invalid_fonciere_guided_applicability' using errcode='22023'; end if;
  seen:=array[]::text[];
  for v in select value from jsonb_array_elements(g->'inactive') loop
   k:=v#>>'{}';
   if jsonb_typeof(v) is distinct from 'string' or not(catalog ? k) or k=any(seen) then raise exception 'invalid_fonciere_guided_applicability' using errcode='22023'; end if;
   seen:=array_append(seen,k);
  end loop;
 end if;
 if g ? 'details' then
  if jsonb_typeof(g->'details') is distinct from 'object' then raise exception 'invalid_fonciere_guided_details' using errcode='22023'; end if;
  for k,v in select key,value from jsonb_each(g->'details') loop
   if not(catalog ? k) or jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>12000 then raise exception 'invalid_fonciere_guided_details' using errcode='22023'; end if;
  end loop;
 end if;
 for k,v in select key,value from jsonb_each(g->'values') loop
  def:=catalog->k;
  if def is null then raise exception 'unknown_fonciere_guided_field' using errcode='22023'; end if;
  if v='null'::jsonb then continue; end if;
  if def->>'kind'='composite' then
   if jsonb_typeof(v) is distinct from 'object' then raise exception 'invalid_fonciere_guided_composite' using errcode='22023'; end if;
   for sk,sv in select key,value from jsonb_each(v) loop
    if not(def->'subfields' ? sk) then raise exception 'unknown_fonciere_guided_subfield' using errcode='22023'; end if;
    perform app_private.validate_fonciere_guided_scalar(sv,def->'subfields'->sk);
   end loop;
  elsif def->>'kind' in ('checklist','diagnostics') then
   if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>50 then raise exception 'invalid_fonciere_guided_checks' using errcode='22023'; end if;
   seen:=array[]::text[];
   for row in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(row) is distinct from 'object' or row-'code'-'status'-'detail'-'documentId'-'grade'<>'{}'::jsonb or jsonb_typeof(row->'code') is distinct from 'string' or not(def->'options' @> jsonb_build_array(row->'code')) or (row->>'code')=any(seen) then raise exception 'invalid_fonciere_guided_checks' using errcode='22023'; end if;
    seen:=array_append(seen,row->>'code');
    if jsonb_typeof(row->'status') is distinct from 'string' or (def->>'kind'='checklist' and row->>'status' not in ('to_verify','in_progress','verified')) or (def->>'kind'='diagnostics' and row->>'status' not in ('available','not_provided','in_progress','not_applicable')) then raise exception 'invalid_fonciere_guided_check_status' using errcode='22023'; end if;
    if row ? 'grade' and (row->>'code' not in ('dpe','ges') or row->>'status'<>'available' or jsonb_typeof(row->'grade') is distinct from 'string' or row->>'grade' !~ '^[A-G]$') then raise exception 'invalid_fonciere_guided_grade' using errcode='22023'; end if;
    if row ? 'detail' and (jsonb_typeof(row->'detail') is distinct from 'string' or length(row->>'detail')>12000) then raise exception 'invalid_fonciere_guided_check_detail' using errcode='22023'; end if;
    if row ? 'documentId' and (jsonb_typeof(row->'documentId') is distinct from 'string' or length(row->>'documentId')>180) then raise exception 'invalid_fonciere_guided_document' using errcode='22023'; end if;
   end loop;
  else perform app_private.validate_fonciere_guided_scalar(v,def); end if;
 end loop;
 -- A referenced evidence document must be a finalized asset of this exact property.
 for source in
  select x.value->>'documentId' from jsonb_each(g->'values') x where jsonb_typeof(x.value)='object' and x.value ? 'documentId'
  union all
  select evidence.value->>'documentId' from jsonb_each(g->'values') x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.value)='array' then x.value else '[]'::jsonb end) evidence(value) where jsonb_typeof(evidence.value)='object' and evidence.value ? 'documentId'
 loop
  if coalesce(source,'')='' then continue; end if;
  if source !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists(select 1 from public.fonciere_assets a where a.id::text=source and a.project_id=p_id and a.lifecycle='finalized' and a.kind in ('pdf','attachment') and app_private.can_fonciere_asset(a.object_path)) then raise exception 'forbidden_fonciere_guided_document' using errcode='42501'; end if;
 end loop;
end $$;
revoke all on function app_private.validate_fonciere_payload(uuid,jsonb) from public,anon,authenticated;
revoke all on function app_private.validate_fonciere_payload_legacy_v1(uuid,jsonb) from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
