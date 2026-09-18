// UI-only fixture verification. Does NOT validate JWT, REST or Storage authorization.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
const out=resolve(process.env.IZORD_ARTIFACTS || '/tmp/izord-artifacts');mkdirSync(out,{recursive:true});
const dir=readFileSync(join(out,'ui-preview-path.txt'),'utf8').trim();
const next=join(process.cwd(),'node_modules/next/dist/bin/next'),binary=process.env.AGENT_BROWSER_BIN;
const session=`izord-ui-${process.pid}`,base='http://127.0.0.1:3158';
const browserEnv={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR};
const env={...browserEnv,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55431',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fictional-local-build-key'};
const browserConfig=join(out,'ui-browser-config.json');writeFileSync(browserConfig,'{}');
const server=spawn(process.execPath,[next,'start','--hostname','127.0.0.1','--port','3158'],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',c=>serverLog+=c);server.stderr.on('data',c=>serverLog+=c);
const ab=(...args)=>execFileSync(binary,['--config',browserConfig,'--session',session,...args],{encoding:'utf8',timeout:45000,env:browserEnv}).trim();
const ev=code=>JSON.parse(ab('eval',code));
async function wait(code){for(let i=0;i<80;i++){if(ev(code))return;await new Promise(r=>setTimeout(r,100));}throw Error(`Timeout: ${code}`);}
const report=[];const pass=t=>{report.push(t);console.log('PASS '+t);};
async function profile(role,path){ev(`localStorage.setItem('fixture-role',${JSON.stringify(role)}); true`);ab('open',base+path);await wait('!document.body.textContent.includes("Vérification des accès")');ab('snapshot','-i');}
function noOAR(){assert.deepEqual(ev('(window.__accessCalls||[]).filter(c=>c.table.startsWith("crm_"))'),[]);assert.equal(ev('document.querySelector(".nav-list")===null'),true);}
function screenshot(name){ab('screenshot',join(out,name+'.png'));}
try {
 for(let i=0;!serverLog.includes('Ready');i++){if(i>150||server.exitCode!==null)throw Error(serverLog);await new Promise(r=>setTimeout(r,100));}
 ab('--allowed-domains','127.0.0.1','open',base+'/spaces');ab('network','route','https://*','--abort');ab('network','route','**/api/**','--abort');
 await wait('globalThis.__accessFixture===true');ab('snapshot','-i');
 assert.equal(ab('errors'),'');pass('Isolated UI loaded without console errors');
 for(const width of [1440,390]){
  ab('set','viewport',String(width),'1000');await profile('both','/spaces');
  assert.equal(ev('document.querySelectorAll("nav a").length'),2);
  noOAR();screenshot(`spaces-${width}`);
  await profile('admin','/izord');await wait('document.body.textContent.includes("Villa des Oliviers")');
  assert.equal(ev('document.documentElement.scrollWidth<=innerWidth'),true);noOAR();screenshot(`izord-${width}`);
  pass(`Space selector and IZORD fictional project at ${width}px, no OAR load, no overflow`);
 }
 await profile('admin','/');assert.equal(ev('document.body.textContent.includes("ne dispose pas d’un accès OAR")'),true);noOAR();pass('IZORD-only root refused without CRM mount or shared payload');
 await profile('oar','/izord');assert.equal(ev('document.body.textContent.includes("ne dispose pas d’un accès IZORD")'),true);assert.deepEqual(ev('(window.__accessCalls||[]).filter(c=>c.table.startsWith("izord_"))'),[]);pass('OAR-only IZORD refused without project query');
 for(const role of ['none','pending','revoked']){await profile(role,'/spaces');assert.equal(ev('document.body.textContent.includes("Aucune adhésion active")'),true);noOAR();}pass('No membership / pending / revoked UI closed');
 ev(`localStorage.setItem('oneaddress-riviera-crm-v1',JSON.stringify({contacts:[{name:'SECRET OLD CACHE'}]}));localStorage.setItem('oar:fixture-oar:oneaddress-riviera-crm-v1',JSON.stringify({contacts:[{name:'SECRET SCOPED CACHE'}]}));true`);
 await profile('admin','/izord');await wait('!!document.querySelector("[data-cache-transition]")');assert.equal(ev('/SECRET (OLD|SCOPED) CACHE/.test(document.body.textContent)'),false);noOAR();assert.equal(ev('document.querySelectorAll("input[type=password]").length'),0);screenshot('cache-recovery-390');pass('Old cache recovery blocks login and IZORD; no payload or CRM rendered');
 // Fixture-only cleanup after the gate assertion; actual export/purge is covered by cache-lifecycle.browser.mjs.
 ev(`localStorage.removeItem('oneaddress-riviera-crm-v1');localStorage.removeItem('oar:fixture-oar:oneaddress-riviera-crm-v1');true`);await profile('admin','/izord');await wait('document.body.textContent.includes("Villa des Oliviers")');
 // Auth/account change without a navigation: focus revalidation must discard old page.
 ev(`localStorage.setItem('fixture-role','reader');window.dispatchEvent(new Event('focus'));true`);await wait('document.body.textContent.includes("reader@example.invalid")');noOAR();pass('Account change reloads and clears old React state');
 await profile('anon','/izord');assert.equal(ev('document.querySelectorAll("input[type=password]").length'),1);noOAR();pass('Anonymous route shows only individual login');
 assert.equal(ab('errors'),'');pass('No browser errors after navigation');
 writeFileSync(join(out,'ui-results.json'),JSON.stringify({kind:'fixtures only',passed:report.length,checks:report},null,2));
}finally{try{ab('close');}catch{}server.kill('SIGTERM');writeFileSync(join(out,'ui-server.log'),serverLog);}
