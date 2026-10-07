/** Reuse the existing source-identical launcher on a second exact loopback port. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const state = '/private/tmp/oar-tasks-direct-state';
const repo = process.cwd();
let source = readFileSync(new URL('./serve.mjs', import.meta.url), 'utf8');
function replaceOnce(from, to) {
  assert.equal(source.split(from).length, 2, 'Launcher contract changed: ' + from);
  source = source.replace(from, to);
}
replaceOnce("import { assertTasksTarget } from './local-target.mjs';", `import { assertDirectTasksTarget as assertTasksTarget } from ${JSON.stringify(new URL('./direct-local-target.mjs', import.meta.url).href)};`);
source = source.replaceAll('http://127.0.0.1:3197', 'http://127.0.0.1:3198');
replaceOnce("'--port', '3197'", "'--port', '3198'");
const guard = readFileSync(new URL('./network-guard.cjs', import.meta.url), 'utf8');
assert.equal(guard.split('new Set([3197, 55731])').length, 2);
const guardFile = join(state, 'direct-network-guard.cjs');
writeFileSync(guardFile, guard.replace('new Set([3197, 55731])', 'new Set([3198, 55731])'), { mode: 0o600 });
replaceOnce("join(repo, 'tests/tasks/network-guard.cjs')", JSON.stringify(guardFile));
const migration = 'supabase/migrations/20261007132122_tasks_direct_account_assignment.sql';
replaceOnce('const sourceFiles = [];', `const sourceFiles = [];
mkdirSync(join(directory, 'supabase/migrations'), { recursive: true });
cpSync(join(sourceRoot, ${JSON.stringify(migration)}), join(directory, ${JSON.stringify(migration)}));
sourceFiles.push({path:${JSON.stringify(migration)},sha256:createHash('sha256').update(readFileSync(join(directory,${JSON.stringify(migration)}))).digest('hex')});`);
assert.ok(process.env.TASKS_SOURCE_ROOT?.endsWith('/oar-tasks-direct-candidate'));
assert.equal(process.env.TASKS_APP_MANIFEST, join(state, 'demo-manifest.json'));
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
