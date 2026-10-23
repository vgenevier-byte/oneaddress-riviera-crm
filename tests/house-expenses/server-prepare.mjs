/** Fresh owned Supabase stack: real Auth/PostgREST/PostgreSQL, fictional data only. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureData } from './fixture-data.mjs';
import { connect, sql, request, rpc, directory, status } from './server-local.mjs';

const fullModules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','monthlyCharges'];
const ownerGrants = Object.fromEntries(fullModules.map(module => [module, { level:'contribute', sensitive:{ delete:true, export:true, ...(module==='contacts' ? { bank_read:true, bank_write:true } : {}), ...(module==='vendorInvoices' ? { payment:true } : {}) } }]));
const profiles = {
  owner: { admin:true, grants:ownerGrants },
  contributor: { grants:{ houseTracking:{ level:'contribute', sensitive:{ export:true } }, monthlyCharges:{ level:'contribute', sensitive:{ export:true } } } },
  reader: { grants:{ houseTracking:{ level:'read', sensitive:{ export:true } }, monthlyCharges:{ level:'read', sensitive:{ export:true } } } },
  none: { grants:{} }
};
await connect();
try {
  assert.equal((await sql.query("select to_regclass('public.crm_workspace_state') n")).rows[0].n, null, 'Fresh owned stack required; never replay into an existing bench');
  const historical = readFileSync('tests/izord/sql-fixture.sql','utf8');
  await sql.query(historical.slice(historical.indexOf('create table public.crm_workspace_state'), historical.indexOf('create schema storage;')));
  await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
  const migrationFiles = readdirSync('supabase/migrations').filter(file => /^\d{14}_.+\.sql$/.test(file)).sort();
  for (const file of migrationFiles) {
    const before = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
    await sql.query(readFileSync(join('supabase/migrations',file),'utf8'));
    assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload,before,'Every migration preserves fictional existing business payload: '+file);
  }
  const users = {};
  for (const [name,profile] of Object.entries(profiles)) {
    const email = 'house-expenses-'+name+'@example.invalid', password = randomBytes(24).toString('hex');
    const created = await request('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{ email,password,email_confirm:true });
    assert.equal(created.status,200,JSON.stringify(created.data));
    await sql.query('insert into public.crm_access_profiles(user_id,general_admin) values($1,$2)',[created.data.id,profile.admin??false]);
    await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member')",[created.data.id]);
    for (const [module,grant] of Object.entries(profile.grants)) await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[created.data.id,module,grant.level,grant.sensitive??{}]);
    const signed = await request('/auth/v1/token?grant_type=password',null,{ email,password });
    assert.equal(signed.status,200);
    const claims = JSON.parse(Buffer.from(signed.data.access_token.split('.')[1],'base64url').toString());
    assert.equal((await sql.query('select count(*)::int n from auth.sessions where id=$1 and user_id=$2',[claims.session_id,created.data.id])).rows[0].n,1,'Real local Auth session exists');
    users[name] = { id:created.data.id,email,password,token:signed.data.access_token,session:signed.data };
  }
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[fixtureData]);
  await sql.query("update app_private.monthly_charges_config set config=$1",[{ personRules:[{ source:'hours',personId:'expense-worker',included:true },{ source:'hours',personId:'expense-archived-worker',included:true }],exceptions:[],attachments:[] }]);
  await sql.query("notify pgrst,'reload schema'");
  for (let attempt=0;attempt<50;attempt++) {
    const response = await rpc('crm_read_module',users.contributor.token,{ p_module:'houseTracking' });
    if (response.status===200) break;
    if (attempt===49) throw new Error('Local schema cache unavailable: '+JSON.stringify(response.data));
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const fixture = { api:status.API_URL,app:'http://127.0.0.1:3184',publicKey:status.ANON_KEY,users,integrationComplete:true };
  writeFileSync(join(directory,'fixtures.private.json'),JSON.stringify(fixture),{mode:0o600});
  writeFileSync(join(directory,'preparation.json'),JSON.stringify({ ready:true,realAuth:true,realSessions:4,fictionalDataOnly:true,migrationFiles,profileNames:Object.keys(users),app:fixture.app },null,2));
  console.log(JSON.stringify({ ready:true,realAuth:true,realSessions:4,fixtureFile:join(directory,'fixtures.private.json'),migrationCount:migrationFiles.length,profiles:Object.keys(users) }));
} finally { await sql.end(); }
