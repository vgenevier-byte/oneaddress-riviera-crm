/** Exact published baseline plus named local Tasks changes; no Git mutations. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const repo = process.cwd();
const state = '/private/tmp/oar-tasks-direct-state';
const candidate = '/private/tmp/oar-tasks-direct-candidate';
const metadata = JSON.parse(readFileSync(join(state, 'published-base.json'), 'utf8'));
const base = metadata.gitCommitSha;
assert.equal(base, 'aeadd4c6999755001da34f60f85a028be30e59ca');
assert.equal(metadata.readyState, 'READY');
assert.equal(metadata.target, 'production');
mkdirSync(candidate, { recursive: true });
const env = { ...process.env, GIT_INDEX_FILE: join(state, 'export.index') };
execFileSync('git', ['read-tree', base], { cwd: repo, env });
execFileSync('git', ['checkout-index', '--all', '--force', `--prefix=${candidate}/`], { cwd: repo, env });
const paths = [
  'components/TasksWorkspace.tsx', 'components/TaskIdentityAdministration.tsx', 'lib/tasks/types.ts',
  'supabase/migrations/20261007132122_tasks_direct_account_assignment.sql',
  'tests/tasks/direct-local-target.mjs', 'tests/tasks/direct-candidate.mjs', 'tests/tasks/direct-serve.mjs'
];
for (const test of ['tests/tasks/direct-assignment-database.mjs', 'tests/tasks/direct-assignment-browser.mjs']) {
  if (process.env.TASKS_DIRECT_REQUIRE_TESTS === '1') assert.ok(existsSync(join(repo, test)), 'Missing final test: ' + test);
  if (existsSync(join(repo, test))) paths.push(test);
}
for (const path of paths) {
  assert.ok(existsSync(join(repo, path)), 'Missing final source: ' + path);
  mkdirSync(dirname(join(candidate, path)), { recursive: true });
  cpSync(join(repo, path), join(candidate, path));
}
const publishedFiles = ['components/GoogleDriveDiagnostic.tsx', 'components/GoogleDriveDiagnostic.module.css', 'components/PasswordInput.tsx', 'components/PasswordInput.module.css', 'lib/googleDriveDiagnostic.ts', 'app/api/drive/diagnostic/handler.ts', 'lib/server/contactDriveDiagnostic.ts'];
for (const path of publishedFiles) assert.deepEqual(readFileSync(join(candidate, path)), execFileSync('git', ['show', `${base}:${path}`], { cwd: repo }));
const originalSql = 'supabase/migrations/20261006202942_canonical_private_tasks.sql';
assert.deepEqual(readFileSync(join(candidate, originalSql)), execFileSync('git', ['show', `${base}:${originalSql}`], { cwd: repo }));
for (const path of ['supabase/migrations/20261006184902_contact_private_drive_catalogue.sql', 'app/api/contact-documents/upload/handler.ts', 'lib/contactDocumentMigration.ts']) assert.equal(existsSync(join(candidate, path)), false);
const hashes = Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(join(candidate, path))).digest('hex')]));
writeFileSync(join(candidate, '.tasks-candidate.json'), JSON.stringify({ base, deploymentId: metadata.id, paths, hashes, contactsDriveExcluded: true, originalMigrationUnchanged: true, publishedFixesExact: true }, null, 2) + '\n');
if (!existsSync(join(candidate, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(candidate, 'node_modules'), 'dir');
console.log(JSON.stringify({ candidate, base, files: paths.length, originalMigrationUnchanged: true, publishedFixesExact: true, contactsDriveExcluded: true }));
