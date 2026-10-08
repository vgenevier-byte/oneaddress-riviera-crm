/** Disposable localhost-only demo. Exact candidate product sources, fictional read-only transport.
 * No .env, credentials, migration, external Auth, Drive or database operation.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename, relative, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { createFixture, profiles } from './fixture.mjs';
const production=process.env.I18N_DEMO_MODE==='production';
const repo=process.cwd(), sourceRoot=resolve(process.env.I18N_SOURCE_ROOT||'');
assert.ok(process.env.I18N_SOURCE_ROOT,'Explicit candidate source required');
assert.notEqual(sourceRoot,resolve('/Users/vg/Desktop/OARcrm-repo'),'The dirty shared checkout cannot be the demo candidate');
const directory=mkdtempSync(join(tmpdir(),'oar-bilingual-demo-'));chmodSync(directory,0o700);
symlinkSync(join(repo,'node_modules'),join(directory,'node_modules'),'dir');
const manifestPath=resolve(process.env.I18N_MANIFEST||'/private/tmp/oar-bilingual-20261008/demo-manifest.json');mkdirSync(dirname(manifestPath),{recursive:true});
const manifest={directory,sourceRoot,app:'http://127.0.0.1:3299',demo:'http://127.0.0.1:3299/i18n-demo',status:'preparing',mode:production?'production':'development',sourceFiles:[],applicationSourcesModified:false,isolatedLauncher:'app/i18n-demo/page.tsx',authentication:'SIMULATED ONLY',database:'NONE',externalCalls:0,buildLog:join(directory,'build.log'),serverLog:join(directory,'server.log')};
const save=()=>writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
const launcher=`"use client";
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import LanguageSelector from '@/components/LanguageSelector';
import {useI18n} from '@/lib/i18n/I18nProvider';
const profiles=${JSON.stringify(Object.keys(profiles))};
const labels:Record<string,{fr:string,en:string}>={full:{fr:'Compte complet',en:'Full access'},limited:{fr:'Accès limité',en:'Limited access'},reader:{fr:'Lecture seule',en:'Read only'},none:{fr:'Sans accès',en:'No access'},admin:{fr:'Administration',en:'Administration'},charges:{fr:'Charges mensuelles',en:'Monthly charges'},planning:{fr:'Planning',en:'Schedule'},house:{fr:'Personnel et interventions',en:'Staff and services'},publisher:{fr:'Publisher',en:'Publisher'}};
export default function Demo(){const{language}=useI18n();const[message,setMessage]=useState('');const[busy,setBusy]=useState(false);return <main style={{maxWidth:850,margin:'40px auto',padding:24,lineHeight:1.6}}><LanguageSelector/><h1>{language==='en'?'Bilingual CRM — local demonstration':'CRM bilingue — démonstration locale'}</h1><p>{language==='en'?'The actual candidate interface uses fictional accounts and data. Authentication, permissions and reads are simulated locally. Business writes and generations are blocked.':'Le véritable CRM candidat utilise des comptes et données fictifs. Authentification, droits et lectures sont simulés localement. Les écritures métier et générations sont bloquées.'}</p><p>{language==='en'?'Choose a profile. Open a separate private window to compare accounts.':'Choisissez un profil. Ouvrez une fenêtre privée distincte pour comparer les comptes.'}</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>{profiles.map(profile=><button type="button" key={profile} disabled={busy} style={{minHeight:48,padding:12}} onClick={async()=>{if(!['127.0.0.1','localhost'].includes(location.hostname)){setMessage('Localhost required');return;}setBusy(true);await supabase.auth.signOut();const r=await supabase.auth.signInWithPassword({email:'i18n-'+profile+'@example.invalid',password:'Bilingual-Fictive-2026!'});if(r.error){setMessage(language==='en'?'Fictional sign-in unavailable.':'Connexion fictive indisponible.');setBusy(false);}else location.assign(profile==='charges'?'/charges':profile==='admin'?'/admin':'/');}}>{labels[profile]?.[language]||profile}</button>)}</div>{message&&<p role="status">{message}</p>}<p><a href="/">{language==='en'?'Open sign-in screen':'Ouvrir l’écran de connexion'}</a></p></main>;}`;
function copySources(){
 for(const folder of ['app','components','lib','public'])cpSync(join(sourceRoot,folder),join(directory,folder),{recursive:true,filter:path=>!basename(path).startsWith('.env')&&!basename(path).includes('.before-')});
 for(const file of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','eslint.config.mjs'])if(existsSync(join(sourceRoot,file)))cpSync(join(sourceRoot,file),join(directory,file));
 // Temporary empty catalogues only allow the early dev server to launch while other agents work.
 for(const name of ['crm','modules','specialist'])if(!existsSync(join(directory,`lib/i18n/catalogs/${name}.ts`))){assert.ok(!production,'Complete catalogues required for the final production demo');writeFileSync(join(directory,`lib/i18n/catalogs/${name}.ts`),`export const ${name}Messages = {} as const;\n`);}
 const sourceFiles=[];
 function collect(path){for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.name.startsWith('.env')||entry.name.includes('.before-'))continue;if(entry.isDirectory())collect(file);else sourceFiles.push({path:relative(sourceRoot,file),sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});}}
 for(const folder of ['app','components','lib'])collect(join(sourceRoot,folder));
 for(const file of sourceFiles)assert.equal(createHash('sha256').update(readFileSync(join(directory,file.path))).digest('hex'),file.sha256);
 manifest.sourceFiles=sourceFiles;manifest.syncedAt=new Date().toISOString();
 mkdirSync(join(directory,'app/i18n-demo'),{recursive:true});writeFileSync(join(directory,'app/i18n-demo/page.tsx'),launcher);save();
}
copySources();
const fixtures=Object.fromEntries(Object.keys(profiles).map(name=>[name,createFixture(name)]));
function selected(req,body){if(req.url.startsWith('/auth/v1/token'))return fixtures[Object.keys(fixtures).find(name=>body.email===fixtures[name].user.email)]||fixtures.full;const token=String(req.headers.authorization||'').replace(/^Bearer /,'');return Object.values(fixtures).find(f=>f.token===token)||fixtures.full;}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>100000)throw new Error('Fixture body too large');}if(!text)return {};try{return JSON.parse(text);}catch{return {};}}
function json(res,value){res.writeHead(value.status,{'content-type':'application/json','access-control-allow-origin':'http://127.0.0.1:3299','access-control-allow-headers':'*','access-control-allow-methods':'*','cache-control':'no-store'});res.end(value.body===null?'':JSON.stringify(value.body));}
const transport=http.createServer(async(req,res)=>{try{const data=await body(req);const reply=selected(req,data).respond(req.method,new URL(req.url,'http://127.0.0.1:4097'),data);if(req.url.includes('crm_admin_users'))await new Promise(r=>setTimeout(r,120));json(res,reply);}catch{json(res,{status:500,body:{error:'Local fictional transport unavailable'}});}});
const proxy=http.createServer(async(req,res)=>{
 if(!['127.0.0.1:3299','localhost:3299'].includes(req.headers.host)){res.writeHead(403);res.end('Localhost only');return;}
 if(req.url.startsWith('/api/')){const data=await body(req);return json(res,selected(req,data).respond(req.method,new URL(req.url,'http://127.0.0.1:3299'),data));}
 const upstream=http.request({hostname:'127.0.0.1',port:3300,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3299'}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});upstream.on('error',()=>{res.writeHead(503);res.end('Local app starting');});req.pipe(upstream);
});
// Next dev's bootstrap waits for HMR; keep its WebSocket on the same local proxy.
proxy.on('upgrade',(req,socket,head)=>{
 const upstream=net.connect(3300,'127.0.0.1',()=>{
  const headers={...req.headers,host:'127.0.0.1:3299'};
  upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries(headers).map(([key,value])=>`${key}: ${value}`).join('\r\n')+'\r\n\r\n');
  if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
 });
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
await new Promise(r=>transport.listen(4097,'127.0.0.1',r));
const env={PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8',NODE_ENV:production?'production':'development',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require='+join(repo,'tests/i18n/network-guard.cjs'),NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4097',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fictional-public-bilingual-key'};
let child;
function launch(args,path){child=spawn(process.execPath,[join(repo,'node_modules/next/dist/bin/next'),...args],{cwd:directory,env,stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log+=chunk;writeFileSync(path,log);});return child;}
if(production){
 manifest.status='building';save();launch(['build','--webpack'],manifest.buildLog);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 if(code!==0){manifest.status='build-failed';save();transport.close();throw new Error('Final demo build failed: '+manifest.buildLog);}
 launch(['start','--hostname','127.0.0.1','--port','3300'],manifest.serverLog);
}else launch(['dev','--webpack','--hostname','127.0.0.1','--port','3300'],manifest.serverLog);

for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child?.kill(signal);proxy.close();transport.close();});
process.on('SIGHUP',()=>{if(production){console.log('Production demo is a fixed source snapshot; restart to rebuild.');return;}copySources();console.log('SYNC '+manifest.syncedAt);});
await new Promise(r=>proxy.listen(3299,'127.0.0.1',r));
for(let i=0;i<100;i++){try{if((await fetch(manifest.demo,{signal:AbortSignal.timeout(1000)})).ok){manifest.status='ready';manifest.serverPID=child.pid;manifest.transportPID=process.pid;save();console.log('READY '+manifest.demo);break;}}catch{}await new Promise(r=>setTimeout(r,200));}
if(manifest.status!=='ready'){child.kill('SIGTERM');throw new Error('Local app startup failed');}
await new Promise(resolve=>child.on('exit',resolve));manifest.status='stopped';save();proxy.close();transport.close();
