import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {sendInvitation,deliverInvitation} from '../../lib/server/invitations.ts';
import {connect,sql,user,grant,rpc,request,status,dir} from './local.mjs';
const require=createRequire(import.meta.url),{chromium}=require('/tmp/izord-playwright-runtime-20260917/node_modules/playwright');
await connect();const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[];
const env={NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY,LOCAL_AUTH_INVITE_KEY:status.SERVICE_ROLE_KEY,IZORD_TEST_ACK:'IZORD_DISPOSABLE_LOCAL_ONLY'};
const admin=await user('admin'),limited=await user('izord-admin'),other=await user('native-other-'+Date.now());
const existing=await user('native-existing-'+Date.now());await grant(existing,{});
const app='http://127.0.0.1:3160',mail='http://127.0.0.1:55434',grants={tasks:{level:'read'}};
const req=(email,token=admin.token)=>new Request(app+'/api/access/invite',{method:'POST',headers:token?{authorization:'Bearer '+token}:{},body:JSON.stringify({email,grants})});
const send=(email,token=admin.token)=>fetch(app+'/api/access/invite',{method:'POST',headers:token?{authorization:'Bearer '+token,'Content-Type':'application/json'}:{'Content-Type':'application/json'},body:JSON.stringify({email,grants})});
const ok=r=>{assert.ok([200,204].includes(r.status),'Expected successful local RPC');return r.data;};
const denied=r=>assert.ok(r.status>=400,'Expected invitation refusal');
let active='setup',stage='setup';
const beforeCorrection=process.env.INVITATION_REPRO_BEFORE==='1';
let invitationHandlers={sendInvitation,deliverInvitation};
if(beforeCorrection){const manifest=JSON.parse(readFileSync(dir+'/app.json','utf8'));assert.equal(manifest.app,app);assert.equal(manifest.status,'ready');assert.match(manifest.directory,/\/crm-unified-app-[A-Za-z0-9]+$/);invitationHandlers=await import(pathToFileURL(join(manifest.directory,'lib/server/invitations.ts')).href);}
const resultFile=beforeCorrection?'/native-invitation-resend-before.json':process.env.INVITATION_FINAL==='1'?'/native-invitations-final.json':process.env.INVITATION_CASE?'/native-invitation-password-retry.json':'/native-invitations.json';
async function check(name,fn){if(process.env.INVITATION_CASE&&!name.includes(process.env.INVITATION_CASE))return;active=name;stage='start';try{const evidence=await fn();results.push({name,status:beforeCorrection?'reproduced':'passed',...(evidence?{evidence}:{})});console.log((beforeCorrection?'REPRODUCED ':'PASS ')+name);}catch(e){results.push({name,status:'failed',stage,code:e.code==='ERR_ASSERTION'?'assertion_failed':'local_flow_failed'});throw new Error('Invitation check failed: '+name);}finally{writeFileSync(dir+resultFile,JSON.stringify(results,null,2));}}
async function received(email,previousToken){
 for(let attempt=0;attempt<30;attempt++){
  const list=await(await fetch(mail+'/api/v1/messages')).json();
  for(const m of list.messages.filter(m=>m.To?.some(t=>t.Address===email))){const content=await(await fetch(mail+'/api/v1/message/'+m.ID)).json();const urls=(content.Text+' '+content.HTML).match(/http:\/\/127\.0\.0\.1:55431\/auth\/v1\/verify[^\s"<>]+/g);assert.ok(urls?.length,'Native Auth verification link expected');const url=new URL(urls[0].replaceAll('&amp;','&'));assert.equal(url.origin,status.API_URL);const callback=new URL(url.searchParams.get('redirect_to'));assert.equal(callback.origin,app);assert.ok(callback.searchParams.get('invite'));assert.equal(callback.searchParams.has('token_hash'),false);if(callback.searchParams.get('invite')===previousToken)continue;return {link:url.href,callback,token:callback.searchParams.get('invite')};}
  await new Promise(r=>setTimeout(r,100));
 }throw new Error('Local message not received');
}
async function context(){const c=await browser.newContext();await c.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'&&['3160','55431'].includes(u.port)?r.continue():r.abort();});return c;}
async function session(page){return page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('-auth-token')))).access_token);}
async function openLink(c,item){const p=await c.newPage();await p.goto(item.link);await p.getByRole('button',{name:'Accepter mon invitation'}).waitFor({timeout:15000});assert.equal(new URL(p.url()).hash,'');return p;}
async function noRights(email){assert.equal((await sql.query('select count(*) from crm_module_grants g join auth.users u on u.id=g.user_id where u.email=$1',[email])).rows[0].count,'0');assert.equal((await sql.query('select count(*) from app_memberships m join auth.users u on u.id=m.user_id where u.email=$1',[email])).rows[0].count,'0');}
async function fixture(){const email='native-'+crypto.randomUUID()+'@example.invalid';assert.equal((await send(email)).status,200);return {email,...await received(email)};}
async function sendFromAdministration(email){
 const c=await context();try{const p=await c.newPage();await p.goto(app+'/admin');await p.getByLabel('Email',{exact:true}).fill(admin.email);await p.getByLabel('Mot de passe',{exact:true}).fill(admin.password);await p.getByRole('button',{name:'Se connecter',exact:true}).click();await p.getByRole('heading',{name:'Utilisateurs et accès',exact:true}).waitFor();await p.getByRole('button',{name:'Inviter un utilisateur',exact:true}).click();await p.getByLabel('Email du destinataire').fill(email);await p.getByLabel('Droit Tâches',{exact:true}).selectOption('read');await p.getByRole('button',{name:'Envoyer l’invitation',exact:true}).click();await p.getByText('Invitation remise au transport. Aucun droit actif avant acceptation.',{exact:true}).waitFor();}finally{await c.close();}
}
async function passwordState(email){return(await sql.query("select id,coalesce(encrypted_password,'')<>'' as has_password from auth.users where email=$1",[email])).rows;}
try{
 for(const failedFirstDelivery of [false,true])await check('Unfinished invitation retry '+(failedFirstDelivery?'after first delivery failure following Auth creation':'after an unfinished first invitation'),async()=>{
  const email='native-resend-'+crypto.randomUUID()+'@example.invalid',chosenPassword='Local-Reprise-2026!';
  stage='first-native-delivery';
  if(failedFirstDelivery){const r=await invitationHandlers.sendInvitation(req(email),env,async(config,input)=>{await invitationHandlers.deliverInvitation(config,input);throw new Error('fictional failure after native Auth creation');});assert.equal(r.status,502);assert.equal((await sql.query('select count(*) from crm_access_invitations where email=$1 and revoked_at is null and accepted_at is null',[email])).rows[0].count,'0');}
  else assert.equal((await send(email)).status,200);
  const first=await received(email),created=await passwordState(email);assert.equal(created.length,1);assert.equal(created[0].has_password,false);await noRights(email);
  stage='administration-resend';await sendFromAdministration(email);const retried=await received(email,first.token);assert.notEqual(retried.token,first.token);assert.equal(new URL(retried.link).searchParams.get('type'),'magiclink');await noRights(email);
  stage='native-callback-and-acceptance';
  const c=await context();try{const p=await openLink(c,retried);const token=await session(p);denied(await rpc('crm_invite_accept',token,{p_token:first.token}));
   if(beforeCorrection){assert.equal(retried.callback.searchParams.has('setup'),false);assert.equal(await p.getByLabel('Choisissez un mot de passe').count(),0);}
   else{assert.equal(retried.callback.searchParams.get('setup'),'1');await p.getByLabel('Choisissez un mot de passe').fill(chosenPassword);}
   await p.getByRole('button',{name:'Accepter mon invitation'}).click();await p.getByRole('heading',{name:'Tâches',exact:true}).first().waitFor();denied(await rpc('crm_invite_accept',token,{p_token:retried.token}));
   stage='logout';await p.getByRole('button',{name:'Déconnexion',exact:true}).click();await p.getByRole('button',{name:'Se connecter',exact:true}).waitFor();
  }finally{await c.close();}
  const after=await passwordState(email);assert.equal(after.length,1);assert.equal(after[0].id,created[0].id);assert.equal(after[0].has_password,!beforeCorrection);
  stage='fresh-password-login';const fresh=await context();try{const p=await fresh.newPage();await p.goto(app);await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Mot de passe',{exact:true}).fill(chosenPassword);await p.getByRole('button',{name:'Se connecter',exact:true}).click();if(beforeCorrection)await p.getByText('Connexion impossible. Vérifiez vos identifiants.',{exact:true}).waitFor();else await p.getByRole('heading',{name:'Tâches',exact:true}).first().waitFor();}finally{await fresh.close();}
  return {sameAuthAccount:true,firstInvitationSuperseded:true,noRightsBeforeAcceptance:true,passwordOffered:!beforeCorrection,freshPasswordLoginWorks:!beforeCorrection,failedFirstDelivery};
 });
 await check('Admin route rejects anonymous, IZORD-only administrator and non-fictional local recipient before preparation',async()=>{
  const email='native-denied-'+Date.now()+'@example.invalid';assert.equal((await send(email,null)).status,401);assert.equal((await send(email,limited.token)).status,403);assert.equal((await send('blocked@external.test')).status,400);assert.equal((await sql.query('select count(*) from crm_access_invitations where email=$1',[email])).rows[0].count,'0');
 });
 await check('Administration UI sends native invite; real local Auth callback, reload, metadata inert, explicit acceptance and replay refusal',async()=>{
  const c=await context();const email='native-ui-'+Date.now()+'@example.invalid';try{
   const p=await c.newPage();await p.goto(app+'/admin');await p.getByLabel('Email',{exact:true}).fill(admin.email);await p.getByLabel('Mot de passe',{exact:true}).fill(admin.password);await p.getByRole('button',{name:'Se connecter',exact:true}).click();await p.getByRole('heading',{name:'Utilisateurs et accès',exact:true}).waitFor();await p.getByRole('button',{name:'Inviter un utilisateur',exact:true}).click();await p.getByLabel('Email du destinataire').fill(email);await p.getByLabel('Droit Tâches',{exact:true}).selectOption('read');await p.getByRole('button',{name:'Envoyer l’invitation',exact:true}).click();await p.getByText('Invitation remise au transport. Aucun droit actif avant acceptation.',{exact:true}).waitFor();
  }finally{await c.close();}
  const item=await received(email);await noRights(email);const accept=await context();try{
   const p=await openLink(accept,item);await p.reload();await p.getByRole('button',{name:'Accepter mon invitation'}).waitFor();await noRights(email);
   const token=await session(p);ok(await request('/auth/v1/user',token,{data:{general_admin:true,modules:{contacts:{level:'contribute'}}}},'PUT'));const snapshot=ok(await rpc('crm_access_snapshot',token));assert.equal(snapshot.generalAdmin,false);assert.equal(Object.keys(snapshot.modules).length,0);
   await p.getByLabel('Choisissez un mot de passe').fill('Local-Invitation-2026!');await p.getByRole('button',{name:'Accepter mon invitation'}).click();await p.getByRole('heading',{name:'Tâches',exact:true}).first().waitFor();assert.equal(await p.locator('#task-create-form input[name=title]').isDisabled(),true);denied(await rpc('crm_invite_accept',token,{p_token:item.token}));
  }finally{await accept.close();}
 });
 await check('Confirmed existing account gets native OTP without duplicate account or password change',async()=>{
  const before=(await sql.query('select encrypted_password from auth.users where id=$1',[existing.id])).rows[0];assert.equal((await send(existing.email)).status,200);const item=await received(existing.email);assert.equal(new URL(item.link).searchParams.get('type'),'magiclink');await noRights(existing.email);const c=await context();try{const p=await openLink(c,item);assert.equal(await p.getByLabel('Choisissez un mot de passe').count(),0);await p.getByRole('button',{name:'Accepter mon invitation'}).click();await p.getByRole('heading',{name:'Tâches',exact:true}).first().waitFor();}finally{await c.close();}assert.deepEqual((await sql.query('select encrypted_password from auth.users where id=$1',[existing.id])).rows[0],before);assert.equal((await sql.query('select count(*) from auth.users where email=$1',[existing.email])).rows[0].count,'1');
 });
 await check('Native mail failure revokes pending invitation without exposing provider errors',async()=>{
  const email='native-failure-'+Date.now()+'@example.invalid';const r=await sendInvitation(req(email),env,async()=>{throw new Error('private-provider-diagnostic');});assert.equal(r.status,502);assert.ok(!(await r.text()).includes('private-provider'));assert.equal((await sql.query('select count(*) from crm_access_invitations where email=$1 and revoked_at is null and accepted_at is null',[email])).rows[0].count,'0');await noRights(email);
 });
 await check('Revoked native invitation authenticates without granting business rights',async()=>{
  const item=await fixture();const id=(await sql.query('select id from crm_access_invitations where email=$1',[item.email])).rows[0].id;ok(await rpc('crm_invite_revoke',admin.token,{p_id:id}));const c=await context();try{const p=await openLink(c,item);const token=await session(p);denied(await rpc('crm_invite_accept',token,{p_token:item.token}));await noRights(item.email);}finally{await c.close();}
 });
 await check('Expired native invitation and wrong recipient rejected with no password or rights mutation',async()=>{
  const item=await fixture();await sql.query("update crm_access_invitations set expires_at=clock_timestamp()-interval '1 minute' where email=$1",[item.email]);const c=await context();try{const p=await openLink(c,item);denied(await rpc('crm_invite_accept',await session(p),{p_token:item.token}));}finally{await c.close();}
  const wrong=await context();try{const p=await wrong.newPage();await p.goto(item.callback.href);await p.getByLabel('Email',{exact:true}).fill(other.email);await p.getByLabel('Mot de passe',{exact:true}).fill(other.password);await p.getByRole('button',{name:'Se connecter',exact:true}).click();await p.getByLabel('Choisissez un mot de passe').waitFor();const before=(await sql.query('select encrypted_password from auth.users where id=$1',[other.id])).rows[0];await p.getByLabel('Choisissez un mot de passe').fill('Local-Invitation-2026!');await p.getByRole('button',{name:'Accepter mon invitation'}).click();await p.getByText('Invitation refusée : destinataire, expiration ou droits à faire vérifier par l’administrateur.',{exact:true}).waitFor();assert.deepEqual((await sql.query('select encrypted_password from auth.users where id=$1',[other.id])).rows[0],before);}finally{await wrong.close();}await noRights(item.email);await noRights(other.email);
 });
 await check('Reused Auth link blocks acceptance even with retained session and after reload',async()=>{
  const item=await fixture(),c=await context();try{const p=await openLink(c,item);await p.goto(item.link);await p.getByText('Lien d’invitation invalide ou expiré. Demandez une nouvelle invitation.',{exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Accepter mon invitation'}).isDisabled(),true);await p.reload();await p.getByText('Lien d’invitation invalide ou expiré. Demandez une nouvelle invitation.',{exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Accepter mon invitation'}).isDisabled(),true);await noRights(item.email);}finally{await c.close();}
 });
 await check('Password setup rejection retains retry after reload without accepting rights twice',async()=>{
  const item=await fixture(),c=await context();try{const p=await openLink(c,item);let accepts=0;
   p.on('request',r=>{if(r.url().endsWith('/rest/v1/rpc/crm_invite_accept'))accepts++;});
   await p.route('**/auth/v1/user',r=>r.request().method()==='PUT'?r.fulfill({status:422,contentType:'application/json',body:JSON.stringify({code:'weak_password',msg:'Fictitious refusal'})}):r.continue());
   await p.getByLabel('Choisissez un mot de passe').fill('Local-Invitation-2026!');await p.getByRole('button',{name:'Accepter mon invitation'}).click();await p.getByText('Invitation acceptée. Mot de passe non enregistré : choisissez un autre mot de passe ou réessayez.',{exact:true}).waitFor();assert.equal(accepts,1);
   assert.equal((await sql.query('select count(*) from crm_access_invitations where email=$1 and accepted_at is not null',[item.email])).rows[0].count,'1');
   await p.unroute('**/auth/v1/user');await p.reload();await p.getByRole('button',{name:'Enregistrer mon mot de passe'}).waitFor();await p.getByLabel('Choisissez un mot de passe').fill('Local-Invitation-2026!');await p.getByRole('button',{name:'Enregistrer mon mot de passe'}).click();await p.getByRole('heading',{name:'Tâches',exact:true}).first().waitFor();assert.equal(accepts,1);
  }finally{await c.close();}
 });
 await check('Former general admin cannot regain privileges through native existing-account invitation',async()=>{
  const old=await user('native-former-admin-'+Date.now());await grant(old,{},true);await sql.query('update crm_access_profiles set active=false where user_id=$1',[old.id]);const before=(await sql.query('select * from crm_access_profiles where user_id=$1',[old.id])).rows;
  assert.equal((await send(old.email)).status,200);const item=await received(old.email),c=await context();try{const p=await openLink(c,item);denied(await rpc('crm_invite_accept',await session(p),{p_token:item.token}));assert.deepEqual((await sql.query('select * from crm_access_profiles where user_id=$1',[old.id])).rows,before);}finally{await c.close();}
 });
}catch{console.error('FAIL '+active+' (details omitted to protect Auth links)');process.exitCode=1;}finally{await browser.close();await sql.end();}
