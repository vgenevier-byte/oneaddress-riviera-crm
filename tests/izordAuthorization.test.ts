import { before, after, test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const url = process.env.OAR_ACCESS_DATABASE_URL;
if (url) { const u=new URL(url); if(u.hostname!=="127.0.0.1" || u.pathname!=="/izord_access_test") throw new Error("Isolated loopback izord_access_test required"); }
describe("IZORD authorization on PostgreSQL (Auth/Storage services NOT simulated as proof)", {skip:!url},()=>{
 let pool:any;
 const names=["none","pending","oar","admin","partner","a","b","reader","both","revoked"];
 const ids=Object.fromEntries(names.map(n=>[n,randomUUID()]));
 let pa:string,pb:string,assetA:string,assetB:string,presentation:string;
 async function query(who:string,sql:string,values:unknown[]=[]){
  const c=await pool.connect();
  try { await c.query("begin"); await c.query(`set local role ${who==="anon"?"anon":"authenticated"}`); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[ids[who]??""]); const r=await c.query(sql,values); await c.query("commit"); return r; }
  catch(e){await c.query("rollback");throw e;} finally{c.release();}
 }
 const rpc=async(who:string,name:string,args:unknown[]=[]) => (await query(who,`select public.izord_${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) as result`,args)).rows[0].result;
 const denied=async(work:Promise<unknown>)=>assert.rejects(work,(e:any)=>["42501","23514","40001","P0001"].includes(e.code));
 before(async()=>{
  const {Pool}=require("pg"); pool=new Pool({connectionString:url,max:25});
  await pool.query(readFileSync("tests/izord/sql-fixture.sql","utf8"));
  await pool.query(readFileSync("supabase/migrations/20260914210807_drive_folder_registry.sql","utf8"));
  await pool.query(readFileSync("supabase/migrations/20260916170445_module_access_foundation.sql","utf8"));
  for(const name of names) await pool.query("insert into auth.users values($1,$2,now())",[ids[name],`${name}@example.invalid`]);
  for(const [name,role] of Object.entries({admin:"admin",partner:"partner",a:"contributor",b:"contributor",reader:"reader",both:"admin",revoked:"contributor"})) await pool.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'izord',$2,$3)",[ids[name],role,name==="revoked"?"revoked":"active"]);
  for(const name of ["oar","both"]) await pool.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member')",[ids[name]]);
  await rpc("admin","invite_izord",["pending@example.invalid","reader"]);
  pa=await rpc("a","create_project",["Projet fictif A"]); pb=await rpc("b","create_project",["Projet fictif B"]);
  await rpc("admin","assign_project",[pa,ids.reader,true]);
  assetA=await rpc("a","register_asset",[pa,1,"pdf"]); assetB=await rpc("b","register_asset",[pb,1,"photo"]); presentation=await rpc("a","register_asset",[pa,1,"presentation"]);
  for(const [who,path] of [["a",assetA],["b",assetB],["a",presentation]]) { await query(who,"insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[path]); await rpc(who,"finalize_asset",[path.split("/")[1]]); }
 });
 after(async()=>{await pool?.end();});
 for(const who of ["anon",...names]) {
  test(`${who}: direct OAR payload and historical table boundaries`,async()=>{
   if(who==="anon") { await denied(query(who,"select * from public.crm_workspace_state")); return; }
   const expected=["oar","both"].includes(who);
   assert.equal((await query(who,"select * from public.crm_workspace_state")).rowCount,expected?1:0);
   if(!expected) {
    await denied(query(who,"insert into public.crm_workspace_state(workspace_id,payload) values('oneaddress-riviera','{}') on conflict(workspace_id) do update set payload=excluded.payload"));
    for(const table of ["crm_contacts","crm_backups","crm_leads","crm_tasks","crm_properties","crm_vehicles","crm_boats","crm_quotes"]) await denied(query(who,`insert into public.${table}(user_id) values($1)`,[ids[who]]));
   }
   assert.equal((await query(who,"select * from storage.objects where bucket_id='crm-documents'")).rowCount,expected?1:0);
  });
  test(`${who}: direct OAR RPCs`,async()=>{
   const lease=randomUUID(),key=`vendor:${who}`;
   const calls=[['crm_drive_folder_claim',["oneaddress-riviera",key,"root",lease]],['crm_drive_folder_reserve',["oneaddress-riviera",key,lease,`drive-${who}`]],['crm_drive_folder_ready',["oneaddress-riviera",key,lease,`drive-${who}`]]] as const;
   for(const [name,args] of calls){const work=query(who,`select public.${name}($1,$2,$3,$4) result`,[...args]);if(["oar","both"].includes(who)) assert.ok((await work).rows[0].result); else await denied(work);}
  });
  test(`${who}: IZORD project listing`,async()=>{
   if(who==="anon"){await denied(query(who,"select * from public.izord_projects"));return;}
   const expected=["admin","partner","both"].includes(who)?[pa,pb]:["a","reader"].includes(who)?[pa]:who==="b"?[pb]:[];
   assert.deepEqual((await query(who,"select id from public.izord_projects")).rows.map((r:any)=>r.id).sort(),expected.sort());
  });
 }
 test("No direct mutation, role forging, owner changes or assignment self-promotion",async()=>{
  for(const who of ["a","reader","admin","both"]){
   await denied(query(who,"update public.app_memberships set role='admin' where user_id=$1",[ids[who]]));
   await denied(query(who,"insert into public.app_memberships values($1,'oar','member','active',now())",[ids[who]]));
   await denied(query(who,"update public.izord_projects set owner_id=$1 where id=$2",[ids[who],pb]));
   await denied(query(who,"insert into public.izord_project_assignments values($1,$2)",[pb,ids[who]]));
   await denied(query(who,"truncate public.crm_workspace_state"));
  }
 });
 test("OAR writes stamp verified Auth author and preserve ordinary owner CRUD",async()=>{
  await query("oar","update public.crm_workspace_state set updated_by=$1",[ids.admin]);
  assert.equal((await pool.query("select updated_by from public.crm_workspace_state")).rows[0].updated_by,ids.oar);
  await query("oar","insert into public.crm_contacts(user_id) values($1)",[ids.oar]);
  assert.equal((await query("oar","select * from public.crm_contacts")).rowCount,1);
  assert.equal((await query("both","select * from public.crm_contacts")).rowCount,0);
 });
 test("reader cannot create, save, assign, upload or delete",async()=>{
  await denied(rpc("reader","create_project",["invalid"]));
  await denied(rpc("reader","save_project",[pa,1,"bad",{},"draft"]));
  await denied(rpc("reader","assign_project",[pb,ids.reader,true]));
  await denied(rpc("reader","register_asset",[pa,1,"pdf"]));
  await denied(query("reader","insert into storage.objects(bucket_id,name) values('izord-documents','forged')"));
  assert.equal((await query("reader","delete from storage.objects where name=$1",[presentation])).rowCount,0);
 });
 test("contributor boundaries cover project, PDF/photo, listing and guessed object URL path",async()=>{
  await denied(rpc("a","save_project",[pb,1,"bad",{},"draft"]));
  await denied(rpc("a","register_asset",[pb,1,"pdf"]));
  assert.equal((await query("a","select * from storage.objects where name=$1",[assetB])).rowCount,0);
  assert.equal((await query("a","select * from public.izord_assets where object_path=$1",[assetB])).rowCount,0);
  await denied(query("a","insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[`${pb}/${randomUUID()}`]));
  assert.equal((await query("a","delete from storage.objects where name=$1",[assetB])).rowCount,0);
  assert.equal((await query("a","update storage.objects set name='forged' where name=$1",[assetA])).rowCount,0);
 });
 test("reader sees only explicitly allowed presentations, not source PDFs/photos",async()=>{
  assert.equal((await query("reader","select * from storage.objects where bucket_id='izord-documents'")).rowCount,0);
  await denied(rpc("a","allow_reader_download",[presentation.split('/')[1],true]));
  await rpc("partner","allow_reader_download",[presentation.split('/')[1],true]);
  assert.deepEqual((await query("reader","select name from storage.objects where bucket_id='izord-documents'")).rows,[{name:presentation}]);
  await rpc("partner","allow_reader_download",[presentation.split('/')[1],false]);
  assert.equal((await query("reader","select * from storage.objects where bucket_id='izord-documents'")).rowCount,0);
 });
 test("expected revision serializes concurrent saves; business approval requires partner/admin",async()=>{
  await denied(rpc("a","save_project",[pa,1,"A",{},"approved"]));
  const results=await Promise.allSettled([rpc("a","save_project",[pa,1,"A",{scenario:1},"review"]),rpc("a","save_project",[pa,1,"A",{scenario:2},"review"])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await rpc("partner","save_project",[pa,2,"A",{reviewed:true},"approved"]),3);
  await denied(rpc("a","save_project",[pa,3,"A",{},"draft"]));
  assert.equal((await query("a","select * from public.izord_project_versions where project_id=$1",[pa])).rowCount,3);
 });
 test("associé has no access administration rights",async()=>{
  for(const role of ["partner","a","reader","oar"]) {
   await denied(rpc(role,"invite_izord",["fictional@example.invalid","admin"]));
   await denied(rpc(role,"set_izord_member",[ids.a,"admin","active"]));
   await denied(rpc(role,"assign_project",[pb,ids.a,true]));
  }
 });
 test("invitation wrong recipient, expiration, revoked, accepted once and no replay",async()=>{
  const inv=await rpc("admin","invite_izord",["none@example.invalid","contributor"]);
  await denied(rpc("pending","accept_invitation",[inv.token]));
  await pool.query("update public.izord_invitations set expires_at=now()-interval '1 second' where id=$1",[inv.id]);
  await denied(rpc("none","accept_invitation",[inv.token]));
  const revoked=await rpc("admin","invite_izord",["none@example.invalid","reader"]);
  await rpc("admin","revoke_invitation",[revoked.id]); await denied(rpc("none","accept_invitation",[revoked.token]));
  const valid=await rpc("admin","invite_izord",["none@example.invalid","reader"]);
  const attempts=await Promise.allSettled([rpc("none","accept_invitation",[valid.token]),rpc("none","accept_invitation",[valid.token])]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await query("none","select role from public.app_memberships where workspace_id='izord'")).rows[0].role,"reader");
  await denied(rpc("none","accept_invitation",[valid.token]));
  assert.equal((await query("none","select * from public.crm_workspace_state")).rowCount,0);
  await denied(query("admin","select token_hash from public.izord_invitations"));
 });
 test("unverified recipient cannot accept; verified identity comes from auth.users",async()=>{
  const inv=await rpc("admin","invite_izord",["pending@example.invalid","reader"]);
  await pool.query("update auth.users set email_confirmed_at=null where id=$1",[ids.pending]);
  await denied(rpc("pending","accept_invitation",[inv.token]));
  await pool.query("update auth.users set email_confirmed_at=now() where id=$1",[ids.pending]);
 });
 test("revocation immediately affects new SQL requests with same subject; pending invitations revoked",async()=>{
  const inv=await rpc("both","invite_izord",["pending@example.invalid","admin"]);
  await rpc("admin","set_izord_member",[ids.both,"admin","revoked"]);
  await denied(rpc("pending","accept_invitation",[inv.token]));
  assert.equal((await query("both","select * from public.izord_projects")).rowCount,0);
  assert.equal((await query("both","select * from public.crm_workspace_state")).rowCount,1);
  await rpc("admin","set_izord_member",[ids.a,"contributor","revoked"]);
  assert.equal((await query("a","select * from public.izord_projects")).rowCount,0);
  assert.equal((await query("a","select * from storage.objects")).rowCount,0);
  await denied(rpc("a","save_project",[pa,3,"A",{},"draft"]));
  await denied(rpc("admin","set_izord_member",[ids.admin,"reader","revoked"]));
 });
 test("pending imports are private to their current authorized creator and cannot be published",async()=>{
  const project=await rpc("b","create_project",["pending lifecycle"]);
  const path=await rpc("b","register_asset",[project,1,"presentation"]);
  await denied(rpc("b","finalize_asset",[path.split("/")[1]]));
  await query("b","insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[path]);
  assert.equal((await query("b","select * from storage.objects where name=$1",[path])).rowCount,1);
  await rpc("admin","assign_project",[project,ids.reader,true]);
  await rpc("admin","assign_project",[project,ids.none,true]);
  for(const actor of ["reader","none","partner"]) assert.equal((await query(actor,"select * from storage.objects where name=$1",[path])).rowCount,0);
  await denied(rpc("partner","allow_reader_download",[path.split("/")[1],true]));
  await rpc("b","finalize_asset",[path.split("/")[1]]);
  assert.equal((await query("b","select * from storage.objects where name=$1",[path])).rowCount,1);
  await denied(rpc("b","finalize_asset",[path.split("/")[1]]));
 });
 test("finalized paths cannot be removed, overwritten or moved even by a Storage RLS bypass",async()=>{
  assert.equal((await query("b","delete from storage.objects where name=$1",[assetB])).rowCount,0);
  await denied(pool.query("delete from storage.objects where bucket_id='izord-documents' and name=$1",[assetB]));
  await denied(pool.query("update storage.objects set version=gen_random_uuid()::text where bucket_id='izord-documents' and name=$1",[assetB]));
  await denied(pool.query("update storage.objects set name='moved' where bucket_id='izord-documents' and name=$1",[assetB]));
  assert.equal((await pool.query("select count(*)::int n from storage.objects where name=$1",[assetB])).rows[0].n,1);
 });
 test("withdrawal retains a tombstone and a new version needs a new identity and publication",async()=>{
  const project=await rpc("b","create_project",["withdraw lifecycle"]);
  const path=await rpc("b","register_asset",[project,1,"presentation"]);
  await query("b","insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[path]); await rpc("b","finalize_asset",[path.split("/")[1]]);
  await rpc("partner","allow_reader_download",[path.split("/")[1],true]);
  await denied(rpc("b","withdraw_asset",[path.split("/")[1]]));
  await rpc("partner","withdraw_asset",[path.split("/")[1]]);
  assert.equal((await query("b","select * from storage.objects where name=$1",[path])).rowCount,0);
  const tombstone=(await pool.query("select lifecycle,reader_download from public.izord_assets where object_path=$1",[path])).rows[0];
  assert.deepEqual(tombstone,{lifecycle:"withdrawn",reader_download:false});
  await denied(rpc("partner","finalize_asset",[path.split("/")[1]]));
  const next=await rpc("b","register_asset",[project,1,"presentation"]); assert.notEqual(next,path);
  await query("b","insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[next]);await rpc("b","finalize_asset",[next.split("/")[1]]);
  assert.equal((await pool.query("select reader_download from public.izord_assets where object_path=$1",[next])).rows[0].reader_download,false);
 });
 test("withdrawn pending path cannot be used even by signed Storage service writes",async()=>{
  const project=await rpc("b","create_project",["withdraw empty path"]),path=await rpc("b","register_asset",[project,1,"presentation"]);
  await rpc("b","withdraw_asset",[path.split("/")[1]]);
  await denied(pool.query("insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[path]));
  await denied(rpc("partner","allow_reader_download",[path.split("/")[1],true]));
 });
 test("new documents and finalization reject approved projects and old revisions",async()=>{
  const project=await rpc("b","create_project",["revision lifecycle"]),path=await rpc("b","register_asset",[project,1,"presentation"]);
  await query("b","insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[path]);
  await rpc("partner","save_project",[project,1,"approved",{},"approved"]);
  for(const who of ["b","partner","admin"]) {
   await denied(rpc(who,"register_asset",[project,1,"presentation"]));
   await denied(rpc(who,"register_asset",[project,2,"presentation"]));
   await denied(rpc(who,"finalize_asset",[path.split("/")[1]]));
  }
  await rpc("partner","save_project",[project,2,"reopened",{},"draft"]);
  await denied(rpc("b","register_asset",[project,1,"presentation"]));
  assert.ok(await rpc("b","register_asset",[project,3,"presentation"]));
 });
 test("removing assignment prevents finalization despite existing uploaded bytes",async()=>{
  const project=await rpc("partner","create_project",["assignment lifecycle"]);
  await rpc("admin","assign_project",[project,ids.b,true]);
  const path=await rpc("b","register_asset",[project,1,"presentation"]);
  await query("b","insert into storage.objects(bucket_id,name) values('izord-documents',$1)",[path]);
  await rpc("admin","assign_project",[project,ids.b,false]);
  await denied(rpc("b","finalize_asset",[path.split("/")[1]]));
  assert.equal((await query("reader","select * from storage.objects where name=$1",[path])).rowCount,0);
 });
 test("OAR timestamp is server generated, monotonic and supports a single winning CAS",async()=>{
  const read=async()=> (await query("oar","select updated_at::text t from public.crm_workspace_state")).rows[0].t;
  const prior=await read();
  await query("oar","update public.crm_workspace_state set updated_at='2000-01-01'");
  const next=await read(); assert.ok(new Date(next)>=new Date(prior));assert.notEqual(next,prior);
  const results=await Promise.all([query("oar","update public.crm_workspace_state set updated_at='2000-01-01' where updated_at=$1::timestamptz returning updated_at",[next]),query("both","update public.crm_workspace_state set updated_at='2000-01-01' where updated_at=$1::timestamptz returning updated_at",[next])]);
  assert.deepEqual(results.map(r=>r.rowCount).sort(),[0,1]);
 });
 test("no SECURITY DEFINER public additions; explicit EXECUTE and fixed search_path",async()=>{
  const functions=(await pool.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' or (n.nspname='public' and p.proname like 'izord_%')")).rows;
  for(const f of functions){assert.equal(f.anon,false,f.proname);assert.deepEqual(f.proconfig,['search_path=pg_catalog']);if(f.nspname==='public')assert.equal(f.prosecdef,false);}
 });
});
