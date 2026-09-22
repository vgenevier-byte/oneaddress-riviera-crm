// Run against a source-identical isolated app with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3997.
// All Auth/REST responses below are fixtures, never evidence of real authentication.
// MORE_URL, MORE_ARTIFACTS, PLAYWRIGHT_MODULE are required; MORE_BASELINE=1 captures the defect.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
import {installFixture} from './mobile-more.fixture.mjs';
const require = createRequire(import.meta.url);
const {chromium, webkit} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.MORE_URL, out = process.env.MORE_ARTIFACTS;
assert.ok(origin && out, 'MORE_URL and MORE_ARTIFACTS are required');
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname), 'Local app only');
mkdirSync(out, {recursive:true});
const baseline = process.env.MORE_BASELINE === '1', results = [];
const phase = baseline ? 'before' : 'after';
const panel = page => page.locator('.mobile-more-menu');
const more = page => page.getByRole('navigation',{name:'Navigation mobile principale',exact:true}).getByRole('button',{name:'Plus'});
async function open(page) {await more(page).click(); await panel(page).waitFor();}
async function login(page, email, path) {
  await page.goto(origin + path);
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Mot de passe',{exact:true}).fill('Local-CRM-2026!');
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await page.locator('.crm-shell').waitFor({timeout:90000});
  if (path === '/') await page.locator('.mobile-shared-db-status.connected').waitFor({state:'attached',timeout:90000});
  if (path === '/izord') await page.getByRole('button',{name:'Nouveau projet',exact:true}).waitFor({timeout:90000});
  if (path === '/admin') await page.getByRole('button',{name:/unified-admin@example.invalid/}).waitFor({timeout:90000});
}
async function geometry(page) {
  return panel(page).evaluate(root => {
    const rect = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const styles = el => {const s=getComputedStyle(el);return {display:s.display,width:s.width,minWidth:s.minWidth,gridTemplateColumns:s.gridTemplateColumns,flexDirection:s.flexDirection,flexBasis:s.flexBasis,whiteSpace:s.whiteSpace,overflowWrap:s.overflowWrap,wordBreak:s.wordBreak,fontSize:s.fontSize,letterSpacing:s.letterSpacing,color:s.color,backgroundColor:s.backgroundColor};};
    const rgba=value=>{const values=value.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];return [...values.slice(0,3),values[3]??1];};
    const background=el=>{if(!el)return [255,255,255];const own=rgba(getComputedStyle(el).backgroundColor),parent=own[3]<1?background(el.parentElement):[0,0,0];return own.slice(0,3).map((v,i)=>v*own[3]+parent[i]*(1-own[3]));};
    const luminance=rgb=>rgb.reduce((sum,v,i)=>{const s=v/255;return sum+(s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4)*[0.2126,0.7152,0.0722][i];},0);
    const contrast=el=>{const bg=background(el),fg=rgba(getComputedStyle(el).color),text=fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3])),a=luminance(bg),b=luminance(text);return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),text,background:bg};};
    return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,touch:navigator.maxTouchPoints,stylesheets:[...document.styleSheets].map(sheet=>sheet.href),panel:rect(root),header:rect(root.querySelector('header')),titleStyle:styles(root.querySelector('h2')),controls:[root.querySelector('h2'),root.querySelector('header button'),[...root.querySelectorAll('button')].at(-1)].map(el=>({text:el.textContent,rect:rect(el),style:styles(el),contrast:contrast(el)})),rows:[...root.querySelectorAll('nav button')].map(button=>{
      const label=button.querySelector('.unified-more-label,.nav-button-label'), icon=button.querySelector('.unified-more-icon,.nav-button-icon'), badge=button.querySelector('.unified-more-badge,.nav-badge');
      const range=document.createRange();range.selectNodeContents(label);
      return {text:label.textContent,button:rect(button),buttonStyle:styles(button),label:rect(label),labelStyle:styles(label),contrast:contrast(label),textLines:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height})),icon:rect(icon),badge:badge?{text:badge.textContent,...rect(badge),contrast:contrast(badge)}:null,active:button.getAttribute('aria-current')};
    })};
  });
}
function verifyGeometry(value, expected) {
  assert.deepEqual(value.rows.map(row=>row.text),expected,'Exact filtered module order');
  assert.ok(value.pageWidth<=value.viewport+1,'No page horizontal overflow');
  assert.ok(value.header.height<=90,'Compact header');
  assert.ok(parseFloat(value.titleStyle.fontSize)<=20,'Compact header typography');
  for(const control of value.controls) assert.ok(control.contrast.ratio>=4.5,control.text+' readable contrast');
  for (const [index,row] of value.rows.entries()) {
    assert.ok(row.button.height>=48,row.text+' touch height');
    assert.ok(row.label.width>=180,row.text+' useful label width');
    assert.ok(parseFloat(row.labelStyle.fontSize)>=16,row.text+' font size');
    assert.ok(row.contrast.ratio>=4.5,row.text+' readable contrast');
    assert.ok(row.textLines.length<=2,row.text+' readable line count');
    assert.ok(row.textLines.every(line=>line.width>30),row.text+' no single-letter lines');
    assert.ok(row.textLines.every(line=>line.x>=row.label.x-1&&line.x+line.width<=row.label.right+1),row.text+' complete text fits label');
    assert.ok(row.icon.right<=row.label.x+1,row.text+' icon precedes label');
    assert.ok(row.button.right<=value.viewport+1,row.text+' row fits');
    if (row.badge) {assert.ok(row.label.right<=row.badge.x+1,row.text+' count follows label');assert.ok(row.badge.contrast.ratio>=4.5,row.text+' readable count contrast');}
    if (index) assert.ok(row.button.y>=value.rows[index-1].button.bottom-1,'Single column');
  }
}
async function preserveDraft(page, path) {
  let field, original, value;
  if (path === '/admin') {
    await page.getByRole('button',{name:/unified-admin@example.invalid/}).click();
    field=page.getByLabel('Droit Tâches',{exact:true});original=await field.inputValue();value='read';await field.selectOption(value);
  } else if (path === '/izord') {
    await page.getByRole('button',{name:'Nouveau projet',exact:true}).click();
    field=page.locator('#izord-project');original=await field.inputValue();value='Brouillon fictif conservé';await field.fill(value);
  } else {
    await open(page);await panel(page).getByRole('button',{name:'Tâches',exact:true}).click();
    field=page.locator('form input[name="title"]').first();original=await field.inputValue();value='Saisie fictive conservée';await field.fill(value);
  }
  await open(page);await panel(page).getByRole('button',{name:'Fermer',exact:true}).click();
  assert.equal(await field.inputValue(),value,'Opening/closing Plus preserves the draft');
  await open(page);
  const warning=page.waitForEvent('dialog');
  const navigation=panel(page).getByRole('button',{name:'Suivi maison',exact:true}).click();
  const dialog=await warning;assert.equal(dialog.type(),'confirm');await dialog.dismiss();await navigation;
  assert.equal(await field.inputValue(),value,'Canceling navigation preserves the draft');
  assert.notEqual(value,original);
  return true;
}
for (const engine of process.env.MORE_ENGINE?[process.env.MORE_ENGINE]:baseline?['chromium']:['chromium','webkit']) {
  const browser=await (engine==='chromium'?chromium.launch({headless:true,channel:'chrome'}):webkit.launch({headless:true}));
  try {
    for (const width of process.env.MORE_WIDTH?[Number(process.env.MORE_WIDTH)]:baseline?[390]:[375,390,430]) for (const scenario of baseline||process.env.MORE_SINGLE?[{profile:'admin',path:'/'}]:[{profile:'admin',path:'/'},{profile:'admin',path:'/izord'},{profile:'admin',path:'/admin'},{profile:'house',path:'/?module=houseTracking'}]) {
      const context=await browser.newContext({viewport:{width,height:844},locale:'fr-FR',deviceScaleFactor:1,isMobile:true,hasTouch:true});
      const fixture=await installFixture(context,scenario.profile,origin),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{window.__moreFocus=[];document.addEventListener('focusin',event=>window.__moreFocus.push({time:performance.now(),tag:event.target.tagName,id:event.target.id,className:event.target.className}));});
      const name=`${phase}-${engine}-${width}-${scenario.profile}-${scenario.path.includes('izord')?'izord':scenario.path.includes('admin')?'admin':scenario.profile==='house'?'house':'dashboard'}`;
      try {
        await login(page,fixture.email,scenario.path);
        if (width===390&&scenario.path==='/') await page.locator('.mobile-crm-navigation').screenshot({path:`${out}/${phase}-${engine}-bottom.png`});
        await open(page);
        const measured=await geometry(page);
        await page.screenshot({path:`${out}/${name}.png`});
        if (baseline) assert.ok(measured.rows.some(row=>row.label.width<30&&row.textLines.length>5),'Baseline reproduces letter-per-line defect');
        else {
          verifyGeometry(measured,fixture.expected);
          assert.equal(await panel(page).getByRole('button',{name:'Fermer',exact:true}).evaluate(el=>el===document.activeElement),true,'Initial dialog focus');
          assert.ok(measured.rows.some(row=>row.active==='page'),'Active module retained');
          if (scenario.path==='/') assert.equal(measured.rows.find(row=>row.text==='Factures prestataires').badge?.text,'12','Real CRM badge calculation');
          await page.keyboard.press('Shift+Tab');
          assert.equal(await panel(page).getByRole('button',{name:'Déconnexion',exact:true}).evaluate(el=>el===document.activeElement),true,'Reverse focus wraps');
          await page.keyboard.press('Tab');
          assert.equal(await panel(page).getByRole('button',{name:'Fermer',exact:true}).evaluate(el=>el===document.activeElement),true,'Forward focus wraps');
          const logout=panel(page).getByRole('button',{name:'Déconnexion',exact:true});await logout.scrollIntoViewIfNeeded();
          const last=await logout.boundingBox();assert.ok(last.y>=0&&last.y+last.height<=844,'Logout completely reachable');
          await page.screenshot({path:`${out}/${name}-bottom.png`});
          await panel(page).getByRole('button',{name:'Fermer',exact:true}).click();
          await page.waitForFunction(()=>document.activeElement?.id==='unified-more-trigger');
          await open(page);await page.keyboard.press('Escape');await panel(page).waitFor({state:'hidden'});
          await page.waitForFunction(()=>document.activeElement?.id==='unified-more-trigger');
          if(width===390&&scenario.profile==='admin'){
            await preserveDraft(page,scenario.path);
            page.once('dialog',dialog=>dialog.accept());
          }
          await open(page);await panel(page).getByRole('button',{name:'Suivi maison',exact:true}).click();
          await panel(page).waitFor({state:'hidden'});await page.getByRole('heading',{name:'Suivi maison',exact:true}).first().waitFor();
          if(scenario.profile==='admin'){
            await open(page);await panel(page).getByRole('button',{name:'IZORD Invest',exact:true}).click();
            await page.getByRole('button',{name:'Nouveau projet',exact:true}).waitFor();
            await page.waitForFunction(()=>document.activeElement?.id==='unified-more-trigger');
          }
        }
        if(width===390&&scenario.path==='/'){
          const desktop=await browser.newContext({viewport:{width:1440,height:1000},locale:'fr-FR'});
          const desktopFixture=await installFixture(desktop,'admin',origin),desktopPage=await desktop.newPage();
          await login(desktopPage,desktopFixture.email,'/');
          await desktopPage.locator('.sidebar').screenshot({path:`${out}/${phase}-${engine}-desktop.png`});
          assert.equal(await desktopPage.locator('.mobile-crm-navigation').isVisible(),false);
          assert.deepEqual(desktopFixture.audit.blocked,[]);await desktop.close();
        }
        if(!baseline&&width===430){
          await open(page);await panel(page).getByRole('button',{name:'Déconnexion',exact:true}).click();
          await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();
          assert.ok(fixture.audit.auth.includes('simulated sign out'),'Logout reaches fake transport and login');
        }
        assert.deepEqual(errors,[],'No browser exceptions');assert.deepEqual(fixture.audit.blocked,[],'No remote or business write attempted');
        results.push({name,status:'passed',browserVersion:browser.version(),authentication:'simulated fixture only',geometry:measured,audit:fixture.audit,errors});console.log('PASS '+name);
      } catch(error) {await page.screenshot({path:`${out}/${name}-failure.png`});results.push({name,status:'failed',error:String(error),audit:fixture.audit,errors,focus:await page.evaluate(()=>({history:window.__moreFocus,active:{tag:document.activeElement?.tagName,id:document.activeElement?.id},trigger:!!document.getElementById('unified-more-trigger')}))});throw error;}
      finally {writeFileSync(`${out}/${phase}-${engine}${process.env.MORE_SUFFIX?'-'+process.env.MORE_SUFFIX:''}-results.json`,JSON.stringify(results,null,2));await context.close();}
    }
  } finally {await browser.close();}
}
