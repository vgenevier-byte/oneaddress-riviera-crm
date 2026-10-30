"use client";
import {createContext,useCallback,useContext,useMemo,useRef} from 'react';
import {useScopedOperations} from '@/lib/access/operations';
import {createFonciereRepository} from '@/lib/fonciere/repository';
import {searchProjectContacts,type ProjectContact} from '@/lib/fonciere/contacts';
type Snapshot={revision:string;contacts:ProjectContact[]};
type Load=()=>Promise<Snapshot>;
const Context=createContext<Load|null>(null);
/** Only concurrent reads share an admitted snapshot. No settled cache or cross-actor reuse. */
export function ProjectContactReads({children}:{children:React.ReactNode}){
 const begin=useScopedOperations('fonciere'),pending=useRef<{actor:typeof begin;promise:Promise<Snapshot>}|null>(null);
 const load=useCallback(()=>{if(pending.current?.actor===begin)return pending.current.promise;const ticket={actor:begin,promise:Promise.resolve(null as unknown as Snapshot)};ticket.promise=(async()=>{const op=await begin();return op.run(()=>createFonciereRepository(op.client,{accessToken:op.token}).readContacts({signal:op.signal}));})().finally(()=>{if(pending.current===ticket)pending.current=null;});pending.current=ticket;return ticket.promise;},[begin]);
 return <Context.Provider value={load}>{children}</Context.Provider>;
}
export function useProjectContactReads(){
 const shared=useContext(Context),begin=useScopedOperations('fonciere');
 const fallback=useCallback(async()=>{const op=await begin();return op.run(()=>createFonciereRepository(op.client,{accessToken:op.token}).readContacts({signal:op.signal}));},[begin]);
 const load=shared||fallback;
 return useMemo(()=>({readContact:async(id:string,{signal}:{signal?:AbortSignal}={})=>{signal?.throwIfAborted();const rows=await load();signal?.throwIfAborted();return rows.contacts.find(r=>r.id===id)||null;},searchContacts:async(query:string,{signal}:{signal?:AbortSignal}={})=>{signal?.throwIfAborted();const rows=await load();signal?.throwIfAborted();return searchProjectContacts(rows.contacts,query.trim());}}),[load]);
}
