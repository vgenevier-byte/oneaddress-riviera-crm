"use client";
import {createContext,useContext,useLayoutEffect,useMemo,useCallback,useRef} from 'react';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {supabase} from '@/lib/supabase';
import type {AccessSnapshot,ModuleId} from './modules';

type Scope={userId:string;access:AccessSnapshot;signal:AbortSignal};
const Context=createContext<Scope|null>(null);
function operationLease(){
 let controller=new AbortController();
 return {get signal(){return controller.signal;},start(){if(controller.signal.aborted)controller=new AbortController();return controller;}};
}
/** Same lifetime/identity checks as the generator. Never rolls back an admitted transaction. */
export function OperationProvider({userId,access,children}:{userId:string;access:AccessSnapshot;children:React.ReactNode}){
 const fingerprint=JSON.stringify(access);
 const scope=useMemo(()=>{const lease=operationLease();return {userId,access:JSON.parse(fingerprint) as AccessSnapshot,lease,get signal(){return lease.signal;}};},[userId,fingerprint]);
 // A StrictMode setup-cleanup-setup creates a fresh lease. Previously admitted
 // operations keep the aborted signal; a real unmount never revives it.
 useLayoutEffect(()=>{const controller=scope.lease.start();const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==scope.userId)controller.abort();});return()=>{controller.abort();subscription.unsubscribe();};},[scope]);
 return <Context.Provider value={scope}>{children}</Context.Provider>;
}
export type ScopedOperation={client:SupabaseClient;token:string;signal:AbortSignal;check:()=>Promise<void>;run:<T>(fn:()=>PromiseLike<T>)=>Promise<T>;download:(blob:Blob,name:string)=>Promise<void>};
export function useScopedOperations(module:ModuleId|'admin'){
 const scope=useContext(Context);
 const lifetime=useRef(new AbortController());
 useLayoutEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();const controller=lifetime.current;return()=>controller.abort();},[]);
 return useCallback(async function begin():Promise<ScopedOperation>{
  if(!scope)throw new Error('Contexte de compte requis.');
  const signal=AbortSignal.any([scope.signal,lifetime.current.signal]);signal.throwIfAborted();
  const {data:{session}}=await supabase.auth.getSession();signal.throwIfAborted();
  if(!session||session.user.id!==scope.userId)throw new DOMException('Compte changé.','AbortError');
  const token=session.access_token;
  // No shared session lookup on later business requests: all use the captured actor.
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal})}});
  async function check(){signal.throwIfAborted();const {data:{session:current}}=await supabase.auth.getSession();signal.throwIfAborted();if(current?.user.id!==scope!.userId)throw new DOMException('Compte changé.','AbortError');const r=await client.rpc('crm_access_snapshot').abortSignal(signal);signal.throwIfAborted();if(r.error||!r.data?.active||r.data.revision!==scope!.access.revision||JSON.stringify(r.data.modules)!==JSON.stringify(scope!.access.modules)||(module==='admin'&&!r.data.generalAdmin))throw new DOMException('Droits modifiés.','AbortError');}
  const run=async<T,>(fn:()=>PromiseLike<T>)=>{await check();const value=await fn();await check();return value;};
  await check();
  return {client,token,signal,check,run,download:async(blob,name)=>{await check();const url=URL.createObjectURL(blob);try{signal.throwIfAborted();const a=document.createElement('a');a.href=url;a.download=name;a.click();}finally{URL.revokeObjectURL(url);}}};
 },[scope,lifetime,module]);
}
export function isCancelled(error:unknown){return error instanceof DOMException&&error.name==='AbortError';}
