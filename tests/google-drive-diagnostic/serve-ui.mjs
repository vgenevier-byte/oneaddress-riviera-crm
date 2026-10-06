// A source-identical UI served with fictitious public Auth configuration only.
// Browser tests intercept all Auth/REST/API traffic; no real session or Google call.
import { cpSync, existsSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const repo=process.cwd(),dir=mkdtempSync(join(tmpdir(),'crm-google-diagnostic-ui-'));
chmodSync(dir,0o700);
for(const folder of ['app','components','lib','public'])cpSync(join(repo,folder),join(dir,folder),{recursive:true,filter:path=>!basename(path).startsWith('.env')});
for(const file of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','eslint.config.mjs'])if(existsSync(join(repo,file)))cpSync(join(repo,file),join(dir,file));
symlinkSync(join(repo,'node_modules'),join(dir,'node_modules'),'dir');
const guard=join(dir,'network-guard.cjs');
writeFileSync(guard,`const net=require('node:net');const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const o=args[0];let host=typeof o==='object'?o.host:typeof args[1]==='string'?args[1]:null;if(host&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Diagnostic UI fixture blocks remote server connection');return connect.apply(this,args);};\n`,{mode:0o600});
const out=resolve(process.env.DIAGNOSTIC_UI_MANIFEST||'/private/tmp/oar-google-diagnostic-ui-manifest.json'),origin='http://127.0.0.1:3194';
const sourceFiles=['components/AccessAdministration.tsx','components/AccessPortal.tsx','components/GoogleDriveDiagnostic.tsx','components/GoogleDriveDiagnostic.module.css','lib/googleDriveDiagnostic.ts'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(dir,path))).digest('hex')}));
const manifest={origin,directory:dir,sourceFiles,status:'building',boundary:'fictitious browser Auth/REST/API; zero real database or Google calls'};
const save=()=>writeFileSync(out,JSON.stringify(manifest,null,2),{mode:0o600});save();
const env={PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8',NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production',NODE_OPTIONS:'--require='+guard,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3997',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fictional-public-ui-key'};
let child;async function launch(args,log){child=spawn(process.execPath,[join(repo,'node_modules/next/dist/bin/next'),...args],{cwd:dir,env,stdio:['ignore','pipe','pipe']});let output='';for(const stream of[child.stdout,child.stderr])stream.on('data',chunk=>{output+=String(chunk);writeFileSync(join(dir,log),output,{mode:0o600});});return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code));});}
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>child?.kill(signal));
if(await launch(['build','--webpack'],'build.log'))throw new Error('Isolated diagnostic UI build failed: '+join(dir,'build.log'));
const ending=launch(['start','--hostname','127.0.0.1','--port','3194'],'server.log');manifest.serverPID=child.pid;manifest.status='starting';save();
for(let i=0;i<100;i++){try{const response=await fetch(origin+'/admin',{signal:AbortSignal.timeout(1000)});if(response.ok){manifest.status='ready';save();console.log('READY isolated diagnostic UI '+origin);break;}}catch{}await new Promise(r=>setTimeout(r,200));}
if(manifest.status!=='ready'){child.kill('SIGTERM');throw new Error('UI fixture server did not start');}
process.exitCode=await ending||0;
