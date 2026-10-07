/** Disposable UI fixture: exact candidate sources, fictional HTTP responses only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, chmodSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

assert.equal(process.env.TASKS_COMPANY_SEARCH_ACK, 'TASKS_UI_FICTION_ONLY');
const sourceRoot = resolve(process.env.TASKS_COMPANY_SEARCH_SOURCE || process.cwd());
assert.ok(sourceRoot.startsWith('/private/tmp/'), 'Explicit disposable candidate source required');
const base = process.env.TASKS_COMPANY_SEARCH_BASE;
assert.equal(base, 'b33ec9841d111727f48ace0f3c06ec2830da4b13', 'Explicit published base SHA required');
const directory = mkdtempSync(join(tmpdir(), 'oar-tasks-company-search-ui-')); chmodSync(directory, 0o700);
const output = resolve(process.env.TASKS_COMPANY_SEARCH_OUTPUT || join(sourceRoot, 'docs/tasks/company-search'));
mkdirSync(output, { recursive: true });
const manifestFile = join(output, 'ui-source-manifest.json');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceFiles = [];
for (const path of ['components/TasksWorkspace.tsx', 'components/TaskContactPicker.tsx', 'lib/tasks/contactOptions.ts', 'lib/tasks/types.ts', 'lib/tasks/domain.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs']) {
  mkdirSync(join(directory, path, '..'), { recursive: true });
  cpSync(join(sourceRoot, path), join(directory, path));
  sourceFiles.push({ path, sha256: hash(join(sourceRoot, path)) });
  assert.equal(hash(join(directory, path)), sourceFiles.at(-1).sha256, 'Exact candidate source copy: ' + path);
}
const supportingSourceFiles = ['components/CRMApp.tsx', 'components/ModuleWorkspace.tsx', 'tests/tasks/contactOptions.test.ts', 'tests/tasks/company-search-serve.mjs', 'tests/tasks/company-search-browser.mjs', 'tests/tasks/select-only-network-guard.cjs'].map(path => ({ path, sha256: hash(join(sourceRoot, path)) }));
symlinkSync(join(sourceRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
mkdirSync(join(directory, 'app/company-demo'), { recursive: true });
writeFileSync(join(directory, 'app/layout.tsx'), `export default function Layout({children}: {children: React.ReactNode}) {return <html lang="fr"><body style={{margin:0,fontFamily:"Arial,sans-serif",background:"#fff",color:"#293345"}}>{children}</body></html>; }\n`);
writeFileSync(join(directory, 'app/company-demo/page.tsx'), `"use client";
import {useEffect,useState} from "react";
import TasksWorkspace from "@/components/TasksWorkspace";
import {taskContactOptions} from "@/lib/tasks/contactOptions";
import type {TaskApi,TaskMutation} from "@/lib/tasks/types";
async function request(path:string, body?:TaskMutation){const response=await fetch("/__task_fixture/"+path,{method:body?"POST":"GET",...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{}),cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.message||"Fixture HTTP failure");return data;}
const api:TaskApi={list:()=>request("list"),directory:()=>request("directory"),mutate:(mutation)=>request("mutate",mutation)};
const permissions={read:true,contribute:true,export:true,delete:true};
type InitialDraft={title?:string;contactId?:string};
export default function Fixture(){
 const [rows,setRows]=useState<unknown[]>([]),[readable,setReadable]=useState(true),[ready,setReady]=useState(false),[draft,setDraft]=useState<InitialDraft|undefined>();
 useEffect(()=>{let alive=true;void request("contacts").then(value=>{if(alive){setRows(value);setReady(true);}});return()=>{alive=false;};},[]);
 return <main style={{padding:12,maxWidth:1380,margin:"0 auto"}}><p style={{fontSize:12}}>Banc UI fictif · confirmation HTTP simulée · aucune Auth, RPC ou base de données</p>
 <aside data-fixture-contacts-state={ready?"ready":"loading"} data-fixture-contacts-readable={String(readable)} style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
 <button type="button" onClick={()=>setReadable(false)}>Retirer Contacts (fixture)</button><button type="button" onClick={()=>setReadable(true)}>Restaurer Contacts (fixture)</button>
 <button type="button" disabled={!readable||!ready} onClick={()=>setDraft({title:"Depuis contact Clément Minodier fictif",contactId:"contact-clement-a-fictional"})}>Créer depuis Contact (fixture)</button></aside>
 <TasksWorkspace api={api} userId="00000000-0000-4000-8000-000000000001" sessionKey="fictional-contact-ui-session" permissions={permissions} draft={draft} onDraftConsumed={()=>setDraft(undefined)} links={{leads:[{id:"lead-alpha-fictional",label:"Lead Alpha Fictif"},{id:"lead-beta-fictional",label:"Lead Beta Fictif"}],contacts:taskContactOptions(readable?rows:[])}}/>
 </main>;
}
`);
// Reuse the existing guard; only the disposable fixture's fixed port changes.
const guard = readFileSync(join(sourceRoot, 'tests/tasks/select-only-network-guard.cjs'), 'utf8').replaceAll('3201', '3203');
writeFileSync(join(directory, 'company-search-network-guard.cjs'), guard);
const fixtureOnlyFiles = ['app/layout.tsx', 'app/company-demo/page.tsx', 'company-search-network-guard.cjs'].map(path => ({ path, sha256: hash(join(directory, path)) }));
const manifest = { status: 'building', directory, sourceRoot, candidateBaseSHA: base, app: 'http://127.0.0.1:3203', sourceFiles, supportingSourceFiles, fixtureOnlyFiles, productionComponentModified: false, actualAuth: false, actualRPC: false, actualDatabase: false, accountsCreated: 0, businessWrites: 0, simulatedHTTPConfirmation: true, externalCalls: 0, guardReuse: 'select-only-network-guard.cjs with disposable fixed port 3201 replaced by 3203', integratedCRMPageRendered: false };
const save = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n'); save();
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--require=' + join(directory, 'company-search-network-guard.cjs'), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3203', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fictional_ui_only', TASKS_SELECT_ONLY_ACK: 'TASKS_UI_FICTION_ONLY' };
let child;
function launch(args, file) {
  child = spawn(process.execPath, [join(sourceRoot, 'node_modules/next/dist/bin/next'), ...args], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += String(chunk); writeFileSync(file, log); });
  return new Promise((done, fail) => { child.on('error', fail); child.on('exit', done); });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child?.kill(signal));
if (await launch(['build', '--webpack'], join(directory, 'build.log'))) { manifest.status = 'build-failed'; save(); throw new Error('UI fixture build failed: ' + join(directory, 'build.log')); }
manifest.status = 'starting'; save();
const stopped = launch(['start', '--hostname', '127.0.0.1', '--port', '3203'], join(directory, 'server.log'));
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch(manifest.app + '/company-demo', { signal: AbortSignal.timeout(1000) })).ok) { manifest.status = 'ready'; manifest.serverPID = child.pid; save(); console.log('READY ' + manifest.app + '/company-demo'); break; } } catch {}
  if (child.exitCode !== null) break;
  await new Promise(done => setTimeout(done, 200));
}
if (manifest.status !== 'ready') { child.kill('SIGTERM'); throw new Error('UI fixture startup failed'); }
await stopped; manifest.status = 'stopped'; save();
