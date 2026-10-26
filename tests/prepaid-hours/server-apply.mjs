/** Apply fresh migration or replace its functions during local-only iteration. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { connect, sql } from './server-local.mjs';
const files = readdirSync('supabase/migrations').filter(n => n.endsWith('_house_prepaid_hours.sql'));
assert.equal(files.length, 1);
const source = readFileSync('supabase/migrations/' + files[0], 'utf8');
await connect();
try {
 const exists = (await sql.query("select to_regclass('app_private.house_prepaid_settings') n")).rows[0].n;
 if (!exists) await sql.query(source);
 else {
  if (!(await sql.query("select to_regprocedure('public.crm_export_module_before_prepaid(text)') n")).rows[0].n) await sql.query('alter function public.crm_export_module(text) rename to crm_export_module_before_prepaid');
  if (!(await sql.query("select to_regprocedure('public.crm_read_module_before_prepaid(text)') n")).rows[0].n) await sql.query('alter function public.crm_read_module(text) rename to crm_read_module_before_prepaid');
  const functions = [...source.matchAll(/create function [\s\S]*?\$\$;/g)].map(m => m[0].replace('create function ', 'create or replace function '));
  assert.ok(functions.length >= 5, 'Only named migration function bodies are replayed');
  for (const statement of functions) await sql.query(statement);
  await sql.query('revoke all on function public.crm_export_module_before_prepaid(text),public.crm_export_module(text) from public,anon,authenticated; grant execute on function public.crm_export_module(text) to authenticated');
  await sql.query('revoke all on function public.crm_read_module_before_prepaid(text),public.crm_read_module(text) from public,anon,authenticated; grant execute on function public.crm_read_module(text) to authenticated');
  await sql.query("notify pgrst,'reload schema'");
 }
 console.log('Local prepaid migration functions ready.');
} finally { await sql.end(); }
