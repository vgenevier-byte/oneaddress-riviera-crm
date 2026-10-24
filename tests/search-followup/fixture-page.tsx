"use client";
/** Integrated business views on fictional projected data. Every save is a local simulation. */
import {useEffect,useState,type ComponentProps} from "react";
import {DocumentsView,HouseTrackingView} from "@/components/CRMApp";
import {BusinessContext,type BusinessPermissions} from "@/components/BusinessPermissions";
import {I18nProvider,useI18n} from "@/lib/i18n/I18nProvider";
import type {Contact,HouseTrackingWorker,HouseTimeEntry,HousePayment} from "@/lib/types";

type DocumentRow=ComponentProps<typeof DocumentsView>["documents"][number];
const date="2026-10-24",createdAt=`${date}T10:00:00Z`;
const contact=(row:Partial<Contact>)=>({kind:"Prestataire",name:"",city:"",postalAddress:"",budget:0,source:"Direct",notes:"",createdAt,...row} as Contact);
const contacts=[contact({id:"contact-clement",entityType:"person",firstName:"Clément",name:"Martin",city:"Cannes",companyId:"company-riviera",companyName:"Ancienne dénomination",email:"clement@example.invalid",phone:"0611223344"}),contact({id:"company-riviera",entityType:"company",name:"Agence Riviera",companyName:"Agence Riviera",city:"Cannes",email:"agence@example.invalid"}),contact({id:"contact-nora",entityType:"person",firstName:"Nora",name:"Bernard",city:"Nice"})];
const workers:HouseTrackingWorker[]=[
 {id:"worker-nora",contactId:"contact-nora",contactName:"Nora Bernard",role:"Gestion",hourlyRate:18,status:"Actif",createdAt},
 {id:"worker-clement",contactId:"contact-clement",contactName:"Clément Martin",role:"Jardinier",hourlyRate:25.5,status:"Actif",createdAt},
 {id:"worker-orphan",contactId:"contact-unavailable",contactName:"Intervenant historique",role:"Plomberie",hourlyRate:31.25,status:"Actif",createdAt},
 {id:"worker-archived",contactId:"contact-clement",contactName:"Clément Martin archivé",role:"Ancien jardinier",hourlyRate:23,status:"Inactif",createdAt},
 {id:"worker-archive-orphan",contactId:"archive-unavailable",contactName:"Historique archivé",role:"Ancien entretien",hourlyRate:19,status:"Inactif",createdAt}
];
const initialEntries:HouseTimeEntry[]=[{id:"time-original",workerId:"worker-clement",workerName:"Clément Martin",houseId:"house-riviera",houseName:"Villa des Oliviers",date,startTime:"09:00",endTime:"13:00",breakMinutes:0,hourlyRate:25.5,expenseAmount:12.75,expenseNote:"Achat fictif",createdAt},{id:"time-archived",workerId:"worker-archived",workerName:"Clément Martin archivé",houseId:"house-riviera",houseName:"Villa des Oliviers",date,startTime:"09:00",endTime:"11:00",breakMinutes:0,hourlyRate:23,expenseAmount:4.5,createdAt}];
const initialPayments:HousePayment[]=[{id:"payment-original",workerId:"worker-clement",workerName:"Clément Martin",houseId:"house-riviera",houseName:"Villa des Oliviers",date,amount:40.25,method:"Virement",createdAt},{id:"payment-archived",workerId:"worker-archived",workerName:"Clément Martin archivé",houseId:"house-riviera",houseName:"Villa des Oliviers",date,amount:20,method:"Virement",createdAt}];
const document=(id:string,title:string,folderId="",isFolder=false):DocumentRow=>({id,title,folderId,parentFolderId:folderId,isFolder,category:"Documents",status:"À jour",url:"",location:"",expiryDate:"",notes:"",addedAt:createdAt,addedBy:"Fixture"});
const documents=[document("folder-parent","Dossier parent","",true),document("folder-child","Contrats Riviera","folder-parent",true),document("folder-grandchild","Sous-dossier direct","folder-child",true),document("folder-sibling","Dossier voisin","folder-parent",true),document("file-child","Contenu unique du dossier","folder-child"),document("file-parent","Pièce du parent","folder-parent"),document("file-root","Pièce de la racine"),document("file-sibling","Pièce voisine","folder-sibling")];
const storageKey="search-followup-fictional-state";
function Demo(){
 const {language,setLanguage}=useI18n();
 const [mode,setMode]=useState<"full"|"company-hidden"|"contacts-hidden"|"read-only">("full"),[ready,setReady]=useState(false),[entries,setEntries]=useState(initialEntries),[payments,setPayments]=useState(initialPayments),[saves,setSaves]=useState<unknown[]>([]);
 useEffect(()=>{queueMicrotask(()=>{const value=localStorage.getItem(storageKey);if(value){const state=JSON.parse(value);setEntries(state.entries);setPayments(state.payments);setSaves(state.saves);}setReady(true);});},[]);
 useEffect(()=>{if(ready)localStorage.setItem(storageKey,JSON.stringify({entries,payments,saves}));},[ready,entries,payments,saves]);
 const permissions:BusinessPermissions={write:mode!=="read-only",remove:false,export:false,read:module=>mode!=="contacts-hidden"||module!=="contacts",canWrite:()=>mode!=="read-only",hiddenFields:mode==="read-only"?["notes"]:[],download:async()=>{throw Error("Downloads disabled in fixture");},upload:async()=>{throw Error("Uploads disabled in fixture");},check:async()=>{}};
 const projectedContacts=mode==="contacts-hidden"?[]:mode==="company-hidden"?contacts.filter(row=>row.entityType!=="company"):contacts;
 const unexpected=()=>{throw Error("Unexpected fixture action");};
 return <main className="fixture-main"><header className="card"><p className="eyebrow">One Address Riviera · Démonstration intégrée</p><h1>Documents et suivi maison</h1><p>Données fictives · sauvegardes locales simulées · aucun serveur métier</p><button type="button" className="secondary-button" onClick={()=>setLanguage(language==="fr"?"en":"fr")}>FR / EN</button><label>Projection autorisée<select data-fixture-projection value={mode} onChange={event=>setMode(event.target.value as typeof mode)}><option value="full">Complète fictive</option><option value="company-hidden">Entreprise inaccessible</option><option value="contacts-hidden">Contacts inaccessibles</option><option value="read-only">Lecture seule</option></select></label></header>
 {ready&&<BusinessContext.Provider value={permissions}><section id="integrated-documents"><h2>Documents — vue métier intégrée</h2><DocumentsView documents={documents} activeActor="" onAdd={unexpected} onUpdate={unexpected} onTrash={async()=>unexpected()} canTrash={false} sessionUserId="fixture-user"/></section><section id="integrated-house"><h2>Suivi maison — vue métier intégrée</h2><HouseTrackingView key={mode} contacts={projectedContacts} houses={[{id:"house-riviera",name:"Villa des Oliviers",address:"Cannes",createdAt}]} workers={workers} timeEntries={entries} payments={payments} onAddHouse={unexpected} onDeleteHouse={unexpected} onAddWorker={unexpected} onArchiveWorker={unexpected} onReactivateWorker={unexpected} onPermanentlyDeleteWorker={unexpected} onAddTimeEntry={entry=>{setEntries(current=>[...current,entry]);setSaves(current=>[...current,{kind:"hours",record:entry}]);return {ok:true,recordId:entry.id};}} onDeleteTimeEntry={unexpected} onAddPayment={payment=>{setPayments(current=>[...current,payment]);setSaves(current=>[...current,{kind:"payment",record:payment}]);}} onDeletePayment={unexpected}/></section></BusinessContext.Provider>}
 <output data-fixture-state hidden>{JSON.stringify({workers,entries,payments,saves,projection:mode})}</output></main>;
}
export default function Fixture(){return <I18nProvider><Demo/></I18nProvider>;}
