-- Additive, optional rental alternatives. No project backfill, new tables or public grants.
create function app_private.fonciere_rental_schema() returns jsonb language sql immutable set search_path=pg_catalog as $schema$ select '{"type":"object","properties":{"version":{"type":"number","enum":[1]},"cost":{"type":"object","properties":{"acquisition":{"type":["number","null"],"minimum":0,"maximum":1000000000000.0},"acquisitionFees":{"type":["number","null"],"minimum":0,"maximum":1000000000000.0},"works":{"type":["number","null"],"minimum":0,"maximum":1000000000000.0},"other":{"type":["number","null"],"minimum":0,"maximum":1000000000000.0},"confirmed":{"type":"boolean"}},"required":["acquisition","acquisitionFees","works","other","confirmed"]},"referenceId":{"type":["string","null"],"maxLength":36,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"scenarios":{"type":"array","maxItems":20,"items":{"type":"object","properties":{"id":{"type":"string","maxLength":36,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"name":{"type":"string","maxLength":120},"mode":{"type":"string","enum":["long_term","seasonal","mixed","annual"]},"periods":{"type":"array","maxItems":12,"items":{"type":"object","properties":{"id":{"type":"string","maxLength":36,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"unit":{"type":"string","enum":["month","week","night","year"]},"rate":{"type":["number","null"],"minimum":0,"maximum":1000000000000.0},"rentedUnits":{"type":["number","null"],"minimum":0,"maximum":365,"integer":true},"availability":{"type":["number","null"],"minimum":0,"maximum":365,"integer":true},"occupancyPercent":{"type":["number","null"],"minimum":0,"maximum":100},"start":{"type":"string","maxLength":5,"pattern":"^$|^[0-9]{2}-[0-9]{2}$"},"end":{"type":"string","maxLength":5,"pattern":"^$|^[0-9]{2}-[0-9]{2}$"}},"required":["id","unit","rate","rentedUnits","availability","occupancyPercent","start","end"]}},"management":{"type":["number","null"],"minimum":0,"maximum":1000000000000.0},"operatingCosts":{"type":["number","null"],"minimum":0,"maximum":1000000000000.0},"receiptDelayMonths":{"type":["number","null"],"minimum":0,"maximum":1200,"integer":true}},"required":["id","name","mode","periods","management","operatingCosts","receiptDelayMonths"]}}},"required":["version","cost","referenceId","scenarios"]}'::jsonb $schema$;
create function app_private.fonciere_annual_day(v text) returns integer
language plpgsql immutable set search_path=pg_catalog as $$
declare d date;
begin
 if v='' then return null; end if;
 if v !~ '^[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_rental_window' using errcode='22023'; end if;
 begin d:=('2001-'||v)::date; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'invalid_rental_window' using errcode='22023'; end;
 if to_char(d,'MM-DD')<>v then raise exception 'invalid_rental_window' using errcode='22023'; end if;
 return extract(doy from d)::integer;
end $$;
create function app_private.validate_fonciere_rentals(v jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$
declare s jsonb; p jsonb; ids text[]:=array[]::text[]; pids text[]; windows int4range[]; w int4range; a integer; b integer; cap integer; av numeric; occ numeric; rented numeric;
begin
 if v is null or v='null'::jsonb then return; end if;
 perform app_private.validate_fonciere_owner_shape(v,app_private.fonciere_rental_schema());
 for s in select value from jsonb_array_elements(v->'scenarios') loop
  if s->>'id'=any(ids) or jsonb_array_length(s->'periods')<1 or (s->>'mode'<>'mixed' and jsonb_array_length(s->'periods')<>1) then raise exception 'invalid_rental_scenario' using errcode='22023'; end if;
  ids:=array_append(ids,s->>'id');pids:=array[]::text[];windows:=array[]::int4range[];
  for p in select value from jsonb_array_elements(s->'periods') loop
   if p->>'id'=any(pids) or s->>'mode'='long_term' and p->>'unit'<>'month' or s->>'mode'='seasonal' and p->>'unit' not in ('week','night') or s->>'mode'='annual' and p->>'unit'<>'year' then raise exception 'invalid_rental_unit' using errcode='22023'; end if;
   pids:=array_append(pids,p->>'id');a:=app_private.fonciere_annual_day(p->>'start');b:=app_private.fonciere_annual_day(p->>'end');
   if (a is null)<>(b is null) or b<a or s->>'mode'='mixed' and a is null then raise exception 'invalid_rental_window' using errcode='22023'; end if;
   cap:=case p->>'unit' when 'month' then 12 when 'week' then 52 when 'night' then 365 else 1 end;
   if a is not null then
    w:=int4range(a,b,'[]');if exists(select 1 from unnest(windows) prior where prior&&w) then raise exception 'overlapping_rental_periods' using errcode='22023'; end if;windows:=array_append(windows,w);
    cap:=case p->>'unit' when 'night' then b-a+1 when 'week' then (b-a+1)/7 when 'year' then case when b-a+1=365 then 1 else 0 end else substring(p->>'end' from 1 for 2)::integer-substring(p->>'start' from 1 for 2)::integer+1 end;
    if p->>'unit'='month' and (right(p->>'start',2)<>'01' or to_char(('2001-'||(p->>'end'))::date+1,'DD')<>'01') then raise exception 'partial_rental_month' using errcode='22023'; end if;
   end if;
   av:=(p->>'availability')::numeric;occ:=(p->>'occupancyPercent')::numeric;rented:=(p->>'rentedUnits')::numeric;
   if av>cap or rented>cap or rented>av or occ is not null and av is null or occ is not null and av is not null and rented is not null and abs(av*occ/100-rented)>0.0000001 then raise exception 'inconsistent_rental_occupancy' using errcode='22023'; end if;
  end loop;
 end loop;
 if v->>'referenceId' is not null and not(v->>'referenceId'=any(ids)) then raise exception 'invalid_rental_reference' using errcode='22023'; end if;
end $$;
alter function app_private.validate_fonciere_payload(uuid,jsonb) rename to validate_fonciere_payload_before_rentals;
create function app_private.validate_fonciere_payload(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform app_private.validate_fonciere_payload_before_rentals(p_id,jsonb_set(p_payload,'{data}',(p_payload->'data')-'rentalPlan'));
 perform app_private.validate_fonciere_rentals(p_payload#>'{data,rentalPlan}');
end $$;
create or replace function app_private.retain_fonciere_internal_answers() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare k text;
begin
 foreach k in array array['visitDate','diagnosticsReceived','constraintNotes','rentalPlan'] loop
  if old.payload->'data' ? k and not(new.payload->'data' ? k) then new.payload:=jsonb_set(new.payload,array['data',k],old.payload#>array['data',k]); end if;
 end loop;
 return new;
end $$;
revoke all on function app_private.fonciere_rental_schema(),app_private.fonciere_annual_day(text),app_private.validate_fonciere_rentals(jsonb),app_private.validate_fonciere_payload_before_rentals(uuid,jsonb),app_private.validate_fonciere_payload(uuid,jsonb),app_private.retain_fonciere_internal_answers() from public,anon,authenticated;
