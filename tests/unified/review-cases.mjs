import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connect,sql,user,grant,rpc,fullGrants,dir} from './local.mjs';
await connect(); const results=[]; const observe=process.argv.includes('--observe');
try {
 const admin=await user('admin'),u=await user('review-u');await grant(admin,fullGrants,true,'admin');
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const check=(name,r)=>{const denied=r.status>=400;results.push({name,status:denied?'protected':'REPRODUCED',http:r.status,code:r.data?.message});if(!observe)assert.ok(denied,name);};
 await grant(u,{bookings:{level:'contribute',sensitive:{delete:true}},quotes:{level:'contribute'}});
 await sql.query('begin');
 try{
 await sql.query("update crm_workspace_state set payload=jsonb_set(payload,'{quotes}',(payload->'quotes')||$1::jsonb) where workspace_id='oneaddress-riviera'",[JSON.stringify([{id:'review-u1',title:'Fictif U1',status:'Accepted',items:[]}])]);
 await sql.query('commit');
 const view=ok(await rpc('crm_read_module',u.token,{p_module:'bookings'}));
 check('U1 bookings cannot delete Accepted quote',await rpc('crm_mutate_record',u.token,{p_module:'bookings',p_collection:'quotes',p_id:'review-u1',p_patch:{},p_revision:view.revision,p_delete:true}));
 }finally{await sql.query("update crm_workspace_state set payload=jsonb_set(payload,'{quotes}',coalesce((select jsonb_agg(r) from jsonb_array_elements(payload->'quotes') r where r->>'id'<>'review-u1'),'[]')) where workspace_id='oneaddress-riviera'");}
 await grant(u,{},true);await sql.query('update crm_access_profiles set active=false where user_id=$1',[u.id]);
 const inv=ok(await rpc('crm_invite_prepare',admin.token,{p_email:u.email,p_grants:{tasks:{level:'read'}}}));
 check('U3 ordinary invite cannot reactivate former general admin',await rpc('crm_invite_accept',u.token,{p_token:inv.token}));
 await rpc('crm_invite_revoke',admin.token,{p_id:inv.id});await grant(u,{});
 check('U4 null revision rejected',await rpc('crm_admin_save',admin.token,{p_user:u.id,p_revision:null,p_active:true,p_general_admin:false,p_grants:{},p_izord_role:null,p_assignments:[]}));
}finally{writeFileSync(dir+(observe?'/review-before.json':'/review-after.json'),JSON.stringify(results,null,2));await sql.end();console.log(JSON.stringify(results));}
