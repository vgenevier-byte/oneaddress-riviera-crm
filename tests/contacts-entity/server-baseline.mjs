/** Reproduce both actual installed name_required guards via real local JWT/RPC. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {getBench} from './server-control.mjs';
const {bench}=getBench();
async function rpc(name,args){
 const r=await fetch(bench.origin+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',headers:{apikey:bench.publishableKey,Authorization:'Bearer '+bench.accounts.contributor.token,'Content-Type':'application/json'},body:JSON.stringify(args)});
 return {status:r.status,data:await r.json()};
}
const before=await rpc('crm_read_module',{p_module:'contacts'});assert.equal(before.status,200);
const baseline=[];
for(const [branch,patch] of [['validate_business_patch',{name:'',companyName:'Entreprise fictive avant correction'}],['tasks_previous_mutate_record',{companyName:'Entreprise fictive avant correction'}]]){
 const response=await rpc('crm_mutate_record',{p_module:'contacts',p_collection:'contacts',p_id:'baseline-'+branch,p_patch:patch,p_revision:before.data.revision,p_delete:false});
 assert(response.status>=400);assert.equal(response.data.message,'name_required');
 baseline.push({branch,status:response.status,code:response.data.code,message:response.data.message});
}
const after=await rpc('crm_read_module',{p_module:'contacts'});assert.deepEqual(after,before);
const result={passed:true,actualLocalAuthJWTPostgREST:true,simulatedResponses:false,baseline,refusedWritesPreserveProjectionAndRevision:true};
writeFileSync(resolve('../evidence/server/baseline-refusals.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
