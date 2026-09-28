// Review artifact only. Never stages, commits, fetches or touches private files.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const destination = 'docs/publisher/integration.diff';
function git(args, diff = false) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.ok(result.status === 0 || (diff && result.status === 1), result.stderr);
  return result.stdout;
}
const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  .filter(file => file !== destination && file !== 'tsconfig.tsbuildinfo');
for (const file of untracked) {
  assert.ok(/^(app\/(api\/publisher|publisher)\/|components\/publisher\/|lib\/publisher\/|docs\/publisher\/|tests\/publisher\/|supabase\/migrations\/.*publisher)/.test(file), `Unexpected untracked file: ${file}`);
  assert.equal(/\.env|WIF|private\.json|private\.log/.test(file), false, 'Private configuration must not be included');
}
let patch = git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', '.', ':!GOOGLE_DRIVE_WIF_SETUP.local.md', `:!${destination}`]);
for (const file of untracked.sort()) patch += git(['diff', '--no-index', '--binary', '--no-ext-diff', '--', '/dev/null', file], true);
writeFileSync(destination, patch);
console.log(JSON.stringify({ diff: destination, bytes: Buffer.byteLength(patch), untrackedIncluded: untracked.length, staging: false }));
