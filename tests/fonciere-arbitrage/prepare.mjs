/** Fresh fictional baseline on real local Auth/PostgreSQL/Storage services. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {connect,sql,service,status,fixtureFile,login,payload,fullGrants,ok} from './local.mjs';
await connect();
try{
 const fresh=(await sql.query("select to_regclass('public.crm_workspace_state') t")).rows[0].t===null; if(!fresh){assert.equal(process.env.ARBITRAGE_RESUME,'1','Explicit resume of this owned setup required'); assert.equal(Number((await sql.query('select count(*) from fonciere_projects')).rows[0].count),0); assert.equal(Number((await sql.query("select count(*) from auth.users where email not like 'arbitrage-%@example.invalid'")).rows[0].count),0);} if(fresh){
 const base=readFileSync('tests/izord/sql-fixture.sql','utf8');await sql.query(base.slice(base.indexOf('create table public.crm_workspace_state'),base.indexOf('create schema storage;')));
 await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false);create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
 const migrations=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&!name.includes('arbitrage')).sort();
 for(const name of migrations)try{await sql.query(readFileSync(join('supabase/migrations',name),'utf8'));}catch(error){throw new Error(name+': '+error.message);}
 }
 const users={};
 const defs={admin:{role:'admin',admin:true,level:'contribute',export:true,izord:'contribute'},vincent:{role:'reader',level:'read'},annCharlotte:{role:'reader',level:'read'},contributor:{role:'contributor',level:'contribute'},stranger:{role:'contributor',level:'contribute'},successor:{role:'reader',level:'read'}};
 for(const [name,def] of Object.entries(defs)){
  const email='arbitrage-'+name.toLowerCase()+'@example.invalid',password=randomBytes(24).toString('hex'); let id; if(fresh){const created=await ok(service.auth.admin.createUser({email,password,email_confirm:true}));id=created.user.id;}else{id=(await sql.query('select id from auth.users where email=$1',[email])).rows[0].id;await ok(service.auth.admin.updateUserById(id,{password}));} users[name]={id,email,password}; if(!fresh)continue;
  await sql.query('insert into crm_access_profiles(user_id,active,general_admin) values($1,true,$2)',[id,def.admin??false]);await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'oar','member'),($1,'izord',$2)",[id,def.role]);
  const grants=def.admin?fullGrants:{fonciere:{level:def.level,sensitive:{export:def.export??false,delete:false}},izord:{level:def.izord??'none',sensitive:{}},tasks:{level:'read',sensitive:{}}};
  for(const [module,grant] of Object.entries(grants))await sql.query('insert into crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[id,module,grant.level,grant.sensitive]);
 }
 await sql.query("update crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[{contacts:[],leads:[],tasks:[],properties:[],vehicles:[],boats:[],quotes:[],vendorQuotes:[],vendorInvoices:[],houseTrackingWorkers:[],houseTimeEntries:[],housePayments:[],documents:[],planningEntries:[]}]);
 const admin=await login(users.admin),projects={};
 for(const [name,title] of [['assigned','Villa fictive — Arbitrage'],['foreign','Projet fictif non affecté']])projects[name]=await ok(admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:payload(title),p_contact:'',p_agency_contact:''}));
 for(const who of ['vincent','annCharlotte','contributor','successor'])await sql.query('insert into fonciere_project_assignments(project_id,user_id) values($1,$2)',[projects.assigned,users[who].id]);
 const fixture={api:status.API_URL,app:'http://127.0.0.1:3197',publicKey:status.ANON_KEY,users,projects,baselineMigrations:readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&!name.includes('arbitrage')).sort()};writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});console.log('Prepared six fictional CRM accounts and two isolated projects with real Auth; baseline migrations: '+fixture.baselineMigrations.length);
}finally{await sql.end();}
