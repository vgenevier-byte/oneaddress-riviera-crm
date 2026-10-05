/** Real local Auth/JWT/RPC, actual page/components. Fresh browser contexts only.
 * No real browser profile, remote target, fake authorization or global source payload.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connect, sql, rpc, read, login as tokenLogin, directory } from './server-local.mjs';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { buildMonthlyCharges } = require(process.env.MONTHLY_CALCULATIONS_MODULE || '/private/tmp/oar-monthly-charges-unit/lib/monthlyCharges/calculations.js');
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const app = 'http://127.0.0.1:3183';
assert.equal(fixture.app, app);
const output = join(process.cwd(), 'docs/monthly-charges/captures');
mkdirSync(output, { recursive: true });
const results = [], failures = [];
await connect();
const baselineSource = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const baselineConfig = (await sql.query("select config from app_private.monthly_charges_config")).rows[0].config;
const ownerToken = await tokenLogin(fixture.users.owner);
async function restore() {
  await sql.query("update app_private.monthly_charges_config set config=$1,revision=gen_random_uuid()", [baselineConfig]);
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baselineSource]);
}
async function session(browser, role, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1050 : 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', acceptDownloads: true, isMobile: width < 1000, hasTouch: width < 1000 });
  const blocked = [], requests = [], errors = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['data:','blob:'].includes(url.protocol) || ['http:','ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && ['3183','55631'].includes(url.port)) return route.continue();
    blocked.push(url.origin); return route.abort();
  });
  const page = await context.newPage();
  page.on('request', request => requests.push({ url:request.url(),method:request.method() }));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app+'/charges');
  await page.getByLabel('Email', { exact:true }).fill(fixture.users[role].email);
  await page.getByLabel('Mot de passe', { exact:true }).fill(fixture.users[role].password);
  await page.getByRole('button', { name:'Se connecter', exact:true }).click();
  await page.locator('.crm-shell').waitFor({ timeout:45000 });
  if (['none','invoiceOnly','legacyOwner','publisherOnly'].includes(role)) await page.getByRole('heading', { name:'Charges mensuelles : accès refusé' }).waitFor();
  else if (role === 'empty') await page.getByRole('heading', { name:'Aucune source autorisée' }).waitFor();
  else await page.getByRole('region', { name:'Tableau annuel des charges, défilement horizontal' }).waitFor();
  return { page, context, blocked, requests, errors };
}
function audit(state, { chargesOnly = true } = {}) {
  assert.deepEqual(state.blocked, [], 'No nonlocal network request');
  assert.deepEqual(state.errors, [], 'No runtime/hydration errors');
  if (chargesOnly) assert.ok(!state.requests.some(request => /\/rest\/v1\/crm_workspace_state(?:\?|$)/.test(request.url)), 'No global payload requested, including owner');
}
async function check(name, fn) {
  try { await fn(); results.push({ name, passed:true }); console.log('PASS '+name); }
  catch (error) { failures.push({ name, error:error.message }); console.error('FAIL '+name+': '+error.message); }
}
function annualTotal(page) { return page.locator('table tbody tr').filter({ has:page.getByRole('rowheader', { name:'Total des charges sélectionnées', exact:true }) }).locator('td').last(); }
async function assertTotal(page, snapshot) {
  const expected = buildMonthlyCharges(snapshot, 2026).totalCents / 100;
  assert.equal((await annualTotal(page).innerText()).replace(/[\s\u00a0\u202f]/g,''), expected.toLocaleString('fr-FR',{ style:'currency',currency:'EUR' }).replace(/[\s\u00a0\u202f]/g,''));
}
async function month(page, index, width) {
  if (width < 700) await page.getByLabel('Mois affiché').selectOption(String(index));
  else await page.getByRole('button', { name:['Afficher janvier 2026','Afficher février 2026','Afficher mars 2026','Afficher avril 2026','Afficher mai 2026','Afficher juin 2026','Afficher juillet 2026','Afficher août 2026','Afficher septembre 2026','Afficher octobre 2026','Afficher novembre 2026','Afficher décembre 2026'][index],exact:true }).click();
}
try {
  for (const engine of ['chromium','webkit']) {
    const browser = await (engine === 'chromium' ? chromium.launch({ headless:true, channel:'chrome' }) : webkit.launch({ headless:true }));
    try {
      for (const width of [1440,390,430]) await check(`${engine} ${width}px: annual/month/selection/attachment/Plus/source navigation`, async () => {
        await restore();
        const state = await session(browser, 'owner', width), { page, context } = state;
        try {
          const snapshot = (await read(ownerToken)).data;
          await assertTotal(page, snapshot);
          await month(page,8,width);
          assert.match(await page.locator('#monthly-detail-title').innerText(),/septembre 2026/);
          const September = page.getByRole('heading',{name:'Détail de septembre 2026'}).locator('..').locator('..');
          assert.match(await September.innerText(),/600,00/); assert.match(await September.innerText(),/300,00/);
          if (engine === 'chromium' && width === 1440) await page.screenshot({ path:join(output,'bureau-1440.png'),fullPage:true });
          if (engine === 'chromium' && width === 390) await page.screenshot({ path:join(output,'mois-mobile-390.png'),fullPage:true });
          const geometry = await page.evaluate(() => ({ width:innerWidth, contentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('table').scrollWidth, containerWidth:document.querySelector('table').parentElement.clientWidth, headingFont:parseFloat(getComputedStyle(document.querySelector('#monthly-detail-title')).fontSize) }));
          assert.ok(geometry.contentWidth <= geometry.width+1, 'No global horizontal overflow');
          assert.ok(geometry.tableWidth > geometry.containerWidth, 'Wide readable table scrolls within its container');
          assert.ok(geometry.headingFont<=32, 'Module heading remains readable and compact despite inherited CRM CSS');
          if (width < 1000) {
            await page.getByRole('navigation',{name:'Navigation mobile principale'}).getByRole('button',{name:'Plus'}).click();
            const panel=page.getByRole('dialog',{name:'Modules autorisés'});
            const labels=await panel.locator('.unified-more-label').allInnerTexts();
            assert.equal(labels[labels.indexOf('Suivi maison')+1], 'Charges mensuelles');
            const chars=await panel.locator('.unified-more-label').evaluateAll(elements=>elements.map(element=>{const range=document.createRange();range.selectNodeContents(element);return { label:element.textContent,width:element.getBoundingClientRect().width,lines:range.getClientRects().length };}));
            assert.ok(chars.every(row=>row.width>=180&&row.lines<=2),'Plus labels readable when open');
            if(engine==='chromium'&&width===390)await page.screenshot({path:join(output,'plus-ouvert-390.png')});
            await panel.getByRole('button',{name:'Fermer',exact:true}).click();
          } else {
            const labels=await page.getByRole('navigation',{name:'Navigation principale'}).locator('.nav-button-label').allTextContents();
            assert.equal(labels[labels.indexOf('Suivi maison')+1], 'Charges mensuelles');
          }
          await page.getByRole('button',{name:'Sélectionner mes charges',exact:true}).click();
          const selection=page.getByRole('dialog',{name:'Sélectionner mes charges'});
          assert.ok(await selection.getByLabel('Jardin Riviera fictif',{exact:false}).isChecked());
          await selection.getByLabel('Rechercher une personne ou une dépense').fill('Entretien septembre');
          await selection.getByLabel('Sélection Entretien septembre',{exact:true}).selectOption('exclude');
          await selection.getByLabel('Motif Entretien septembre',{exact:true}).fill('Déjà compté via une autre source');
          await selection.getByRole('button',{name:'Annuler',exact:true}).click();
          await assertTotal(page,snapshot);
          await page.reload(); await page.getByRole('region',{name:'Tableau annuel des charges, défilement horizontal'}).waitFor();
          await assertTotal(page,snapshot);
          await month(page,8,width);
          await page.getByRole('button',{name:'Rattachement / répartition',exact:true}).first().click();
          const attachment=page.getByRole('dialog',{name:'Rattachement de la facture'});
          await attachment.getByLabel('Mode de rattachement').selectOption('spread');
          await attachment.getByLabel('Premier mois').fill('2026-10');
          await attachment.getByLabel('Dernier mois').fill('2026-12');
          if(engine==='chromium'&&width===430)await page.screenshot({path:join(output,'repartition-mobile-430.png')});
          assert.ok(await attachment.getByRole('button',{name:'Enregistrer',exact:true}).isVisible());
          await attachment.getByRole('button',{name:'Annuler',exact:true}).click();
          await page.getByRole('button',{name:'Ouvrir la facture source',exact:true}).first().click();
          await page.locator('#vendor-invoice-invoice-september').waitFor({state:'visible',timeout:30000});
          assert.match(page.url(),/module=vendorInvoices#vendor-invoice-invoice-september/);
          await page.goto(app+'/charges');
          await page.getByRole('region',{name:'Tableau annuel des charges, défilement horizontal'}).waitFor();
          await month(page,8,width);
          await page.getByRole('button',{name:'Ouvrir les heures source',exact:true}).first().click();
          await page.locator('#house-time-hours-september').waitFor({ state:'visible',timeout:30000 });
          assert.match(page.url(),/module=houseTracking#house-time-hours-september/);
          audit(state,{chargesOnly:false});
        } finally { await context.close(); }
      });
      if(engine==='chromium') {
        for(const role of ['reader','invoice','house','empty','none','invoiceOnly','legacyOwner','publisherOnly'])await check(`Profile ${role}: direct route and scoped projection`,async()=>{
          const state=await session(browser,role),{page,context}=state;
          try {
            if(!['none','invoiceOnly','legacyOwner','publisherOnly','empty'].includes(role)) {
              const token=await tokenLogin(fixture.users[role]);const snapshot=(await read(token)).data;
              await assertTotal(page,snapshot);
              const names=await page.locator('body').innerText();
              assert.ok(!/PRIVATE_|Camille fictive|Jardin Riviera fictif|Intervenant archivé fictif/.test(names),'Masked names and private fields absent');
              if(role==='reader')assert.equal(await page.getByRole('button',{name:'Sélectionner mes charges',exact:true}).count(),0);
              else {
                await page.getByRole('button',{name:'Sélectionner mes charges',exact:true}).click();
                const text=await page.getByRole('dialog').innerText();
                if(role==='invoice')assert.ok(!text.includes('Intervenant ·'));
                if(role==='house')assert.ok(!text.includes('Fournisseur ·'));
                await page.getByRole('button',{name:'Annuler',exact:true}).click();
              }
            }
            audit(state);
          }finally{await context.close();}
        });
        await check('Contribution selection/spread/reset/source refresh/export filtered/concurrency',async()=>{
          await restore(); const state=await session(browser,'owner'),{page,context}=state;
          try {
            await page.getByRole('button',{name:'Sélectionner mes charges',exact:true}).click();
            let modal=page.getByRole('dialog',{name:'Sélectionner mes charges'});
            await modal.getByLabel('Entretien fictif',{exact:false}).check();
            await modal.getByRole('button',{name:'Enregistrer',exact:true}).click();
            await modal.waitFor({state:'hidden'});
            await month(page,9,1440);
            const spreadCard=page.locator('article').filter({has:page.getByText('Facture trimestrielle',{exact:true})});
            await spreadCard.getByRole('button',{name:'Rattachement / répartition',exact:true}).click();
            modal=page.getByRole('dialog',{name:'Rattachement de la facture'});
            await modal.getByLabel('Mode de rattachement').selectOption('spread');
            await modal.getByLabel('Premier mois').fill('2026-10');await modal.getByLabel('Dernier mois').fill('2026-12');
            await modal.getByRole('button',{name:'Enregistrer',exact:true}).click();await modal.waitFor({state:'hidden'});
            assert.match(await spreadCard.innerText(),/300,00/);assert.match(await spreadCard.innerText(),/Répartition personnalisée/);
            const sourceBefore=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
            assert.deepEqual(sourceBefore,baselineSource,'Parameters did not mutate any source');
            const changed=structuredClone(baselineSource);changed.vendorInvoices.find(row=>row.id==='invoice-spread').amount=1200;
            await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[changed]);
            await page.getByRole('button',{name:'Actualiser',exact:true}).click();
            await page.getByText('Un montant source a changé.',{exact:false}).waitFor();
            assert.match(await spreadCard.innerText(),/400,00/);
            const download=page.waitForEvent('download');await page.getByRole('button',{name:'CSV annuel',exact:true}).click();
            const exported=await download;const csv=readFileSync(await exported.path(),'utf8');
            const snap=(await read(ownerToken)).data, total=(buildMonthlyCharges(snap,2026).totalCents/100).toFixed(2).replace('.',',');
            assert.ok(csv.includes('"'+total+'"'),'Export reconciles with current sources');
            assert.ok(csv.includes('Montants enregistrés dans le CRM'));assert.ok(!csv.includes('PRIVATE_'));
            await page.getByRole('button',{name:'Sélectionner mes charges',exact:true}).click();modal=page.getByRole('dialog',{name:'Sélectionner mes charges'});
            await modal.getByLabel('Sélection Entretien septembre',{exact:true}).selectOption('exclude');
            const revision=(await read(ownerToken)).data.revision;
            assert.equal((await rpc('crm_patch_monthly_charges',ownerToken,{p_revision:revision,p_request_id:randomUUID(),p_patch:{exceptions:[{source:'invoice',sourceId:'invoice-manual',included:false}]}})).status,200);
            await modal.getByRole('button',{name:'Enregistrer',exact:true}).click();
            await modal.getByRole('alert').waitFor();assert.match(await modal.getByRole('alert').innerText(),/Conflit/);
            assert.equal(await modal.getByLabel('Sélection Entretien septembre',{exact:true}).inputValue(),'exclude');
            await modal.getByRole('button',{name:'Actualiser les données',exact:true}).click();
            await modal.getByRole('button',{name:'Reprendre ma saisie sur la version actualisée'}).click();
            await modal.getByRole('button',{name:'Enregistrer',exact:true}).click();await modal.waitFor({state:'hidden'});
            const config=(await read(ownerToken)).data.config;
            assert.ok(config.exceptions.some(row=>row.sourceId==='invoice-manual'&&row.included===false));
            assert.ok(config.exceptions.some(row=>row.sourceId==='invoice-september'&&row.included===false));
            audit(state);
          }finally{await context.close();await restore();}
        });
      }
    } finally { await browser.close(); }
  }
} finally {
  await restore();
  const after=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
  assert.deepEqual(after,baselineSource,'Every fictional source/history restored and preserved');
  await sql.end();
  writeFileSync(join(directory,'browser-results.json'),JSON.stringify({results,failures,realLocalJWT:true,realRPC:true,productionAccess:false,physicalIPhone:false,sourcePreserved:true},null,2),{mode:0o600});
}
assert.deepEqual(failures,[],'Browser cases must all pass');
