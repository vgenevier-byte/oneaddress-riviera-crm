import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import {connect,sql,fixtureFile,login,ok,denied,output} from './local.mjs';
const require=createRequire(import.meta.url),Module=require('module'),load=Module._load;Module._load=function(id,...args){return id==='server-only'?{}:load.call(this,id,...args);};
await connect();const f=JSON.parse(readFileSync(fixtureFile)),user=await login(f.users.contributor),checks=[];let oldGrant,target,assignment;
try{
 const status=JSON.parse(readFileSync(process.env.ARBITRAGE_STATUS_FILE));process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.LOCAL_AUTH_INVITE_KEY=status.SERVICE_ROLE_KEY;process.env.PREPAID_HOURS_TEST_ACK='PREPAID_HOURS_LOCAL_ONLY';
 const {primaryCall}=require('../../lib/server/drivePrimary');
 oldGrant=(await sql.query("select level,sensitive from crm_module_grants where user_id=$1 and module='izord'",[user.id])).rows[0];
 await sql.query("update crm_module_grants set level='contribute',sensitive='{\"export\":true}' where user_id=$1 and module='izord'",[user.id]);
 target=(await sql.query("select * from izord_projects where payload#>>'{data,importMeta,fonciereSource,id}'=$1 order by created_at desc limit 1",[f.projects.assigned])).rows[0];assert(target);
 assignment=await sql.query('insert into izord_project_assignments(project_id,user_id) values($1,$2) on conflict do nothing returning project_id',[target.id,user.id]);
 await sql.query('update app_private.crm_drive_primary_config set enabled=true');
 await denied(user.client.rpc('fonciere_authorize_transfer',{p_project:f.projects.assigned,p_revision:null}));
 const operation=randomUUID(),args={p_operation:operation,p_domain:'izord',p_project:target.id,p_source:f.projects.assigned,p_revision:target.revision,p_kind:'pdf',p_size:30,p_mime:'application/pdf',p_name:'historical-scope.pdf',p_category:'agency',p_sha256:'b'.repeat(64)};
 const original=await ok(user.client.rpc('crm_drive_begin',args));checks.push('An editable saved presentation can add its own document after source export permission is absent');
 await denied(user.client.rpc('crm_drive_begin',{...args,p_operation:randomUUID(),p_source:f.projects.foreign}));checks.push('A different inaccessible source cannot be substituted');
 const revision=await ok(user.client.rpc('izord_save_generator',{p_id:target.id,p_expected_revision:target.revision,p_title:target.title,p_payload:target.payload,p_status:'draft'}));
 const replay=await ok(user.client.rpc('crm_drive_begin',{...args,p_revision:revision}));assert.equal(replay.assetId,original.assetId);const row=(await sql.query('select project_revision from izord_assets where id=$1',[original.assetId])).rows[0];assert.equal(row.project_revision,revision);const lease=randomUUID();await primaryCall('claim',{operation_id:operation,actor:user.id,lease});await primaryCall('release',{operation_id:operation,actor:user.id,lease});checks.push('Pending transfer rebase keeps the same asset and durable operation identity');
 await denied(user.client.rpc('izord_withdraw_asset',{p_asset:original.assetId}));await sql.query("update crm_module_grants set sensitive=jsonb_set(sensitive,'{delete}','true') where user_id=$1 and module='izord'",[user.id]);
 await ok(user.client.rpc('izord_withdraw_asset',{p_asset:original.assetId}));await denied(user.client.rpc('crm_drive_begin',{...args,p_revision:revision}));checks.push('An explicitly withdrawn transfer cannot upload again');
 writeFileSync(output+'/drive-primary-history-scope.json',JSON.stringify({checks,realLocalAuthAndDatabase:true,googleRequests:0},null,2));for(const c of checks)console.log('PASS '+c);
}finally{if(oldGrant)await sql.query("update crm_module_grants set level=$2,sensitive=$3 where user_id=$1 and module='izord'",[user.id,oldGrant.level,oldGrant.sensitive]);if(assignment?.rowCount)await sql.query('delete from izord_project_assignments where project_id=$1 and user_id=$2',[target.id,user.id]);await sql.query('update app_private.crm_drive_primary_config set enabled=false');await sql.end();}
