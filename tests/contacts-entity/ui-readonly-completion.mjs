/** Supplemental mobile proof against actual LOCAL Auth/JWT/PostgREST.
 * No successful response is simulated. No business mutation is admitted.
 * Initial browser journey JSON and screenshots are never rewritten here.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const destination = resolve(process.env.CONTACTS_ENTITY_DEST || dirname(process.cwd()));
const benchPath = process.env.CONTACTS_ENTITY_BENCH || readFileSync('/private/tmp/oar-contacts-entity-bench-path.txt', 'utf8').trim();
const bench = JSON.parse(readFileSync(benchPath, 'utf8'));
const initialPath = join(destination, 'evidence/browser/results.json');
const initial = JSON.parse(readFileSync(initialPath, 'utf8'));
const manifest = JSON.parse(readFileSync(join(destination, 'evidence/demo-manifest.json'), 'utf8'));
const origin = initial.origin, backend = initial.backend;
assert.equal(origin, 'http://127.0.0.1:3399');
assert.equal(backend, new URL(bench.origin).origin);
for (const value of [origin, backend]) assert.ok(new URL(value).protocol === 'http:' && new URL(value).hostname === '127.0.0.1');
assert.equal(manifest.status, 'ready'); assert.equal(manifest.mode, 'production'); assert.equal(manifest.app, origin); assert.equal(manifest.backend, backend);
const out = join(destination, 'evidence/browser-completion'), captures = join(out, 'captures');
mkdirSync(captures, { recursive: true });
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const originalFiles = [initialPath, ...initial.results.map(record => join(destination, 'evidence/browser', record.name + '.json'))];
const originalHashes = originalFiles.map(path => ({ path, sha256: sha(path) }));
function sourceMatch() {
  for (const file of manifest.sourceFiles) for (const root of [manifest.sourceRoot, manifest.directory]) assert.equal(sha(join(root, file.path)), file.sha256, file.path);
  return { files: manifest.sourceFiles.length, sourceAndServedCopyMatch: true };
}
const sourceBefore = sourceMatch(), results = [], viewport = { width: 390, height: 667 };
const readRPCs = new Set(['crm_access_snapshot', 'crm_read_module', 'crm_tasks_read', 'crm_tasks_directory', 'crm_contact_documents']);
const testSha256 = sha(new URL(import.meta.url));
async function auditContext(context, record) {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (![origin, backend].includes(url.origin)) { record.externalBlocked.push({origin:url.origin,path:url.pathname}); return route.abort(); }
    if (url.origin === origin && url.pathname.startsWith('/api/')) { record.businessBlocked.push({method,path:url.pathname}); return route.abort(); }
    if (url.origin === backend && url.pathname.startsWith('/rest/v1/')) {
      const rpc = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.split('/').at(-1) : null;
      if ((rpc && !readRPCs.has(rpc)) || (!rpc && !['GET', 'HEAD', 'OPTIONS'].includes(method))) {
        record.businessBlocked.push({method,path:url.pathname}); return route.abort();
      }
    }
    return route.continue();
  });
  context.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== backend) return;
    if (url.pathname.startsWith('/auth/')) record.auth.push({method:response.request().method(),path:url.pathname,status:response.status()});
    if (url.pathname.startsWith('/rest/v1/')) record.localReads.push({method:response.request().method(),path:url.pathname,status:response.status()});
  });
}
async function login(page, profile) {
  await page.goto(origin + '/contacts-entity-demo', {waitUntil:'domcontentloaded'});
  await page.locator(`[data-local-profile="${profile}"]`).click();
  await page.waitForURL(url => url.pathname === '/');
  await page.locator('.contact-create-form').waitFor();
  if (profile === 'owner') await page.locator('.shared-db-status-panel.connected').waitFor({state:'attached'});
  await page.waitForLoadState('networkidle');
}
async function language(page, value, record) {
  const before = { auth:record.auth.length, reads:record.localReads.length, blocked:record.businessBlocked.length };
  await page.locator('#unified-more-trigger').click();
  const panel = page.locator('.unified-more-panel');
  await panel.locator('[data-language-selector]').getByRole('button', {name:value === 'en' ? 'English — EN' : 'Français — FR',exact:true}).click();
  await panel.locator('.unified-more-close').click();
  await page.waitForFunction(expected => document.documentElement.lang === expected, value === 'en' ? 'en-GB' : 'fr');
  assert.equal(record.auth.length, before.auth, 'Language does not sign in again');
  assert.equal(record.businessBlocked.length, before.blocked, 'Language does not attempt a write');
  record.languageToggles.push({language:value,newAuthCalls:record.auth.length-before.auth,newBusinessWriteAttempts:record.businessBlocked.length-before.blocked,backgroundReadResponses:record.localReads.slice(before.reads)});
}
async function token(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.endsWith('-auth-token')) {
      try { const session=JSON.parse(localStorage.getItem(key)); if(session.access_token)return session.access_token; } catch { /* Not an Auth entry. */ }
    }
    throw new Error('No fictional local Auth session');
  });
}
async function readContacts(context, page, record) {
  const response = await context.request.post(backend + '/rest/v1/rpc/crm_read_module', {headers:{apikey:bench.publishableKey,Authorization:'Bearer ' + await token(page)},data:{p_module:'contacts'}});
  assert.equal(response.status(),200); const data=await response.json(); assert.ok(Array.isArray(data.collections?.contacts));
  record.explicitJWTReads.push({status:response.status(),revision:data.revision,ids:data.collections.contacts.map(contact=>contact.id)});
  return data.collections.contacts;
}
async function searchMobile(page, query) {
  await page.locator('.mobile-crm-header-actions .mobile-icon-button').click();
  const sheet = page.locator('.mobile-search-sheet');
  const input = sheet.locator('input[type="search"]:visible');
  await input.waitFor({state:'visible'}); assert.equal(await input.isVisible(),true);
  await input.fill(query);
  await sheet.locator('button.primary-button').click();
  await sheet.waitFor({state:'hidden'});
}
function row(page,label) { return page.locator('.oar-contact-row').filter({has:page.getByRole('heading',{name:label,exact:true})}); }
async function overflow(page) {
  const result=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.equal(result.viewport,390); assert.ok(result.document<=392&&result.body<=392,'No horizontal overflow'); return result;
}
async function frame(page, input, path, error) {
  // Let the existing dialog's own smooth scroll finish; never alter CSS or locks.
  await page.waitForTimeout(1200);
  await input.evaluate(element=>{element.focus({preventScroll:true});element.scrollIntoView({block:'center',behavior:'instant'});});
  await page.waitForTimeout(550);
  let stable=0,previous=null,last;
  for(let attempt=0;attempt<25&&stable<3;attempt++) {
    const rect=await input.boundingBox();
    last=await page.evaluate(()=>({x:scrollX,y:scrollY}));
    const sample={...last,fieldY:rect?.y,fieldHeight:rect?.height};
    if(previous&&JSON.stringify(sample)===JSON.stringify(previous))stable++;else stable=0;
    previous=sample;
    await page.waitForTimeout(120);
  }
  assert.equal(stable,3,'Scroll settled before screenshot');
  const fieldRect=await input.boundingBox(),errorRect=error?await error.boundingBox():null;
  for(const rect of [fieldRect,errorRect].filter(Boolean))assert.ok(rect.y>=0&&rect.y+rect.height<=viewport.height,'Field and error fully visible in mobile frame');
  assert.equal(await input.evaluate(element=>document.activeElement===element),true,'Relevant field focused');
  await page.screenshot({path});return {fieldRect,errorRect,focused:true,scroll:last,stableSamples:stable,minimumSettlingMs:1750};
}

for(const engine of ['chromium','webkit']) {
  const browser=await (engine==='chromium'?chromium.launch({headless:true,channel:'chrome'}):webkit.launch({headless:true}));
  for(const profile of ['owner','contributor']) {
    const name=`${engine}-mobile-${profile}`, original=initial.results.find(record=>record.name===name);
    assert(original,name);assert.equal(original.realSaves.length,6);assert.ok(original.realSaves.every(save=>save.status===200));assert.equal(original.realReads.length,5);
    const record={name,status:'running',viewport,browserVersion:browser.version(),testSha256,originalJourney:{path:join(destination,'evidence/browser',name+'.json'),sha256:sha(join(destination,'evidence/browser',name+'.json')),status:original.status,confirmedRPCs:6,JWTReads:5,error:original.error||null},auth:[],localReads:[],explicitJWTReads:[],languageToggles:[],businessBlocked:[],externalBlocked:[],pageErrors:[],screenshots:[],checks:[],proofBoundary:'Supplement only: actual fictional LOCAL password Auth and JWT→PostgREST reads. Successful business writes from original journeys are not repeated. All business mutations and external integrations are blocked. Original journey JSON/screenshots remain unchanged. Desktop and physical device proof are outside this supplement.'};
    const context=await browser.newContext({viewport}),page=await context.newPage();page.setDefaultTimeout(20000);
    await auditContext(context,record);page.on('pageerror',error=>record.pageErrors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
    try {
      await login(page,profile);
      if(profile==='owner') {
        assert.equal(original.status,'failed');assert.ok(original.error.includes('input[type="search"]')&&original.error.includes('not visible'));
        const records=await readContacts(context,page,record);
        const wanted=[original.realSaves[0],original.realSaves[3],original.realSaves[4]].map(save=>({id:save.id,label:save.patch.companyName||save.patch.name}));
        for(const expected of wanted){const saved=records.find(contact=>contact.id===expected.id);assert(saved);assert.equal(saved.entityType,expected.id===original.realSaves[4].id?'person':'company');assert.equal(saved.companyName||saved.name,expected.label);assert.equal(records.filter(contact=>contact.id===expected.id).length,1);}
        const company=wanted[0],guillaumeCompany=wanted[1];
        for(const expected of [company,guillaumeCompany]){const saved=records.find(contact=>contact.id===expected.id);assert.equal(saved.firstName,'Guillaume');assert.equal(saved.name,'');}
        record.visibleSearchControl = 'Actual mobile search button → visible search sheet input → show results';
        record.searches=[];
        for(const [query,expected] of [['societe emeraude',[company]],['eMeRaU',[company]],['guillaum',[company,guillaumeCompany]]]){
          await searchMobile(page,query);
          for(const contact of expected) await row(page,contact.label).waitFor({state:'visible'});
          record.searches.push({query,expectedIDs:expected.map(contact=>contact.id),expectedLabels:expected.map(contact=>contact.label),visibleMatches:true,overflow:await overflow(page)});
        }
        const searchPath=join(captures,name+'-search-guillaume.png');await row(page,guillaumeCompany.label).getByRole('heading',{name:guillaumeCompany.label,exact:true}).evaluate(heading=>heading.scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(550);await page.screenshot({path:searchPath});record.screenshots.push({path:searchPath,view:'visible-search-results',language:await page.locator('html').getAttribute('lang'),state:'read-only-completed'});
        await searchMobile(page,'');
        await row(page,guillaumeCompany.label).getByRole('button',{name:/^(Modifier|Edit)$/}).click();
        const edit=page.locator('#contact-edit-panel form');await edit.waitFor();assert.equal(await edit.locator('[name="entityType"]').inputValue(),'company');assert.equal(await edit.locator('[name="companyName"]').inputValue(),guillaumeCompany.label);assert.equal(await edit.locator('[name="firstName"]').inputValue(),'Guillaume');assert.equal(await edit.locator('[name="name"]').inputValue(),'');
        // Modal language changes use the existing controls, without submitting.
        record.programmaticModalLanguageChanges = 1;
        await page.locator('#unified-more-trigger').evaluate(button=>button.click());
        const menu=page.locator('.unified-more-panel');await menu.locator('[data-language-selector]').getByRole('button',{name:'English — EN',exact:true}).evaluate(button=>button.click());await menu.locator('.unified-more-close').evaluate(button=>button.click());await page.waitForFunction(()=>document.documentElement.lang==='en-GB');
        for(const [field,view] of [['companyName','company-primary'],['firstName','company-interlocutor']]){
          const path=join(captures,name+'-'+view+'-en.png'),framing=await frame(page,edit.locator(`[name="${field}"]`),path);
          record.screenshots.push({path,view,language:'en',state:'real-reloaded',framing});
        }
        record.checks=['original confirmed IDs reread through actual local JWT','visible mobile search completed without accent/case/fragment regression','Guillaume first-name-only company searchable','company primary and interlocutor reopened without saving','no horizontal overflow'];
      } else {
        const form=page.locator('.contact-create-form');
        for(const [type,field,fr,en] of [['person','name','Veuillez renseigner le nom de famille.','Please enter the last name.'],['company','companyName','Veuillez renseigner le nom de l’entreprise.','Please enter the company name.']]){
          await language(page,'fr',record);await form.locator('[name="entityType"]').selectOption(type);await form.locator('[name="firstName"]').fill('Guillaume');await form.locator('[name="name"]').fill('');await form.locator('[name="companyName"]').fill(type==='company'?'   ':'');
          await form.locator('button[type="submit"]').click();const input=form.locator(`[name="${field}"]`);
          await input.locator('..').getByRole('alert').waitFor();assert.equal(await input.getAttribute('aria-invalid'),'true');
          const id=(await input.getAttribute('aria-describedby')).split(' ')[0],error=page.locator('#'+id);
          for(const [value,message] of [['fr',fr],['en',en]]){
            await language(page,value,record);await error.filter({hasText:message}).waitFor();assert.equal(await input.getAttribute('aria-invalid'),'true');
            const path=join(captures,`${name}-${type}-invalid-${value}-framed.png`),framing=await frame(page,input,path,error);
            record.screenshots.push({path,view:type+'-invalid',language:value,state:'client-validation-no-save',framing});
          }
        }
        record.checks=['four localized Person/Company error frames','affected field focused and aria-describedby error visible','no save attempted by invalid draft or language toggle'];
      }
      record.overflow=await overflow(page);
      assert.ok(record.auth.some(call=>call.path==='/auth/v1/token'&&call.status===200),'Real local password Auth observed');
      assert.deepEqual(record.businessBlocked,[],'No business mutation attempted');assert.deepEqual(record.externalBlocked,[],'No external integration attempted');assert.deepEqual(record.pageErrors,[]);
      record.businessMutations=0;record.status='passed';
    } catch(error) {record.status='failed';record.error=error.stack;const path=join(captures,name+'-supplement-failure.png');await page.screenshot({path}).catch(()=>{});record.screenshots.push({path,view:'failure'});}
    finally {record.finishedAt=new Date().toISOString();writeFileSync(join(out,name+'.json'),JSON.stringify(record,null,2)+'\n');results.push(record);await context.close();console.log(name+' '+record.status);if(record.error)console.error(record.error);}
  }
  await browser.close();
}
for(const file of originalHashes)assert.equal(sha(file.path),file.sha256,'Original browser evidence unchanged');
const summary={testSha256,origin,backend,viewport,sourceBefore,sourceAfter:sourceMatch(),originalEvidenceUnchanged:true,originalHashes,businessMutations:0,results};
writeFileSync(join(out,'results.json'),JSON.stringify(summary,null,2)+'\n');
if(results.some(record=>record.status!=='passed'))process.exitCode=1;
