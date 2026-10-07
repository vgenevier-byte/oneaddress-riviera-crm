/** Source-identical actual CRM; adds only a private fictional profile launcher.
 * Never loads repo .env, credentials, Google transport, or a hosted project.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, chmodSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { assertAdminSimplificationTarget as assertTasksTarget } from './admin-simplification-target.mjs';

if (!process.env.TASKS_STATUS_FILE || !process.env.TASKS_FIXTURE_FILE) throw new Error('Explicit disposable status and fixture required');
const repo = process.cwd(), status = JSON.parse(readFileSync(process.env.TASKS_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.TASKS_FIXTURE_FILE, 'utf8'));
assertTasksTarget({ api: status.API_URL, database: status.DB_URL, acknowledgement: process.env.TASKS_TEST_ACK });
const reviewMode = process.env.TASKS_REVIEW_MODE === '1';
const sourceRoot = resolve(process.env.TASKS_SOURCE_ROOT || repo);
let candidateProof;
if (reviewMode) {
  assert.ok(process.env.TASKS_SOURCE_ROOT, 'Review requires an explicit clean candidate source root');
  assert.notEqual(realpathSync(sourceRoot), realpathSync('/Users/vg/Desktop/OARcrm-repo'), 'The dirty checkout cannot be the review candidate');
  assert.match(process.env.TASKS_CANDIDATE_BASE_SHA || '', /^[a-f0-9]{40}$/, 'Explicit published candidate base SHA required');
  assert.ok(existsSync(join(sourceRoot, 'supabase/migrations/20261006202942_canonical_private_tasks.sql')), 'Review candidate must contain its exact local task migration');
  candidateProof = JSON.parse(readFileSync(join(sourceRoot, '.tasks-candidate.json'), 'utf8'));
  assert.equal(candidateProof.base, process.env.TASKS_CANDIDATE_BASE_SHA, 'Candidate matches the separately verified published base');
  assert.equal(candidateProof.contactsDriveExcluded, true, 'Separate Contacts → Drive work must be excluded');
}
const directory = mkdtempSync(join(tmpdir(), 'oar-tasks-demo-')); chmodSync(directory, 0o700);
const sourceFiles = [];
for (const folder of ['app', 'components', 'lib', 'public']) cpSync(join(sourceRoot, folder), join(directory, folder), { recursive: true, filter: path => !basename(path).startsWith('.env') && !basename(path).includes('.before-') });
const configFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', 'eslint.config.mjs'];
for (const file of configFiles) if (existsSync(join(sourceRoot, file))) cpSync(join(sourceRoot, file), join(directory, file));
symlinkSync(join(repo, 'node_modules'), join(directory, 'node_modules'), 'dir');
function collect(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) collect(file); else sourceFiles.push({ path: relative(directory, file), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }); } }
for (const folder of ['app', 'components', 'lib']) collect(join(directory, folder));
if (reviewMode) {
  collect(join(directory, 'public'));
  // Next rewrites this generated compiler declaration during build. Product
  // source fingerprints remain exact; record that declaration separately.
  for (const file of configFiles.filter(file => file !== 'next-env.d.ts')) if (existsSync(join(directory, file))) sourceFiles.push({ path: file, sha256: createHash('sha256').update(readFileSync(join(directory, file))).digest('hex') });
  const migrations = ['supabase/migrations/20261006202942_canonical_private_tasks.sql','supabase/migrations/20261007132122_tasks_direct_account_assignment.sql','supabase/migrations/20261007171153_tasks_admin_history_pagination.sql'];
  mkdirSync(join(directory, 'supabase/migrations'), { recursive: true });
  for (const migration of migrations) {
    cpSync(join(sourceRoot, migration), join(directory, migration));
    sourceFiles.push({ path: migration, sha256: createHash('sha256').update(readFileSync(join(directory, migration))).digest('hex') });
  }
  for (const entry of sourceFiles) {
    assert.equal(createHash('sha256').update(readFileSync(join(sourceRoot, entry.path))).digest('hex'), entry.sha256, 'Candidate copied exactly: ' + entry.path);
    if (candidateProof.hashes[entry.path]) assert.equal(entry.sha256, candidateProof.hashes[entry.path], 'Candidate integration proof: ' + entry.path);
  }
}
sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
const profiles = Object.entries(fixture.users).filter(([name]) => ['creator', 'contributor', 'reader', 'fullOther', 'noTasks'].includes(name)).map(([name, user]) => ({ name, label: user.label, email: user.email, password: user.password }));
assert.equal(profiles.length, 5);
for (const user of profiles) assert.ok(user.email.endsWith('@example.invalid'));
mkdirSync(join(directory, 'app/demo'), { recursive: true });
writeFileSync(join(directory, 'app/demo/page.tsx'), `"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
const profiles=${JSON.stringify(profiles)};
export default function Demo(){ const[message,setMessage]=useState(""); const[busy,setBusy]=useState(false); return <main style={{maxWidth:900,margin:"40px auto",padding:24}}><h1>Démonstration locale Tâches</h1><p>Profils fictifs indépendants. Ouvrez un profil dans une fenêtre privée distincte pour comparer les tâches visibles. Aucune donnée réelle.</p><p>Le créateur voit ses tâches. Les responsables concernés voient la même tâche. Le lecteur consulte. Le compte complet tiers ne bénéficie d’aucune supervision globale.</p><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))",gap:16}}>{profiles.map(p=><section key={p.name} style={{border:"1px solid #ddd",borderRadius:12,padding:20}}><h2>{p.label}</h2><button disabled={busy} onClick={async()=>{setBusy(true);setMessage("");await supabase.auth.signOut();const r=await supabase.auth.signInWithPassword({email:p.email,password:p.password});if(r.error){setMessage("Connexion locale refusée");setBusy(false);}else window.location.assign("/?module=tasks");}}>Ouvrir ce profil</button></section>)}</div>{message&&<p role="status">{message}</p>}<p>Annuaire, mutations et confidentialité utilisent Auth et les RPC Supabase du banc local. La base et les fichiers conservés sont exclusivement fictifs.</p></main>; }
`, { mode: 0o600 });
const guard = join(directory, 'tasks-network-guard.cjs'); cpSync(join(repo, 'tests/tasks/admin-simplification-network-guard.cjs'), guard);
const manifestFile = resolve(process.env.TASKS_APP_MANIFEST || '/private/tmp/oar-tasks-demo-manifest.json');
const manifest = { directory, sourceRoot, reviewMode, candidateBaseSHA: reviewMode ? process.env.TASKS_CANDIDATE_BASE_SHA : null, app: 'http://127.0.0.1:3200', sourceFiles, status: 'building', isolatedLauncher: 'app/demo/page.tsx only', actualLocalAuth: true, applicationSourcesModified: false, externalCalls: 0, buildLog: join(directory, 'build.log'), serverLog: join(directory, 'server.log') };
if (candidateProof) manifest.candidateProof = { base: candidateProof.base, deploymentId: candidateProof.deploymentId, contactsDriveExcluded: candidateProof.contactsDriveExcluded };
if (reviewMode && existsSync(join(directory, 'next-env.d.ts'))) manifest.buildGeneratedTypes = { path: 'next-env.d.ts', candidateSHA256: createHash('sha256').update(readFileSync(join(directory, 'next-env.d.ts'))).digest('hex') };
const saveManifest = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 }); saveManifest();
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--require=${guard}`, NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY, TASKS_TEST_ACK: process.env.TASKS_TEST_ACK };
let child;
function launch(args, log) { child = spawn(process.execPath, [join(repo, 'node_modules/next/dist/bin/next'), ...args], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += String(chunk); writeFileSync(log, output.replaceAll(status.ANON_KEY, '[LOCAL PUBLIC KEY]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]'), { mode: 0o600 }); }); return new Promise((res, reject) => { child.on('error', reject); child.on('exit', code => res(code)); }); }
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child?.kill(signal));
if (await launch(['build', '--webpack'], manifest.buildLog)) { manifest.status = 'build-failed'; saveManifest(); throw new Error('Build failed: ' + manifest.buildLog); }
if (manifest.buildGeneratedTypes) manifest.buildGeneratedTypes.builtSHA256 = createHash('sha256').update(readFileSync(join(directory, 'next-env.d.ts'))).digest('hex');
manifest.status = 'starting'; saveManifest();
const stopped = launch(['start', '--hostname', '127.0.0.1', '--port', '3200'], manifest.serverLog);
for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(manifest.app + '/demo', { signal: AbortSignal.timeout(1000) })).ok) { manifest.status = 'ready'; manifest.serverPID = child.pid; saveManifest(); console.log('READY ' + manifest.app + '/demo'); break; } } catch {} if (child.exitCode !== null) break; await new Promise(r => setTimeout(r, 200)); }
if (manifest.status !== 'ready') { child.kill('SIGTERM'); throw new Error('Local demo startup failed'); }
await stopped; manifest.status = 'stopped'; saveManifest();
