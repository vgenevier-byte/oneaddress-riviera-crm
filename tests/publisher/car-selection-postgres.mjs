/** Native PostgreSQL fixture only; existing binaries, no installation. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
const bin='/private/tmp/oar-publisher-cars-runtime/node_modules/@embedded-postgres/darwin-arm64/native/bin';
const directory='/private/tmp/oar-publisher-car-selection-bench-20261021';
const cluster='/private/tmp/oar-publisher-car-selection-db-20261021';
assert.equal(process.env.PUBLISHER_TEST_ACK,'PUBLISHER_DISPOSABLE_LOCAL_ONLY');
assert.equal(existsSync(cluster),false,'Inspect existing cluster rather than replacing it');
mkdirSync(directory,{recursive:true});mkdirSync(`${cluster}/socket`,{recursive:true});
const init=execFileSync(`${bin}/initdb`,['-D',`${cluster}/data`,'-U','publisher_local','-A','trust','--no-locale','--encoding=UTF8'],{encoding:'utf8',timeout:20000});
appendFileSync(`${directory}/postgres.log`,init);
const server=spawn(`${bin}/postgres`,['-D',`${cluster}/data`,'-h','127.0.0.1','-p','55542','-k',`${cluster}/socket`],{stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Local PG startup timed out')),20000);
 for(const stream of [server.stdout,server.stderr])stream.on('data',part=>{appendFileSync(`${directory}/postgres.log`,part);if(part.toString().includes('database system is ready to accept connections')){clearTimeout(timer);resolve();}});
 server.once('error',error=>{clearTimeout(timer);reject(error);});server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local PG exited ${code}`));});
});
console.log('LOCAL PostgreSQL fixture ready at 127.0.0.1:55542; no remote database');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.kill('SIGTERM'));
await new Promise(resolve=>server.once('exit',resolve));
