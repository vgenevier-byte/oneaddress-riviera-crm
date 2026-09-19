"use client";
import {useEffect,useRef,useState} from 'react';

export type FormSaveResult = {ok:true;recordId?:string} | {ok:false;message:string;cancelled?:boolean};
export type FormSave = void | FormSaveResult | Promise<void | FormSaveResult>;

function contents(form:HTMLFormElement){
 // Include temporarily disabled fields: FormData would omit them while saving.
 return JSON.stringify(Array.from(form.elements).flatMap(field=>
  field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement
   ?[[field.name,field.value,field instanceof HTMLInputElement?field.checked:null]]:[]));
}
/** Confirmation belongs to one mounted form and one draft version. No persistence. */
export function useConfirmedForm(onRetain?:()=>void){
 const alive=useRef(true),version=useRef(0),pending=useRef(false);
 const [saving,setSaving]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function changed(){version.current++;}
 async function submit(form:HTMLFormElement,save:()=>FormSave,confirmed:(newerDraft:boolean,result?:Extract<FormSaveResult,{ok:true}>)=>void){
  if(pending.current)return;
  pending.current=true;setSaving(true);setMessage('');
  const submitted=version.current,snapshot=contents(form);
  try{
   const result=await save();
   if(!alive.current||!form.isConnected)return;
   if(result&&!result.ok){setMessage(result.message);return;}
   if(version.current!==submitted||contents(form)!==snapshot){
    onRetain?.();setMessage('La version envoyée est enregistrée. Votre nouvelle saisie reste à enregistrer.');confirmed(true,result||undefined);return;
   }
   confirmed(false,result||undefined);
  }catch{
   if(alive.current&&form.isConnected)setMessage('Enregistrement non confirmé. Votre saisie est conservée ; vérifiez les données avant de réessayer.');
  }finally{pending.current=false;if(alive.current)setSaving(false);}
 }
 return {saving,message,changed,submit};
}
