/** Narrow, round-trip-verified patch against the published Tasks candidate.
 * Does not stage, commit, push, archive, or change a Git worktree/index.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repo = process.cwd();
const candidate = '/private/tmp/oar-tasks-direct-candidate';
const manifest = JSON.parse(readFileSync(join(candidate, '.tasks-candidate.json'), 'utf8'));
const base = manifest.base;
assert.equal(base, 'aeadd4c6999755001da34f60f85a028be30e59ca');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const path of manifest.paths) {
  assert.equal(hash(readFileSync(join(repo, path))), manifest.hashes[path], 'Unexported local change: ' + path);
  assert.equal(hash(readFileSync(join(candidate, path))), manifest.hashes[path], 'Candidate mismatch: ' + path);
}
const originalSql = 'supabase/migrations/20261006202942_canonical_private_tasks.sql';
assert.deepEqual(readFileSync(join(repo, originalSql)), execFileSync('git', ['show', `${base}:${originalSql}`], { cwd: repo }));
const paths = [...new Set([...manifest.paths, 'tests/tasks/direct-diff.mjs', 'docs/tasks/direct-assignment/REVIEW.txt', 'docs/tasks/direct-assignment/VALIDATION.json'])].sort();
assert.ok(paths.every(path => /^(components\/(TasksWorkspace|TaskIdentityAdministration)\.tsx|lib\/tasks\/types\.ts|supabase\/migrations\/20261007132122_tasks_direct_account_assignment\.sql|tests\/tasks\/direct-[a-z-]+\.mjs|docs\/tasks\/direct-assignment\/(REVIEW\.txt|VALIDATION\.json))$/.test(path)));
const proof = mkdtempSync('/private/tmp/oar-tasks-direct-diff-');
for (const tree of ['a', 'b', 'applied']) mkdirSync(join(proof, tree), { mode: 0o700 });
for (const path of paths) {
  assert.ok(existsSync(join(repo, path)), 'Missing deliverable: ' + path);
  mkdirSync(dirname(join(proof, 'b', path)), { recursive: true });
  cpSync(join(repo, path), join(proof, 'b', path));
  const listed = execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', path], { cwd: repo, encoding: 'utf8' }).trim();
  if (listed) {
    assert.equal(listed, path);
    const before = execFileSync('git', ['show', `${base}:${path}`], { cwd: repo });
    for (const tree of ['a', 'applied']) {
      mkdirSync(dirname(join(proof, tree, path)), { recursive: true });
      writeFileSync(join(proof, tree, path), before);
    }
  }
}
let patch;
try { patch = execFileSync('git', ['diff', '--no-index', '--no-ext-diff', '--binary', '--', 'a', 'b'], { cwd: proof, encoding: 'utf8' }); }
catch (error) { assert.equal(error.status, 1); patch = error.stdout; }
patch = patch.replace(/^diff --git a\/[ab]\/(.+) b\/b\/(.+)$/gm, 'diff --git a/$1 b/$2')
  .replace(/^--- a\/[ab]\//gm, '--- a/').replace(/^\+\+\+ b\/b\//gm, '+++ b/');
const patchPath = join(repo, 'docs/tasks/direct-assignment/implementation.diff');
mkdirSync(dirname(patchPath), { recursive: true });
writeFileSync(patchPath, patch);
execFileSync('git', ['apply', '--check', '--whitespace=error', patchPath], { cwd: join(proof, 'applied') });
execFileSync('git', ['apply', patchPath], { cwd: join(proof, 'applied') });
for (const path of paths) assert.deepEqual(readFileSync(join(proof, 'applied', path)), readFileSync(join(repo, path)), 'Patch round trip: ' + path);
const changed = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map(match => { assert.equal(match[1], match[2]); return match[1]; });
assert.ok(changed.length > 0 && changed.every(path => paths.includes(path)));
const receipt = { base, patchPath, sha256: hash(patch), changedPaths: changed, roundTrip: true, whitespace: 'PASS', originalMigrationUnchanged: true, gitIndexUntouched: true };
writeFileSync('/private/tmp/oar-tasks-direct-state/diff-result.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
