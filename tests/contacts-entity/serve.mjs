/** Exact candidate UI, disposable launcher and real LOCAL GoTrue/PostgREST/PG.
 * No .env is loaded or copied. The bench JSON must contain fictional accounts
 * and a LOCAL public API key only. No successful Auth/RPC response is simulated.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, chmodSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
const sourceRoot = resolve(process.env.CONTACTS_ENTITY_SOURCE || '');
assert.ok(process.env.CONTACTS_ENTITY_SOURCE, 'Explicit isolated candidate source required');
assert.notEqual(sourceRoot, resolve('/Users/vg/Desktop/OARcrm-repo'), 'The shared dirty checkout cannot be the bench source');
const benchPath = resolve(process.env.CONTACTS_ENTITY_BENCH || '');
assert.ok(process.env.CONTACTS_ENTITY_BENCH, 'Explicit local bench JSON required');
assert.equal(statSync(benchPath).mode & 0o077, 0, 'Local credentials file must be private');
const bench = JSON.parse(readFileSync(benchPath, 'utf8'));
const backend = new URL(bench.origin);
assert.equal(backend.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost'].includes(backend.hostname), 'Only real localhost bench accepted');
assert.ok(!backend.username && !backend.password && backend.port);
assert.ok(bench.publishableKey && bench.accounts?.owner && bench.accounts?.contributor, 'Local public key and accounts required');
if (bench.publishableKey.split('.').length === 3) assert.equal(JSON.parse(Buffer.from(bench.publishableKey.split('.')[1], 'base64url')).role, 'anon', 'Only the local anonymous public API key may enter the browser');
const profiles = ['owner', 'contributor', 'reader', 'none', 'revoked', 'leadsContributor'].filter(key => bench.accounts[key]);
const accounts = Object.fromEntries(profiles.map(key => {
  const account = bench.accounts[key];
  assert.ok(account.email && account.password && /(@example\.invalid|@[^@]*\.test|@[^@]*\.invalid)$/.test(account.email), 'Only fictional local emails may be embedded');
  return [key, { email: account.email, password: account.password }];
}));
const production = process.env.CONTACTS_ENTITY_DEMO_MODE !== 'development';
const port = Number(process.env.CONTACTS_ENTITY_PORT || 3399);
const nextPort = port + 1;
const directory = mkdtempSync(join(tmpdir(), 'oar-contacts-entity-demo-'));
chmodSync(directory, 0o700);
symlinkSync(join(sourceRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
const manifestPath = resolve(process.env.CONTACTS_ENTITY_MANIFEST || join(dirname(sourceRoot), 'evidence/demo-manifest.json'));
mkdirSync(dirname(manifestPath), { recursive: true });
const manifest = { directory, sourceRoot, app: `http://127.0.0.1:${port}`, demo: `http://127.0.0.1:${port}/contacts-entity-demo`, backend: backend.origin, status: 'preparing', mode: production ? 'production' : 'development', sourceFiles: [], applicationSourcesModified: false, isolatedLauncher: 'app/contacts-entity-demo/page.tsx', authentication: 'real LOCAL GoTrue password login', database: 'real LOCAL PostgREST and PostgreSQL RPC; fictional records only', productionSession: false, buildLog: join(dirname(manifestPath), 'demo-build.log'), serverLog: join(dirname(manifestPath), 'demo-server.log'), blockedAPIAttempts: [] };
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
function copySources() {
  for (const folder of ['app', 'components', 'lib', 'public']) cpSync(join(sourceRoot, folder), join(directory, folder), { recursive: true, filter: path => !basename(path).startsWith('.env') && !basename(path).includes('.before-') });
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', 'eslint.config.mjs']) if (existsSync(join(sourceRoot, file))) cpSync(join(sourceRoot, file), join(directory, file));
  const sourceFiles = [];
  function collect(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.name.startsWith('.env') || entry.name.includes('.before-')) continue; if (entry.isDirectory()) collect(file); else sourceFiles.push({ path: relative(sourceRoot, file), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }); } }
  for (const folder of ['app', 'components', 'lib']) collect(join(sourceRoot, folder));
  manifest.sourceFiles = sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
  manifest.syncedAt = new Date().toISOString();
  const launcher = `"use client";
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import LanguageSelector from '@/components/LanguageSelector';
import {useI18n} from '@/lib/i18n/I18nProvider';
const accounts=${JSON.stringify(accounts)};
const labels:Record<string,{fr:string,en:string}>={owner:{fr:'Propriétaire fictif',en:'Fictional owner'},contributor:{fr:'Contributeur limité fictif',en:'Fictional limited contributor'},reader:{fr:'Lecture seule',en:'Read only'},none:{fr:'Sans droit Contacts',en:'No Contacts permission'},revoked:{fr:'Compte pour révocation locale',en:'Account for local revocation'},leadsContributor:{fr:'Demandes : contribution / Contacts : lecture',en:'Leads: contribute / Contacts: read'}};
export default function LocalDemo(){const{language}=useI18n();const[busy,setBusy]=useState(false),[message,setMessage]=useState('');return <main style={{maxWidth:850,margin:'40px auto',padding:24,lineHeight:1.6,overflowWrap:'anywhere'}}><LanguageSelector/><h1>{language==='en'?'Contacts — Person / Company':'Contacts — Personne / Entreprise'}</h1><p>{language==='en'?'Integrated candidate with fictional accounts and records in an isolated local database. Sign-in uses real local Auth; saves and reloads use real local PostgREST/RPC. No Production account or record is used.':'Candidat intégré avec comptes et fiches fictifs dans une base locale isolée. La connexion utilise le vrai Auth local ; les sauvegardes et relectures utilisent le vrai PostgREST/RPC local. Aucun compte ni contact Production n’est utilisé.'}</p><p>{language==='en'?'Choose a profile. Saved fictional records persist in this local bench. Use a private window to compare profiles.':'Choisissez un profil. Les fiches fictives enregistrées persistent dans ce banc local. Utilisez une fenêtre privée pour comparer les profils.'}</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>{Object.entries(accounts).map(([profile,account])=><button type="button" key={profile} data-local-profile={profile} disabled={busy} style={{minHeight:48,padding:12}} onClick={async()=>{if(!['127.0.0.1','localhost'].includes(location.hostname)){setMessage('Localhost required');return;}setBusy(true);setMessage('');await supabase.auth.signOut();const r=await supabase.auth.signInWithPassword(account);if(r.error){setMessage(language==='en'?'Local sign-in unavailable.':'Connexion locale indisponible.');setBusy(false);}else location.assign(profile==='leadsContributor'?'/?module=leads':'/?module=contacts');}}>{labels[profile]?.[language]||profile}</button>)}</div>{message&&<p role="alert">{message}</p>}<p><a href="/">{language==='en'?'Open CRM sign-in':'Ouvrir la connexion CRM'}</a></p></main>;}`;
  mkdirSync(join(directory, 'app/contacts-entity-demo'), { recursive: true });
  writeFileSync(join(directory, 'app/contacts-entity-demo/page.tsx'), launcher);
  save();
}
copySources();
const proxy = http.createServer((req, res) => {
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) { res.writeHead(403); res.end('Localhost only'); return; }
  if (req.url.startsWith('/api/')) { manifest.blockedAPIAttempts.push({ method: req.method, path: req.url, at: new Date().toISOString() }); save(); res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: 'External integrations are disabled in the local Contacts bench.' })); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: nextPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
  upstream.on('error', () => { res.writeHead(503); res.end('Local app starting'); }); req.pipe(upstream);
});
proxy.on('upgrade', (req, socket, head) => { const upstream = net.connect(nextPort, '127.0.0.1', () => { const headers = { ...req.headers, host: `127.0.0.1:${port}` }; upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); }); upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy()); });
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', NODE_ENV: production ? 'production' : 'development', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--require=' + join(sourceRoot, 'tests/contacts-entity/network-guard.cjs'), CONTACTS_ENTITY_ALLOWED_PORTS: [port, nextPort, Number(backend.port)].join(','), NEXT_PUBLIC_SUPABASE_URL: backend.origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bench.publishableKey };
let child;
function launch(args, path) { child = spawn(process.execPath, [join(sourceRoot, 'node_modules/next/dist/bin/next'), ...args], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; writeFileSync(path, log); }); return child; }
if (production) { manifest.status = 'building'; save(); launch(['build', '--webpack'], manifest.buildLog); const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); if (code !== 0) { manifest.status = 'build-failed'; save(); throw new Error('Local candidate build failed; see ' + manifest.buildLog); } launch(['start', '--hostname', '127.0.0.1', '--port', String(nextPort)], manifest.serverLog); }
else launch(['dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(nextPort)], manifest.serverLog);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child?.kill(signal); proxy.close(); });
process.on('SIGHUP', () => { if (production) { console.log('Fixed production snapshot; restart to rebuild.'); return; } copySources(); console.log('SYNC ' + manifest.syncedAt); });
await new Promise(r => proxy.listen(port, '127.0.0.1', r));
for (let i = 0; i < 120; i++) { try { if ((await fetch(manifest.demo, { signal: AbortSignal.timeout(1000) })).ok) { manifest.status = 'ready'; manifest.serverPID = child.pid; manifest.proxyPID = process.pid; save(); console.log('READY ' + manifest.demo); break; } } catch { /* Child is still starting. */ } await new Promise(r => setTimeout(r, 250)); }
if (manifest.status !== 'ready') { child.kill('SIGTERM'); throw new Error('Local app startup failed'); }
await new Promise(resolve => child.on('exit', resolve)); manifest.status = 'stopped'; save(); proxy.close();
