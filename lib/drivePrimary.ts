import type {SupabaseClient} from '@supabase/supabase-js';
import type {OperationOptions} from './izord/repository';
const CHUNK=1024*1024;
export async function drivePrimaryEnabled(client:SupabaseClient){const r=await client.rpc('crm_drive_mode');if(r.error)throw Error('Configuration du stockage non confirmée. Votre brouillon est conservé.');return r.data===true;}
async function digest(bytes:BufferSource){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function uploadPrimaryAsset(client:SupabaseClient,input:{domain:'fonciere'|'izord';project:string;source:string;revision:number;kind:string;file:Blob;name:string;category:string;slot:string;baseUrl?:string;accessToken?:string},options:OperationOptions){
 const session=input.accessToken?null:(await client.auth.getSession()).data.session,token=input.accessToken||session?.access_token;if(!token)throw Error('Connexion requise.');
 // JWT subject is only a deterministic draft namespace here, never authorization.
 // The server verifies the full JWT and current resource rights independently.
 const actor=session?.user.id||JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;

 const sha256=await digest(await input.file.arrayBuffer());
 // Identity survives draft reloads. Homonymous files in distinct slots differ.
 const seed=await digest(new TextEncoder().encode(JSON.stringify([actor,input.domain,input.project,input.revision,input.kind,input.slot,input.name,input.category,sha256])));
 const operation=`${seed.slice(0,8)}-${seed.slice(8,12)}-4${seed.slice(13,16)}-a${seed.slice(17,20)}-${seed.slice(20,32)}`;
 const url=(input.baseUrl||'')+'/api/drive-primary/upload',authorization='Bearer '+token;
 async function checked(response:Response){if(response.status===429)throw Error('Google Drive limite temporairement les transferts. Vos fichiers restent en attente ; reprenez plus tard.');if(response.status===507)throw Error('La capacité Google Drive est atteinte. Vos fichiers restent en attente ; contactez l’administrateur.');if(!response.ok)throw Error('Transfert Drive non confirmé. Votre brouillon et vos fichiers sont conservés ; réessayez pour reprendre.');const result=await response.json();if(!result||!Number.isSafeInteger(result.received)||result.received<0||result.received>input.file.size||typeof result.complete!=='boolean'||!/^[a-f0-9-]{36}$/.test(result.assetId))throw Error('Confirmation de transfert invalide.');return result as {assetId:string;received:number;complete:boolean};}
 let result=await checked(await fetch(url,{method:'POST',headers:{Authorization:authorization,'content-type':'application/json'},body:JSON.stringify({operation,domain:input.domain,project:input.project,source:input.source,revision:input.revision,kind:input.kind,size:input.file.size,mime:input.file.type,name:input.name,category:input.category,sha256}),signal:options.signal}));
 let attempts=0;
 while(!result.complete){if(++attempts>Math.ceil(input.file.size/CHUNK)+2)throw Error('Reprise interrompue. Conservez les fichiers et réessayez explicitement pour reprendre.');
  const offset=result.received,end=Math.min(offset+CHUNK,input.file.size);if(end<=offset)throw Error('Finalisation Drive non confirmée.');
  result=await checked(await fetch(url,{method:'PATCH',headers:{Authorization:authorization,'x-transfer-id':operation,'x-chunk-offset':String(offset),'content-type':'application/octet-stream'},body:input.file.slice(offset,end),signal:options.signal}));
  if(result.received<=offset&&!result.complete)throw Error('Transfert non avancé. Réessayez explicitement pour reprendre.');
  options.onProgress?.({stage:'upload',completed:result.received,total:input.file.size,label:input.name});
 }
 options.signal?.throwIfAborted();return result.assetId;
}
export async function downloadPrimaryAsset(client:SupabaseClient,domain:'fonciere'|'izord',asset:string,options:OperationOptions,baseUrl='',accessToken?:string){
 const token=accessToken||(await client.auth.getSession()).data.session?.access_token;if(!token)throw Error('Connexion requise.');
 const r=await fetch(`${baseUrl}/api/drive-primary/file?domain=${domain}&asset=${encodeURIComponent(asset)}`,{headers:{Authorization:'Bearer '+token},signal:options.signal,cache:'no-store'});if(!r.ok)throw Error('Original inaccessible. Les références enregistrées sont conservées.');const blob=await r.blob();options.signal?.throwIfAborted();return blob;
}
