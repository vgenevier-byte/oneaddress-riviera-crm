/** Actual local application and Auth/RPC/Storage. Never reads repository env or production credentials. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
const status=JSON.parse(readFileSync(process.env.FONCIERE_DRIVE_STATUS_FILE,'utf8'));assert.equal(status.API_URL,'http://127.0.0.1:56031');
const root=process.cwd(),directory=mkdtempSync(join(tmpdir(),'fonciere-reliability-app-')),output='/private/tmp/fonciere-reliability-ui-evidence';mkdirSync(output,{recursive:true});
for(const folder of ['app','components','lib','public'])cpSync(join(root,folder),join(directory,folder),{recursive:true,filter:source=>!basename(source).startsWith('.env')});
for(const file of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','eslint.config.mjs'])if(existsSync(join(root,file)))cpSync(join(root,file),join(directory,file));
symlinkSync(join(root,'node_modules'),join(directory,'node_modules'),'dir');
const guard=join(directory,'network-guard.cjs');writeFileSync(guard,readFileSync(join(root,'tests/izord/local-network-guard.cjs'),'utf8').replace('new Set([3159, 55431])','new Set([3231,56031,56032])'));
const manifest={app:'http://127.0.0.1:3231',directory,sourceRoot:root,launcherPID:process.pid,serverPID:null,actualAuth:true,actualRPC:true,actualStorage:true,actualGoogle:false,status:'starting'};
const save=()=>writeFileSync(join(output,'app-manifest.json'),JSON.stringify(manifest,null,2));save();
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3231'],{cwd:directory,env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG||'en_US.UTF-8',NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:`--require=${guard}`,IZORD_TEST_ACK:process.env.IZORD_TEST_ACK,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY},stdio:['ignore','pipe','pipe']});manifest.serverPID=child.pid;save();
const redact=text=>String(text).replaceAll(status.ANON_KEY,'[LOCAL PUBLIC KEY]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[LOCAL JWT]');for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>process.stdout.write(redact(chunk)));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
for(let attempt=0;attempt<150;attempt++){if(child.exitCode!==null)throw Error('Local app exited '+child.exitCode);try{if((await fetch(manifest.app+'/fonciere',{signal:AbortSignal.timeout(1500)})).ok){manifest.status='ready';save();console.log('READY '+manifest.app);break;}}catch{}await new Promise(done=>setTimeout(done,300));}
await new Promise(done=>child.on('exit',done));manifest.status='stopped';manifest.serverPID=null;save();
