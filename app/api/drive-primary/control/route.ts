import {createHash,timingSafeEqual} from 'node:crypto';
import {createGoogleDriveFetch,getSharedDriveId} from '@/app/api/drive/_utils';
import {createFonciereDriveStore} from '@/lib/server/fonciereDriveSupabase';
import {validateProjetsRoot,type DriveConfig} from '@/lib/server/fonciereDrive';
import {testFonciereDriveIntegration} from '@/lib/server/fonciereDriveTest';
import {migratePrimaryBatch} from '@/lib/server/drivePrimaryMigration';
import {primaryCall} from '@/lib/server/drivePrimary';
import {CONTROL_HASH,CONTROL_EXPIRES} from '@/lib/server/drivePrimaryControlConfig';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
export async function POST(request:Request){
 const headers={'cache-control':'private, no-store','referrer-policy':'no-referrer'};
 const token=request.headers.get('x-oar-control')||'',digest=createHash('sha256').update(token).digest();
 if(Date.now()>CONTROL_EXPIRES||!timingSafeEqual(digest,Buffer.from(CONTROL_HASH,'hex')))return Response.json({error:'Administrative authorization required.'},{status:403,headers});
 try{
  const b=await request.json();if(!b||Object.keys(b).some(k=>k!=='action')||!['diagnose','test','migrate','activate'].includes(b.action))return Response.json({error:'Invalid action.'},{status:400,headers});
  const fetchDrive=createGoogleDriveFetch(),store=createFonciereDriveStore(),config=await store.call<DriveConfig>('get_config');
  if(config.shared_drive_id!==getSharedDriveId())throw Error('destination_conflict');
  const root=await validateProjetsRoot(fetchDrive,config);
  if(b.action==='diagnose')return Response.json({rootId:root.id,rootName:root.name,sharedDriveId:root.driveId,authorized:true},{headers});
  if(b.action==='test')return Response.json(await testFonciereDriveIntegration(store,fetchDrive,getSharedDriveId()),{headers});
  if(b.action==='migrate')return Response.json(await migratePrimaryBatch(),{headers});
  return Response.json(await primaryCall('activate',{enabled:true}),{headers});
 }catch{return Response.json({error:'Administrative operation not confirmed.'},{status:503,headers});}
}
