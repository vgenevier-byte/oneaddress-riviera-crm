import 'server-only';
import {createClient} from '@supabase/supabase-js';
type Env=Record<string,string|undefined>;
export type InvitationConfiguration={mode:'local'|'production';supabaseUrl:string;publicKey:string;authKey:string;returnUrl:string};
export function invitationConfiguration(env:Env):InvitationConfiguration {
 if(env.NEXT_PUBLIC_SUPABASE_URL==='http://127.0.0.1:55431'&&env.IZORD_TEST_ACK==='IZORD_DISPOSABLE_LOCAL_ONLY'){
  if(!env.LOCAL_AUTH_INVITE_KEY||!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)throw new Error('delivery_unconfigured');
  return {mode:'local',supabaseUrl:env.NEXT_PUBLIC_SUPABASE_URL,publicKey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,authKey:env.LOCAL_AUTH_INVITE_KEY,returnUrl:'http://127.0.0.1:3160/'};
 }
 if(env.CRM_INVITATIONS_ENABLED!=='APPROVED_PRODUCTION_ACTIVATION')throw new Error('delivery_disabled');
 const base=new URL(env.CRM_INVITE_SUPABASE_ORIGIN??''),app=new URL(env.CRM_INVITE_RETURN_URL??'');
 if(base.href.replace(/\/$/,'')!==env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')||[base,app].some(u=>u.protocol!=='https:'||u.username||u.password||u.hash)||app.origin!==env.CRM_INVITE_APPROVED_APP_ORIGIN||base.pathname!=='/'||base.search||app.search)throw new Error('destination_not_approved');
 if(!env.CRM_INVITE_AUTH_KEY||!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)throw new Error('delivery_unconfigured');
 return {mode:'production',supabaseUrl:base.href.replace(/\/$/,''),publicKey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,authKey:env.CRM_INVITE_AUTH_KEY,returnUrl:app.href};
}
/** Native Auth mail only. SMTP credentials belong to Supabase Auth, never this app.
 * A pre-existing account receives a native login link without creating another user.
 * Neither path includes metadata or applies any business permissions. */
export async function deliverInvitation(config:InvitationConfiguration,input:{email:string;existingUser:boolean;returnUrl:string}){
 const auth=createClient(config.supabaseUrl,input.existingUser?config.publicKey:config.authKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=input.existingUser
  ?await auth.auth.signInWithOtp({email:input.email,options:{shouldCreateUser:false,emailRedirectTo:input.returnUrl}})
  :await auth.auth.admin.inviteUserByEmail(input.email,{redirectTo:input.returnUrl});
 if(result.error)throw new Error('auth_delivery_failed');
}
export async function sendInvitation(request:Request,env:Env=process.env,delivery:typeof deliverInvitation=deliverInvitation){
 let config:InvitationConfiguration;try{config=invitationConfiguration(env);}catch{return Response.json({error:'Envoi non activé ou configuration non approuvée.'},{status:503});}
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)return Response.json({error:'Authentification requise.'},{status:401});
 const client=createClient(config.supabaseUrl,config.publicKey,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await client.auth.getUser(token);if(error||!user)return Response.json({error:'Session invalide.'},{status:401});
 const access=await client.rpc('crm_access_snapshot');if(access.error||!access.data?.generalAdmin)return Response.json({error:'Administration générale requise.'},{status:403});
 let input;try{const raw=await request.text();if(raw.length>16000)throw new Error();input=JSON.parse(raw);if(typeof input.email!=='string'||input.email.length>254)throw new Error();input.email=input.email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw new Error();if(config.mode==='local'&&!input.email.endsWith('@example.invalid'))throw new Error();}catch{return Response.json({error:'Destinataire ou invitation invalide.'},{status:400});}
 const prepared=await client.rpc('crm_invite_prepare',{p_email:input.email,p_grants:input.grants,p_izord_role:input.izordRole,p_assignments:input.assignments??[]});if(prepared.error)return Response.json({error:'Invitation refusée : vérifiez les droits et le destinataire.'},{status:400});
 try{
  if(typeof prepared.data?.existingUser!=='boolean'||typeof prepared.data?.needsPasswordSetup!=='boolean')throw new Error('invitation_state_unavailable');
  const still=await client.rpc('crm_invite_delivery_allowed',{p_id:prepared.data.id});if(still.error||!still.data)throw new Error('invitation_revoked');
  // Supabase builds and verifies its own confirmation URL. Only the separate
  // business invitation token travels in redirectTo; it never grants Auth rights.
  const callback=new URL(config.returnUrl);callback.searchParams.set('invite',prepared.data.token);
  // The server reads actual Auth password state, independently of account
  // existence. A pending invite can need setup on its second or later delivery.
  if(prepared.data.needsPasswordSetup)callback.searchParams.set('setup','1');
  await delivery(config,{email:input.email,existingUser:prepared.data.existingUser,returnUrl:callback.href});
  const after=await client.rpc('crm_invite_delivery_allowed',{p_id:prepared.data.id});if(after.error||!after.data)throw new Error('invitation_revoked');
  return Response.json({ok:true,mode:config.mode});
 }catch{const revoked=await client.rpc('crm_invite_revoke',{p_id:prepared.data.id});return Response.json({error:revoked.error?'Envoi non confirmé. Vérifiez et révoquez l’invitation dans les invitations en attente.':'Envoi non confirmé ; cette invitation est révoquée. Vous pouvez reprendre.'},{status:502});}
}
