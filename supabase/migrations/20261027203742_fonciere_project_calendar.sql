-- Additive calendar assumptions: no row rewrite, derived dates, approval change,
-- financial recalculation, access change or new public RPC. Existing saved business
-- data and its dossier fingerprint already include all guided values.
begin;

-- Keep every existing guided definition and append only the personal calendar.
create or replace function app_private.fonciere_guided_catalog() returns jsonb
language sql immutable set search_path=pg_catalog as $catalog$
 select $json${"propertyType":{"kind":"choice","options":["house","villa","apartment","building","land","commercial","offices","industrial","parking","mixed","to_confirm","not_applicable","other"]},"askingPrice":{"kind":"number","min":0},"fees":{"kind":"composite","subfields":{"inclusion":{"kind":"choice","options":["included","extra","to_confirm","not_applicable"]},"payer":{"kind":"choice","options":["seller","buyer","shared","to_confirm"]},"amount":{"kind":"number","min":0},"percent":{"kind":"number","min":0,"max":100},"note":{"kind":"text"}}},"area":{"kind":"number","min":0},"areaKind":{"kind":"choice","options":["habitable","carrez","usable","floor","advertised","to_confirm","not_applicable","other"]},"land":{"kind":"number","min":0},"rooms":{"kind":"number","min":0,"integer":true},"bedrooms":{"kind":"number","min":0,"integer":true},"condition":{"kind":"choice","options":["new","excellent","good","refresh","renovate","heavy","to_confirm","not_applicable","other"]},"equipment":{"kind":"multi","options":["none","air_conditioning","heating","lift","fireplace","smart_home","alarm","accessibility","to_confirm","not_applicable","other"]},"annexes":{"kind":"multi","options":["none","garage","parking","cellar","outbuilding","guest_house","caretaker","plant_room","to_confirm","not_applicable","other"]},"exterior":{"kind":"multi","options":["none","garden","terrace","balcony","patio","courtyard","rooftop","water_access","to_confirm","not_applicable","other"]},"pool":{"kind":"choice","options":["absent","private","shared","planned","to_confirm","not_applicable","other"]},"view":{"kind":"multi","options":["none","sea","canal","mountain","countryside","garden","city","open","overlooked","to_confirm","not_applicable","other"]},"annexCount":{"kind":"number","min":0,"integer":true},"annexArea":{"kind":"number","min":0},"exteriorArea":{"kind":"number","min":0},"poolDetails":{"kind":"composite","subfields":{"heating":{"kind":"choice","options":["yes","no","to_confirm"]},"position":{"kind":"choice","options":["outdoor","indoor","to_confirm"]},"condition":{"kind":"text"}}},"seaExtent":{"kind":"choice","options":["partial","panoramic","to_confirm","not_applicable","other"]},"agencyPotential":{"kind":"multi","options":["none","renovation","redistribution","division","extension","change_use","resale","rental","to_confirm","not_applicable","other"]},"renovation":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"division":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"extension":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"resale":{"kind":"multi","options":["none","resale","long_term","seasonal","rent_then_resell","to_confirm","not_applicable","other"]},"rental":{"kind":"multi","options":["none","long_term","seasonal","rent_then_resell","to_confirm","not_applicable","other"]},"pointsOfInterest":{"kind":"multi","options":["none","sea_beach","centre","shops","schools","transport","port","quiet","view","upside","to_confirm","not_applicable","other"]},"pointsToVerify":{"kind":"checklist","options":["title","planning","division","structure","area","boundaries","risks","drainage","occupancy","charges","diagnostics","other"]},"diagnostics":{"kind":"diagnostics","options":["dpe","ges","asbestos","lead","electricity","gas","termites","risks","drainage","other"]},"charges":{"kind":"composite","subfields":{"amount":{"kind":"number","min":0},"period":{"kind":"choice","options":["month","quarter","year","once","to_confirm","not_applicable"]},"nature":{"kind":"text"},"note":{"kind":"text"}}},"constraints":{"kind":"multi","options":["none","condominium","easement","planning","risks","access","drainage","occupancy","to_confirm","not_applicable","other"]},"worksHypothesis":{"kind":"composite","subfields":{"amount":{"kind":"number","min":0},"level":{"kind":"choice","options":["refresh","renovation","heavy","extension","to_confirm","not_applicable","other"]},"comment":{"kind":"text"},"startDate":{"kind":"date"},"durationMonths":{"kind":"number","min":0,"max":1200,"integer":true}}},"resaleHypothesis":{"kind":"composite","subfields":{"amount":{"kind":"number","min":0},"timing":{"kind":"text"},"comment":{"kind":"text"},"receiptDelayMonths":{"kind":"number","min":0,"max":1200,"integer":true}}},"rentalHypothesis":{"kind":"composite","subfields":{"mode":{"kind":"choice","options":["long_term","seasonal","mixed","to_confirm","not_applicable","other"]},"amount":{"kind":"number","min":0},"period":{"kind":"choice","options":["night","week","month","year","to_confirm","not_applicable"]},"occupiedUnits":{"kind":"number","min":0},"occupancyPercent":{"kind":"number","min":0,"max":100},"comment":{"kind":"text"},"receiptDelayMonths":{"kind":"number","min":0,"max":1200,"integer":true}}},"locationPrecision":{"kind":"choice","options":["exact","approximate","to_confirm","not_applicable","other"]},"coordinates":{"kind":"composite","subfields":{"latitude":{"kind":"number","min":-90,"max":90},"longitude":{"kind":"number","min":-180,"max":180}}},"floor":{"kind":"number","min":-1000000,"integer":true},"lots":{"kind":"number","min":0,"integer":true},"uses":{"kind":"multi","options":["none","residential","commercial","offices","industrial","to_confirm","not_applicable","other"]},"occupancy":{"kind":"choice","options":["vacant","occupied","tenanted","partial","to_confirm","not_applicable","other"]},"servicing":{"kind":"choice","options":["serviced","partial","not_serviced","to_confirm","not_applicable","other"]},"buildability":{"kind":"composite","subfields":{"stage":{"kind":"choice","options":["to_study","agency_claim","documented","not_planned","not_applicable"]},"detail":{"kind":"text"},"documentId":{"kind":"text"}}},"parkingSpaces":{"kind":"number","min":0,"integer":true},"parkingType":{"kind":"choice","options":["garage","covered","outdoor","underground","to_confirm","not_applicable","other"]},"access":{"kind":"choice","options":["direct","shared","restricted","step_free","to_confirm","not_applicable","other"]},"personalStrategy":{"kind":"choice","options":["resale","rental","rental_then_resale"]}}$json$::jsonb;
$catalog$;
revoke all on function app_private.fonciere_guided_catalog() from public,anon,authenticated;

create or replace function app_private.validate_fonciere_guided_scalar(p_value jsonb,p_def jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$
declare n numeric; k text:=p_def->>'kind'; v jsonb; x text; seen text[]:=array[]::text[]; civil text; civil_date date;
begin
 if p_value='null'::jsonb then return; end if;
 if k='number' then
  if jsonb_typeof(p_value) is distinct from 'number' then raise exception 'invalid_fonciere_guided_number' using errcode='22023'; end if;
  n:=(p_value#>>'{}')::numeric;
  if abs(n)>1000000000000000 or (p_def ? 'min' and n<(p_def->>'min')::numeric) or (p_def ? 'max' and n>(p_def->>'max')::numeric) or (coalesce((p_def->>'integer')::boolean,false) and trunc(n)<>n) then raise exception 'invalid_fonciere_guided_number' using errcode='22023'; end if;
 elsif k='date' then
  if jsonb_typeof(p_value) is distinct from 'string' then raise exception 'invalid_fonciere_calendar_date' using errcode='22023'; end if;
  civil:=p_value#>>'{}';
  if civil='' then return; end if;
  if civil !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or substring(civil from 1 for 4)='0000' then raise exception 'invalid_fonciere_calendar_date' using errcode='22023'; end if;
  begin
   civil_date:=civil::date;
  exception when datetime_field_overflow or invalid_datetime_format then
   raise exception 'invalid_fonciere_calendar_date' using errcode='22023';
  end;
  if to_char(civil_date,'YYYY-MM-DD')<>civil then raise exception 'invalid_fonciere_calendar_date' using errcode='22023'; end if;
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

-- Civil dates never pass through a timestamp or timezone. Durations remain
-- explicit nullable whole calendar months; old records stay entirely untouched.
notify pgrst, 'reload schema';
commit;
