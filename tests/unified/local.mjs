import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {assertLocalTarget} from '../izord/local-target.mjs';
const require=createRequire(import.meta.url);
const {Client}=require('/tmp/oar-contact-release-test-runtime/node_modules/pg');
export const dir='/tmp/crm-unified-review';
mkdirSync(dir,{recursive:true});
export const status=JSON.parse(readFileSync('/var/folders/mh/cdb8c40d4jq3g9_g6l04wtzc0000gn/T/izord-local-stack-5HXuB2/local-status.json','utf8'));
assertLocalTarget({api:status.API_URL,database:status.DB_URL,app:'http://127.0.0.1:3159',mail:'http://127.0.0.1:55434',acknowledgement:process.env.IZORD_TEST_ACK});
export const sql=new Client({connectionString:status.DB_URL});
export async function connect(){await sql.connect();assert.equal(Number((await sql.query("select count(*) from auth.users where email not like '%@example.invalid'")).rows[0].count),0);}
export async function request(path,token,body,method){const r=await fetch(status.API_URL+path,{method:method??(body===undefined?'GET':'POST'),headers:{apikey:status.ANON_KEY,...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};}
export const rpc=(name,token,args={})=>request('/rest/v1/rpc/'+name,token,args);
export const modules=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord'];
export const fullGrants=Object.fromEntries(modules.map(m=>[m,{level:'contribute',sensitive:{delete:true,export:true,...(m==='contacts'?{bank_read:true,bank_write:true}:{}),...(m==='vendorInvoices'?{payment:true}:{})}}]));
export async function user(name){const email='unified-'+name+'@example.invalid',password='Local-CRM-2026!';let u=(await sql.query('select id from auth.users where email=$1',[email])).rows[0];if(!u){const r=await request('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{email,password,email_confirm:true});assert.equal(r.status,200,JSON.stringify(r.data));u=r.data;}const login=await request('/auth/v1/token?grant_type=password',null,{email,password});assert.equal(login.status,200);return {id:u.id,email,password,token:login.data.access_token};}
export async function grant(u,grants={},admin=false,role=null){await sql.query('insert into public.crm_access_profiles(user_id,general_admin) values($1,$2) on conflict(user_id) do update set active=true,general_admin=$2,revision=crm_access_profiles.revision+1',[u.id,admin]);await sql.query('delete from public.crm_module_grants where user_id=$1',[u.id]);for(const [module,g]of Object.entries(grants))await sql.query('insert into public.crm_module_grants values($1,$2,$3,$4)',[u.id,module,g.level,g.sensitive??{}]);if(Object.keys(grants).some(m=>m!=='izord'))await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member') on conflict(user_id,workspace_id) do update set status='active'",[u.id]);if(role)await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'izord',$2) on conflict(user_id,workspace_id) do update set role=$2,status='active'",[u.id,role]);}
if(process.argv.includes('--prepare')){
 await connect();
 const original=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 writeFileSync(dir+'/payload-before.private.json',JSON.stringify(original),{mode:0o600,flag:'wx'});
 const migration=readFileSync('supabase/migrations/20260918084849_unified_module_permissions.sql','utf8');
 try{await sql.query(migration);}catch(e){console.error(e.message,e.position);process.exitCode=1;await sql.end();process.exit(1);}
 const after=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;assert.deepEqual(after,original);
 const users={};for(const name of ['admin','izord','house','invoices','tasks','none','izord-admin','matrix','second-admin','revoked'])users[name]=await user(name);
 await grant(users.admin,fullGrants,true,'admin');
 await grant(users['second-admin'],fullGrants,true,'admin');
 await grant(users.izord,{izord:{level:'contribute',sensitive:{export:true}}},false,'contributor');
 await grant(users.house,{houseTracking:{level:'contribute'},planning:{level:'read'}});
 await grant(users.invoices,{vendorInvoices:{level:'read'}});
 await grant(users.tasks,{tasks:{level:'contribute'}});
 await grant(users.none);await grant(users['izord-admin'],{izord:{level:'contribute'}},false,'admin');
 await grant(users.revoked,{contacts:{level:'read'}});
 const catalog=JSON.parse(readFileSync('lib/access/collections.json','utf8'));
 const payload=structuredClone(original);
 for(const c of catalog){payload[c.collection]??=[];if(!payload[c.collection].some(r=>r.id==='unified-'+c.collection)){
 const row={id:'unified-'+c.collection};for(const [k,f]of Object.entries(c.fields))row[k]=f.type==='number'?100:k.toLowerCase().includes('date')?'2026-09-18':k.toLowerCase().includes('time')?'09:00':k==='houseId'?'unified-houseTrackingHouses':k==='workerId'?'unified-houseTrackingWorkers':'Fictif '+k;
 if(c.collection==='contacts')Object.assign(row,{name:'Camille Démonstration',kind:'Client',notes:'PRIVATE_CONTACT_NOTE',supplierBankAccounts:[{id:'bank-fictional',iban:'FICTIONAL-NOT-AN-IBAN',status:'Vérifié',isPrimary:true}]});
 if(c.collection==='tasks')Object.assign(row,{title:'Préparer la visite fictive',status:'À faire',owner:'Matteo',linkedTo:''});
 if(c.collection==='vendorQuotes')Object.assign(row,{title:'Entretien fictif',status:'À valider',contactId:'unified-contacts',contactName:'PRIVATE_CONTACT_NAME',notes:'PRIVATE_QUOTE_NOTE'});
 if(c.collection==='vendorInvoices')Object.assign(row,{title:'Facture fictive',status:'À payer',paidAmount:0,contactId:'unified-contacts',contactName:'PRIVATE_CONTACT_NAME',notes:'PRIVATE_INVOICE_NOTE'});
 if(c.collection==='quotes')Object.assign(row,{title:'Séjour fictif',status:'Validé',bookingStatus:'À confirmer',clientName:'PRIVATE_CLIENT_NAME'});
 if(c.collection==='houseTrackingWorkers')row.status='Actif';
 payload[c.collection].push(row);
 }}
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[payload]);
 writeFileSync(dir+'/users.private.json',JSON.stringify(users),{mode:0o600});
 writeFileSync(dir+'/transition.json',JSON.stringify({businessPayloadUnchangedByMigration:true,beforeSHA256:createHash('sha256').update(JSON.stringify(original)).digest('hex'),migrationSHA256:createHash('sha256').update(migration).digest('hex'),fictitiousAccounts:Object.keys(users)},null,2));
 console.log('Migration additive locale appliquée; égalité métier avant/après vérifiée; profils fictifs prêts.');await sql.end();
}
