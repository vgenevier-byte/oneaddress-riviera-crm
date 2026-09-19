import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {invitationConfiguration,deliverInvitation,sendInvitation} from '../../lib/server/invitations.ts';

const results=[];
const check=async(name,fn)=>{
 try{await fn();results.push({name,status:'passed'});}
 catch(error){results.push({name,status:'failed'});throw error;}
};
const env={
 CRM_INVITATIONS_ENABLED:'APPROVED_PRODUCTION_ACTIVATION',
 NEXT_PUBLIC_SUPABASE_URL:'https://approved.example.invalid',
 CRM_INVITE_SUPABASE_ORIGIN:'https://approved.example.invalid',
 CRM_INVITE_RETURN_URL:'https://crm.example.invalid/',
 CRM_INVITE_APPROVED_APP_ORIGIN:'https://crm.example.invalid',
 CRM_INVITE_AUTH_KEY:'fixture-auth-key',
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',
};
const originalFetch=globalThis.fetch;
let handler;
const requests=[];
// No test can fall through to a real network request, including an unexpected SDK call.
globalThis.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 const call={url,method:init?.method,headers:new Headers(init?.headers),body:init?.body?JSON.parse(String(init.body)):null};
 requests.push(call);
 if(url.origin!==env.NEXT_PUBLIC_SUPABASE_URL||!handler)throw new Error('Unexpected simulated Auth destination');
 return handler(call);
};
const runDelivery=async(config,input,response)=>{
 requests.length=0;
 handler=response;
 try{return await deliverInvitation(config,input);}
 finally{handler=undefined;}
};
const config=invitationConfiguration(env);
const input={email:'recipient@example.invalid',existingUser:false,returnUrl:'https://crm.example.invalid/?invite=fixture-business-token&setup=1'};

try{
 await check('Native invitations disabled by default; local acknowledgement does not authorize remote activation',()=>{
  assert.throws(()=>invitationConfiguration({}));
  assert.throws(()=>invitationConfiguration({...env,CRM_INVITATIONS_ENABLED:undefined,IZORD_TEST_ACK:'IZORD_DISPOSABLE_LOCAL_ONLY'}));
  assert.throws(()=>invitationConfiguration({...env,CRM_INVITATIONS_ENABLED:'true'}));
 });
 await check('Native configuration needs only approved Auth and callback origins, with server Auth key',()=>{
  assert.deepEqual(config,{mode:'production',supabaseUrl:env.NEXT_PUBLIC_SUPABASE_URL,publicKey:'fixture-public-key',authKey:'fixture-auth-key',returnUrl:env.CRM_INVITE_RETURN_URL});
  for(const missing of ['CRM_INVITE_AUTH_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])assert.throws(()=>invitationConfiguration({...env,[missing]:undefined}));
  // Legacy relay settings have no effect and are never returned or used for delivery.
  assert.deepEqual(invitationConfiguration({...env,CRM_INVITE_DELIVERY_URL:'https://obsolete.example.invalid/send',CRM_INVITE_APPROVED_DELIVERY_ORIGIN:'https://obsolete.example.invalid',CRM_INVITE_DELIVERY_KEY:'obsolete-fixture',CRM_INVITE_SENDER:'obsolete@example.invalid'}),config);
 });
 await check('Unapproved origin, HTTP, URL credentials, query and fragment configurations are rejected',()=>{
  const patches=[
   {CRM_INVITE_SUPABASE_ORIGIN:'https://other.example.invalid'},
   {CRM_INVITE_SUPABASE_ORIGIN:'http://approved.example.invalid',NEXT_PUBLIC_SUPABASE_URL:'http://approved.example.invalid'},
   {CRM_INVITE_SUPABASE_ORIGIN:'https://approved.example.invalid/auth',NEXT_PUBLIC_SUPABASE_URL:'https://approved.example.invalid/auth'},
   {CRM_INVITE_SUPABASE_ORIGIN:'https://approved.example.invalid/?bad=1',NEXT_PUBLIC_SUPABASE_URL:'https://approved.example.invalid/?bad=1'},
   {CRM_INVITE_SUPABASE_ORIGIN:'https://user:fixture@approved.example.invalid',NEXT_PUBLIC_SUPABASE_URL:'https://user:fixture@approved.example.invalid'},
   {CRM_INVITE_SUPABASE_ORIGIN:'https://approved.example.invalid/#bad',NEXT_PUBLIC_SUPABASE_URL:'https://approved.example.invalid/#bad'},
   {CRM_INVITE_RETURN_URL:'https://other.example.invalid/'},
   {CRM_INVITE_RETURN_URL:'http://crm.example.invalid/',CRM_INVITE_APPROVED_APP_ORIGIN:'http://crm.example.invalid'},
   {CRM_INVITE_RETURN_URL:'https://user:fixture@crm.example.invalid/'},
   {CRM_INVITE_RETURN_URL:'https://crm.example.invalid/?invite=unapproved'},
   {CRM_INVITE_RETURN_URL:'https://crm.example.invalid/#access_token=fictional'},
  ];
  for(const patch of patches)assert.throws(()=>invitationConfiguration({...env,...patch}));
 });
 await check('Local native configuration requires the exact disposable stack, acknowledgement and both keys',()=>{
  const local={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55431',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',LOCAL_AUTH_INVITE_KEY:'fixture-local-key',IZORD_TEST_ACK:'IZORD_DISPOSABLE_LOCAL_ONLY'};
  assert.deepEqual(invitationConfiguration(local),{mode:'local',supabaseUrl:local.NEXT_PUBLIC_SUPABASE_URL,publicKey:'fixture-public-key',authKey:'fixture-local-key',returnUrl:'http://127.0.0.1:3160/'});
  for(const missing of ['LOCAL_AUTH_INVITE_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','IZORD_TEST_ACK'])assert.throws(()=>invitationConfiguration({...local,[missing]:undefined}));
  assert.throws(()=>invitationConfiguration({...local,NEXT_PUBLIC_SUPABASE_URL:'http://localhost:55431'}));
 });
 await check('New recipient uses native inviteUserByEmail with exact recipient and callback; no business metadata',async()=>{
  await runDelivery(config,input,async()=>Response.json({id:'fixture-user-id',email:input.email}));
  assert.equal(requests.length,1);
  const call=requests[0];
  assert.equal(call.method,'POST');assert.equal(call.url.pathname,'/auth/v1/invite');
  assert.deepEqual([...call.url.searchParams.keys()],['redirect_to']);
  assert.equal(call.url.searchParams.get('redirect_to'),input.returnUrl);
  assert.equal(call.headers.get('authorization'),'Bearer fixture-auth-key');
  assert.equal(call.headers.get('apikey'),'fixture-auth-key');
  assert.deepEqual(call.body,{email:input.email});
 });
 await check('Existing recipient uses native OTP with shouldCreateUser false and public key; no rights metadata',async()=>{
  const existing={...input,existingUser:true,returnUrl:'https://crm.example.invalid/?invite=fixture-existing-token'};
  await runDelivery(config,existing,async()=>Response.json({}));
  assert.equal(requests.length,1);
  const call=requests[0];
  assert.equal(call.method,'POST');assert.equal(call.url.pathname,'/auth/v1/otp');
  assert.deepEqual([...call.url.searchParams.keys()],['redirect_to']);
  assert.equal(call.url.searchParams.get('redirect_to'),existing.returnUrl);
  assert.equal(call.headers.get('authorization'),'Bearer fixture-public-key');
  assert.equal(call.headers.get('apikey'),'fixture-public-key');
  assert.equal(call.body.email,existing.email);assert.equal(call.body.create_user,false);
  assert.deepEqual(call.body.data,{});
  assert.deepEqual(Object.keys(call.body).sort(),['code_challenge','code_challenge_method','create_user','data','email','gotrue_meta_security']);
  assert.equal(call.body.code_challenge,null);assert.equal(call.body.code_challenge_method,null);
  assert.deepEqual(call.body.gotrue_meta_security,{});
 });
 await check('Auth rejection and rate limit errors fail without returning Auth details or a false success',async()=>{
  for(const existingUser of [false,true])for(const status of [400,429]){
   await assert.rejects(()=>runDelivery(config,{...input,existingUser},async()=>Response.json({message:'fixture provider detail must not escape',error_code:'fixture_auth_rejection'},{status})),error=>error.message==='auth_delivery_failed');
   assert.equal(requests.length,1);
  }
 });
 await check('Invalid Auth responses fail closed for both native paths',async()=>{
  for(const existingUser of [false,true]){
   await assert.rejects(()=>runDelivery(config,{...input,existingUser},async()=>new Response('invalid fixture response',{status:200,headers:{'Content-Type':'application/json'}})),error=>error.message==='auth_delivery_failed');
   assert.equal(requests.length,1);
  }
 });
 await check('Only server password state controls setup on new accounts, pending accounts and initialized accounts',async()=>{
  for(const state of [{existingUser:false,needsPasswordSetup:true},{existingUser:true,needsPasswordSetup:true},{existingUser:true,needsPasswordSetup:false}]){
   const deliveries=[];requests.length=0;
   handler=async call=>{
    if(call.url.pathname==='/auth/v1/user')return Response.json({id:'fixture-admin',email:'admin@example.invalid'});
    if(call.url.pathname==='/rest/v1/rpc/crm_access_snapshot')return Response.json({generalAdmin:true});
    if(call.url.pathname==='/rest/v1/rpc/crm_invite_prepare')return Response.json({id:'fixture-invitation',token:'fixture-business-token',...state});
    if(call.url.pathname==='/rest/v1/rpc/crm_invite_delivery_allowed')return Response.json(true);
    throw new Error('Unexpected simulated invitation endpoint');
   };
   try{
    const result=await sendInvitation(new Request('https://crm.example.invalid/api/access/invite',{method:'POST',headers:{authorization:'Bearer fixture-session'},body:JSON.stringify({email:input.email,grants:{tasks:{level:'read'}},needsPasswordSetup:!state.needsPasswordSetup,setup:!state.needsPasswordSetup,user_metadata:{needsPasswordSetup:!state.needsPasswordSetup}})}),env,async(_config,delivery)=>deliveries.push(delivery));
    assert.equal(result.status,200);assert.equal(deliveries.length,1);
    assert.equal(deliveries[0].existingUser,state.existingUser);assert.equal(deliveries[0].email,input.email);
    const callback=new URL(deliveries[0].returnUrl);assert.equal(callback.searchParams.get('invite'),'fixture-business-token');assert.equal(callback.searchParams.get('setup'),state.needsPasswordSetup?'1':null);
    const preparation=requests.find(r=>r.url.pathname==='/rest/v1/rpc/crm_invite_prepare');assert.deepEqual(Object.keys(preparation.body).sort(),['p_assignments','p_email','p_grants']);
   }finally{handler=undefined;}
  }
 });
 await check('Missing server password state revokes the prepared invitation without Auth delivery',async()=>{
  let sent=false;requests.length=0;
  handler=async call=>{
   if(call.url.pathname==='/auth/v1/user')return Response.json({id:'fixture-admin',email:'admin@example.invalid'});
   if(call.url.pathname==='/rest/v1/rpc/crm_access_snapshot')return Response.json({generalAdmin:true});
   if(call.url.pathname==='/rest/v1/rpc/crm_invite_prepare')return Response.json({id:'fixture-invitation',token:'fixture-business-token',existingUser:true});
   if(call.url.pathname==='/rest/v1/rpc/crm_invite_revoke')return new Response(null,{status:204});
   throw new Error('Unexpected simulated invitation endpoint');
  };
  try{const result=await sendInvitation(new Request('https://crm.example.invalid/api/access/invite',{method:'POST',headers:{authorization:'Bearer fixture-session'},body:JSON.stringify({email:input.email,grants:{tasks:{level:'read'}}})}),env,async()=>{sent=true;});assert.equal(result.status,502);assert.equal(sent,false);assert.equal(requests.filter(r=>r.url.pathname==='/rest/v1/rpc/crm_invite_revoke').length,1);}finally{handler=undefined;}
 });
}finally{
 globalThis.fetch=originalFetch;
 writeFileSync('/tmp/crm-unified-review/'+(process.env.INVITATION_FINAL==='1'?'native-invitation-adapter-final.json':'finalisation-invitation-adapter.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}
