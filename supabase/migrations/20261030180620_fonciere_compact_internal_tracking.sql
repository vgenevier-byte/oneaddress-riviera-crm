-- Optional internal project answers. No backfill, no change to historical options,
-- presentation snapshots, admission rules, Storage policies or Drive destinations.
alter function app_private.validate_fonciere_payload(uuid,jsonb)
  rename to validate_fonciere_payload_before_internal_tracking;
create function app_private.validate_fonciere_payload(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare d jsonb:=p_payload->'data'; v jsonb; k text; n jsonb;
begin
  perform app_private.validate_fonciere_payload_before_internal_tracking(
    p_id,jsonb_set(p_payload,'{data}',d-'visitDate'-'diagnosticsReceived'-'constraintNotes'));
  if d ? 'visitDate' then
    if jsonb_typeof(d->'visitDate')<>'string' then raise exception 'invalid_fonciere_visit_date' using errcode='22023'; end if;
    perform app_private.validate_fonciere_guided_scalar(d->'visitDate','{"kind":"date"}'::jsonb);
  end if;
  if d ? 'constraintNotes' then
    if jsonb_typeof(d->'constraintNotes')<>'object' or octet_length((d->'constraintNotes')::text)>180000 then raise exception 'invalid_fonciere_constraint_notes' using errcode='22023'; end if;
    for k,n in select key,value from jsonb_each(d->'constraintNotes') loop
      if not (app_private.fonciere_guided_catalog()->'constraints'->'options' ? k) or jsonb_typeof(n)<>'string' or length(n#>>'{}')>12000 then raise exception 'invalid_fonciere_constraint_notes' using errcode='22023'; end if;
    end loop;
  end if;
  if d ? 'diagnosticsReceived' then
    v:=d->'diagnosticsReceived';
    if jsonb_typeof(v)<>'string' or (v#>>'{}') not in ('','yes','no') then
      raise exception 'invalid_fonciere_diagnostics_received' using errcode='22023';
    end if;
  end if;
end $$;
revoke all on function app_private.validate_fonciere_payload(uuid,jsonb),
  app_private.validate_fonciere_payload_before_internal_tracking(uuid,jsonb)
  from public,anon,authenticated;

-- An older client may omit answers it does not understand. Explicit empty values
-- still clear an answer; missing keys alone retain the saved values.
create function app_private.retain_fonciere_internal_answers() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare k text;
begin
  foreach k in array array['visitDate','diagnosticsReceived','constraintNotes'] loop
    if old.payload->'data' ? k and not (new.payload->'data' ? k) then
      new.payload:=jsonb_set(new.payload,array['data',k],old.payload#>array['data',k]);
    end if;
  end loop;
  return new;
end $$;
create trigger fonciere_retain_internal_answers before update of payload on public.fonciere_projects
for each row execute function app_private.retain_fonciere_internal_answers();
revoke all on function app_private.retain_fonciere_internal_answers() from public,anon,authenticated;
