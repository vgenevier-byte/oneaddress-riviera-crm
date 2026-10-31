/** Read-only fictional provider reconstruction. No migration, real Google call or business write. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {connect,sql,service,status} from '../drive-primary/local.mjs';
const require=createRequire(import.meta.url);
const {createFoncierePhotoPreviewHandler}=require('../../lib/server/foncierePhotoPreview');
export async function previewProvider(f) {
 process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=status.ANON_KEY;
 process.env.LOCAL_AUTH_INVITE_KEY=status.SERVICE_ROLE_KEY;
 process.env.PREPAID_HOURS_TEST_ACK='PREPAID_HOURS_LOCAL_ONLY';
 const files=new Map(),assets=new Map();let active=null,changed=false,headChanged=false;
 await connect();
 try {
  const {rows:[config]}=await sql.query('select * from app_private.fonciere_drive_config');
  assert(config?.shared_drive_id);process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID=config.shared_drive_id;
  const folder=(id,parent,project,kind)=>({id,name:id,driveId:config.shared_drive_id,parents:parent?[parent]:[],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:true,canListChildren:true},appProperties:{managedBy:'oar-fonciere',projectId:project,folderKind:kind}});
  files.set(config.shared_drive_id,folder(config.shared_drive_id));files.set(config.root_folder_id,folder(config.root_folder_id,config.root_parent_id||config.shared_drive_id));
  const ids=f.performance.records.map(r=>r.id);
  for(const row of (await sql.query("select * from app_private.fonciere_drive_folders where project_id=any($1::uuid[]) and status='ready'",[ids])).rows)files.set(row.drive_folder_id,folder(row.drive_folder_id,row.parent_drive_folder_id,row.project_id,row.category));
  const rows=(await sql.query("select a.*,f.file_id,f.drive_id,f.folder_id,f.revision_id,f.sha256,f.md5,f.source_project,f.source_version,f.legacy from fonciere_assets a join app_private.crm_drive_files f on f.asset_id=a.id where a.project_id=any($1::uuid[]) and a.kind='photo' and a.lifecycle='finalized'",[ids])).rows;
  // Fixture preparation reads are outside measured windows and reported separately.
  let setupBytes=0;
  for(const a of rows){const r=await service.storage.from('fonciere-documents').download(a.object_path);assert.equal(r.error,null);const bytes=Buffer.from(await r.data.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256);setupBytes+=bytes.length;
   assets.set(a.id,a);files.set(a.file_id,{id:a.file_id,driveId:a.drive_id,parents:[a.folder_id],trashed:false,mimeType:a.expected_mime,size:String(a.expected_size),md5Checksum:a.md5,headRevisionId:a.revision_id,version:'1',appProperties:{managedBy:'oar-fonciere',projectId:a.source_project,assetId:a.id,storageVersion:a.legacy?a.source_version:a.sha256},bytes,revision:a.revision_id});
  }
  const fetchDrive=async input=>{const u=new URL(input);assert.equal(u.origin,'https://www.googleapis.com');if(active)active.providerMetadataRequests++;const p=u.pathname.split('/'),ri=p.indexOf('revisions'),id=decodeURIComponent(ri<0?p.at(-1):p[ri-1]),file=files.get(id);if(!file)return Response.json({}, {status:404});
   if(ri>=0){assert.equal(decodeURIComponent(p[ri+1]),file.revision);if(active){active.providerOriginalReads++;active.providerOriginalBytes+=file.bytes.length;}return new Response(file.bytes,{headers:{'content-type':file.mimeType}});}
   // A changed immutable binding must never authorize stale browser bytes.
   return Response.json({...file,bytes:undefined,...(headChanged&&file.bytes?{headRevisionId:'fictional-new-head',version:'2'}:{}),...(changed&&file.bytes?{parents:['fictional-wrong-parent']}:{} )});};
  const handler=createFoncierePhotoPreviewHandler({fetchDrive,readOriginal:async(origin,path)=>{assert.equal(origin,status.API_URL);if(active)active.supabaseOriginalReads++;const r=await service.storage.from('fonciere-documents').download(path);assert.equal(r.error,null);if(active)active.supabaseOriginalBytes+=r.data.size;return r.data;}});
  return {assets,setupBytes,setActive:v=>active=v,setChanged:v=>changed=v,setHeadChanged:v=>headChanged=v,handle:handler,handler};
 } finally {await sql.end();}
}
