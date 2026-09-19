import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {user,rpc,dir,connect,sql} from './local.mjs';
await connect();const admin=await user('admin'),limited=await user('invoices');
const manifest=JSON.parse(readFileSync(dir+'/app.json','utf8'));
const results=[];
try{
 for(const [path,method]of [['file?fileId=fictional-rib','GET'],['diagnostic','GET'],['folders','POST'],['upload','POST'],['delete','POST'],['vendor-bank-accounts/upload','POST']]){
 const before=readFileSync(manifest.googleTraceFile,'utf8');const r=await fetch('http://127.0.0.1:3160/api/drive/'+path,{method,headers:{Authorization:'Bearer '+limited.token,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(r.status,403,await r.text());assert.equal(readFileSync(manifest.googleTraceFile,'utf8'),before);results.push({name:'Restricted Drive '+path,status:'passed'});
 }
 const diag=await fetch('http://127.0.0.1:3160/api/drive/diagnostic',{headers:{Authorization:'Bearer '+admin.token}});assert.equal(diag.status,200,await diag.text());results.push({name:'Full administrator reaches simulated Google with real local JWT checks',status:'passed'});
 const email='unified-mail-'+Date.now()+'@example.invalid';
 const denied=await fetch('http://127.0.0.1:3160/api/access/invite',{method:'POST',headers:{Authorization:'Bearer '+limited.token,'Content-Type':'application/json'},body:JSON.stringify({email,grants:{tasks:{level:'read'}}})});assert.equal(denied.status,403);
 const sent=await fetch('http://127.0.0.1:3160/api/access/invite',{method:'POST',headers:{Authorization:'Bearer '+admin.token,'Content-Type':'application/json'},body:JSON.stringify({email,grants:{tasks:{level:'read'}},izordRole:null,assignments:[]})});assert.equal(sent.status,200,await sent.text());
 const list=await(await fetch('http://127.0.0.1:55434/api/v1/messages')).json();const mail=list.messages.find(m=>m.To?.some(t=>t.Address===email));assert.ok(mail,'Mailpit received invitation');
 const content=await(await fetch('http://127.0.0.1:55434/api/v1/message/'+mail.ID)).json();const link=(content.Text+' '+content.HTML).match(/http:\/\/127\.0\.0\.1:55431\/auth\/v1\/verify[^\s"<>]+/)[0].replaceAll('&amp;','&');assert.equal(new URL(new URL(link).searchParams.get('redirect_to')).origin,'http://127.0.0.1:3160');
 const before=(await sql.query('select p.* from public.crm_module_grants p join auth.users u on u.id=p.user_id where u.email=$1',[email])).rows;assert.equal(before.length,0);
 writeFileSync(dir+'/mail.private.json',JSON.stringify({email,link}),{mode:0o600});results.push({name:'Invitation delivery in local Mailpit; no grants before verified acceptance',status:'passed'});
 console.log(JSON.stringify(results,null,2));writeFileSync(dir+'/api.json',JSON.stringify(results,null,2));
}finally{await sql.end();}
