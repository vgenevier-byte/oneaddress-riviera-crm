/** Local lot2 lifecycle; retained stack only, no reset and no volume deletion. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,statSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {join,basename} from 'node:path';
import {createConnection} from 'node:net';
import {assertLocalDocker,assertLocalTarget} from './local-target.mjs';
const action=process.argv[2];assert.ok(['--start','--stop'].includes(action));
assertLocalDocker(process.env);
const dir=process.env.IZORD_LOCAL_WORKDIR;assert.ok(dir);
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
assert.equal(realpathSync(manifest.dir),realpathSync(dir));assert.equal(manifest.project,basename(dir).toLowerCase());
assert.equal(manifest.project,'izord-local-stack-5hxub2');assert.equal(manifest.network,manifest.project+'-loopback');
assertLocalTarget({...manifest,acknowledgement:process.env.IZORD_TEST_ACK});
assert.ok(statSync('/Users/vg/.colima/default/docker.sock').isSocket());
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DOCKER_HOST:process.env.DOCKER_HOST,SUPABASE_TELEMETRY_DISABLED:'1',DO_NOT_TRACK:'1'};
const docker=args=>execFileSync('/opt/homebrew/bin/docker',args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const cli=process.env.SUPABASE_BIN;assert.ok(cli);
const version=JSON.parse(docker(['version','--format','{{json .}}']));assert.ok(version.Server);
const volumes=['supabase_db_'+manifest.project,'supabase_storage_'+manifest.project];for(const volume of volumes)docker(['volume','inspect',volume]);
const out=process.env.IZORD_ARTIFACTS;assert.ok(out);mkdirSync(out,{recursive:true});
const names=['storage','rest','inbucket','auth','kong','db'].map(s=>'supabase_'+s+'_'+manifest.project).sort();
const command=action==='--start'?['start','--workdir',dir,'--network-id',manifest.network,'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']:['stop','--workdir',dir];
try{const output=execFileSync(cli,command,{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});writeFileSync(join(dir,'generator-services.private.log'),output,{mode:0o600});}catch(e){writeFileSync(join(dir,'generator-services.private.log'),String(e.stdout||'')+String(e.stderr||''),{mode:0o600});throw new Error('Local lifecycle command failed; private diagnostic retained.');}
let services=[];
if(action==='--start'){
 const ids=docker(['ps','--filter','label=com.supabase.cli.project='+manifest.project,'--format','{{.ID}}']).trim().split('\n').filter(Boolean);assert.equal(ids.length,6);
 const inspected=JSON.parse(docker(['inspect',...ids]));assert.deepEqual(inspected.map(c=>c.Name.slice(1)).sort(),names);
 for(const c of inspected){assert.ok(c.NetworkSettings.Networks[manifest.network]);for(const bindings of Object.values(c.NetworkSettings.Ports||{}))for(const b of bindings||[])assert.equal(b.HostIp,'127.0.0.1');}
 services=inspected.map(c=>({name:c.Name.slice(1),state:c.State.Status,health:c.State.Health?.Status}));
 const status=execFileSync(cli,['status','--workdir',dir,'--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});const s=JSON.parse(status);assertLocalTarget({api:s.API_URL,database:s.DB_URL,app:manifest.app,mail:manifest.mail,acknowledgement:process.env.IZORD_TEST_ACK});writeFileSync(join(dir,'local-status.json'),status,{mode:0o600});
}else{assert.equal(docker(['ps','--filter','label=com.supabase.cli.project='+manifest.project,'--format','{{.ID}}']).trim(),'');for(const volume of volumes)docker(['volume','inspect',volume]);}
const portState=port=>new Promise((resolve,reject)=>{const s=createConnection({host:'127.0.0.1',port});s.on('connect',()=>{s.destroy();resolve('open');});s.on('error',e=>e.code==='ECONNREFUSED'?resolve('closed'):reject(e));s.setTimeout(1500,()=>{s.destroy();reject(new Error('Port timeout'));});});
const ports=Object.fromEntries(await Promise.all([55431,55432,55434].map(async p=>[p,await portState(p)])));assert.ok(Object.values(ports).every(v=>v===(action==='--start'?'open':'closed')));
const report={time:new Date().toISOString(),action,client:version.Client.Version,server:version.Server.Version,project:manifest.project,services,ports,volumesPreserved:true};writeFileSync(join(out,action.slice(2)+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
