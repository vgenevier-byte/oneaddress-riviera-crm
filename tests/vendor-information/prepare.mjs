import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connect,sql,request,status,directory,allow} from './local.mjs';
await connect();
try{
 const existing=(await sql.query("select to_regclass('public.crm_workspace_state') n")).rows[0].n;
 if(existing){assert.ok(process.argv.includes('--resume'),'Fresh owned database required');assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload,{fixture:'unchanged'},'Resume only failed setup before data');}
 const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&!f.includes('vendor_quote_information')).sort();
 if(!existing){
 const baseline=readFileSync('tests/izord/sql-fixture.sql','utf8');await sql.query(baseline.slice(baseline.indexOf('create table public.crm_workspace_state'),baseline.indexOf('create schema storage;')));
 await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false);create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
 for(const file of files){try{await sql.query(readFileSync('supabase/migrations/'+file,'utf8'));console.log('Applied '+file);}catch(e){console.log('Failed '+file);throw e;}}
 }
 const modules=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','monthlyCharges','fonciere','publisher'];
 const users={};
 for(const [name,admin,grants] of [['owner',true,Object.fromEntries(modules.map(m=>[m,'contribute']))],['contributor',false,{vendorQuotes:'contribute',contacts:'read',documents:'contribute'}],['quoteOnly',false,{vendorQuotes:'contribute'}],['reader',false,{vendorQuotes:'read',contacts:'read',documents:'read'}]]){
  const email='vendor-information-'+name+'-'+randomUUID()+'@example.invalid',password='Fictitious-Information-2026!';
  const created=allow(await request('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{email,password,email_confirm:true}));
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member')",[created.id]);await sql.query('insert into public.crm_access_profiles(user_id,general_admin) values($1,$2)',[created.id,admin]);
  for(const [module,level] of Object.entries(grants))await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[created.id,module,level,admin?{delete:true,export:true,bank_read:true,bank_write:true,payment:true}:{}]);
  const signed=allow(await request('/auth/v1/token?grant_type=password',null,{email,password}));users[name]={id:created.id,email,password,token:signed.access_token};
 }
 const stamp='2026-01-01T12:00:00Z';const contact={id:'vendor-fictional',name:'Démo',firstName:'Camille',entityType:'person',companyName:'',kind:'Prestataire',relationshipStatus:'Prestataire',supplierCategory:'Maison',supplierProfession:'Paysagiste',createdAt:stamp};
 const quote=(id,status='À valider',extra={})=>({id,contactId:contact.id,contactName:contact.name,category:'Paysagiste',title:'Comparaison entretien du jardin · fictif',quoteReference:'DEMO-'+id,quoteDate:'2026-10-27',validUntil:'2026-12-31',amount:425,status,notes:'Étude de marché · données fictives',createdAt:stamp,...extra});
 const fixture={contacts:[contact],vendorQuotes:[quote('pending'),quote('refused','Refusé'),quote('no-doc'),quote('linked','À valider',{linkedInvoiceId:'existing-invoice'}),quote('reverse'),quote('broken','À valider',{linkedInvoiceId:'missing-invoice'}),quote('inconsistent','À valider',{linkedInvoiceId:'wrong-invoice'})],vendorInvoices:[{id:'existing-invoice',sourceQuoteId:'linked',contactId:contact.id,title:'Facture fictive protégée',amount:425,paidAmount:75,status:'À payer',invoiceDate:'2026-10-01',createdAt:stamp},{id:'reverse-invoice',sourceQuoteId:'reverse',contactId:contact.id,title:'Facture lien inverse fictive',amount:425,paidAmount:0,status:'En attente de facture',createdAt:stamp},{id:'wrong-invoice',sourceQuoteId:'different-quote',amount:99,paidAmount:0,status:'À payer',createdAt:stamp}],housePayments:[{id:'preserved-payment',amount:75,date:'2026-10-01',createdAt:stamp}],houseTimeEntries:[],houseTrackingHouses:[],houseTrackingWorkers:[],tasks:[],documents:[],leads:[],properties:[],vehicles:[],boats:[],quotes:[],planningEntries:[],sentinel:{history:'Preserved'}};
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[fixture]);await sql.query("notify pgrst,'reload schema'");
 writeFileSync(join(directory,'fixtures.private.json'),JSON.stringify({users,fixture,api:status.API_URL,app:'http://127.0.0.1:3207',publicKey:status.ANON_KEY}),{mode:0o600});console.log('Ready: dedicated fictional users and baseline, '+(files?.length??'previous')+' migrations.');
}finally{await sql.end();}
