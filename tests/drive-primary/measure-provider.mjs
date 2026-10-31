/** Fictional local provider double only. No Google credential or network call. */
import {createRequire} from 'node:module';import {randomUUID,createHash} from 'node:crypto';
import {connect,sql,service,status} from './local.mjs';
const require=createRequire(import.meta.url),{createFoncierePhotoPreviewHandler}=require('../../lib/server/foncierePhotoPreview');
export async function measureProvider(f,label){
 process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=status.ANON_KEY;process.env.LOCAL_AUTH_INVITE_KEY=status.SERVICE_ROLE_KEY;process.env.PREPAID_HOURS_TEST_ACK='PREPAID_HOURS_LOCAL_ONLY';process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID='fixture-drive';
 const {primaryCall}=require('../../lib/server/drivePrimary');let active;const files=new Map();
 const folder=(id,parent,project,kind)=>({id,name:id,driveId:'fixture-drive',parents:parent?[parent]:[],mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:true,canListChildren:true},appProperties:{managedBy:'oar-fonciere',projectId:project,folderKind:kind}});
 files.set('fixture-drive',folder('fixture-drive'));files.set('fixture-root',folder('fixture-root','fixture-drive'));
 if(label==='before'){await connect();try{const ids=f.performance.records.map(r=>r.id);await sql.query("update app_private.crm_drive_files set read_provider='supabase' where legacy and project_id=any($1::uuid[])",[ids]);await sql.query("update fonciere_assets set storage_provider='supabase' where project_id=any($1::uuid[])",[ids]);}finally{await sql.end();}}
 if(label==='after'){
  await connect();try{for(const record of f.performance.records){for(const kind of ['project','agency','plans','photos','other']){const id=record.id+'-'+kind,parent=kind==='project'?'fixture-root':record.id+'-project';files.set(id,folder(id,parent,record.id,kind));await sql.query("insert into app_private.fonciere_drive_folders(project_id,category,parent_drive_folder_id,drive_folder_id,status) values($1,$2,$3,$4,'ready') on conflict(project_id,category) do update set status='ready',drive_folder_id=excluded.drive_folder_id,parent_drive_folder_id=excluded.parent_drive_folder_id",[record.id,kind,parent,id]);}
   const assets=(await sql.query("select * from fonciere_assets where project_id=$1 and lifecycle='finalized'",[record.id])).rows;
   for(const a of assets){const blob=await service.storage.from('fonciere-documents').download(a.object_path);if(blob.error)throw Error('Fictional original missing');const bytes=Buffer.from(await blob.data.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex'),md5=createHash('md5').update(bytes).digest('hex'),id='benchmark-'+a.id,folderId=record.id+'-photos';files.set(id,{id,driveId:'fixture-drive',parents:[folderId],trashed:false,mimeType:a.expected_mime,size:String(a.expected_size),md5Checksum:md5,headRevisionId:'benchmark-revision',version:'1',appProperties:{managedBy:'oar-fonciere',projectId:record.id,assetId:a.id,storageVersion:a.storage_object_version},bytes});
    const lease=randomUUID();await primaryCall('migration_reserve',{asset_id:a.id,source_version:a.storage_object_version,file_id:id});await primaryCall('claim',{operation_id:a.id,lease});await primaryCall('state',{operation_id:a.id,lease,drive_id:'fixture-drive',folder_id:folderId});await primaryCall('complete',{operation_id:a.id,lease,sha256,md5,revision_id:'benchmark-revision'});await primaryCall('release',{operation_id:a.id,lease});
   }
  }}finally{await sql.end();}
 }
 const fetchDrive=async input=>{if(active)active.googleRequests++;const u=new URL(input),p=u.pathname.split('/'),rev=p.indexOf('revisions'),id=rev<0?p.at(-1):p[rev-1],file=files.get(id);if(!file)return Response.json({}, {status:404});if(rev>=0){if(active)active.driveBytes+=file.bytes.length;return new Response(file.bytes,{headers:{'content-type':file.mimeType}});}return Response.json({...file,bytes:undefined});};
 const handler=createFoncierePhotoPreviewHandler({fetchDrive,readOriginal:async(origin,path)=>{if(origin!==status.API_URL)throw Error('Nonlocal original');const r=await service.storage.from('fonciere-documents').download(path);if(r.error)throw Error('Fictional original missing');if(active){active.supabaseBytes+=r.data.size;active.storageReads++;}return r.data;}});
 return {handler,setActive(value){active=value;}};
}
