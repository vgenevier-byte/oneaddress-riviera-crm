// Actual local /admin UI; all Auth/REST/Google responses are fictitious fixtures.
// This test never obtains a real session, reaches Google, or writes business data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.DIAGNOSTIC_UI_ORIGIN||'http://127.0.0.1:3194',out=process.env.DIAGNOSTIC_UI_ARTIFACTS||'/private/tmp/oar-google-diagnostic-ui';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local fixture only');mkdirSync(out,{recursive:true,mode:0o700});
const ownerId='dc495374-494b-420c-89d7-adb4667d8747',driveId='0ANj9BrFwFggDUk9PVA',human='vg@oneaddressriviera.com',technical='crm-drive-uploader@stalwart-method-500314-j8.iam.gserviceaccount.com';
const permission=(email,role='reader',inherited=true)=>({id:email,type:'user',role,emailAddress:email,domain:null,view:null,deleted:false,allowFileDiscovery:null,permissionDetails:[{permissionType:'member',role,inherited,inheritedFrom:inherited?driveId:null}]});
const humanPermission=permission(human,'organizer',false),technicalPermission=permission(technical,'writer',true),permissions=[humanPermission,technicalPermission];
const acl={status:'partial',data:permissions,reason:'http_403'};
const principal=(email)=>({email,observation:'observed',visiblePermissions:permissions.filter(p=>p.emailAddress===email),effectiveAccess:'not-verified',note:'fixture'});
const metadata={id:'fictional-contacts-folder',name:'Documents contacts',mimeType:'application/vnd.google-apps.folder',driveId,parents:[driveId],trashed:false,inheritedPermissionsDisabled:false,capabilities:{canListChildren:true,canAddChildren:true,canEdit:false,canShare:null}};
const success={ok:true,scope:'contacts',readOnly:true,crmAuthentication:{status:'validated'},googleAuthentication:{status:'succeeded'},status:'partial',technicalIdentity:technical,sharedDrive:{status:'available',data:{id:driveId,name:'Drive Workspace fictif',orgUnitId:null,restrictions:{},capabilities:{canListChildren:true,canAddChildren:true,canEdit:false,canShare:null,canManageMembers:false}}},drivePermissions:acl,humanPrincipals:[principal(human)],technicalPrincipal:principal(technical),contactsFolder:{configuredId:null,exactName:'Documents contacts',search:{status:'partial',data:null,reason:'incomplete_search'},observedCandidateCount:4,absenceEstablished:false,note:'fixture',folders:[{metadata,permissions:acl,parents:[{id:driveId,metadata:{status:'available',data:{...metadata,id:driveId,name:'Drive Workspace fictif'}},permissions:acl}],ancestryNotFullyChecked:true,parentSnapshotComplete:false,humanPrincipals:[principal(human)],technicalPrincipal:principal(technical)}]},managers:[{resourceId:driveId,permission:humanPermission,approved:false}],quota:{status:'available',data:{limit:null,usage:'584','usageInDrive':'584',usageInDriveTrash:'0',available:null},identity:'configured-service-account',scope:'technical-identity',unit:'bytes',organizationPooledCapacity:'not-determined',sharedDriveFreeCapacity:'not-determined',missingLimit:'unknown'}};
const google401={ok:false,scope:'contacts',readOnly:true,crmAuthentication:{status:'validated'},googleAuthentication:{status:'failed',code:'google_http_401',message:'Identité technique Google refusée.'},error:{stage:'google',code:'google_http_401',message:'Identité technique Google refusée.'}};
const crm401={ok:false,scope:'contacts',readOnly:true,crmAuthentication:{status:'required'},googleAuthentication:{status:'unknown'},error:{stage:'crm',code:'crm_authentication_required',message:'Authentification CRM requise.'},reconnect:true};
const modules=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','monthlyCharges','documents','planning','properties','vehicles','boats','izord','publisher'];
const results=[];
async function setup(browser,{profile='owner',width=1440,response=success,status=200}={}){
 const context=await browser.newContext({viewport:{width,height:950},locale:'fr-FR'}),state={profile,response,status,blocked:[],requests:[],diagnosticRequests:0,authLogouts:0,diagnosticDelay:null};
 const user={id:profile==='non-owner'?'00000000-0000-4000-8000-000000000001':ownerId,aud:'authenticated',role:'authenticated',email:'owner-ui@example.invalid',email_confirmed_at:'2026-10-06T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:'2026-10-06T00:00:00Z'};
 const grants=Object.fromEntries(modules.map(module=>[module,{level:'none',sensitive:{}}]));
 state.access={revision:1,active:profile!=='inactive',generalAdmin:profile!=='not-admin',fullAccess:profile!=='not-full',modules:grants};
 const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',exp:4102444800})).toString('base64url'),'fictional-ui-signature'].join('.');
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','cache-control':'private, no-store'},body:JSON.stringify(body)});
  if(url.origin==='http://127.0.0.1:3997'){
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
   state.requests.push({method:request.method(),path});
   if(path==='/auth/v1/token')return respond({access_token:token,refresh_token:'fictional-refresh',token_type:'bearer',expires_in:31536000,user});
   if(path==='/auth/v1/user')return respond(user);
   if(path==='/auth/v1/logout'){state.authLogouts++;return respond({});}
   if(path==='/rest/v1/app_memberships')return respond([{workspace_id:'oar',role:'member'}]);
   if(path==='/rest/v1/rpc/crm_access_snapshot')return respond(state.access);
   if(path==='/rest/v1/rpc/crm_admin_users')return respond({users:[{...user,confirmed:true,active:true,generalAdmin:true,revision:1,modules:grants,izordRole:null,assignments:[]}],invitations:[],projects:[],history:[]});
   state.blocked.push(request.method()+' '+path);return route.abort();
  }
  if(url.origin===origin&&path==='/api/drive/diagnostic'){
   assert.equal(request.method(),'GET','Diagnostic has no write request');assert.equal(url.search,'?scope=contacts','Only fixed metadata scope, no token or external identifiers');
   assert.ok(request.headers().authorization==='Bearer '+token,'Captured session header required');assert.ok(!request.postData(),'No diagnostic request body');
   state.diagnosticRequests++;if(state.diagnosticDelay)await state.diagnosticDelay;
   try{return await respond(state.response,state.status);}catch{return;}
  }
  if(url.origin===origin&&!path.startsWith('/api/'))return route.continue();
  if(['data:','blob:'].includes(url.protocol))return route.continue();state.blocked.push(request.method()+' '+url.origin+path);return route.abort();
 });
 if(context.routeWebSocket)await context.routeWebSocket('**',socket=>{const url=new URL(socket.url()),app=new URL(origin);if(url.hostname===app.hostname&&url.port===app.port)socket.connectToServer();else socket.close();});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 const login=async()=>{await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Mot de passe',{exact:true}).fill('Fictitious-UI-only!');await page.getByRole('button',{name:'Se connecter',exact:true}).click();await page.getByRole('heading',{name:profile==='not-admin'?'Aucun accès autorisé':'Utilisateurs et accès',exact:true}).waitFor({timeout:90000});};
 await page.goto(origin+'/admin');await login();return{context,page,state,errors,login,width};
}
const verify=async f=>{await f.page.getByRole('button',{name:'Vérifier Google Drive',exact:true}).click();};
async function finish(f,name){assert.deepEqual(f.state.blocked,[],'All transport remains local and read only');assert.deepEqual(f.errors,[],'No runtime browser error');assert.ok(!f.state.requests.some(r=>/crm_admin_save|crm_mutate|\/storage\//.test(r.path)),'No business or Storage writes');results.push({name,passed:true,width:f.width,diagnosticRequests:f.state.diagnosticRequests,realAuthentication:false,googleCalls:0,databaseCalls:0});await f.context.close();console.log('PASS '+name);}
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 for(const width of[1440,390]){const f=await setup(browser,{width});await verify(f);const region=f.page.getByLabel('Résultat du diagnostic Google Drive',{exact:true});await region.waitFor();const text=await region.innerText();assert.ok(text.includes('Connexion CRM validée.'));assert.ok(text.includes('Authentification Google réussie'));assert.ok(text.includes('Candidats observés : 4 ; emplacements détaillés : 1'));assert.ok(text.includes('incomplete_search'));assert.ok(text.includes('Directe')&&text.includes('Héritée'));assert.ok(text.includes('Non approuvé automatiquement'));assert.ok(text.includes('Accès effectif non vérifié.'));assert.ok(text.includes('Capacité mutualisée de l’organisation et espace libre du Drive partagé : inconnus.'));assert.ok(text.includes('disponible dans ce seul périmètre : Inconnue'));assert.ok(text.includes('Modifier : non')&&text.includes('Partager : inconnu'));assert.equal(await region.locator('a[href*="/api/"]').count(),0);assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');assert.ok(await region.locator('table').evaluateAll(tables=>tables.every(table=>table.getBoundingClientRect().right<=innerWidth+1&&table.scrollWidth<=table.clientWidth+1)),'All permission columns readable without hidden overflow');assert.ok(!text.includes('fictional-ui-signature'),'Session never appears in result');await region.screenshot({path:join(out,'owner-'+width+'.png')});await finish(f,'owner '+width+' readable metadata + header + scoped unknowns');}
 for(const profile of['non-owner','not-full','not-admin','inactive']){const f=await setup(browser,{profile});assert.equal(await f.page.getByRole('button',{name:'Vérifier Google Drive',exact:true}).count(),0);assert.equal(f.state.diagnosticRequests,0);await finish(f,'hidden for '+profile);}
 {
  const f=await setup(browser,{response:crm401,status:401});await f.page.getByRole('button',{name:/owner-ui@example.invalid/}).click();const field=f.page.getByLabel('Droit Contacts',{exact:true});await field.selectOption('read');await verify(f);await f.page.getByRole('button',{name:'Se reconnecter au CRM',exact:true}).waitFor();assert.equal(await f.page.getByText('Connexion CRM validée.',{exact:true}).count(),0);
  f.page.once('dialog',dialog=>dialog.dismiss());await f.page.getByRole('button',{name:'Se reconnecter au CRM',exact:true}).click();assert.equal(await field.inputValue(),'read','Canceled normal reconnect preserves unsaved edits');assert.equal(f.state.authLogouts,0);
  f.page.once('dialog',dialog=>dialog.accept());await f.page.getByRole('button',{name:'Se reconnecter au CRM',exact:true}).click();await f.page.getByRole('heading',{name:'Connexion au CRM',exact:true}).waitFor();assert.equal(new URL(f.page.url()).pathname,'/admin');f.state.response=success;f.state.status=200;await f.login();await verify(f);await f.page.getByText('Connexion CRM validée.',{exact:true}).waitFor();assert.equal(f.state.diagnosticRequests,2);await finish(f,'CRM401 normal reconnect with dirty edit protection then relaunch');
 }
 for(const status of[200,401]){const f=await setup(browser,{response:google401,status});await verify(f);await f.page.getByText('Authentification Google en échec.',{exact:true}).waitFor();assert.equal(await f.page.getByText('Connexion CRM validée.',{exact:true}).count(),1);assert.equal(await f.page.getByRole('button',{name:'Se reconnecter au CRM',exact:true}).count(),0);assert.equal(await f.page.getByText(/Erreur Google · google_http_401/).count(),1);await finish(f,'Google401 distinguished from CRM HTTP'+status);}
 {
  const f=await setup(browser);let release;f.state.diagnosticDelay=new Promise(r=>release=r);await verify(f);await f.page.waitForFunction(()=>document.querySelector('button')?.textContent!==undefined);for(let i=0;i<40&&f.state.diagnosticRequests===0;i++)await f.page.waitForTimeout(25);assert.equal(f.state.diagnosticRequests,1);f.state.access={...f.state.access,revision:2,fullAccess:false};await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));await f.page.getByRole('button',{name:'Vérifier Google Drive',exact:true}).waitFor({state:'hidden'});release();await f.page.waitForTimeout(300);assert.equal(await f.page.getByLabel('Résultat du diagnostic Google Drive',{exact:true}).count(),0);await finish(f,'late metadata discarded after access reduction');
 }
 {
  const f=await setup(browser);let release;f.state.diagnosticDelay=new Promise(r=>release=r);await verify(f);for(let i=0;i<40&&f.state.diagnosticRequests===0;i++)await f.page.waitForTimeout(25);assert.equal(f.state.diagnosticRequests,1);await f.page.getByRole('button',{name:'Déconnexion',exact:true}).first().click();await f.page.getByRole('heading',{name:'Connexion au CRM',exact:true}).waitFor();release();await f.page.waitForTimeout(300);assert.equal(await f.page.getByLabel('Résultat du diagnostic Google Drive',{exact:true}).count(),0);await finish(f,'late metadata discarded after logout');
 }
 {
  const f=await setup(browser);await verify(f);await f.page.getByLabel('Résultat du diagnostic Google Drive',{exact:true}).waitFor();await f.page.getByRole('button',{name:'Déconnexion',exact:true}).first().click();await f.page.getByRole('heading',{name:'Connexion au CRM',exact:true}).waitFor();assert.equal(await f.page.getByLabel('Résultat du diagnostic Google Drive',{exact:true}).count(),0);await finish(f,'private result discarded on logout');
 }
}finally{await browser.close();writeFileSync(join(out,'results.json'),JSON.stringify({passed:results.length===12,groups:results.length,results,boundary:'Actual local admin components; simulated Auth/REST/API only; no live Google or CRM authenticated proof'},null,2),{mode:0o600});}
assert.equal(results.length,12,'All targeted UI groups must pass');
console.log(JSON.stringify({passed:true,groups:results.length,artifacts:out}));
