/** Authoritative after-proof: raw PostgreSQL + fresh Auth reads + immutable Storage bytes. */
const assert=require('node:assert/strict');const{readFileSync,writeFileSync}=require('node:fs');const{createHash}=require('node:crypto');const{Client}=require('pg');const{createClient}=require('@supabase/supabase-js');
const out='/private/tmp/oar-task-link-corrections',f=JSON.parse(readFileSync(out+'/photo-fixture.private.json','utf8')),s=JSON.parse(readFileSync(f.statusFile,'utf8'));
if(process.env.TASK_LINK_CORRECTIONS_ACK!=='TASK_LINK_CORRECTIONS_DISPOSABLE_LOCAL_ONLY'||new URL(s.API_URL).origin!=='http://127.0.0.1:55931'||new URL(s.DB_URL).hostname!=='127.0.0.1'||new URL(s.DB_URL).port!=='55932')throw Error('Explicit isolated photo verification required');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(stable(value))).digest('hex');
const photoState=payload=>({photos:payload.data.photos,importGallery:payload.data.importGallery,photoGalleryRoles:payload.data.photoGalleryRoles,importMeta:payload.data.importMeta,sourceDocuments:payload.sourceDocuments});
const client=createClient(s.API_URL,s.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),sql=new Client({connectionString:s.DB_URL});
const ok=async action=>{const r=await action;if(r.error)throw Error('Local verification rejected: '+(r.error.code||'unknown'));return r.data;};
(async()=>{await sql.connect();const results=[];try{await ok(client.auth.signInWithPassword({email:f.owner.email,password:f.owner.password}));
 for(const project of f.projects){
  const row=(await sql.query('select * from public.izord_projects where id=$1',[project.id])).rows[0];assert.equal(row.revision,4);assert.equal(row.payload.data.state.features,project.editedText);assert.deepEqual(photoState(row.payload),project.baseline.photoState);
  const expected=structuredClone(project.baseline.payload);expected.data.state.features=project.editedText;assert.deepEqual(row.payload,expected,'only explicitly edited text changes in saved payload');
  const version4=(await sql.query('select payload from public.izord_project_versions where project_id=$1 and revision=4',[project.id])).rows[0];assert.deepEqual(version4.payload,row.payload);
  const oldVersions=(await sql.query('select revision,title,payload,status,author_id from public.izord_project_versions where project_id=$1 and revision<=3 order by revision',[project.id])).rows;assert.deepEqual(oldVersions,project.baseline.versions,'historical snapshots remain byte-equivalent data');
  const refs=(await sql.query('select slot,asset_id from public.izord_generator_asset_refs where project_id=$1 and project_revision=4 order by slot',[project.id])).rows;assert.deepEqual(refs,project.baseline.refs,'all7 roles/gallery/source slots reuse exact asset IDs');
  const assets=(await sql.query('select * from public.izord_assets where project_id=$1 order by id',[project.id])).rows;assert.deepEqual(JSON.parse(JSON.stringify(assets)),project.baseline.assetRows,'no new/replaced/altered photo or source asset');
  const fresh=await ok(client.from('izord_projects').select('revision,payload').eq('id',project.id).single());assert.deepEqual(fresh,{revision:4,payload:row.payload});
  for(const asset of project.assets){const blob=await ok(client.storage.from('izord-documents').download(asset.path));assert.equal(hash(Buffer.from(await blob.arrayBuffer())),asset.sha256,'exact Storage bytes retained');}
  const proof={name:'raw DB, fresh Auth and Storage persistence '+project.title,passed:true,projectId:project.id,revisionBefore:3,revisionAfter:4,beforePhotoStateHash:hash(project.baseline.photoState),afterPhotoStateHash:hash(photoState(row.payload)),beforeSlotsHash:hash(project.baseline.refs),afterSlotsHash:hash(refs),historicalVersionsUnchanged:true,assetRowsUnchanged:true,photoAssets:6,sourceDocuments:1,referenceSlots:7,storageBytesUnchanged:true,onlyEditedField:'data.state.features'};results.push(proof);console.log('PASS '+proof.name);
 }
 writeFileSync(out+'/photo-persistence-results.json',JSON.stringify({actualPostgres:true,freshAuthRead:true,actualStorage:true,hashMethod:'SHA256 of JSON with recursively sorted object keys; arrays preserve order',results},null,2));
}finally{await sql.end();await client.auth.stopAutoRefresh();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
