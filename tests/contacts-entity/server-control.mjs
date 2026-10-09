/** Test-only access changes on the fictional isolated local bench. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {assertTarget,assertPrivateFile} from './server-target.mjs';
export function getBench(){
 const path=process.env.CONTACTS_ENTITY_BENCH||readFileSync('/private/tmp/oar-contacts-entity-bench-path.txt','utf8').trim();
 assertPrivateFile(path);
 const bench=JSON.parse(readFileSync(path,'utf8')),status=JSON.parse(readFileSync(bench.statusFile,'utf8'));
 assertTarget({origin:bench.origin,database:status.DB_URL,acknowledgement:process.env.CONTACTS_ENTITY_ACK});
 return {bench,status,path};
}
export async function setContactLevel(profile,level){
 const {bench,status}=getBench();
 assert(['contributor','reader','none','revoked'].includes(profile));assert(['none','read','contribute'].includes(level));
 const account=bench.accounts[profile];assert(account.email.endsWith('@example.invalid'));
 const sql=new Client({connectionString:status.DB_URL});await sql.connect();
 try{
  const before=(await sql.query("select level from public.crm_module_grants where user_id=$1 and module='contacts'",[account.id])).rows[0].level;
  await sql.query("update public.crm_module_grants set level=$2 where user_id=$1 and module='contacts'",[account.id,level]);
  await sql.query('update public.crm_access_profiles set revision=revision+1 where user_id=$1',[account.id]);
  return before;
 }finally{await sql.end();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const before=await setContactLevel(process.argv[2],process.argv[3]);console.log(JSON.stringify({profile:process.argv[2],previousLevel:before,level:process.argv[3],localOnly:true}));
}
