-- NOT EXECUTED. Emergency fail-closed rollback proposal, separately authorized.
-- Keep all OAR membership policies and RPC guards. Never restore broad grants.
-- Keep immutable asset tombstones, the Storage lifecycle trigger and OAR server revision.
begin;
update public.app_memberships set status='revoked',updated_at=clock_timestamp() where workspace_id='izord';
update public.izord_invitations set revoked_at=clock_timestamp() where accepted_at is null and revoked_at is null;
create policy izord_emergency_closed on storage.objects as restrictive for all to authenticated
using(bucket_id<>'izord-documents') with check(bucket_id<>'izord-documents');
-- Existing downloaded files or signed URLs cannot be recalled by this SQL.
-- A previously issued pending-upload capability can still transfer bytes until expiry;
-- revoked membership blocks finalization/publication. Do not reopen its path or drop guards.
-- Keep the access portal in the deployed code. Do not roll back to the old global-cache UI.
commit;
