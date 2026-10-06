/** Local review server: source copy, real local Auth/REST/Storage, no repository
 * env or external credentials. Google alone uses the retained fictional adapter.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { assertLocalTarget } from '../izord/local-target.mjs';

assert.equal(process.env.IZORD_TEST_ACK, 'IZORD_DISPOSABLE_LOCAL_ONLY');
assert.ok(process.env.LOCAL_STATUS_FILE, 'Existing fictional local bench required');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
assertLocalTarget({ api: status.API_URL, database: status.DB_URL,
  app: 'http://127.0.0.1:3159', mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
const repo = process.cwd(), directory = mkdtempSync(join(tmpdir(), 'oar-contact-evolution-'));
const app = 'http://127.0.0.1:3190';
const manifestPath = process.env.CONTACT_EVOLUTION_MANIFEST || join(directory, 'manifest.private.json');
for (const folder of ['app','components','lib','public']) cpSync(join(repo, folder), join(directory, folder), {
  recursive: true, filter: source => !basename(source).startsWith('.env') && !basename(source).includes('.before-') && !basename(source).includes('.backup')
});
for (const file of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','eslint.config.mjs']) {
  if (existsSync(join(repo, file))) cpSync(join(repo, file), join(directory, file));
}
symlinkSync(join(repo, 'node_modules'), join(directory, 'node_modules'), 'dir');
cpSync(join(repo, 'tests/izord/google-transport-fixture.ts'), join(directory, 'app/api/drive/_localGoogleFixture.ts'));
const utilsPath = join(directory, 'app/api/drive/_utils.ts');
const original = readFileSync(utilsPath, 'utf8');
const start = original.indexOf('export function createGoogleDriveFetch(');
const end = original.indexOf('\nasync function verifySupabaseAccessToken(', start);
assert.ok(start > 0 && end > start);
writeFileSync(utilsPath, 'import { createFixtureGoogleDriveFetch } from "./_localGoogleFixture";\n' +
  original.slice(0,start) + 'export function createGoogleDriveFetch(): DriveFetch { return createFixtureGoogleDriveFetch(); }\n' + original.slice(end));
const guard = join(directory, 'network-guard.cjs');
writeFileSync(guard, readFileSync(join(repo, 'tests/izord/local-network-guard.cjs'), 'utf8')
  .replace('new Set([3159, 55431])','new Set([3190, 55431])'), {mode:0o600});
const trace = join(directory, 'google.private.jsonl');
writeFileSync(trace, '', {mode:0o600});
const env = {PATH:process.env.PATH, TMPDIR:process.env.TMPDIR, LANG:'fr_FR.UTF-8', NODE_ENV:'production',
  NEXT_TELEMETRY_DISABLED:'1', NODE_OPTIONS:`--require=${guard}`, IZORD_TEST_ACK:process.env.IZORD_TEST_ACK,
  NEXT_PUBLIC_SUPABASE_URL:new URL(status.API_URL).origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY,
  LOCAL_AUTH_INVITE_KEY:status.SERVICE_ROLE_KEY, IZORD_GOOGLE_TRACE_FILE:trace,
  GCP_PROJECT_ID:'fictional-local-project', GCP_SERVICE_ACCOUNT_EMAIL:'fixture@fictional-local-project.iam.gserviceaccount.com',
  GOOGLE_DRIVE_SHARED_DRIVE_ID:'fixture-shared-drive', GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID:'fixture-documents-root',
  GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID:'fixture-vendors-root'};
const manifest = {app,directory,status:'building',launcherPID:process.pid,serverPID:null,
  buildLog:join(directory,'build.private.log'),serverLog:join(directory,'server.private.log'),
  sourceFiles:[],google:'fictional transport only',auth:'real local Auth/RPC/Storage',egress:'loopback only'};
for (const file of ['app/globals.css','components/CRMApp.tsx','components/ModuleWorkspace.tsx','components/ScopedDocuments.tsx',
  'components/ContactDocuments.tsx','components/ContactDocuments.module.css','lib/access/collections.json',
  'lib/contactDocuments.ts','lib/contactEditing.ts','lib/types.ts','lib/vendorContacts.ts',
  'app/api/contact-documents/file/route.ts','app/api/contact-documents/file/handler.ts',
  'app/api/drive/vendor-bank-accounts/upload/handler.ts']) if(existsSync(join(directory,file))) {
  manifest.sourceFiles.push({path:file,sha256:createHash('sha256').update(readFileSync(join(directory,file))).digest('hex')});
}
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest,null,2), {mode:0o600});
const sanitize = value => String(value).replaceAll(status.SERVICE_ROLE_KEY,'[LOCAL SERVER KEY]').replaceAll(status.ANON_KEY,'[LOCAL PUBLIC KEY]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT]');
let child;
function launch(args,log){
  child=spawn(process.execPath,[join(repo,'node_modules/next/dist/bin/next'),...args],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
  let output='';
  for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{output+=String(chunk);writeFileSync(log,sanitize(output),{mode:0o600});});
  return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child?.kill(signal));
save();
const built=await launch(['build','--webpack'],manifest.buildLog);
if(built.code){manifest.status='build-failed';save();throw new Error('Isolated build failed: '+manifest.buildLog);}
const running=launch(['start','--hostname','127.0.0.1','--port','3190'],manifest.serverLog);
manifest.serverPID=child.pid;manifest.status='starting';save();
for(let i=0;i<100;i++){
  try{const response=await fetch(app,{signal:AbortSignal.timeout(1000)});if(response.ok){manifest.status='ready';save();break;}}catch{/* Starting */}
  if(child.exitCode!==null)break;
  await new Promise(resolve=>setTimeout(resolve,300));
}
assert.equal(manifest.status,'ready','Review server must start');
console.log(JSON.stringify({ready:true,app,manifestPath,build:'passed',environment:'fictional local only'}));
const result=await running;manifest.status='stopped';manifest.serverPID=null;save();process.exitCode=result.code||0;
