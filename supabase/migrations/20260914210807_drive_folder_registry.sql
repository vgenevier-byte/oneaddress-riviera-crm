-- Prepared for review only. Do not apply to a live Supabase project yet.
-- No reference to or change of the CRM workspace payload.
begin;

create table public.crm_drive_folder_registry (
  workspace_id text not null check (workspace_id = 'oneaddress-riviera'),
  logical_key text not null check (length(logical_key) between 1 and 500 and logical_key ~ '^vendor:([A-Za-z0-9_.!~*''()-]|%[0-9A-F]{2})+(:rib)?$'),
  parent_drive_folder_id text not null check (length(parent_drive_folder_id) > 0),
  drive_folder_id text check (length(drive_folder_id) > 0),
  status text not null default 'creating' check (status in ('creating', 'ready')),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, logical_key),
  unique (drive_folder_id),
  check ((status = 'creating' and lease_token is not null and lease_expires_at is not null)
    or (status = 'ready' and drive_folder_id is not null and lease_token is null and lease_expires_at is null))
);
alter table public.crm_drive_folder_registry enable row level security;
-- No direct table access, including for authenticated clients. RPCs only.
revoke all on public.crm_drive_folder_registry from public, anon, authenticated;

-- The reservation and identity can never be changed, even by a stale server worker.
create function public.crm_drive_folder_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.logical_key is distinct from old.logical_key
    or new.parent_drive_folder_id is distinct from old.parent_drive_folder_id
    or (old.drive_folder_id is not null and new.drive_folder_id is distinct from old.drive_folder_id)
    or (old.status = 'ready' and new.status <> 'ready') then
    raise exception 'Immutable Drive folder reservation' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.crm_drive_folder_guard() from public, anon, authenticated;
create trigger crm_drive_folder_guard before update on public.crm_drive_folder_registry
for each row execute function public.crm_drive_folder_guard();

create function public.crm_drive_folder_claim(
  p_workspace_id text, p_logical_key text, p_parent_id text, p_lease_token uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare
  r public.crm_drive_folder_registry%rowtype;
  v_now timestamptz;
  v_old_token uuid;
  v_old_expiry timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_workspace_id is distinct from 'oneaddress-riviera' then
    raise exception 'invalid_workspace' using errcode = '22023';
  end if;
  if p_logical_key is null or length(p_logical_key) > 500
    or p_logical_key !~ '^vendor:([A-Za-z0-9_.!~*''()-]|%[0-9A-F]{2})+(:rib)?$' then
    raise exception 'invalid_logical_key' using errcode = '22023';
  end if;
  if p_lease_token is null then raise exception 'Lease token required'; end if;
  insert into public.crm_drive_folder_registry (
    workspace_id, logical_key, parent_drive_folder_id, lease_token, lease_expires_at
  ) values (p_workspace_id, p_logical_key, p_parent_id, p_lease_token, clock_timestamp() + interval '30 seconds')
  on conflict (workspace_id, logical_key) do nothing;

  -- Row lock plus unique key serializes competing claims across all instances.
  select * into strict r from public.crm_drive_folder_registry
    where workspace_id = p_workspace_id and logical_key = p_logical_key for update;
  if r.parent_drive_folder_id <> p_parent_id then
    raise exception 'Drive registry parent mismatch' using errcode = '23514';
  end if;
  v_now := clock_timestamp();
  if r.status = 'creating' and r.lease_expires_at <= v_now then
    v_old_token := r.lease_token;
    v_old_expiry := r.lease_expires_at;
    -- Explicit CAS: the token AND expiry must still be those observed under lock.
    update public.crm_drive_folder_registry set
      lease_token = p_lease_token, lease_expires_at = v_now + interval '30 seconds', updated_at = v_now
    where workspace_id = p_workspace_id and logical_key = p_logical_key
      and status = 'creating' and lease_token = v_old_token
      and lease_expires_at = v_old_expiry and lease_expires_at <= v_now
    returning * into r;
  end if;
  return jsonb_build_object('workspace_id', r.workspace_id, 'logical_key', r.logical_key,
    'parent_drive_folder_id', r.parent_drive_folder_id, 'drive_folder_id', r.drive_folder_id, 'status', r.status) || jsonb_build_object('claimed',
    r.status = 'creating' and r.lease_token = p_lease_token and r.lease_expires_at > clock_timestamp());
end;
$$;

create function public.crm_drive_folder_reserve(
  p_workspace_id text, p_logical_key text, p_lease_token uuid, p_drive_folder_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare r public.crm_drive_folder_registry%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_workspace_id is distinct from 'oneaddress-riviera' then
    raise exception 'invalid_workspace' using errcode = '22023';
  end if;
  if p_logical_key is null or length(p_logical_key) > 500
    or p_logical_key !~ '^vendor:([A-Za-z0-9_.!~*''()-]|%[0-9A-F]{2})+(:rib)?$' then
    raise exception 'invalid_logical_key' using errcode = '22023';
  end if;
  if p_drive_folder_id is null or length(p_drive_folder_id) = 0 then raise exception 'Drive ID required'; end if;
  update public.crm_drive_folder_registry set
    drive_folder_id = coalesce(drive_folder_id, p_drive_folder_id), updated_at = clock_timestamp()
  where workspace_id = p_workspace_id and logical_key = p_logical_key
    and status = 'creating' and lease_token = p_lease_token and lease_expires_at > clock_timestamp()
  returning * into r;
  if not found then return null; end if;
  -- A retry always returns the previously committed ID, never a replacement.
  return jsonb_build_object('workspace_id', r.workspace_id, 'logical_key', r.logical_key,
    'parent_drive_folder_id', r.parent_drive_folder_id, 'drive_folder_id', r.drive_folder_id, 'status', r.status);
end;
$$;

create function public.crm_drive_folder_ready(
  p_workspace_id text, p_logical_key text, p_lease_token uuid, p_drive_folder_id text
) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_workspace_id is distinct from 'oneaddress-riviera' then
    raise exception 'invalid_workspace' using errcode = '22023';
  end if;
  if p_logical_key is null or length(p_logical_key) > 500
    or p_logical_key !~ '^vendor:([A-Za-z0-9_.!~*''()-]|%[0-9A-F]{2})+(:rib)?$' then
    raise exception 'invalid_logical_key' using errcode = '22023';
  end if;
  update public.crm_drive_folder_registry set status = 'ready', lease_token = null,
    lease_expires_at = null, updated_at = clock_timestamp()
  where workspace_id = p_workspace_id and logical_key = p_logical_key
    and status = 'creating' and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp() and drive_folder_id = p_drive_folder_id;
  return found;
end;
$$;

revoke all on function public.crm_drive_folder_claim(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_drive_folder_reserve(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.crm_drive_folder_ready(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.crm_drive_folder_claim(text, text, text, uuid) to authenticated;
grant execute on function public.crm_drive_folder_reserve(text, text, uuid, text) to authenticated;
grant execute on function public.crm_drive_folder_ready(text, text, uuid, text) to authenticated;

commit;
