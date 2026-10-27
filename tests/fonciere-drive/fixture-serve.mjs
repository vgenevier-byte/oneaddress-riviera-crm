/** Source-identical components and deliberate client doubles; no credentials or business persistence. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
const root = resolve(process.cwd()), fixture = mkdtempSync(join(tmpdir(), 'fonciere-number-ui-')), files = new Set();
const output = '/private/tmp/fonciere-number-ui-evidence'; mkdirSync(output, { recursive: true });
function copy(relative) {
 if (files.has(relative)) return; files.add(relative);
 const source=join(root,relative), target=join(fixture,relative); mkdirSync(dirname(target),{recursive:true}); cpSync(source,target);
 if(!/\.(?:tsx?|jsx?)$/.test(relative))return;
 for(const match of readFileSync(source,'utf8').matchAll(/(?:from\s*|import\s*|import\s*\()["']([^"']+)["']/g)) { const spec=match[1]; if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue; const base=spec.startsWith('@/')?spec.slice(2):join(dirname(relative),spec); const found=[base,...['.ts','.tsx','.js','.mjs','.json','.css'].map(ext=>base+ext),join(base,'index.ts'),join(base,'index.tsx')].find(path=>existsSync(join(root,path)));if(found)copy(found); }
}
for(const file of ['components/fonciere/ProjectsWorkspace.tsx','components/fonciere/ProjectSourcePicker.tsx','components/AccessAdministration.tsx','components/TaskLinks.tsx','lib/i18n/I18nProvider.tsx','app/globals.css']) copy(file);
for(const file of ['package.json','package-lock.json','tsconfig.json'])cpSync(join(root,file),join(fixture,file));
symlinkSync(join(root,'node_modules'),join(fixture,'node_modules'),'dir');mkdirSync(join(fixture,'app'),{recursive:true});
cpSync(join(root,'tests/fonciere-drive/fixture-page.tsx.template'),join(fixture,'app/page.tsx'));
cpSync(join(root,'tests/fonciere-drive/fixture-client.ts.template'),join(fixture,'lib/fonciere/fixtureClient.ts'));
cpSync(join(root,'tests/fonciere-drive/fixture-operations.tsx.template'),join(fixture,'lib/access/operations.tsx'));
writeFileSync(join(fixture,'app/layout.tsx'),'import "./globals.css";import "./fixture.css";export default function Layout({children}:{children:React.ReactNode}){return <html lang="fr"><body>{children}</body></html>;}');
writeFileSync(join(fixture,'app/fixture.css'),'main{max-width:1320px;margin:auto;padding:16px;min-width:0}main>[data-fixture-nav]{position:static!important;background:#f7f8f4!important;height:auto!important;display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px;min-height:0;background:#f7f8f4;padding:10px;border-radius:8px}main>[data-fixture-nav] p{flex-basis:100%;font-size:12px}main>[data-fixture-nav] button{min-height:40px;padding:8px 12px}');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest={url:'http://127.0.0.1:3229',directory:fixture,status:'starting',files:[...files].filter(file=>file!=='lib/access/operations.tsx').map(path=>({path,sha256:hash(join(fixture,path))})),doubles:['lib/access/operations.tsx','lib/fonciere/fixtureClient.ts'],fictionalData:true,actualAuth:false,actualRPC:false,actualDatabase:false,actualDrive:false,persistence:'none'};
const save=()=>writeFileSync(join(output,'fixture-manifest.json'),JSON.stringify(manifest,null,2));save();
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3229'],{cwd:fixture,env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fictional-public-key'},stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>process.stdout.write(chunk));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
for(let attempt=0;attempt<150;attempt++){if(child.exitCode!==null)throw Error('Fixture exited '+child.exitCode);try{if((await fetch(manifest.url,{signal:AbortSignal.timeout(2000)})).ok){manifest.status='ready';save();console.log('READY '+manifest.url);break;}}catch{}await new Promise(done=>setTimeout(done,300));}
await new Promise(done=>child.on('exit',done));
