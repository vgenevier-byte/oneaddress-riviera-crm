/** Real local RPC/Storage revocation between preview admission and byte response. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {fixtureFile,status,login,rpc,output,options} from './local.mjs';
const require=createRequire(import.meta.url),{createFoncierePhotoPreviewHandler}=require('../../lib/server/foncierePhotoPreview');
const f=JSON.parse(readFileSync(fixtureFile,'utf8')),admin=await login(f.users.admin),reader=await login(f.users.reader),service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=status.ANON_KEY;
async function change(level){const data=await rpc('crm_admin_users',admin.token);assert.equal(data.status,200);const user=data.data.users.find(u=>u.id===reader.id);const saved=await rpc('crm_admin_save',admin.token,{p_user:user.id,p_revision:user.revision,p_active:user.active,p_general_admin:user.generalAdmin,p_grants:{...user.modules,fonciere:{level,sensitive:{delete:false,export:false}}},p_izord_role:user.izordRole,p_assignments:user.assignments,p_fonciere_assignments:user.fonciereAssignments});assert.equal(saved.status,200);}
await change('read');let downloads=0;
try{
 const handler=createFoncierePhotoPreviewHandler({readOriginal:async(origin,path)=>{assert.equal(origin,status.API_URL);assert.equal(path,f.assets.photo.object_path);const r=await service.storage.from('fonciere-documents').download(path);assert.equal(r.error,null);downloads++;await change('none');return r.data;}});
 const response=await handler(new Request('http://127.0.0.1:3197/api/fonciere/photo-preview?asset='+f.assets.photo.id,{headers:{Authorization:'Bearer '+reader.token}}));assert.equal(downloads,1);assert.equal(response.status,403);assert.match(response.headers.get('cache-control'),/no-store/);const body=await response.text();assert(!body.includes('data:image'));assert(!body.includes(f.assets.photo.object_path));
 writeFileSync(join(output,'preview-revocation-results.json'),JSON.stringify({passed:1,checks:['The actual server preview handler repeats live RPC admission after real Storage read and withholds bytes when access is revoked mid-operation'],evidence:'Actual loopback Auth/RPC/Storage with injected real-read scheduling boundary; no response or authorization mocks',productionRequests:0},null,2));console.log('PASS actual preview handler reauthorizes after Storage read and denies the revoked response');
}finally{await change('read');}
