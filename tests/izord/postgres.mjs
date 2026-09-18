/** Reproducible SQL + historical suite runner, no Docker needed.
 * Install test-only embedded-postgres@18.4.0-beta.17 and pg@8.16.3 outside repo.
 * IZORD_PG_RUNTIME=/tmp/test-runtime IZORD_ARTIFACTS=/tmp/report node tests/izord/postgres.mjs
 * Auth claims/Storage schema here are facsimiles; run live-local.mjs for HTTP proof.
 */
import { createRequire } from 'node:module';
import { spawn,spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync,writeFileSync,mkdirSync,mkdtempSync,appendFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
const runtime=process.env.IZORD_PG_RUNTIME;if(!runtime)throw Error('IZORD_PG_RUNTIME required');
const require=createRequire(join(resolve(runtime),'package.json'));
const EmbeddedPostgres=require('embedded-postgres').default;
const repo=process.cwd(),out=resolve(process.env.IZORD_ARTIFACTS||mkdtempSync(join(tmpdir(),'izord-test-results-')));mkdirSync(out,{recursive:true});
const cluster=mkdtempSync(join(tmpdir(),'izord-postgres-'));mkdirSync(join(cluster,'socket'));
const password=randomBytes(24).toString('hex'),port=55487;
const db=`postgresql://oar_test:${password}@127.0.0.1:${port}/oar_folder_registry_test`;
const postgres=new EmbeddedPostgres({databaseDir:join(cluster,'data'),user:'oar_test',password,port,persistent:false,postgresFlags:['-h','127.0.0.1','-k',join(cluster,'socket')],onLog:s=>appendFileSync(join(out,'postgres.log'),s+'\n'),onError:s=>appendFileSync(join(out,'postgres.log'),s+'\n')});
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_PATH:join(repo,'node_modules')+':'+join(resolve(runtime),'node_modules'),OAR_TEST_DATABASE_URL:db,OAR_ACCESS_DATABASE_URL:db.replace('/oar_folder_registry_test','/izord_access_test')};
try{
 const files=readdirSync(join(repo,'tests')).filter(f=>f.endsWith('.test.ts')).sort();
 const compile=spawnSync(join(repo,'node_modules/.bin/tsc'),['--outDir',join(out,'compiled'),'--module','commonjs','--moduleResolution','node','--target','es2022','--esModuleInterop','--skipLibCheck','--resolveJsonModule',...files.map(f=>'tests/'+f)],{cwd:repo,encoding:'utf8',env});
 writeFileSync(join(out,'compile.log'),compile.stdout+compile.stderr);if(compile.status!==0)throw Error('Compilation failed');
 await postgres.initialise();await postgres.start();await postgres.createDatabase('oar_folder_registry_test');await postgres.createDatabase('izord_access_test');
 const results=[];
 for(const file of files){
  // Keep the event loop draining PostgreSQL logs while expected denial tests run.
  // spawnSync can fill the server's output pipe and stall otherwise valid SQL.
  const result=await new Promise((resolveChild,rejectChild)=>{
   const child=spawn(process.execPath,['--conditions=react-server','--test','--test-reporter=tap',join(out,'compiled/tests',file.replace(/\.ts$/,'.js'))],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';
   const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);
   child.stdout.on('data',part=>{stdout+=part.toString();});child.stderr.on('data',part=>{stderr+=part.toString();});
   child.on('error',error=>{clearTimeout(timeout);rejectChild(error);});
   child.on('exit',status=>{clearTimeout(timeout);resolveChild({stdout,stderr,status});});
  });
  const output=result.stdout+result.stderr;writeFileSync(join(out,file+'.log'),output);
  const count=key=>Number(output.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]??-1);
  const record={suite:file,tests:count('tests'),pass:count('pass'),fail:count('fail'),cancelled:count('cancelled'),skipped:count('skipped'),todo:count('todo'),exitCode:result.status};results.push(record);console.log(JSON.stringify(record));
 }
 writeFileSync(join(out,'test-results.json'),JSON.stringify(results,null,2));
 if(results.some(r=>r.exitCode!==0||r.fail!==0||r.skipped!==0||r.cancelled!==0||r.todo!==0||r.tests!==r.pass))throw Error('Failed, cancelled or skipped suite; inspect report');
}finally{await postgres.stop();console.log('Disposable PostgreSQL stopped.');}
