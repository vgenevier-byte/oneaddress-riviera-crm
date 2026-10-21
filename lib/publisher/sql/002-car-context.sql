-- Additive migration for the EXISTING Publisher Neon database, never CRM Supabase.
-- Apply before the matching application release; nullable fields, no backfill.
-- Rollback: restore the previous app first and retain these optional columns.
BEGIN;
ALTER TABLE publisher_posts ADD COLUMN IF NOT EXISTS car_context jsonb;
ALTER TABLE publisher_operations ADD COLUMN IF NOT EXISTS car_context jsonb;
COMMIT;
