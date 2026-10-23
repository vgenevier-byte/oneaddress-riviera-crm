-- Existing Publisher Neon database only. No legacy status is promoted or dated.
BEGIN;
ALTER TABLE publisher_music
  ADD COLUMN IF NOT EXISTS version text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy_catalogue';
ALTER TABLE publisher_posts ADD COLUMN IF NOT EXISTS selected_music_id bigint REFERENCES publisher_music(id);
DROP INDEX IF EXISTS publisher_music_title_artist_unique;
CREATE UNIQUE INDEX IF NOT EXISTS publisher_music_reference_unique
  ON publisher_music (lower(title), lower(artist), lower(version));

CREATE TABLE IF NOT EXISTS publisher_music_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  music_id bigint NOT NULL REFERENCES publisher_music(id),
  account text NOT NULL CHECK (account = 'one-address-riviera'),
  context text NOT NULL CHECK (context IN ('feed','reel')),
  status text NOT NULL CHECK (status IN ('confirmed','not_found','unknown')),
  method text NOT NULL CHECK (method = 'manual_instagram'),
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid NOT NULL,
  title text NOT NULL,
  artist text NOT NULL,
  version text NOT NULL DEFAULT '',
  instagram_audio_id text,
  instagram_audio_url text
);
CREATE INDEX IF NOT EXISTS publisher_music_checks_scope
  ON publisher_music_checks (music_id, account, context, checked_at DESC, id DESC);
CREATE OR REPLACE FUNCTION publisher_keep_music_checks() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'Publisher music verification history is append only' USING ERRCODE='42501';
END;
$$;
DROP TRIGGER IF EXISTS publisher_keep_music_checks ON publisher_music_checks;
CREATE TRIGGER publisher_keep_music_checks BEFORE UPDATE OR DELETE ON publisher_music_checks
  FOR EACH ROW EXECUTE FUNCTION publisher_keep_music_checks();
REVOKE ALL ON FUNCTION publisher_keep_music_checks() FROM PUBLIC;
REVOKE ALL ON publisher_music_checks FROM PUBLIC;
REVOKE ALL ON SEQUENCE publisher_music_checks_id_seq FROM PUBLIC;
-- The existing dedicated server role needs SELECT/INSERT on the new table and
-- USAGE/SELECT on its sequence; no browser or CRM database grants are required.
ALTER TABLE publisher_operations DROP CONSTRAINT IF EXISTS publisher_operations_action_check;
ALTER TABLE publisher_operations ADD CONSTRAINT publisher_operations_action_check
  CHECK (action IN ('generate','regenerate-text','regenerate-image','music-status','music-replace','music-confirm','music-select','publish'));
COMMIT;
