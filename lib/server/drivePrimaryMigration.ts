import 'server-only';
import {randomUUID} from 'node:crypto';
import {createGoogleDriveFetch} from '../../app/api/drive/_utils';
import {primaryCall,primaryService,resolvePrimaryDestination,verifyPrimaryFile,type DriveFile,PrimaryError} from './drivePrimary';
import {copyOriginalToDrive,reserveDriveId,type DriveJob,type FonciereDriveFetch,safeDriveError} from './fonciereDrive';

/** Finite administrative batch, only canonical CRM assets. Durable file ID is
 * reserved before Google writes. A completed batch is naturally skipped later.
 * Originals and business payloads are never changed or deleted. */
export async function migratePrimaryBatch(limit=10,fetchDrive:FonciereDriveFetch=createGoogleDriveFetch()){
 type Candidate={id:string;project_id:string;storage_object_version:string;expected_size:number;expected_mime:string;original_name:string;drive_category:string;copy_id:string|null;reserved_id:string|null;binding:DriveFile|null};
 const candidates=await primaryCall<Candidate[]>('migration_list');
 const results:Array<{assetId:string;bytes:number;status:string;phase?:string;code?:string;fileId?:string;sha256?:string}>=[];
 for(const a of candidates.slice(0,Math.min(10,Math.max(1,limit)))){
  let f!:DriveFile;let phase='discovery';const lease=randomUUID();
  try{
   const existing=a.binding?.file_id||a.copy_id||a.reserved_id||await discoverCopy(a,fetchDrive);
   phase='reserve';f=await primaryCall('migration_reserve',{asset_id:a.id,source_version:a.storage_object_version,file_id:existing||await reserveDriveId(fetchDrive)});
   f=await primaryCall('claim',{operation_id:f.operation_id,lease});
   phase='destination';const dest=await resolvePrimaryDestination(f,fetchDrive);
   f=await primaryCall('state',{operation_id:f.operation_id,lease,...dest});
   phase='source-read';const downloaded=await primaryService().storage.from('fonciere-documents').download(`${a.project_id}/${a.id}`);
   if(downloaded.error||!downloaded.data)throw Error('original_unavailable');
   const job={asset_id:a.id,project_id:a.project_id,object_path:`${a.project_id}/${a.id}`,storage_object_version:a.storage_object_version,expected_size:a.expected_size,expected_mime:a.expected_mime,original_name:a.original_name} as DriveJob;
   phase='copy-or-match';await copyOriginalToDrive(fetchDrive,job,downloaded.data,f.folder_id!,f.drive_id!,f.file_id!);
   phase='integrity-and-revision';const proof=await verifyPrimaryFile(f,fetchDrive,downloaded.data);
   phase='commit';await primaryCall('complete',{operation_id:f.operation_id,lease,...proof});
   results.push({assetId:a.id,bytes:a.expected_size,status:'verified-and-switched',fileId:f.file_id!,sha256:proof.sha256});
  }catch(error){if(f)await primaryCall('fail',{operation_id:f.operation_id,lease}).catch(()=>{});results.push({assetId:a.id,bytes:a.expected_size,status:'exception-retained-on-supabase',phase,code:error instanceof PrimaryError?`drive-rejected-${error.status}`:safeDriveError(error)});}
  finally{if(f)await primaryCall('release',{operation_id:f.operation_id,lease}).catch(()=>{});}
 }
 return {remainingBefore:candidates.length,results};
}

async function discoverCopy(a:{id:string;project_id:string;storage_object_version:string},fetchDrive:FonciereDriveFetch){
 const config=await primaryCall<{shared_drive_id:string}>('config');
 const quote=(v:string)=>v.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
 const props={managedBy:'oar-fonciere',assetId:a.id,projectId:a.project_id,storageVersion:a.storage_object_version};
 const q="trashed = false and "+Object.entries(props).map(([key,value])=>`appProperties has { key='${key}' and value='${quote(value)}' }`).join(' and ');
 let page='',found:string|undefined;const seen=new Set<string>();
 do{if(seen.has(page)||seen.size>100)throw Error('incomplete_discovery');seen.add(page);const params=new URLSearchParams({q,corpora:'drive',driveId:config.shared_drive_id,supportsAllDrives:'true',includeItemsFromAllDrives:'true',pageSize:'100',fields:'nextPageToken,incompleteSearch,files(id)'});if(page)params.set('pageToken',page);
 const r=await fetchDrive('https://www.googleapis.com/drive/v3/files?'+params,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('discovery_unavailable');const body=await r.json();if(body.incompleteSearch||!Array.isArray(body.files))throw Error('incomplete_discovery');for(const file of body.files){if(found)throw Error('ambiguous_copy');found=file.id;}page=body.nextPageToken||'';
 }while(page);return found;
}
