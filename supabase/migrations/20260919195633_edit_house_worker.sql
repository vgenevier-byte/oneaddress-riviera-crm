-- Targeted edit only: no creation, identity change, document change or history rewrite.
create function public.crm_update_house_worker(p_id text, p_patch jsonb, p_revision text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  w public.crm_workspace_state%rowtype;
  oldrow jsonb;
  result jsonb;
  owner_access boolean;
  rate numeric;
begin
  perform pg_advisory_xact_lock_shared(734991);
  if not app_private.module_allowed('houseTracking', true) then
    raise exception 'module_forbidden' using errcode = '42501';
  end if;
  owner_access := app_private.full_access();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ? 'hourlyRate') or jsonb_typeof(p_patch->'hourlyRate') <> 'number'
    or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('hourlyRate', 'notes')) then
    raise exception 'invalid_worker_patch' using errcode = '22023';
  end if;
  rate := (p_patch->>'hourlyRate')::numeric;
  if rate < 0 or rate > 100000000000 or rate <> round(rate, 2) then
    raise exception 'invalid_hourly_rate' using errcode = '22023';
  end if;
  if p_patch ? 'notes' then
    if not owner_access then raise exception 'notes_forbidden' using errcode = '42501'; end if;
    if jsonb_typeof(p_patch->'notes') <> 'string' or length(p_patch->>'notes') > 4000 then
      raise exception 'invalid_notes' using errcode = '22023';
    end if;
  end if;
  select * into strict w from public.crm_workspace_state where workspace_id = 'oneaddress-riviera' for update;
  if owner_access then
    if p_revision::timestamptz is distinct from w.updated_at then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
  elsif p_revision is distinct from app_private.module_revision('houseTracking', w.payload) then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;
  select r into oldrow from jsonb_array_elements(coalesce(w.payload->'houseTrackingWorkers', '[]')) r where r->>'id' = p_id;
  if oldrow is null then raise exception 'record_missing'; end if;
  if oldrow->>'status' = 'Inactif' then raise exception 'worker_inactive'; end if;

  -- Existing allowlist, business validation, audit stamps and revision-guarded merge.
  result := public.crm_mutate_record('houseTracking', 'houseTrackingWorkers', p_id,
    p_patch - 'notes', app_private.module_revision('houseTracking', w.payload), false);
  if p_patch ? 'notes' then
    update public.crm_workspace_state
    set payload = jsonb_set(payload, '{houseTrackingWorkers}', (
      select jsonb_agg(case when r->>'id' = p_id then r || jsonb_build_object('notes', p_patch->'notes') else r end)
      from jsonb_array_elements(payload->'houseTrackingWorkers') r
    ))
    where workspace_id = 'oneaddress-riviera';
  end if;
  if owner_access then
    select * into strict w from public.crm_workspace_state where workspace_id = 'oneaddress-riviera';
    select r into oldrow from jsonb_array_elements(w.payload->'houseTrackingWorkers') r where r->>'id' = p_id;
    return jsonb_build_object('worker', oldrow, 'workspaceRevision', w.updated_at);
  end if;
  -- A restricted account receives only the existing module projection, never global data.
  return result;
end $$;
revoke all on function public.crm_update_house_worker(text, jsonb, text) from public, anon;
grant execute on function public.crm_update_house_worker(text, jsonb, text) to authenticated;

-- Full-access UI: insert new hours without resending normalized historical data.
-- Restricted contributors already use crm_mutate_record directly.
create function public.crm_create_house_time_entry(p_id text, p_patch jsonb, p_revision text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare w public.crm_workspace_state%rowtype; entry jsonb;
begin
  perform pg_advisory_xact_lock_shared(734991);
  if not app_private.full_access() then raise exception 'module_forbidden' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
    or not (p_patch ? 'hourlyRate') or jsonb_typeof(p_patch->'hourlyRate') <> 'number' then
    raise exception 'invalid_hourly_rate' using errcode = '22023';
  end if;
  if (p_patch->>'hourlyRate')::numeric <> round((p_patch->>'hourlyRate')::numeric, 2) then
    raise exception 'invalid_hourly_rate' using errcode = '22023';
  end if;
  select * into strict w from public.crm_workspace_state where workspace_id = 'oneaddress-riviera' for update;
  if p_revision::timestamptz is distinct from w.updated_at then raise exception 'revision_conflict' using errcode = '40001'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(w.payload->'houseTimeEntries','[]')) r where r->>'id'=p_id) then
    raise exception 'record_exists';
  end if;
  perform public.crm_mutate_record('houseTracking', 'houseTimeEntries', p_id,
    p_patch - 'id' - 'createdAt', app_private.module_revision('houseTracking', w.payload), false);
  select * into strict w from public.crm_workspace_state where workspace_id = 'oneaddress-riviera';
  select r into entry from jsonb_array_elements(w.payload->'houseTimeEntries') r where r->>'id'=p_id;
  return jsonb_build_object('entry', entry, 'workspaceRevision', w.updated_at);
end $$;
revoke all on function public.crm_create_house_time_entry(text, jsonb, text) from public, anon;
grant execute on function public.crm_create_house_time_entry(text, jsonb, text) to authenticated;
