-- ADDITIVE migration for the EXISTING Publisher Neon database (not CRM Supabase).
-- Apply only in an explicitly approved coordinated release. No historical backfill.
BEGIN;
ALTER TABLE publisher_posts
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE publisher_music
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE TABLE IF NOT EXISTS publisher_operations (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('generate','regenerate-text','regenerate-image','music-status','publish')),
  target_post_id uuid,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('running','complete','failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
-- Durable cross-instance admission. No expiry-based paid replay after a timeout.
CREATE UNIQUE INDEX IF NOT EXISTS publisher_one_operation_running
  ON publisher_operations ((1)) WHERE state = 'running';
CREATE INDEX IF NOT EXISTS publisher_operations_actor_date
  ON publisher_operations (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION publisher_record_actor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE actor uuid := nullif(current_setting('publisher.actor', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := actor;
  ELSE
    NEW.revision := OLD.revision + 1;
  END IF;
  NEW.updated_by := actor;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION publisher_record_music_actor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_by := nullif(current_setting('publisher.actor', true), '')::uuid;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS publisher_actor ON publisher_posts;
CREATE TRIGGER publisher_actor BEFORE INSERT OR UPDATE ON publisher_posts
  FOR EACH ROW EXECUTE FUNCTION publisher_record_actor();
DROP TRIGGER IF EXISTS publisher_music_actor ON publisher_music;
CREATE TRIGGER publisher_music_actor BEFORE UPDATE ON publisher_music
  FOR EACH ROW EXECUTE FUNCTION publisher_record_music_actor();
REVOKE ALL ON publisher_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION publisher_record_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION publisher_record_music_actor() FROM PUBLIC;
COMMIT;
