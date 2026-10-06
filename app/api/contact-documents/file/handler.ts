import "server-only";
import {createClient} from "@supabase/supabase-js";
import {DriveRouteError, driveErrorResponse, requireServerEnv} from "../../drive/_utils";

type FileMetadata = {resource_id:string;file_name:string;mime_type:string;size_bytes:number};

/** Current Auth/session/resource rights guard each response. Personal files never
 * return a signed URL or use the Google transport and its WIF credentials. */
export function createContactDocumentFileHandler(dependencies:{readBytes?: (origin:string,resource:string)=>Promise<Blob>}={}) {
 return async function GET(request:Request) {
  try {
    const authorization=request.headers.get("authorization");
    if(!authorization || !/^Bearer\s+\S+$/i.test(authorization)) throw new DriveRouteError("Session CRM requise.",401);
    const url=new URL(request.url),resource=url.searchParams.get("resource"),download=url.searchParams.get("download")==="1";
    if(!resource || !/^contact-private\/[0-9a-f-]{36}$/.test(resource)) throw new DriveRouteError("Document indisponible.",400);
    const origin=requireServerEnv("NEXT_PUBLIC_SUPABASE_URL");
    const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,cache:"no-store"})}};
    const user=createClient(origin,requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),{...options,global:{...options.global,headers:{Authorization:authorization}}});
    async function authorize():Promise<FileMetadata> {
      const {data,error}=await user.rpc("crm_contact_document_file",{p_resource:resource,p_download:download}).abortSignal(AbortSignal.timeout(8000));
      if(error) throw new DriveRouteError("Consultation du document non autorisée.",error.code==="42501"?403:503);
      if(!data || data.resource_id!==resource) throw new DriveRouteError("Document indisponible.",403);
      return data as FileMetadata;
    }
    const metadata=await authorize();
    const data=dependencies.readBytes?await dependencies.readBytes(origin,resource):await readContactDocumentBytes(origin,resource);
    // A revocation, removal or account/session change during byte loading blocks
    // the response too. The service credential is never exposed to the browser.
    await authorize();
    const raw=metadata.file_name.replace(/[\r\n]/g," ");
    const ascii=raw.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/["\\;\x00-\x1f\x7f-\uffff]/g,"-").slice(0,150)||"document";
    const encoded=encodeURIComponent(raw).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(data,{headers:{"content-type":metadata.mime_type,"cache-control":"private, no-store",
      "content-disposition":`${download?"attachment":"inline"}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});
  } catch(error) {return driveErrorResponse(error,"Document indisponible.");}
};
}

export async function readContactDocumentBytes(origin:string,resource:string):Promise<Blob> {
 const local=origin==="http://127.0.0.1:55431" && process.env.IZORD_TEST_ACK==="IZORD_DISPOSABLE_LOCAL_ONLY";
 const server=createClient(origin,requireServerEnv(local?"LOCAL_AUTH_INVITE_KEY":"CRM_INVITE_AUTH_KEY"),{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,cache:"no-store"})}
 });
 const {data,error}=await server.storage.from("crm-documents").download(resource);
 if(error||!data) throw new DriveRouteError("Le fichier confirmé est indisponible.",503);
 return data;
}
