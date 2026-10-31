import 'server-only';
import {randomUUID} from 'node:crypto';
import {createGoogleDriveFetch} from '../../app/api/drive/_utils';
import {primaryCall,primaryService,resolvePrimaryDestination,verifyPrimaryFile,type DriveFile} from './drivePrimary';
import {copyOriginalToDrive,reserveDriveId,type DriveJob} from './fonciereDrive';

/** Finite administrative batch, only canonical CRM assets. Durable file ID is
 * reserved before Google writes. A completed batch is naturally skipped later.
 * Originals and business payloads are never changed or deleted. */
export async function migratePrimaryBatch(limit=10){
 const fetchDrive=createGoogleDriveFetch();
 type Candidate={id:string;project_id:string;storage_object_version:string;expected_size:number;expected_mime:string;original_name:string;drive_category:string;copy_id:string|null;reserved_id:string|null;binding:DriveFile|null};
 const candidates=await primaryCall<Candidate[]>('migration_list');
 const results:Array<{assetId:string;bytes:number;status:string;fileId?:string;sha256?:string}>=[];
 for(const a of candidates.slice(0,Math.min(10,Math.max(1,limit)))){
  let f!:DriveFile;const lease=randomUUID();
  try{
   f=await primaryCall('migration_reserve',{asset_id:a.id,source_version:a.storage_object_version,file_id:a.binding?.file_id||a.copy_id||a.reserved_id||await reserveDriveId(fetchDrive)});
   f=await primaryCall('claim',{operation_id:f.operation_id,lease});
   const dest=await resolvePrimaryDestination(f,fetchDrive);
   f=await primaryCall('state',{operation_id:f.operation_id,lease,...dest});
   const downloaded=await primaryService().storage.from('fonciere-documents').download(`${a.project_id}/${a.id}`);
   if(downloaded.error||!downloaded.data)throw Error('original_unavailable');
   const job={asset_id:a.id,project_id:a.project_id,object_path:`${a.project_id}/${a.id}`,storage_object_version:a.storage_object_version,expected_size:a.expected_size,expected_mime:a.expected_mime,original_name:a.original_name} as DriveJob;
   await copyOriginalToDrive(fetchDrive,job,downloaded.data,f.folder_id!,f.drive_id!,f.file_id!);
   const proof=await verifyPrimaryFile(f,fetchDrive,downloaded.data);
   await primaryCall('complete',{operation_id:f.operation_id,lease,...proof});
   results.push({assetId:a.id,bytes:a.expected_size,status:'verified-and-switched',fileId:f.file_id!,sha256:proof.sha256});
  }catch{results.push({assetId:a.id,bytes:a.expected_size,status:'exception-retained-on-supabase'});}
  finally{if(f)await primaryCall('release',{operation_id:f.operation_id,lease}).catch(()=>{});}
 }
 return {remainingBefore:candidates.length,results};
}
