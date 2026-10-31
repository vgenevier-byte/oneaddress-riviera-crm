import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import sharp from 'sharp';
import {createGoogleDriveFetch,requireServerEnv} from '../../app/api/drive/_utils';
import {validateProjetsRoot,reserveDriveId,processFonciereDriveJobs,type FonciereDriveFetch} from './fonciereDrive';
import {createFonciereDriveStore,createFonciereDriveUserClient} from './fonciereDriveSupabase';
import {validateUploadBlob} from '../izord/repository';

export const DRIVE_CHUNK_BYTES=1024*1024;
const API='https://www.googleapis.com/drive/v3/files';
const fields='id,driveId,parents,trashed,mimeType,size,md5Checksum,headRevisionId,version,appProperties';
const headers={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
export class PrimaryError extends Error {constructor(public status=503){super('Transfert Drive non confirmé. Vos fichiers et votre brouillon sont conservés.');}}
export type DriveFile={operation_id:string;domain:'fonciere'|'izord';asset_id:string;project_id:string;source_project:string;created_by:string;expected_size:number;expected_mime:string;original_name:string;category:string;sha256:string;md5:string|null;source_version:string|null;file_id:string|null;folder_id:string|null;drive_id:string|null;revision_id:string|null;session_uri:string|null;received:number;status:'pending'|'verified';legacy:boolean};
export type DriveAdmission={id:string;project_id:string;object_path:string;expected_size:number;expected_mime:string;drive?:{file_id:string;revision_id:string;drive_id:string;folder_id:string;source_project:string;sha256:string;md5:string;category:string;legacy:boolean;source_version:string}};
export function primaryService(){const origin=requireServerEnv('NEXT_PUBLIC_SUPABASE_URL');const local=['http://127.0.0.1:56031','http://127.0.0.1:57031'].includes(origin)&&process.env.PREPAID_HOURS_TEST_ACK==='PREPAID_HOURS_LOCAL_ONLY';return createClient(origin,requireServerEnv(local?'LOCAL_AUTH_INVITE_KEY':'CRM_INVITE_AUTH_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}});}
export async function primaryCall<T=DriveFile>(action:string,data:Record<string,unknown>={}):Promise<T>{const r=await primaryService().rpc('crm_drive_worker',{p_action:action,p_data:data}).abortSignal(AbortSignal.timeout(15000));if(r.error)throw new PrimaryError(r.error.code==='42501'?403:r.error.code==='40001'?409:503);return r.data as T;}
export async function driveMetadata(fetchDrive:FonciereDriveFetch,id:string){const r=await fetchDrive(`${API}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${fields}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(r.status===404)return null;if(!r.ok)throw new PrimaryError();return r.json();}
function sessionUrl(uri:string){const u=new URL(uri);if(u.protocol!=='https:'||u.hostname!=='www.googleapis.com'||!u.pathname.startsWith('/upload/drive/'))throw new PrimaryError();return uri;}
function identity(f:DriveFile){return {managedBy:'oar-fonciere',projectId:f.project_id,assetId:f.asset_id,storageVersion:f.legacy?f.source_version!:f.sha256};}
function assertIdentity(m:Record<string,unknown>|null,f:DriveFile){const p=m?.appProperties as Record<string,string>|undefined;if(!m||m.id!==f.file_id||m.driveId!==f.drive_id||m.trashed!==false||!Array.isArray(m.parents)||m.parents.length!==1||m.parents[0]!==f.folder_id||Object.entries(identity(f)).some(([k,v])=>p?.[k]!==v))throw new PrimaryError(409);}
export async function resolvePrimaryDestination(f:DriveFile,fetchDrive:FonciereDriveFetch,createWhenMissing=true){
 type Dest={config:Parameters<typeof validateProjetsRoot>[1];folders:Array<{category:string;drive_folder_id:string;parent_drive_folder_id:string;status:string}>};
 let d=await primaryCall<Dest>('folders',{source_project:f.source_project});
 if(createWhenMissing&&!d.folders?.some(x=>x.category===f.category&&x.status==='ready')){await processFonciereDriveJobs(createFonciereDriveStore(),fetchDrive,{maxJobs:2,maxDurationMs:45000});d=await primaryCall<Dest>('folders',{source_project:f.source_project});}
 if(d.config.shared_drive_id!==requireServerEnv('GOOGLE_DRIVE_SHARED_DRIVE_ID'))throw new PrimaryError(409);
 await validateProjetsRoot(fetchDrive,d.config);
 const project=d.folders?.find(x=>x.category==='project'&&x.status==='ready'),folder=d.folders?.find(x=>x.category===f.category&&x.status==='ready');
 if(!project||!folder||project.parent_drive_folder_id!==d.config.root_folder_id||folder.parent_drive_folder_id!==project.drive_folder_id)throw new PrimaryError(409);
 for(const [row,parent,kind]of [[project,d.config.root_folder_id,'project'],[folder,project.drive_folder_id,f.category]] as const){const m=await driveMetadata(fetchDrive,row.drive_folder_id);if(!m||m.driveId!==d.config.shared_drive_id||m.mimeType!=='application/vnd.google-apps.folder'||m.trashed!==false||m.parents?.length!==1||m.parents[0]!==parent||m.appProperties?.projectId!==f.source_project||m.appProperties?.managedBy!=='oar-fonciere'||m.appProperties?.folderKind!==kind)throw new PrimaryError(409);}
 return {drive_id:d.config.shared_drive_id!,folder_id:folder.drive_folder_id};
}
async function validateType(blob:Blob){
 if(['image/jpeg','image/png','image/webp'].includes(blob.type)){const image=await sharp(Buffer.from(await blob.arrayBuffer()),{limitInputPixels:40_000_000}).metadata();if(image.format!==({'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'} as Record<string,string>)[blob.type])throw new PrimaryError(400);}
 else await validateUploadBlob(blob,blob.type==='application/pdf'?'pdf':'presentation');
}
export async function verifyPrimaryFile(f:DriveFile,fetchDrive:FonciereDriveFetch,original?:Blob){
 const m=await driveMetadata(fetchDrive,f.file_id!);assertIdentity(m,f);
 if(Number(m.size)!==f.expected_size||m.mimeType!==f.expected_mime||!m.headRevisionId)throw new PrimaryError(409);
 const revision=String(m.headRevisionId);
 const pinned=await fetchDrive(`${API}/${encodeURIComponent(f.file_id!)}/revisions/${encodeURIComponent(revision)}?fields=id,keepForever`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({keepForever:true}),signal:AbortSignal.timeout(15000)});
 if(!pinned.ok||(await pinned.json()).keepForever!==true)throw new PrimaryError();
 const pinnedMeta=await driveMetadata(fetchDrive,f.file_id!);assertIdentity(pinnedMeta,f);
 const response=await fetchDrive(`${API}/${encodeURIComponent(f.file_id!)}/revisions/${encodeURIComponent(revision)}?alt=media`,{cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new PrimaryError();const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length!==f.expected_size)throw new PrimaryError(409);
 const sha256=createHash('sha256').update(bytes).digest('hex'),md5=createHash('md5').update(bytes).digest('hex');
 if(md5!==m.md5Checksum||(!f.legacy&&sha256!==f.sha256))throw new PrimaryError(409);
 if(original&&(original.size!==f.expected_size||createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex')!==sha256))throw new PrimaryError(409);
 await validateType(new Blob([bytes],{type:f.expected_mime}));
 const after=await driveMetadata(fetchDrive,f.file_id!);assertIdentity(after,f);if(after.headRevisionId!==revision||after.version!==pinnedMeta.version||after.md5Checksum!==md5)throw new PrimaryError(409);
 await resolvePrimaryDestination(f,fetchDrive);
 return {revision_id:revision,sha256,md5};
}
export async function validatePrimaryRead(a:DriveAdmission,fetchDrive=createGoogleDriveFetch()){
 if(!a.drive)throw new PrimaryError(409);
 const d=a.drive,m=await driveMetadata(fetchDrive,d.file_id);
 const f={project_id:a.project_id,asset_id:a.id,file_id:d.file_id,drive_id:d.drive_id,folder_id:d.folder_id,legacy:d.legacy,source_version:d.source_version,sha256:d.sha256,source_project:d.source_project,category:d.category} as DriveFile;
 assertIdentity(m,f);
 const destination=await resolvePrimaryDestination(f,fetchDrive,false);if(destination.drive_id!==d.drive_id||destination.folder_id!==d.folder_id)throw new PrimaryError(409);
 // Read exactly the pinned revision; later head replacements cannot rewrite history.
 return fetchDrive;
}
export async function readPrimaryOriginal(a:DriveAdmission,fetchDrive= createGoogleDriveFetch()){
 await validatePrimaryRead(a,fetchDrive);const d=a.drive!;
 const r=await fetchDrive(`${API}/${encodeURIComponent(d.file_id)}/revisions/${encodeURIComponent(d.revision_id)}?alt=media`,{cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw new PrimaryError();const bytes=Buffer.from(await r.arrayBuffer());
 if(bytes.length!==a.expected_size||createHash('sha256').update(bytes).digest('hex')!==d.sha256)throw new PrimaryError(409);
 await validatePrimaryRead(a,fetchDrive);return new Blob([bytes],{type:a.expected_mime});
}
async function boundedBody(request:Request){const reader=request.body?.getReader();if(!reader)throw new PrimaryError(400);const chunks:Uint8Array[]=[];let size=0;try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>DRIVE_CHUNK_BYTES)throw new PrimaryError(413);chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);}
function received(r:Response,total:number){if(r.ok)return total;const range=r.headers.get('range');if(r.status!==308)throw new PrimaryError();if(!range)return 0;const match=/^bytes=0-(\d+)$/.exec(range);if(!match)throw new PrimaryError();const offset=Number(match[1])+1;if(offset>total||offset%262144!==0)throw new PrimaryError();return offset;}
export function createPrimaryUploadHandler(deps:{fetchDrive?:FonciereDriveFetch}={}){return async(request:Request)=>{
 let f!:DriveFile;let actor:string|undefined,lease:string|undefined;
 try{
  const user=createFonciereDriveUserClient(request.headers.get('authorization'));
  const signed=await user.auth.getUser();if(signed.error||!signed.data.user)throw new PrimaryError(401);actor=signed.data.user.id;
  let operation=request.headers.get('x-transfer-id');
  if(request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>8192)throw new PrimaryError(413);
   const b=await request.json();if(!b||Object.keys(b).some(k=>!['operation','domain','project','source','revision','kind','size','mime','name','category','sha256'].includes(k)))throw new PrimaryError(400);
   const r=await user.rpc('crm_drive_begin',{p_operation:b.operation,p_domain:b.domain,p_project:b.project,p_source:b.source,p_revision:b.revision,p_kind:b.kind,p_size:b.size,p_mime:b.mime,p_name:b.name,p_category:b.category,p_sha256:b.sha256});
   if(r.error)throw new PrimaryError(r.error.code==='42501'?403:409);operation=r.data.operationId;
  }else if(!['GET','PATCH'].includes(request.method))throw new PrimaryError(405);
  if(!operation||!/^[a-f0-9-]{36}$/.test(operation))throw new PrimaryError(400);
  lease=randomUUID();f=await primaryCall('claim',{operation_id:operation,actor,lease});
  const fetchDrive=deps.fetchDrive||createGoogleDriveFetch();
  const state=async(data:Record<string,unknown>)=>{f=await primaryCall('state',{operation_id:operation,actor,lease,...data});};
  if(f.status==='verified')return Response.json({assetId:f.asset_id,received:f.expected_size,complete:true},{headers});
  const dest=await resolvePrimaryDestination(f,fetchDrive);
  if(f.folder_id&&f.folder_id!==dest.folder_id)throw new PrimaryError(409);
  await state({...dest,file_id:f.file_id||await reserveDriveId(fetchDrive)});
  let meta=await driveMetadata(fetchDrive,f.file_id!);
  if(!meta){
   if(f.session_uri){const probe=await fetchDrive(sessionUrl(f.session_uri),{method:'PUT',headers:{'content-length':'0','content-range':`bytes */${f.expected_size}`},signal:AbortSignal.timeout(15000)});
    if([404,410].includes(probe.status))await state({session_uri:null,received:0});else await state({received:received(probe,f.expected_size)});}
   if(!f.session_uri){const start=await fetchDrive('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id',{method:'POST',headers:{'content-type':'application/json','x-upload-content-type':f.expected_mime,'x-upload-content-length':String(f.expected_size)},body:JSON.stringify({id:f.file_id,name:f.original_name,mimeType:f.expected_mime,parents:[f.folder_id],appProperties:identity(f)}),signal:AbortSignal.timeout(15000)});
    if(start.status===409)meta=await driveMetadata(fetchDrive,f.file_id!);else{if(!start.ok||!start.headers.get('location'))throw new PrimaryError();await state({session_uri:sessionUrl(start.headers.get('location')!),received:0});}}
   if(request.method==='PATCH'&&!meta){const bytes=await boundedBody(request),offset=Number(request.headers.get('x-chunk-offset'));
    if(!Number.isSafeInteger(offset)||offset<0||!bytes.length||offset+bytes.length>f.expected_size)throw new PrimaryError(400);
    if(offset<f.received&&offset+bytes.length<=f.received)return Response.json({assetId:f.asset_id,received:f.received,complete:false},{headers});
    if(offset!==f.received||(offset+bytes.length<f.expected_size&&bytes.length%262144!==0))throw new PrimaryError(409);
    const sent=await fetchDrive(sessionUrl(f.session_uri!),{method:'PUT',headers:{'content-type':f.expected_mime,'content-length':String(bytes.length),'content-range':`bytes ${offset}-${offset+bytes.length-1}/${f.expected_size}`},body:new Uint8Array(bytes),signal:AbortSignal.timeout(45000)});
    await state({received:received(sent,f.expected_size)});
   }
   if(f.received===f.expected_size)meta=await driveMetadata(fetchDrive,f.file_id!);
  }
  if(meta){const proof=await verifyPrimaryFile(f,fetchDrive);f=await primaryCall('complete',{operation_id:operation,actor,lease,...proof});}
  return Response.json({assetId:f.asset_id,received:f.received,complete:f.status==='verified'},{headers});
 }catch(error){return Response.json({error:'Transfert Drive non confirmé. Conservez les fichiers et le brouillon, puis réessayez.'},{status:error instanceof PrimaryError?error.status:503,headers});}
 finally{if(f&&lease)await primaryCall('release',{operation_id:f.operation_id,actor,lease}).catch(()=>{});}
};}
export function createPrimaryDownloadHandler(){return async(request:Request)=>{try{const user=createFonciereDriveUserClient(request.headers.get('authorization')),u=new URL(request.url),domain=u.searchParams.get('domain'),asset=u.searchParams.get('asset');if(!['fonciere','izord'].includes(domain||'')||!asset)throw new PrimaryError(400);
 const authorize=async()=>{const r=await user.rpc('crm_drive_read',{p_domain:domain,p_asset:asset,p_operation:'download'});if(r.error||!r.data)throw new PrimaryError(403);return r.data as DriveAdmission;};
 const a=await authorize();let blob:Blob;if(a.drive)blob=await readPrimaryOriginal(a);else{const r=await primaryService().storage.from(domain==='fonciere'?'fonciere-documents':'izord-documents').download(a.object_path);if(r.error||!r.data)throw new PrimaryError();blob=r.data;}
 if(JSON.stringify(await authorize())!==JSON.stringify(a))throw new PrimaryError(403);
 const bytes=new Uint8Array(await blob.arrayBuffer());let offset=0;return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(offset+262144,bytes.length);controller.enqueue(bytes.slice(offset,end));offset=end;}}),{headers:{...headers,'content-type':a.expected_mime,'content-disposition':'attachment; filename="document"'}});
 }catch(error){return Response.json({error:'Document inaccessible.'},{status:error instanceof PrimaryError?error.status:503,headers});}};}
