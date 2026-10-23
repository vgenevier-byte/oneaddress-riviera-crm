-- Preserve the Publisher access model and active-session check. Music editing
-- requires contribute; generation/export/publish retain their sensitive grants.
begin;
create or replace function public.crm_authorize_publisher(p_action text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id')
 and coalesce(case
 when p_action in ('session','today','history','status','image') then app_private.module_allowed('publisher')
 when p_action in ('export','export-text') then app_private.module_allowed('publisher',false,'export')
 when p_action in ('generate','regenerate-text','regenerate-image') then app_private.module_allowed('publisher',true,'generate')
 when p_action='publish' then app_private.module_allowed('publisher',true,'mark_published')
 when p_action in ('music-status','music-replace','music-confirm','music-select') then app_private.module_allowed('publisher',true)
 else false end,false);
$$;
revoke all on function public.crm_authorize_publisher(text) from public,anon;
grant execute on function public.crm_authorize_publisher(text) to authenticated;
notify pgrst, 'reload schema';
commit;
