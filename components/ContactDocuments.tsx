"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {useScopedOperations,isCancelled} from "@/lib/access/operations";
import {readable,type AccessSnapshot} from "@/lib/access/modules";
import {
  CONTACT_DOCUMENT_ACCEPT,CONTACT_DOCUMENT_TYPES,ContactDocumentReadSequence,contactDocumentError,sendContactDocument,validateContactDocumentFile,
  type ContactDocument,type ContactDocumentDraft,type ContactDocumentProjection,type ContactDocumentType
} from "@/lib/contactDocuments";
import styles from "./ContactDocuments.module.css";

type Queued = ContactDocumentDraft & {status:"ready"|"sending"|"failed"|"confirmed";message?:string;locked?:boolean};
type Recipient = {id:string;email:string;active:boolean;confirmed:boolean;modules:AccessSnapshot["modules"]};
const date = (value?:string|null) => value ? new Date(value.length===10?value+"T12:00:00":value).toLocaleDateString("fr-FR") : "Non renseignée";
const canDownload = (access:AccessSnapshot) => access.fullAccess || Boolean(access.modules.documents?.sensitive.export && access.modules.contacts?.sensitive.export);
const allowed = (access:AccessSnapshot) => readable(access,"contacts") && readable(access,"documents");
const writable = (access:AccessSnapshot) => access.fullAccess || (access.modules.contacts?.level==="contribute" && access.modules.documents?.level==="contribute");

/** Shared renderer keeps the same private proxy and retirement rules in both surfaces. */
export function ContactDocumentCards({access,documents,onChanged,onReplace}:{access:AccessSnapshot;documents:ContactDocument[];onChanged:()=>Promise<void>|void;onReplace?:(doc:ContactDocument,file:File)=>void}) {
  const begin=useScopedOperations("documents");
  const [message,setMessage]=useState(""),[working,setWorking]=useState(""),[preview,setPreview]=useState<{doc:ContactDocument;url:string}|null>(null);
  const [sharing,setSharing]=useState<ContactDocument|null>(null),[recipients,setRecipients]=useState<Recipient[]>([]),[recipient,setRecipient]=useState("");
  const previewDialog=useRef<HTMLDivElement>(null),shareDialog=useRef<HTMLDivElement>(null),previewReads=useRef(new ContactDocumentReadSequence());
  const closePreview=useCallback(()=>{previewReads.current.invalidate();setPreview(null);setWorking("");},[]);
  const fail=(error:unknown)=>{if(!isCancelled(error))setMessage(contactDocumentError(error));};
  useEffect(()=>{const sequence=previewReads.current;return()=>sequence.invalidate();},[]);
  useEffect(()=>{
    const dialog=preview?previewDialog.current:sharing?shareDialog.current:null;
    if(!dialog)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();closePreview();setSharing(null);}
      if(event.key==="Tab"){const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,iframe,[tabindex="0"]'));const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    document.addEventListener("keydown",keydown);
    return()=>{document.removeEventListener("keydown",keydown);if(previous?.isConnected)previous.focus();};
  },[preview,sharing,closePreview]);
  useEffect(()=>{if(preview)return()=>URL.revokeObjectURL(preview.url);},[preview]);
  useEffect(()=>{
    if(!preview)return;
    let live=true;
    const validate=async()=>{try{const op=await begin();const result=await op.run(()=>op.client.rpc("crm_contact_documents",{p_contact:preview.doc.record_id}));if(result.error)throw result.error;if(!(result.data as ContactDocumentProjection).documents.some(d=>d.resource_id===preview.doc.resource_id)){if(live){closePreview();void onChanged();}}}catch{if(live){closePreview();void onChanged();}}};
    const timer=setInterval(()=>void validate(),3000);
    return()=>{live=false;clearInterval(timer);};
  },[preview,begin,onChanged,closePreview]);
  async function bytes(doc:ContactDocument,download:boolean){
    const op=await begin();
    // Personal files are served with fresh permission checks; no reusable signed URL.
    const endpoint=doc.personal_contact?"/api/contact-documents/file?resource="+encodeURIComponent(doc.resource_id):doc.provider==="google-drive"?"/api/drive/file?fileId="+encodeURIComponent(doc.resource_id):null;
    if(!endpoint){const result=await op.run(()=>op.client.storage.from("crm-documents").download(doc.resource_id));if(result.error)throw result.error;return {op,blob:result.data};}
    const response=await op.run(()=>fetch(endpoint+(download?"&download=1":""),{headers:{Authorization:"Bearer "+op.token},signal:op.signal,cache:"no-store"}));
    if(!response.ok)throw new Error("Document inaccessible avec les droits actuels.");
    const blob=await op.run(()=>response.blob());return {op,blob};
  }
  async function view(doc:ContactDocument){const request=previewReads.current.start();setWorking(doc.resource_id);setMessage("");try{const {op,blob}=await bytes(doc,false);await op.check();if(!previewReads.current.current(request))return;if(blob.type!=="application/pdf"&&!blob.type.startsWith("image/")){setMessage("Aperçu indisponible pour ce format.");return;}setPreview({doc,url:URL.createObjectURL(blob)});}catch(error){if(previewReads.current.current(request)){fail(error);await onChanged();}}finally{if(previewReads.current.current(request))setWorking("");}}
  async function download(doc:ContactDocument){setWorking(doc.resource_id);try{const {op,blob}=await bytes(doc,true);await op.download(blob,doc.file_name||doc.title||"document");}catch(error){fail(error);await onChanged();}finally{setWorking("");}}
  async function withdraw(doc:ContactDocument){
    if(!window.confirm(`Mettre « ${doc.title} » à la corbeille ? Le fichier et son historique seront conservés.`))return;
    setWorking(doc.resource_id);setMessage("");
    try{const op=await begin();const result=await op.run(()=>op.client.rpc("crm_contact_document_withdraw",{p_resource:doc.resource_id,p_revision:doc.revision}));if(result.error)throw result.error;await op.check();setMessage("Document retiré et conservé dans la corbeille privée.");await onChanged();}catch(error){fail(error);}finally{setWorking("");}
  }
  async function openSharing(doc:ContactDocument){setWorking(doc.resource_id);try{const op=await begin();const result=await op.run(()=>op.client.rpc("crm_admin_users"));if(result.error)throw result.error;await op.check();const users=(result.data.users as Recipient[]).filter(user=>user.active&&user.confirmed&&readable({modules:user.modules} as AccessSnapshot,"contacts")&&readable({modules:user.modules} as AccessSnapshot,"documents"));setRecipients(users);setRecipient("");setSharing(doc);}catch(error){fail(error);}finally{setWorking("");}}
  async function share(revokeUser?:string){if(!sharing||(!recipient&&!revokeUser))return;setWorking(sharing.resource_id);try{const op=await begin();const result=await op.run(()=>revokeUser?op.client.rpc("crm_revoke_document_share",{p_provider:"storage",p_resource:sharing.resource_id,p_user:revokeUser}):op.client.rpc("crm_share_contact_document",{p_resource:sharing.resource_id,p_user:recipient}));if(result.error)throw result.error;await op.check();setMessage(revokeUser?"Autorisation retirée.":"Autorisation explicite confirmée.");setSharing(null);await onChanged();}catch(error){fail(error);}finally{setWorking("");}}
  return <div className={styles.list}>
    {documents.map(doc=><article key={doc.resource_id} className={styles.document} data-contact-document={doc.resource_id}>
      <div><h4>{doc.title}</h4><p>{doc.personal_contact?doc.document_type||"Autre":doc.bank?"Document bancaire existant":"Document métier existant"}{doc.superseded_by||doc.lifecycle==="superseded"?" · Ancienne version":""}</p>
      {doc.personal_contact&&<><p>{doc.file_name} · {doc.size_bytes?`${(doc.size_bytes/1_000_000).toLocaleString("fr-FR",{maximumFractionDigits:2})} Mo`:""}</p><p>Ajout : {date(doc.created_at)} · Auteur : {doc.created_by_label||doc.created_by||"Auteur serveur"}</p><p>Expiration : {date(doc.expires_on)}</p><p className={styles.private}>Privé · propriétaire, déposant habilité et personnes explicitement autorisées.</p></>}</div>
      <div className={styles.actions}>
        <button type="button" className="secondary-button" disabled={working===doc.resource_id} onClick={()=>void view(doc)}>Aperçu</button>
        {canDownload(access)&&<button type="button" className="secondary-button" disabled={working===doc.resource_id} onClick={()=>void download(doc)}>Télécharger</button>}
        {doc.personal_contact&&doc.replaceable&&!doc.readonly&&writable(access)&&onReplace&&<label className={styles.fileButton}>Remplacer explicitement<input aria-label={`Remplacer ${doc.title}`} type="file" accept={CONTACT_DOCUMENT_ACCEPT} disabled={Boolean(working)} onChange={event=>{const file=event.target.files?.[0];if(file)onReplace(doc,file);event.target.value="";}}/></label>}
        {doc.personal_contact&&doc.deletable&&writable(access)&&(access.fullAccess||(access.modules.contacts?.sensitive.delete&&access.modules.documents?.sensitive.delete))&&<button type="button" className="danger-button" disabled={Boolean(working)} onClick={()=>void withdraw(doc)}>Mettre à la corbeille</button>}
        {doc.personal_contact&&doc.can_share&&<button type="button" className="secondary-button" disabled={Boolean(working)} onClick={()=>void openSharing(doc)}>Autorisations</button>}
      </div>
    </article>)}
    {message&&<p role="status">{message}</p>}
    {preview&&<div className="document-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="contact-document-preview-title" ref={previewDialog}><div className="document-preview-modal"><div className="section-heading"><h3 id="contact-document-preview-title">{preview.doc.title}</h3><button type="button" className="secondary-button" onClick={closePreview}>Fermer l’aperçu</button></div><iframe src={preview.url+"#toolbar=0"} title={preview.doc.title} sandbox="allow-same-origin" referrerPolicy="no-referrer" className="document-preview-frame"/>{canDownload(access)&&<button type="button" onClick={()=>void download(preview.doc)}>Télécharger</button>}</div></div>}
    {sharing&&<div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="contact-document-sharing-title" ref={shareDialog}><div className="confirm-dialog"><h3 id="contact-document-sharing-title">Autorisations · {sharing.title}</h3><p>Chaque autorisation concerne uniquement cette pièce. Les droits Contacts et Documents restent nécessaires.</p><label>Collaborateur habilité<select value={recipient} onChange={event=>setRecipient(event.target.value)}><option value="">Choisir une personne</option>{recipients.map(user=><option key={user.id} value={user.id}>{user.email}</option>)}</select></label><button type="button" disabled={!recipient||Boolean(working)} onClick={()=>void share()}>Autoriser cette pièce</button>{sharing.shared_with?.map(user=><p key={user.user_id}>{user.email||user.user_id} <button type="button" disabled={Boolean(working)} onClick={()=>void share(user.user_id)}>Retirer l’autorisation</button></p>)}<button type="button" className="secondary-button" onClick={()=>setSharing(null)}>Fermer</button></div></div>}
  </div>;
}

export default function ContactDocuments({contactId,access}:{contactId:string;access:AccessSnapshot}) {
  const begin=useScopedOperations("documents"),[projection,setProjection]=useState<ContactDocumentProjection|null>(null),[queue,setQueue]=useState<Queued[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const revision=useRef<string|null>(null),runController=useRef<AbortController|null>(null),inFlight=useRef(false),alive=useRef(true),queueRef=useRef<Queued[]>([]),reads=useRef(new ContactDocumentReadSequence());
  const permitted=allowed(access),canAdd=writable(access),identity=JSON.stringify(access);
  function updateQueue(next:Queued[]|((rows:Queued[])=>Queued[])){const value=typeof next==="function"?next(queueRef.current):next;queueRef.current=value;setQueue(value);}
  const refresh=useCallback(async()=>{if(!permitted)return;const request=reads.current.start();try{const op=await begin();const result=await op.run(()=>op.client.rpc("crm_contact_documents",{p_contact:contactId}));if(result.error)throw result.error;await op.check();if(alive.current&&reads.current.current(request)){const value=result.data as ContactDocumentProjection;revision.current=value.revision;setProjection(value);const reconciled=queueRef.current.map(item=>{const confirmed=value.documents.find(doc=>doc.operation_id===item.operationId&&doc.lifecycle==="active");const previous=item.previous?value.documents.find(doc=>doc.resource_id===item.previous!.resource_id):null;return confirmed&&(!item.previous||previous?.superseded_by===confirmed.resource_id)?{...item,status:"confirmed" as const,message:"Confirmé par le serveur"}:item;});queueRef.current=reconciled;setQueue(reconciled);}}catch(error){if(alive.current&&reads.current.current(request)&&!isCancelled(error)){setProjection(null);setMessage(contactDocumentError(error));}}},[begin,contactId,permitted]);
  useEffect(()=>{const sequence=reads.current;alive.current=true;const initial=setTimeout(()=>void refresh(),0);const focus=()=>void refresh();window.addEventListener("focus",focus);const timer=setInterval(focus,15000);return()=>{alive.current=false;sequence.invalidate();runController.current?.abort();clearTimeout(initial);clearInterval(timer);window.removeEventListener("focus",focus);};},[refresh,identity]);
  function select(files:FileList|null,previous?:ContactDocument){
    if(!files)return;
    const incoming=Array.from(files).map(file=>({operationId:crypto.randomUUID(),contactId,file,title:file.name,type:previous?.document_type??"Autre",expiry:previous?.expires_on??"",previous:previous?{resource_id:previous.resource_id,revision:previous.revision}:undefined,status:"ready" as const}));
    updateQueue(rows=>[...rows,...incoming]);setMessage("");
  }
  function replace(doc:ContactDocument,file:File){
    const validation=validateContactDocumentFile(file);if(validation){setMessage(validation);return;}
    if(!window.confirm(`Créer une nouvelle version de « ${doc.title} » ? L’ancienne version sera conservée.`))return;
    updateQueue(rows=>[...rows,{operationId:crypto.randomUUID(),contactId,file,title:doc.title,type:doc.document_type??"Autre",expiry:doc.expires_on??"",previous:{resource_id:doc.resource_id,revision:doc.revision},status:"ready"}]);
  }
  async function send(){
    if(inFlight.current||!canAdd||!projection)return;
    const pending=queueRef.current.filter(item=>item.status!=="confirmed");if(!pending.length)return;
    inFlight.current=true;const controller=new AbortController();runController.current=controller;setBusy(true);setMessage("");
    const changed=(id:string,patch:Partial<Queued>)=>{if(alive.current)updateQueue(rows=>rows.map(item=>item.operationId===id?{...item,...patch}:item));};
    let successes=0,failures=0;
    try{
      const op=await begin();
      for(const draft of pending){
        if(controller.signal.aborted)break;
        changed(draft.operationId,{status:"sending",message:""});
        try{
          await sendContactDocument({check:op.check,onReserved:()=>changed(draft.operationId,{locked:true}),rpc:(name,args)=>op.run(()=>op.client.rpc(name,args)),upload:(path,file)=>op.run(()=>op.client.storage.from("crm-documents").upload(path,file,{upsert:false,contentType:file.type,cacheControl:"0"}))},draft,revision.current,controller.signal);
          successes++;changed(draft.operationId,{status:"confirmed",message:"Confirmé par le serveur"});await refresh();
        }catch(error){
          if(controller.signal.aborted){changed(draft.operationId,{status:"failed",message:"Annulé. Rechargez la liste pour vérifier une éventuelle confirmation serveur."});try{const cancelled=await op.run(()=>op.client.rpc("crm_contact_document_cancel",{p_operation:draft.operationId}));if(cancelled.error)throw cancelled.error;if(cancelled.data?.lifecycle==="withdrawn")changed(draft.operationId,{operationId:crypto.randomUUID(),status:"ready",locked:false,message:"Annulation confirmée. Ce fichier peut être envoyé à nouveau."});}catch{/* A confirmed operation is never rolled back or given a new UUID. */}await refresh();break;}
          if(isCancelled(error))throw error;
          changed(draft.operationId,{status:"failed",message:contactDocumentError(error)});await refresh();if(queueRef.current.find(item=>item.operationId===draft.operationId)?.status==="confirmed")successes++;else failures++;
        }
      }
      if(alive.current)setMessage(controller.signal.aborted?"Import interrompu. Les fichiers déjà confirmés sont conservés. Vérifiez la liste avant de reprendre.":`${successes} fichier${successes>1?"s":""} confirmé${successes>1?"s":""}${failures?` · ${failures} échec${failures>1?"s":""} à reprendre`:""}.`);
    }catch(error){if(alive.current&&!isCancelled(error))setMessage(contactDocumentError(error));}
    finally{inFlight.current=false;runController.current=null;if(alive.current)setBusy(false);}
  }
  async function discard(item:Queued){
    if(item.locked&&item.status!=="confirmed"){try{const op=await begin();const result=await op.run(()=>op.client.rpc("crm_contact_document_cancel",{p_operation:item.operationId}));if(result.error)throw result.error;await op.check();}catch(error){if(!isCancelled(error))setMessage(contactDocumentError(error));await refresh();return;}}
    updateQueue(rows=>rows.filter(row=>row.operationId!==item.operationId));
  }
  if(!permitted)return <section className={styles.section} data-contact-documents><h4>Documents du contact</h4><p>Les droits de lecture Contacts et Documents sont nécessaires.</p></section>;
  return <section className={styles.section} data-contact-documents aria-label="Documents du contact">
    <div className={styles.heading}><h4>Documents du contact {projection?`(${projection.documents.length})`:""}</h4><button type="button" className="secondary-button" onClick={()=>void refresh()} disabled={busy}>Recharger la liste</button></div>
    <p>Pièces personnelles privées par défaut. Le propriétaire et le déposant habilité y ont accès ; chaque autre personne doit être autorisée explicitement.</p>
    {!projection?<p role="status">Lecture des documents en cours ou indisponible.</p>:projection.documents.length===0?<p>Aucun document accessible pour ce contact.</p>:<ContactDocumentCards access={access} documents={projection.documents} onChanged={refresh} onReplace={replace}/>}
    {canAdd&&<form className={styles.form} onSubmit={event=>{event.preventDefault();void send();}}>
      <h4>Ajouter des pièces</h4><p>PDF, JPEG et PNG · 25 Mo maximum par fichier. Plusieurs pièces du même type et du même nom sont acceptées. Le contact est déjà confirmé par son identifiant serveur.</p>
      <label>Choisir plusieurs fichiers<input type="file" multiple accept={CONTACT_DOCUMENT_ACCEPT} disabled={busy||!projection} onChange={event=>{select(event.target.files);event.target.value="";}}/></label>
      {queue.map(item=><fieldset key={item.operationId} disabled={busy||item.locked} className={styles.draft}><legend>{item.file.name}{item.previous?" · Nouvelle version":""}</legend>
        <label>Type<select aria-label={`Type ${item.file.name}`} value={item.type} onChange={event=>updateQueue(rows=>rows.map(row=>row.operationId===item.operationId?{...row,type:event.target.value as ContactDocumentType}:row))}>{CONTACT_DOCUMENT_TYPES.map(type=><option key={type}>{type}</option>)}</select></label>
        <label>Intitulé<input aria-label={`Intitulé ${item.file.name}`} required maxLength={200} value={item.title} onChange={event=>updateQueue(rows=>rows.map(row=>row.operationId===item.operationId?{...row,title:event.target.value}:row))}/></label>
        <label>Expiration facultative<input type="date" value={item.expiry} onChange={event=>updateQueue(rows=>rows.map(row=>row.operationId===item.operationId?{...row,expiry:event.target.value}:row))}/></label>
        <p role="status">{item.message||validateContactDocumentFile(item.file)||"Prêt à envoyer"}</p>
      </fieldset>)}
      <div className={styles.actions}>{queue.filter(item=>item.status!=="confirmed").map(item=><button key={item.operationId} type="button" className="secondary-button" disabled={busy} onClick={()=>void discard(item)}>Retirer la sélection : {item.file.name}</button>)}{queue.some(item=>item.status!=="confirmed")&&<button type="submit" className="primary-button" disabled={busy||!projection}>{busy?"Import en cours…":queue.some(item=>item.status==="failed")?"Reprendre les fichiers non confirmés":"Ajouter les fichiers sélectionnés"}</button>}{busy&&<button type="button" className="secondary-button" onClick={()=>runController.current?.abort()}>Annuler l’import</button>}{!busy&&queue.some(item=>item.status==="confirmed")&&<button type="button" className="secondary-button" onClick={()=>updateQueue(rows=>rows.filter(item=>item.status!=="confirmed"))}>Masquer les imports confirmés</button>}</div>
    </form>}
    {message&&<p role="status">{message}</p>}
  </section>;
}

/** Full-access Documents uses its existing payload for Drive; personal attachments
 * are projected separately so no contact addition can trigger a workspace overwrite. */
export function ContactDocumentLibrary({access}:{access:AccessSnapshot}){
  const begin=useScopedOperations("documents"),[documents,setDocuments]=useState<ContactDocument[]>([]),[message,setMessage]=useState(""),[query,setQuery]=useState("");
  const reads=useRef(new ContactDocumentReadSequence());
  const refresh=useCallback(async()=>{const request=reads.current.start();try{const op=await begin();const result=await op.run(()=>op.client.rpc("crm_read_module",{p_module:"documents"}));if(result.error)throw result.error;await op.check();if(reads.current.current(request)){setDocuments((result.data.collections.documents as ContactDocument[]).filter(doc=>doc.personal_contact));setMessage("");}}catch(error){if(reads.current.current(request)&&!isCancelled(error)){setDocuments([]);setMessage(contactDocumentError(error));}}},[begin]);
  useEffect(()=>{const sequence=reads.current;const initial=setTimeout(()=>void refresh(),0);const focus=()=>void refresh();window.addEventListener("focus",focus);const timer=setInterval(focus,15000);return()=>{sequence.invalidate();clearTimeout(initial);clearInterval(timer);window.removeEventListener("focus",focus);};},[refresh]);
  if(!allowed(access))return null;
  return <section className="card" data-contact-documents><div className={styles.heading}><h3>Documents des contacts ({documents.length})</h3><button type="button" className="secondary-button" onClick={()=>void refresh()}>Recharger</button></div><p>Liste des pièces personnelles autorisées. Leur partage reste indépendant de celui de la bibliothèque générale.</p><label>Rechercher une pièce autorisée<input value={query} onChange={event=>setQuery(event.target.value)}/></label><ContactDocumentCards access={access} documents={documents.filter(doc=>[doc.title,doc.file_name,doc.document_type].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()))} onChanged={refresh}/>{message&&<p role="status">{message}</p>}</section>;
}
