import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const state=JSON.parse(readFileSync('/private/tmp/oar-relations-bench/status.private.json','utf8'));
const publisher=JSON.parse(readFileSync('/private/tmp/oar-task-links-publisher.private.json','utf8'));
const origin=new URL(state.API_URL);if(origin.hostname!=='127.0.0.1'||origin.port!=='55931')throw new Error('Isolated bench only');
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:'1',
 NEXT_PUBLIC_SUPABASE_URL:state.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:state.ANON_KEY,
 LOCAL_AUTH_INVITE_KEY:state.SERVICE_ROLE_KEY,PUBLISHER_DATABASE_URL:publisher.database,PUBLISHER_LOCAL_SIMULATION:'1',
 NODE_OPTIONS:'--require='+resolve('tests/task-links/network-guard.cjs')};
const mode=process.argv.includes('--build')?'build':process.argv.includes('--start')?'start':'dev';
const args=[resolve('node_modules/next/dist/bin/next'),mode,...(mode==='build'?['--webpack']:mode==='dev'?['--webpack','-p','3198','-H','127.0.0.1']:['-p','3198','-H','127.0.0.1'])];
const child=spawn(process.execPath,args,{env,cwd:process.cwd(),stdio:'inherit'});
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code??1));
