-- REVIEW TEMPLATE ONLY. Never grants OAR to every Auth user.
-- Run only in a separately approved release, after the new migration.
-- Before reopening: close old CRM instances and complete the explicit browser-cache
-- recovery/purge procedure in cache-transition.md with the prior authorized owner.
-- This template does not export/delete caches or silently import their payloads.
begin;
create temporary table reviewed_oar_accounts (
  user_id uuid primary key,
  verified_email text not null unique
) on commit drop;
-- Populate with the UUID + current verified email of EACH explicitly approved account.
-- No example UUID, personal name, domain rule, or automatic SELECT from auth.users.
-- INSERT INTO reviewed_oar_accounts VALUES (...);
do $$ begin
 if not exists(select 1 from reviewed_oar_accounts) then raise exception 'STOP: approved OAR allowlist is empty'; end if;
 if exists(select 1 from reviewed_oar_accounts a left join auth.users u on u.id=a.user_id
  where u.id is null or u.email_confirmed_at is null or lower(u.email) is distinct from lower(a.verified_email)) then
  raise exception 'STOP: UUID / verified email mismatch';
 end if;
 if exists(select 1 from reviewed_oar_accounts a join public.app_memberships m on m.user_id=a.user_id and m.workspace_id='oar') then
  raise exception 'STOP: existing OAR membership requires explicit review';
 end if;
end $$;
insert into public.app_memberships(user_id,workspace_id,role,status)
select user_id,'oar','member','active' from reviewed_oar_accounts;
-- Record the reviewed UUID mapping and authorized database operator in the release record.
commit;
