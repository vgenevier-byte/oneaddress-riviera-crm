import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Opt-in, fixed disposable local container only. No credentials or remote URL.
test('music actions retain live-session and contribute restrictions in PostgreSQL', {
  skip: process.env.PUBLISHER_MUSIC_LOCAL_SQL !== '1',
}, () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20261023205659_publisher_music_actions.sql', import.meta.url), 'utf8')
    .replace(/^begin;$/m, '').replace(/^commit;$/m, '');
  const sql = `BEGIN;
${migration}
DO $check$
DECLARE actor uuid; session_id uuid; action text; level_value text; expected boolean;
BEGIN
 SELECT u.id,s.id INTO actor,session_id FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
 WHERE u.email='publisher-access-matrix@example.invalid' LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Owned local fixture missing'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',session_id,'role','authenticated')::text,true);
 UPDATE public.crm_access_profiles SET active=true,general_admin=false WHERE user_id=actor;
 FOREACH level_value IN ARRAY ARRAY['none','read','contribute'] LOOP
  UPDATE public.crm_module_grants SET level=level_value,sensitive='{}'::jsonb WHERE user_id=actor AND module='publisher';
  FOREACH action IN ARRAY ARRAY['music-status','music-replace','music-confirm','music-select'] LOOP
   expected := level_value='contribute';
   IF public.crm_authorize_publisher(action) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Permission mismatch: % %',level_value,action;
   END IF;
  END LOOP;
  FOREACH action IN ARRAY ARRAY['generate','regenerate-text','regenerate-image','publish','export','export-text','unknown-action'] LOOP
   IF public.crm_authorize_publisher(action) THEN RAISE EXCEPTION 'Sensitive or unknown action allowed: %',action; END IF;
  END LOOP;
 END LOOP;
 IF public.crm_authorize_publisher(NULL) THEN RAISE EXCEPTION 'Null action allowed'; END IF;
 UPDATE public.crm_access_profiles SET active=false WHERE user_id=actor;
 IF public.crm_authorize_publisher('music-confirm') THEN RAISE EXCEPTION 'Inactive account allowed'; END IF;
 UPDATE public.crm_access_profiles SET active=true WHERE user_id=actor;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id','00000000-0000-4000-8000-000000000000','role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true);
 IF public.crm_authorize_publisher('music-confirm') THEN RAISE EXCEPTION 'Missing session or forged role allowed'; END IF;
 IF has_function_privilege('anon','public.crm_authorize_publisher(text)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute grant'; END IF;
 IF NOT has_function_privilege('authenticated','public.crm_authorize_publisher(text)','EXECUTE') THEN RAISE EXCEPTION 'Authenticated execute missing'; END IF;
END $check$;
ROLLBACK;
SELECT 'music access checks passed';`;
  const output = execFileSync('docker', ['--context', 'colima', 'exec', '-i', 'supabase_db_crm-publisher-local',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At'], { input: sql, encoding: 'utf8' });
  assert.match(output, /music access checks passed/);
});
