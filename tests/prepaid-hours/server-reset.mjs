/** Reset only this feature's synthetic ledger inside the dedicated local stack. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, directory } from './server-local.mjs';
const baseline = JSON.parse(readFileSync(join(directory, 'baseline.private.json'), 'utf8'));
await connect();
try {
 await sql.query('begin');
 await sql.query('truncate app_private.house_prepaid_settings,app_private.house_prepaid_packages,app_private.house_prepaid_requests,app_private.house_prepaid_entry_audit restart identity');
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baseline]);
 await sql.query('commit');
 console.log('Only dedicated fictitious prepaid sources/ledger reset.');
} finally { await sql.end(); }
