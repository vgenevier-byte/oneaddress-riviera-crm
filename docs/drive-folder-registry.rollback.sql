-- NON EXECUTE. Rollback of the new JWT-authenticated registry objects only.
-- Disable bank uploads and stop/drain every worker before separate authorization.
-- Preserve the registry before removal if reactivation is planned: reserved IDs
-- must not be lost while a worker can still create a Drive folder.
-- RESTRICT refuses any unexpected dependency. No existing CRM object is touched.
begin;
lock table public.crm_drive_folder_registry in access exclusive mode;
do $$
begin
  if exists (select 1 from public.crm_drive_folder_registry where status = 'creating') then
    raise exception 'Unresolved Drive reservations: rollback refused';
  end if;
end;
$$;
drop function public.crm_drive_folder_claim(text, text, text, uuid) restrict;
drop function public.crm_drive_folder_reserve(text, text, uuid, text) restrict;
drop function public.crm_drive_folder_ready(text, text, uuid, text) restrict;
drop trigger crm_drive_folder_guard on public.crm_drive_folder_registry;
drop function public.crm_drive_folder_guard() restrict;
drop table public.crm_drive_folder_registry restrict;
commit;
