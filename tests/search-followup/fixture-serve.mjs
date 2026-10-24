/** Frozen exact-source integrated fixture. No production routes, credentials or database. */
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const root=resolve(process.env.SEARCH_SOURCE||process.cwd()),fixture=mkdtempSync(join(tmpdir(),'oar-search-followup-browser-')),output=join(root,'docs/search-followup');
mkdirSync(output,{recursive:true});const files=new Set();
function copy(relative){if(files.has(relative))return;files.add(relative);const source=join(root,relative),target=join(fixture,relative);mkdirSync(dirname(target),{recursive:true});cpSync(source,target);if(!/\.(?:tsx?|jsx?)$/.test(relative))return;
 for(const match of readFileSync(source,'utf8').matchAll(/(?:from\s*|import\s*|import\s*\()["']([^"']+)["']/g)){const spec=match[1];if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;const base=spec.startsWith('@/')?spec.slice(2):join(dirname(relative),spec);const found=[base,...['.ts','.tsx','.js','.mjs','.json','.css'].map(ext=>base+ext),join(base,'index.ts'),join(base,'index.tsx')].find(path=>existsSync(join(root,path)));if(found)copy(found);}
}
for(const file of ['components/CRMApp.tsx','components/BusinessPermissions.tsx','lib/i18n/I18nProvider.tsx','app/globals.css','public/brand-pattern.svg'])copy(file);
for(const file of ['package.json','package-lock.json','tsconfig.json'])cpSync(join(root,file),join(fixture,file));
symlinkSync(join(root,'node_modules'),join(fixture,'node_modules'),'dir');mkdirSync(join(fixture,'app'),{recursive:true});
cpSync(join(root,'tests/search-followup/fixture-page.tsx'),join(fixture,'app/page.tsx'));
writeFileSync(join(fixture,'app/layout.tsx'),'import "./globals.css";import "./fixture.css";export default function Layout({children}:{children:React.ReactNode}){return <html lang="fr"><body>{children}</body></html>;}');
writeFileSync(join(fixture,'app/fixture.css'),'.fixture-main{max-width:1440px;margin:auto;padding:24px}.fixture-main>section{margin:28px 0}.fixture-main>header>label{display:grid;max-width:320px;gap:8px;margin-top:16px}@media(max-width:700px){.fixture-main{padding:12px}}');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest={url:'http://127.0.0.1:3215',directory:fixture,sourceRoot:root,status:'starting',files:[...files].map(path=>({path,sha256:hash(join(root,path))})),fixtureOnlyFiles:['app/page.tsx','app/layout.tsx','app/fixture.css'].map(path=>({path,sha256:hash(join(fixture,path))})),fictionalData:true,actualAuth:false,actualRPC:false,actualDatabase:false,persistence:'React callback plus browser-localStorage simulation',actualBusinessViews:['DocumentsView','HouseTrackingView'],permissions:'Real BusinessContext with already-projected fixture contacts',productionAppRoutesIncluded:false};
const save=()=>writeFileSync(join(output,'fixture-manifest.json'),JSON.stringify(manifest,null,2)+'\n');save();
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3215'],{cwd:fixture,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public-placeholder-no-service'},stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>process.stdout.write(chunk));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
for(let attempt=0;attempt<150;attempt++){if(child.exitCode!==null)throw Error('Fixture exited '+child.exitCode);try{if((await fetch(manifest.url,{signal:AbortSignal.timeout(2000)})).ok){manifest.status='ready';save();console.log('READY '+manifest.url);break;}}catch{}await new Promise(done=>setTimeout(done,300));}
await new Promise(done=>child.on('exit',done));
