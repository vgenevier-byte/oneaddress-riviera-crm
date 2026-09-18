import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalTarget, assertLocalDocker } from './local-target.mjs';
const valid = { api:'http://127.0.0.1:55431', database:'postgresql://postgres:fictional@127.0.0.1:55432/postgres', app:'http://127.0.0.1:3159', mail:'http://127.0.0.1:55434', acknowledgement:'IZORD_DISPOSABLE_LOCAL_ONLY' };
test('explicit approved local targets accepted',()=>assert.doesNotThrow(()=>assertLocalTarget(valid)));
for(const [key,value] of [['api','https://jcmnwvlmysecrahupfkk.supabase.co'],['api','https://other.supabase.co'],['api','http://localhost:55431'],['api','http://127.0.0.1:54321'],['api','http://127.0.0.1:55431/remote'],['database','postgresql://test:secret@remote.example/postgres'],['app','https://production.example'],['mail','https://smtp.example'],['acknowledgement','']]) test(`rejects ${key} ${value}`,()=>assert.throws(()=>assertLocalTarget({...valid,[key]:value})));
const engine={HOME:'/Users/fictional',DOCKER_HOST:'unix:///Users/fictional/.colima/default/docker.sock',IZORD_TEST_ACK:'IZORD_DISPOSABLE_LOCAL_ONLY'};
test('explicit Colima engine accepted',()=>assert.doesNotThrow(()=>assertLocalDocker(engine)));
for(const [key,value] of [['DOCKER_HOST','tcp://remote.example:2376'],['DOCKER_HOST',''],['DOCKER_CONTEXT','remote'],['DOCKER_TLS_VERIFY','1'],['DOCKER_CERT_PATH','/tmp/certs'],['CONTAINER_HOST','ssh://remote.example'],['SUPABASE_SERVICES_HOSTNAME','remote.example'],['IZORD_TEST_ACK','']]) test(`rejects Docker override ${key}`,()=>assert.throws(()=>assertLocalDocker({...engine,[key]:value})));
test('rejected production target never reaches any network client',async()=>{
 let connections=0;
 const connect=async target=>{assertLocalTarget(target); connections++; throw new Error('A client must never be constructed');};
 await assert.rejects(connect({...valid,api:'https://jcmnwvlmysecrahupfkk.supabase.co'}));
 assert.equal(connections,0);
});
