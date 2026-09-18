import test from "node:test";
import assert from "node:assert/strict";
import { requireAuthenticatedCRMUser } from "../app/api/drive/_utils";

for (const scenario of ["oar", "izord", "revoked", "missing-migration", "invalid-jwt"] as const) {
 test(`Drive authorization: ${scenario}`, async t => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.example.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fictional-key" };
  for (const [key,value] of Object.entries(env)) { const old = process.env[key]; process.env[key]=value; t.after(() => { if(old===undefined) delete process.env[key]; else process.env[key]=old; }); }
  let membershipCalls=0;
  t.mock.method(globalThis,"fetch",async (input: any, init: RequestInit) => {
   const url=new URL(String(input));
   assert.equal(new Headers(init.headers).get("authorization"),"Bearer fictional-jwt");
   assert.equal(init.cache,"no-store");
   if(url.pathname==="/auth/v1/user") return scenario==="invalid-jwt" ? Response.json({message:"invalid"},{status:401}) : Response.json({id:"11111111-1111-4111-8111-111111111111",email:"test@example.invalid"});
   assert.equal(url.pathname,"/rest/v1/app_memberships"); membershipCalls++;
   assert.equal(url.searchParams.get("workspace_id"),"eq.oar"); assert.equal(url.searchParams.get("status"),"eq.active");
   if(scenario==="missing-migration") return Response.json({message:"missing"},{status:404});
   return Response.json(scenario==="oar" ? {role:"member"} : null);
  });
  const run=()=>requireAuthenticatedCRMUser(new Request("http://localhost/api/drive/file",{headers:{authorization:"Bearer fictional-jwt"}}));
  if(scenario==="oar") assert.equal((await run()).id,"11111111-1111-4111-8111-111111111111");
  else await assert.rejects(run,(e:any)=>e.status===(scenario==="invalid-jwt"?401:scenario==="missing-migration"?503:403));
  assert.equal(membershipCalls,scenario==="invalid-jwt"?0:1);
 });
}

// Exercise the actual six entrypoints: refusal happens before any Drive access.
import { GET as fileGET } from "../app/api/drive/file/route";
import { GET as diagnosticGET } from "../app/api/drive/diagnostic/route";
import { POST as foldersPOST } from "../app/api/drive/folders/route";
import { POST as uploadPOST } from "../app/api/drive/upload/route";
import { POST as deletePOST } from "../app/api/drive/delete/route";
import { POST as bankPOST } from "../app/api/drive/vendor-bank-accounts/upload/route";
for (const [path, handler, method] of [
 ["file", fileGET, "GET"], ["diagnostic", diagnosticGET, "GET"],
 ["folders", foldersPOST, "POST"], ["upload", uploadPOST, "POST"],
 ["delete", deletePOST, "POST"], ["vendor-bank-accounts/upload", bankPOST, "POST"]
] as const) test(`IZORD-only denied at actual /api/drive/${path} entrypoint`, async t => {
 for (const [key,value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL:"https://fixture.example.invalid",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"fixture-key" })) {
  const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});
 }
 const seen:string[]=[];
 t.mock.method(globalThis,"fetch",async(input:any)=>{
  const url=new URL(String(input));assert.equal(url.hostname,"fixture.example.invalid");seen.push(url.pathname);
  if(url.pathname==="/auth/v1/user")return Response.json({id:"11111111-1111-4111-8111-111111111111",email:"izord@example.invalid"});
  assert.equal(url.pathname,"/rest/v1/app_memberships");return Response.json(null);
 });
 const response=await handler(new Request(`http://localhost/api/drive/${path}`,{method,headers:{authorization:"Bearer fictional-jwt"}}));
 assert.equal(response.status,403);assert.deepEqual(seen,["/auth/v1/user","/rest/v1/app_memberships"]);
});
