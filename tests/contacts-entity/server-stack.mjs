/** Actual local PG17/Auth/PostgREST stack, isolated from every hosted project. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,statSync} from 'node:fs';
import {basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {ACK,ORIGIN,assertTarget,assertDocker} from './server-target.mjs';
assertDocker(process.env);
const cli=process.env.SUPABASE_BIN;
if(!cli||!statSync(cli).isFile()||!statSync(`${process.env.HOME}/.colima/default/docker.sock`).isSocket())throw new Error('Installed CLI and live local Colima required');
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DOCKER_HOST:process.env.DOCKER_HOST,DO_NOT_TRACK:'1',SUPABASE_TELEMETRY_DISABLED:'1'};
const docker=args=>execFileSync('docker',args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
if(!JSON.parse(docker(['version','--format','{{json .}}'])).Server)throw new Error('Local Docker unavailable');
const directory=mkdtempSync(join(tmpdir(),'oar-contacts-entity-')),project=basename(directory).toLowerCase(),network=project+'-loopback';
execFileSync(cli,['init','--workdir',directory],{env,stdio:'ignore'});
writeFileSync(join(directory,'supabase/config.toml'),`project_id = "${project}"
[api]
enabled = true
port = 55831
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 55832
shadow_port = 55830
major_version = 17
health_timeout = "3m"
[db.seed]
enabled = false
[db.pooler]
enabled = false
port = 55839
[realtime]
enabled = false
[studio]
enabled = false
port = 55833
[local_smtp]
enabled = true
port = 55834
[storage]
enabled = true
file_size_limit = "50MiB"
[storage.vector]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:3399"
additional_redirect_urls = ["http://127.0.0.1:3399"]
jwt_expiry = 3600
enable_signup = false
enable_anonymous_sign_ins = false
[auth.rate_limit]
sign_in_sign_ups = 500
[auth.email]
enable_signup = true
enable_confirmations = false
[edge_runtime]
enabled = false
[analytics]
enabled = false
`);
docker(['network','create','--label',`contacts.entity.disposable=${project}`,'-o','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network]);
const manifest={directory,project,network,origin:ORIGIN,database:'postgresql://postgres@127.0.0.1:55832/postgres',app:'http://127.0.0.1:3399',mail:'http://127.0.0.1:55834',acknowledgement:ACK};
assertTarget(manifest);
writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
writeFileSync('/private/tmp/oar-contacts-entity-stack-manifest.json',JSON.stringify(manifest,null,2),{mode:0o600});
console.log('Starting fictional local Auth/PostgREST bench: '+directory);
try{
 const output=execFileSync(cli,['start','--workdir',directory,'--network-id',network,'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
 writeFileSync(join(directory,'startup.private.log'),output,{mode:0o600});
}catch(error){writeFileSync(join(directory,'startup.private.log'),String(error.stdout||'')+String(error.stderr||''),{mode:0o600});throw new Error('Local startup failed; private diagnostic file: '+join(directory,'startup.private.log'));}
const ids=docker(['ps','--filter',`label=com.supabase.cli.project=${project}`,'--format','{{.ID}}']).trim().split('\n').filter(Boolean);
if(!ids.length)throw new Error('No isolated project containers');
const inspected=JSON.parse(docker(['inspect',...ids]));
for(const container of inspected){
 for(const ports of Object.values(container.NetworkSettings.Ports||{}))for(const port of ports||[])if(port.HostIp!=='127.0.0.1')throw new Error('Non-loopback port');
 if(!container.NetworkSettings.Networks[network])throw new Error('Unexpected project network');
}
const output=execFileSync(cli,['status','--workdir',directory,'--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const status=JSON.parse(output);assertTarget({origin:status.API_URL,database:status.DB_URL,acknowledgement:ACK});
const statusFile=join(directory,'local-status.private.json');writeFileSync(statusFile,output,{mode:0o600});
Object.assign(manifest,{ready:true,statusFile});
writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
writeFileSync('/private/tmp/oar-contacts-entity-stack-manifest.json',JSON.stringify(manifest,null,2),{mode:0o600});
console.log(JSON.stringify({ready:true,directory,origin:ORIGIN,services:inspected.map(c=>({name:c.Name,state:c.State.Status,health:c.State.Health?.Status}))}));
