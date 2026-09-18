/** Disposable Supabase stack, explicit Colima only; never reads the repository .env.
 * See docs/izord/local-testing.md. Credentials remain in private temporary files.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { assertLocalDocker, assertLocalTarget } from './local-target.mjs';
assertLocalDocker(process.env);
const cli = process.env.SUPABASE_BIN;
if (!cli) throw new Error('SUPABASE_BIN required (reuse installed CLI)');
if (!statSync(`${process.env.HOME}/.colima/default/docker.sock`).isSocket()) throw new Error('Colima socket missing');
const env = {PATH:process.env.PATH, HOME:process.env.HOME, TMPDIR:process.env.TMPDIR,
 DOCKER_HOST:process.env.DOCKER_HOST, SUPABASE_TELEMETRY_DISABLED:'1', DO_NOT_TRACK:'1'};
function docker(args) {return execFileSync('docker',args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
const version = JSON.parse(docker(['version','--format','{{json .}}']));
if (!version.Server) throw new Error('Local Docker server unavailable');
console.log(`Colima verified: client ${version.Client.Version}, server ${version.Server.Version}, API ${version.Client.ApiVersion}`);
const dir = mkdtempSync(join(tmpdir(),'izord-local-stack-'));
const project = basename(dir).toLowerCase(), network = `${project}-loopback`;
execFileSync(cli,['init','--workdir',dir],{env,stdio:'ignore'});
writeFileSync(join(dir,'supabase/config.toml'),`project_id = "${project}"
[api]
enabled = true
port = 55431
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 55432
shadow_port = 55430
major_version = 17
health_timeout = "3m"
[db.seed]
enabled = false
[db.pooler]
enabled = false
port = 55439
[realtime]
enabled = false
[studio]
enabled = false
port = 55433
[local_smtp]
enabled = true
port = 55434
[storage]
enabled = true
file_size_limit = "50MiB"
[storage.vector]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:3159"
additional_redirect_urls = ["http://127.0.0.1:3159"]
jwt_expiry = 3600
enable_signup = true
enable_anonymous_sign_ins = false
[auth.rate_limit]
sign_in_sign_ups = 200
[auth.email]
enable_signup = true
enable_confirmations = false
[edge_runtime]
enabled = false
[analytics]
enabled = false
`);
// Dedicated loopback-only network: does not change Docker's global network/context.
// Follow Supabase's documented loopback network configuration. Docker internal
// networks suppress port publication on this Colima engine, breaking CLI DB access.
docker(['network','create','--label',`izord.disposable=${project}`,'-o','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network]);
const manifest={dir,project,network,api:'http://127.0.0.1:55431',database:'postgresql://postgres@127.0.0.1:55432/postgres',app:'http://127.0.0.1:3159',mail:'http://127.0.0.1:55434'};
assertLocalTarget({...manifest,acknowledgement:process.env.IZORD_TEST_ACK});
writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
console.log(`Local-only workdir: ${dir}`);
console.log('Starting Auth/PostgreSQL/REST/Storage/mail; first start may pull container images.');
try {
 const output=execFileSync(cli,['start','--workdir',dir,'--network-id',network,'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
 writeFileSync(join(dir,'startup.private.log'),output,{mode:0o600});
} catch(e) {
 writeFileSync(join(dir,'startup.private.log'),String(e.stdout||'')+String(e.stderr||''),{mode:0o600});
 throw new Error(`Local startup failed; private diagnostic log: ${dir}/startup.private.log`);
}
const ids=docker(['ps','--filter',`label=com.supabase.cli.project=${project}`,'--format','{{.ID}}']).trim().split('\n').filter(Boolean);
if (!ids.length) throw new Error('No project containers found; fail closed');
const inspected=JSON.parse(docker(['inspect',...ids]));
for(const c of inspected) {
 for(const ports of Object.values(c.NetworkSettings.Ports||{})) for(const p of ports||[]) {
  if(p.HostIp !== '127.0.0.1') throw new Error('Non-loopback published port: stop this disposable stack');
 }
 if(!c.NetworkSettings.Networks[network]) throw new Error('Unexpected container network');
}
const statusText=execFileSync(cli,['status','--workdir',dir,'--output','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const status=JSON.parse(statusText);
assertLocalTarget({api:status.API_URL,database:status.DB_URL,app:manifest.app,mail:manifest.mail,acknowledgement:process.env.IZORD_TEST_ACK});
writeFileSync(join(dir,'local-status.json'),statusText,{mode:0o600});
const services=inspected.map(c=>({name:c.Name,state:c.State.Status,health:c.State.Health?.Status,ports:c.NetworkSettings.Ports}));
writeFileSync(join(dir,'services.json'),JSON.stringify(services,null,2),{mode:0o600});
console.log(JSON.stringify({ready:true,services,workdir:dir}));
console.log(`Stop: ${cli} stop --workdir ${dir}`);
console.log(`Then remove only this test network: docker network rm ${network}`);
