/** Real disposable Auth -> PostgREST -> Charges RPC persistence, followed by the
 * production calculations on returned snapshots. SQL only seeds/changes fictitious
 * source records; no fake JWT, role substitution or intercepted RPC is used. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { connect, sql, request, rpc, read, login, directory } from './server-local.mjs';

const compiled = mkdtempSync(join(tmpdir(), 'monthly-charges-period-code-'));
execFileSync('node_modules/.bin/tsc', ['--outDir', compiled, '--noEmit', 'false', '--incremental', 'false', '--module', 'commonjs', '--target', 'es2022', '--esModuleInterop', '--skipLibCheck', 'lib/monthlyCharges/calculations.ts']);
const { buildMonthlyChargesPeriod, exportPeriodChargesCsv, exportDetailedChargesCsv } = createRequire(import.meta.url)(join(compiled, 'monthlyCharges/calculations.js'));
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const users = fixture.users, results = [];
await connect();
for (const user of Object.values(users)) user.token = await login(user);
const ok = async operation => { const result = await operation; assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
const no = async (operation, code) => { const result = await operation; assert.ok(result.status >= 400); if (code) assert.equal(result.data.message, code); return result; };
const patch = (who, revision, p_patch, id = randomUUID()) => rpc('crm_patch_monthly_charges', users[who].token, { p_revision: revision, p_patch, p_request_id: id });
const test = async (name, body) => { await body(); results.push({ name, passed: true }); console.log('PASS ' + name); };
const period = (snapshot, filter = {}) => buildMonthlyChargesPeriod(snapshot, '2026-09', '2026-12', { now: '2026-10-24', ...filter });
const invoice = (id, amount, status = 'À payer', date = '2026-10-01') => ({ id, contactId: 'supplier-' + id, contactName: 'Fournisseur fictif ' + id, title: 'Facture fictive ' + id, amount, paidAmount: status === 'Payé' ? amount : status === 'Partiellement payé' ? 100 : 0, status, invoiceDate: date, invoiceReference: id });
const address = '12 avenue des Cèdres, Théoule-sur-Mer';
const addressDetails = { houseNumber:'12',street:'avenue des Cèdres',line1:'12 avenue des Cèdres',complement:'',postalCode:'06590',city:'Théoule-sur-Mer',country:'France',countryCode:'FR',formattedAddress:address,source:'manual',precision:'manual',fingerprint:address.toLowerCase() };
let baseline;
try {
  const existing = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
  baseline = { ...existing, contacts: [], vendorInvoices: [invoice('invoice-A',1200,'Payé'),invoice('invoice-B',600),invoice('invoice-C',300,'Partiellement payé'),invoice('invoice-D',100.01)],
    houseTrackingHouses: [{id:'fixture-house',name:'Maison fictive Cèdres',address,addressDetails},{id:'fixture-other-house',name:'Autre maison fictive',address:'20 rue fictive, Nice'}],
    houseTrackingWorkers:[{id:'fixture-worker',contactName:'Personnel fictif',status:'Actif',hourlyRate:30}],
    houseTimeEntries:[{id:'hours-october',workerId:'fixture-worker',workerName:'Personnel fictif',houseId:'fixture-house',houseName:'Maison fictive Cèdres',date:'2026-10-05',startTime:'08:00',endTime:'14:00',breakMinutes:0,hourlyRate:30,expenseAmount:20}],housePayments:[] };
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baseline]);
  await sql.query("update app_private.monthly_charges_config set config=$1,revision=gen_random_uuid()", [{personRules:[],exceptions:[],attachments:[]}]);
  const before = await ok(read(users.owner.token));
  let saved;
  const canonicalPatch = { personRules:[{source:'hours',personId:'fixture-worker',included:true}], attachments:[{source:'invoice',sourceId:'invoice-A',mode:'month',month:'2026-09'},{source:'invoice',sourceId:'invoice-D',mode:'spread',startMonth:'2026-09',endMonth:'2026-11'}], houseAssignments:['invoice-A','invoice-B','invoice-C','invoice-D'].map(sourceId=>({source:'invoice',sourceId,houseId:'fixture-house'})) };
  await test('authenticated Charges patch saves exact invoice-house and month/spread identities with no business-payload mutation', async()=>{
    saved=await ok(patch('owner',before.revision,canonicalPatch));
    assert.equal(saved.config.houseAssignments.length,4);assert.equal(saved.config.attachments.length,2);
    assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload,baseline);
    assert.equal((await sql.query('select updated_by from app_private.monthly_charges_config')).rows[0].updated_by,users.owner.id);
  });
  await test('new real authentication session re-reads persisted house and month assignments',async()=>{
    const newToken=await login(users.owner);assert.notEqual(newToken,users.owner.token);users.owner.token=newToken;
    const fresh=await ok(read(newToken));assert.equal(fresh.revision,saved.revision);assert.deepEqual(fresh.config,saved.config);
    assert.equal(fresh.sources.houses.find(h=>h.id==='fixture-house').city,'Théoule-sur-Mer');
  });
  await test('real server snapshot produces September 1233.34, October1133.34, November33.33, December0 and period2400.01',async()=>{
    const full=period(await ok(read(users.owner.token)),{houseId:'fixture-house'});
    assert.deepEqual(full.months.map(m=>m.totalCents),[123334,113334,3333,0]);assert.equal(full.totalCents,240001);assert.equal(full.hoursCents,20000);assert.equal(full.invoiceCents,220001);
    assert.equal(full.months.reduce((sum,m)=>sum+m.totalCents,0),full.totalCents);
    assert.ok(exportPeriodChargesCsv(full).includes('2400,01'));assert.ok(exportDetailedChargesCsv(full).includes('33,33'));
  });
  await test('payment status changes leave recorded charge amounts and months unchanged',async()=>{
    const updated=structuredClone(baseline);for(const r of updated.vendorInvoices){if(r.id==='invoice-B'||r.id==='invoice-C'){r.status='Payé';r.paidAmount=r.amount;}}
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[updated]);
    assert.deepEqual(period(await ok(read(users.owner.token)),{houseId:'fixture-house'}).months.map(m=>m.totalCents),[123334,113334,3333,0]);
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[baseline]);
  });
  await test('new supplier invoice defaults included; explicit exclusion reason survives',async()=>{
    const updated=structuredClone(baseline);updated.vendorInvoices.push(invoice('invoice-new-supplier',50));await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[updated]);
    let snap=await ok(read(users.owner.token));assert.equal(period(snap).totalCents,245001);
    snap=await ok(patch('owner',snap.revision,{exceptions:[{source:'invoice',sourceId:'invoice-new-supplier',included:false,reason:'Compté par heures, exclusion explicite'}]}));
    assert.equal(period(snap).totalCents,240001);assert.equal(snap.config.exceptions[0].reason,'Compté par heures, exclusion explicite');
    const reloaded=await ok(read(await login(users.reader)));assert.equal(reloaded.config.exceptions[0].included,false);
  });
  await test('cancelled and expected invoices remain outside effective totals; missing date is unattached',async()=>{
    const updated=structuredClone(baseline);updated.vendorInvoices.push(invoice('invoice-cancelled',90,'Annulé'),invoice('invoice-expected',80,'En attente de facture'),invoice('invoice-no-month',70,'À payer',''));
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[updated]);
    const result=period(await ok(read(users.owner.token)));assert.equal(result.totalCents,240001);assert.ok(result.expected.some(r=>r.sourceId==='invoice-expected'));assert.ok(result.unattached.some(r=>r.sourceId==='invoice-no-month'));
  });
  await test('other-house and unassigned invoices count once globally and remain outside selected-house total',async()=>{
    const updated=structuredClone(baseline);updated.vendorInvoices.push(invoice('invoice-other-house',50),invoice('invoice-unassigned',70));await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[updated]);
    let snap=await ok(read(users.owner.token));snap=await ok(patch('owner',snap.revision,{houseAssignments:[{source:'invoice',sourceId:'invoice-other-house',houseId:'fixture-other-house'}]}));
    assert.equal(period(snap).totalCents,252001);const scoped=period(snap,{houseId:'fixture-house'});assert.equal(scoped.totalCents,240001);assert.deepEqual(scoped.houseUnknown.map(r=>r.sourceId),['invoice-unassigned']);
  });
  await test('house lookup remains available for invoice-only source reads under house read permission',async()=>{
    const snap=await ok(read(users.contributor.token,{p_sources:['invoice']}));assert.equal(snap.sources.timeEntries.length,0);assert.equal(snap.sources.houses.length,2);assert.equal(snap.permissions.canReadHouses,true);
    const hidden=await ok(read(users.invoice.token,{p_sources:['invoice']}));assert.deepEqual(hidden.sources.houses,[]);assert.deepEqual(hidden.config.houseAssignments,[]);assert.equal(hidden.sources.invoices.find(r=>r.id==='invoice-A').houseAssigned,true);
  });
  await test('house read without house export cannot export house identities while global invoice export retains total',async()=>{
    const snap=await ok(read(users.contributor.token,{p_sources:['invoice'],p_export:true}));assert.deepEqual(snap.sources.houses,[]);assert.deepEqual(snap.config.houseAssignments,[]);assert.equal(snap.permissions.canExportHouses,false);assert.equal(period(snap).totalCents,232001);
    assert.ok(!JSON.stringify(snap).includes('Théoule-sur-Mer'));assert.ok(snap.sources.invoices.find(r=>r.id==='invoice-A').houseAssigned);
    await no(read(users.reader.token,{p_export:true}),'export_forbidden');
  });
  await test('hidden house relation survives unrelated month/default edits by invoice-only contributor',async()=>{
    let limited=await ok(read(users.invoice.token));limited=await ok(patch('invoice',limited.revision,{attachments:[{source:'invoice',sourceId:'invoice-A',mode:'month',month:'2026-08'}]}));
    let full=await ok(read(users.owner.token));assert.equal(full.config.houseAssignments.find(a=>a.sourceId==='invoice-A').houseId,'fixture-house');
    limited=await ok(patch('invoice',limited.revision,{attachments:[{source:'invoice',sourceId:'invoice-A',mode:'default'}]}));
    full=await ok(read(users.owner.token));assert.equal(full.config.houseAssignments.find(a=>a.sourceId==='invoice-A').houseId,'fixture-house');assert.ok(!full.config.attachments.some(a=>a.sourceId==='invoice-A'));
    await ok(patch('owner',full.revision,{attachments:[{source:'invoice',sourceId:'invoice-A',mode:'month',month:'2026-09'}]}));
  });
  await test('changing and clearing house preserves monthly attachment and source legal invoice fields',async()=>{
    let snap=await ok(read(users.contributor.token));const month=snap.config.attachments.find(a=>a.sourceId==='invoice-A');
    snap=await ok(patch('contributor',snap.revision,{houseAssignments:[{source:'invoice',sourceId:'invoice-A',houseId:'fixture-other-house'}]}));assert.deepEqual(snap.config.attachments.find(a=>a.sourceId==='invoice-A'),month);
    snap=await ok(patch('contributor',snap.revision,{houseAssignments:[{source:'invoice',sourceId:'invoice-A',houseId:null}]}));assert.deepEqual(snap.config.attachments.find(a=>a.sourceId==='invoice-A'),month);assert.ok(!snap.config.houseAssignments.some(a=>a.sourceId==='invoice-A'));
    await ok(patch('contributor',snap.revision,{houseAssignments:[{source:'invoice',sourceId:'invoice-A',houseId:'fixture-house'}]}));
  });
  await test('server rejects missing rights, forged references and duplicate/malformed assignment operations atomically',async()=>{
    const snap=await ok(read(users.owner.token));const op={source:'invoice',sourceId:'invoice-A',houseId:'fixture-house'};
    await no(patch('reader',snap.revision,{houseAssignments:[op]}),'module_forbidden');await no(patch('invoice',snap.revision,{houseAssignments:[op]}),'house_forbidden');await no(patch('house',snap.revision,{houseAssignments:[op]}),'source_forbidden');
    for(const [entry,code] of [[{...op,houseId:'missing-house'},'invalid_monthly_reference'],[{...op,sourceId:'missing-invoice'},'invalid_monthly_reference'],[{...op,houseId:42},'invalid_monthly_patch'],[{...op,source:'hours'},'invalid_monthly_patch']])await no(patch('owner',snap.revision,{houseAssignments:[entry]}),code);
    await no(patch('owner',snap.revision,{houseAssignments:[op,op]}),'invalid_monthly_patch');assert.deepEqual((await ok(read(users.owner.token))).config,snap.config);
  });
  await test('assignment idempotence, revision conflict and fresh authorization survive retries',async()=>{
    const snap=await ok(read(users.contributor.token));const id=randomUUID(),ops={houseAssignments:[{source:'invoice',sourceId:'invoice-A',houseId:'fixture-house'}]};const saved=await ok(patch('contributor',snap.revision,ops,id));
    assert.equal((await ok(patch('contributor',snap.revision,ops,id))).revision,saved.revision);await no(patch('owner',snap.revision,ops),'revision_conflict');
    await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='houseTracking'",[users.contributor.id]);await no(patch('contributor',snap.revision,ops,id),'house_forbidden');await sql.query("update public.crm_module_grants set level='read' where user_id=$1 and module='houseTracking'",[users.contributor.id]);
  });
  await test('private configuration and request history retain RLS, no direct grants and RPC is authenticated only',async()=>{
    const tables=(await sql.query("select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT') as exposed from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname in ('monthly_charges_config','monthly_charges_requests')")).rows;assert.equal(tables.length,2);assert.ok(tables.every(r=>r.relrowsecurity&&!r.exposed));
    const grants=(await sql.query("select has_function_privilege('anon','public.crm_patch_monthly_charges(text,jsonb,uuid)','EXECUTE') as anon, has_function_privilege('authenticated','public.crm_patch_monthly_charges(text,jsonb,uuid)','EXECUTE') as member")).rows[0];assert.equal(grants.anon,false);assert.equal(grants.member,true);
  });
  // Retain canonical values for browser tests, including genuinely persisted 500
  // zero-cost interventions in a separate unselected personnel group.
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[baseline]);
  let clean=await ok(read(users.owner.token));clean=await ok(patch('owner',clean.revision,canonicalPatch));
  const volume=structuredClone(baseline);volume.houseTimeEntries.push(...Array.from({length:500},(_,i)=>({id:`volume-hours-${i}`,workerId:'volume-worker',workerName:'Personnel volume fictif',houseId:'fixture-other-house',houseName:'Autre maison fictive',date:'2026-10-10',startTime:'08:00',endTime:'09:00',breakMinutes:0,hourlyRate:0})));
  volume.houseTrackingWorkers.push({id:'volume-worker',contactName:'Personnel volume fictif',status:'Actif',hourlyRate:0});
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[volume]);
  clean=await ok(read(users.owner.token));await ok(patch('owner',clean.revision,{personRules:[{source:'hours',personId:'volume-worker',included:true}]}));
  assert.equal(period(await ok(read(users.owner.token))).totalCents,240001);
  writeFileSync(join(directory,'fixtures.private.json'),JSON.stringify(fixture),{mode:0o600});
  writeFileSync(join(directory,'period-server-results.json'),JSON.stringify({passed:results.length,results,realLocalAuthJWT:true,realPostgresPersistence:true,newAuthenticationReadback:true,canonicalMonthTotals:[1233.34,1133.34,33.33,0],canonicalPeriodTotal:2400.01,productionTouched:false,sourceSeeds:'SQL into disposable fictitious database only'},null,2));
  console.log(JSON.stringify({passed:results.length,realAuthRPCPersistence:true,total:2400.01,browserReady:true}));
}finally{await sql.end()}
