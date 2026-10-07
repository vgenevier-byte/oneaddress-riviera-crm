-- Add one read-only, bounded Administration history projection.
-- Existing administration RPCs, permission rules and business data stay intact.
begin;
create function public.crm_admin_history_page(
 p_before_id bigint default null,
 p_snapshot_id bigint default null,
 p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare anchor_id bigint; page_events jsonb; last_id bigint; more boolean;
begin
 -- General Administration is independent of the Tasks module grant.
 if not app_private.general_admin() or not app_private.document_actor_active(auth.uid())
 or not exists(select 1 from auth.users u where u.id=auth.uid()
  and coalesce(to_jsonb(u)->>'is_anonymous','false')<>'true')
 or not exists(select 1 from auth.sessions s where s.user_id=auth.uid()
  and s.id::text=auth.jwt()->>'session_id'
  and (nullif(to_jsonb(s)->>'not_after','') is null
   or (to_jsonb(s)->>'not_after')::timestamptz>clock_timestamp())) then
  raise exception 'general_admin_required' using errcode='42501';
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then
  raise exception 'invalid_history_limit' using errcode='22023';
 end if;
 if (p_before_id is null)<>(p_snapshot_id is null)
 or (p_before_id is not null and (p_before_id<1 or p_snapshot_id<1 or p_before_id>p_snapshot_id)) then
  raise exception 'invalid_history_cursor' using errcode='22023';
 end if;
 if p_snapshot_id is null then
  select max(e.id) into anchor_id from public.crm_permission_events e;
 else
  if not exists(select 1 from public.crm_permission_events e where e.id=p_snapshot_id)
   or not exists(select 1 from public.crm_permission_events e where e.id=p_before_id) then
   raise exception 'invalid_history_cursor' using errcode='22023';
  end if;
  anchor_id:=p_snapshot_id;
 end if;
 -- The extra row is only a hasMore sentinel. No timestamp-based tie-breaking,
 -- OFFSET or raw detail projection; bigint IDs are JSON strings throughout.
 with bounded as materialized (
  select e.id,e.created_at,e.action,e.actor_id,e.subject_id
  from public.crm_permission_events e
  where e.id<=anchor_id and (p_before_id is null or e.id<p_before_id)
  order by e.id desc limit p_limit+1
 ), page as (
  select * from bounded order by id desc limit p_limit
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'created_at',created_at,
  'action',action,'actor_id',actor_id,'subject_id',subject_id) order by id desc),'[]'::jsonb),
  min(id),(select count(*)>p_limit from bounded)
 into page_events,last_id,more from page;
 return jsonb_build_object('events',page_events,'hasMore',more,
  'nextCursor',case when more then jsonb_build_object('beforeId',last_id::text,
   'snapshotId',anchor_id::text) else null end);
end;
$$;
revoke all on function public.crm_admin_history_page(bigint,bigint,integer) from public,anon;
grant execute on function public.crm_admin_history_page(bigint,bigint,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
