// Exact-source isolated build (no .env, WIF configuration or business data).
// --fixture switches only lib/supabase.ts for UI checks; it is NOT security proof.
import { cpSync, mkdtempSync, symlinkSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join,resolve,basename } from 'node:path';
import { tmpdir } from 'node:os';
const repo=process.cwd(),dir=mkdtempSync(join(tmpdir(),'izord-preview-'));
for(const folder of ['app','components','lib','public'])cpSync(join(repo,folder),join(dir,folder),{recursive:true,filter:source=>!basename(source).startsWith('.env')&&!basename(source).includes('.before-')});
for(const file of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','eslint.config.mjs'])if(existsSync(join(repo,file)))cpSync(join(repo,file),join(dir,file));
symlinkSync(join(repo,'node_modules'),join(dir,'node_modules'),'dir');
if(process.argv.includes('--fixture'))writeFileSync(join(dir,'lib/supabase.ts'),`
import type { supabase as RealClient } from ${JSON.stringify(join(repo,'lib/supabase'))};
const user = () => { const name=typeof window === 'undefined' ? 'admin' : localStorage.getItem('fixture-role') || 'admin'; return name==='anon' ? null : { id:'fixture-'+name,email:name+'@example.invalid' }; };
const session=()=>user() ? { user:user(),access_token:'fixture-not-a-jwt' } : null;
(globalThis as any).__accessFixture=true;
const trace=(table:string,operation:string)=>{const w=window as any; (w.__accessCalls ||= []).push({table,operation});};
const adapter={
 storage:{from:()=>({download:async()=>{throw new Error('UI fixture does not provide private documents');}})},
 auth:{getSession:async()=>({data:{session:session()}}),getUser:async()=>({data:{user:user()},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{localStorage.setItem('fixture-role','anon');return {error:null};}},
 from:(table:string)=>{
  const chain = (result: unknown) => { const p = Object.assign(Promise.resolve(result), { setHeader: () => p, abortSignal: () => p }); return p; };
  let updateValue:any=null;const filters:Record<string,unknown>={};
  const q:any={select:()=>{trace(table,'select');return q;},eq:(key:string,value:unknown)=>{filters[key]=value;return q;},in:()=>q,order:()=>q,abortSignal:()=>q,
  then:(done:any)=>{const role=localStorage.getItem('fixture-role')||'admin';const memberships=role==='both'?[{workspace_id:'oar',role:'member'},{workspace_id:'izord',role:'admin'}]:role==='oar'?[{workspace_id:'oar',role:'member'}]:['admin','partner','reader','a','b'].includes(role)?[{workspace_id:'izord',role:['a','b'].includes(role)?'contributor':role}]:[];
    if(table==='app_memberships') return Promise.resolve({data:memberships,error:null}).then(done);
    if(table==='izord_projects') return Promise.resolve({data:[{id:'fictional-project',title:'Projet fictif — Villa des Oliviers',revision:1,status:'draft',owner_id:'fixture-admin',created_at:'2026-09-16T12:00:00Z',updated_at:'2026-09-16T12:00:00Z',payload:{}}],error:null}).then(done);
    if(table==='izord_project_versions') return Promise.resolve({data:[{project_id:'fictional-project',revision:1,author_id:'fixture-admin'}],error:null}).then(done);
    throw new Error('Unexpected table '+table);},
  single:()=>chain({data:{payload:{contacts:[]},updated_at:localStorage.getItem('fixture-revision')||'2026-09-16'},error:null}),
  update:(value:any)=>{updateValue=value;return q;},
  maybeSingle:()=>{trace(table,'update');const revision=localStorage.getItem('fixture-revision')||'2026-09-16';if(!updateValue||filters.updated_at!==revision)return chain({data:null,error:null});const next=new Date().toISOString();localStorage.setItem('fixture-revision',next);return chain({data:{updated_at:next},error:null});},
  upsert:()=>{trace(table,'upsert');return chain({error:null});}};
  return q;
 }
};export const supabase=adapter as unknown as typeof RealClient;
`);
const artifacts=resolve(process.env.IZORD_ARTIFACTS || '/tmp/izord-artifacts');mkdirSync(artifacts,{recursive:true});
writeFileSync(join(artifacts,process.argv.includes('--fixture')?'ui-preview-path.txt':'build-preview-path.txt'),dir);
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55431',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fictional-local-build-key'};
try {const log=execFileSync(process.execPath,[join(repo,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:dir,env,encoding:'utf8',timeout:180000});writeFileSync(join(artifacts,process.argv.includes('--fixture')?'ui-build.log':'source-build.log'),log);console.log(log);console.log('Isolated preview: '+dir);}catch(e){console.error(String(e.stdout)+String(e.stderr));process.exitCode=1;}
