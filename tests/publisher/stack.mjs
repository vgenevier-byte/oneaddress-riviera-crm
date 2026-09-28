/** Reuses the tests/izord/local-stack.mjs method with an independent project,
 * network, ports and retained directory. No reset, stop, prune or volume delete.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertLocalDocker } from '../izord/local-target.mjs';
import { local, assertPublisherLocalTarget } from './local-target.mjs';

assert.equal(process.env.PUBLISHER_TEST_ACK, local.acknowledgement);
assertLocalDocker({ ...process.env, IZORD_TEST_ACK: 'IZORD_DISPOSABLE_LOCAL_ONLY' });
assert.ok(statSync(`${process.env.HOME}/.colima/default/docker.sock`).isSocket());
const cli = process.env.SUPABASE_BIN;
assert.ok(cli && statSync(cli).isFile(), 'Existing Supabase CLI is required');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, DOCKER_HOST: process.env.DOCKER_HOST, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
const docker = args => execFileSync('docker', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
assert.ok(JSON.parse(docker(['version', '--format', '{{json .}}'])).Server);
const dir = local.directory, project = 'crm-publisher-local', network = `${project}-loopback`;
const manifestPath = join(dir, 'manifest.json');
if (existsSync(dir)) {
  assert.ok(existsSync(manifestPath), 'Existing directory has no owned stack manifest');
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(previous.project, project); assert.equal(previous.dir, dir); assert.equal(previous.api, local.api);
} else {
  mkdirSync(dir, { mode: 0o700 });
  execFileSync(cli, ['init', '--workdir', dir], { env, stdio: 'ignore' });
  writeFileSync(join(dir, 'supabase/config.toml'), `project_id = "${project}"
[api]
enabled = true
port = 55531
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 55532
shadow_port = 55530
major_version = 17
health_timeout = "3m"
[db.seed]
enabled = false
[db.pooler]
enabled = false
port = 55539
[realtime]
enabled = false
[studio]
enabled = false
port = 55533
[local_smtp]
enabled = true
port = 55534
[storage]
enabled = true
file_size_limit = "50MiB"
[storage.vector]
enabled = false
[auth]
enabled = true
site_url = "${local.app}"
additional_redirect_urls = ["${local.app}"]
jwt_expiry = 3600
enable_signup = false
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
  docker(['network', 'create', '--label', `publisher.local=${project}`, '-o', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', network]);
  writeFileSync(manifestPath, JSON.stringify({ dir, project, network, api: local.api, app: local.app, mail: local.mail }, null, 2), { mode: 0o600 });
}
try {
  const output = execFileSync(cli, ['start', '--workdir', dir, '--network-id', network, '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(dir, 'startup.private.log'), output, { mode: 0o600 });
} catch (error) {
  writeFileSync(join(dir, 'startup.private.log'), String(error.stdout || '') + String(error.stderr || ''), { mode: 0o600 });
  throw new Error(`Local start failed; see ${dir}/startup.private.log`);
}
const ids = docker(['ps', '--filter', `label=com.supabase.cli.project=${project}`, '--format', '{{.ID}}']).trim().split('\n').filter(Boolean);
assert.ok(ids.length, 'Owned containers required');
for (const container of JSON.parse(docker(['inspect', ...ids]))) {
  for (const ports of Object.values(container.NetworkSettings.Ports || {})) for (const port of ports || []) assert.equal(port.HostIp, '127.0.0.1');
  assert.ok(container.NetworkSettings.Networks[network]);
}
const file = join(dir, 'local-status.private.json');
const priorStatus = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const status = { ...priorStatus, ...JSON.parse(execFileSync(cli, ['status', '--workdir', dir, '--output', 'json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) };
assertPublisherLocalTarget(status);
writeFileSync(file, JSON.stringify(status), { mode: 0o600 }); chmodSync(file, 0o600);
console.log(JSON.stringify({ status: 'ready', directory: dir, api: local.api, app: local.app, network, containers: ids.length, productionAccess: false }));
