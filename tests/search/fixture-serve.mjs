/** Isolated actual-source fixture. No app routes, credentials, Auth or RPCs. */
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
const root=resolve(process.env.SEARCH_SOURCE||process.cwd()),fixture=mkdtempSync(join(tmpdir(),'oar-search-browser-'));
const output=join(root,'docs/search');mkdirSync(output,{recursive:true});
const files=new Set();
function copy(relative){if(files.has(relative))return;files.add(relative);const source=join(root,relative),target=join(fixture,relative);mkdirSync(dirname(target),{recursive:true});cpSync(source,target);
 if(!/\.(?:tsx?|jsx?)$/.test(relative))return;
 const content=readFileSync(source,'utf8');
 for(const match of content.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)){const spec=match[1];if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;const base=spec.startsWith('@/')?spec.slice(2):join(dirname(relative),spec);const found=[base,...['.ts','.tsx','.json','.css'].map(ext=>base+ext),join(base,'index.ts'),join(base,'index.tsx')].find(path=>existsSync(join(root,path)));if(found)copy(found);}
}
for(const file of ['components/ContactCompanyFields.tsx','components/TasksWorkspace.tsx','components/TaskContactPicker.tsx','components/SearchableBusinessContactPicker.tsx','components/search/SearchableInput.tsx','lib/i18n/I18nProvider.tsx'])copy(file);
for(const file of ['package.json','package-lock.json','tsconfig.json'])cpSync(join(root,file),join(fixture,file));
symlinkSync(join(root,'node_modules'),join(fixture,'node_modules'),'dir');
mkdirSync(join(fixture,'app'),{recursive:true});cpSync(join(root,'tests/search/fixture-page.tsx'),join(fixture,'app/page.tsx'));
writeFileSync(join(fixture,'app/layout.tsx'),'import "./style.css"; export default function Layout({children}:{children:React.ReactNode}){return <html lang="fr"><body>{children}</body></html>;}');
writeFileSync(join(fixture,'app/style.css'),'html{font-family:Arial,sans-serif;color:#172f36;background:#f4f2ec}body{margin:0}main{max-width:1240px;margin:auto;padding:28px}header{margin-bottom:22px}h1{font-size:30px}h2{font-size:21px}.eyebrow{font-size:11px;letter-spacing:2px;color:#98743e}.demo-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{background:white;border:1px solid #dedbd1;border-radius:14px;padding:22px;margin:18px 0}label{display:grid;gap:8px;margin:10px 0}input,select,button{font:inherit;border:1px solid #bdc9c9;border-radius:7px;padding:10px}button{cursor:pointer;background:#fff;color:#18383d;margin:4px}button[type=submit]{background:#153e43;color:white}fieldset{min-width:0;border:0;padding:0}output{display:block;font-size:12px;overflow-wrap:anywhere;margin:10px 0;color:#48635b}small{font-size:12px}@media(max-width:700px){main{padding:12px}.demo-grid{grid-template-columns:1fr}.card{padding:16px}h1{font-size:25px}}');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest={url:'http://127.0.0.1:3214',directory:fixture,sourceRoot:root,status:'starting',files:[...files].map(path=>({path,sha256:hash(join(root,path))})),fixtureOnlyFiles:['app/page.tsx','app/layout.tsx','app/style.css'].map(path=>({path,sha256:hash(join(fixture,path))})),fictionalData:true,actualAuth:false,actualRPC:false,actualDatabase:false,persistence:'browser-localStorage simulation',externalCalls:0};
const manifestFile=join(output,'fixture-manifest.json');const save=()=>writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');save();
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3214'],{cwd:fixture,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>process.stdout.write(chunk));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
for(let attempt=0;attempt<100;attempt++){if(child.exitCode!==null)throw new Error('Fixture server exited with '+child.exitCode);try{const response=await fetch(manifest.url,{signal:AbortSignal.timeout(2000)});if(response.ok){manifest.status='ready';save();console.log('READY '+manifest.url);break;}}catch{}await new Promise(done=>setTimeout(done,300));}
await new Promise(done=>child.on('exit',done));
