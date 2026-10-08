import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const collectionDefinitions=require('../../lib/access/collections.json');
/** Fictitious transport for the actual integrated CRM. No real Auth or database. */
export const modules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','monthlyCharges','documents','planning','properties','vehicles','boats','izord','publisher'];
export const labels = { dashboard:'Tableau de bord',contacts:'Contacts',leads:'Demandes clients',tasks:'Tâches',quotes:'Devis clients',bookings:'Réservations',vendorQuotes:'Devis prestataires',vendorInvoices:'Factures prestataires',houseTracking:'Personnel & interventions',monthlyCharges:'Charges mensuelles',documents:'Documents',planning:'Planning',properties:'Biens immobiliers',vehicles:'Voitures',boats:'Bateaux',izord:'IZORD Invest',publisher:'Instagram Publisher',admin:'Administration' };
export const groups = [
  {id:'commercial',label:'Commercial',modules:['leads','quotes']},
  {id:'operations',label:'Opérations',modules:['bookings','planning']},
  {id:'assets',label:'Biens & flotte',modules:['properties','vehicles','boats']},
  {id:'services',label:'Maison & services',modules:['houseTracking','vendorQuotes','vendorInvoices','monthlyCharges']},
  {id:'resources',label:'Marketing & ressources',modules:['publisher','documents']},
];
export const profiles = {
  full:{allowed:modules,admin:true,full:true},
  limited:{allowed:['contacts','tasks','planning','houseTracking','publisher'],admin:false},
  charges:{allowed:['monthlyCharges'],admin:false},
  planning:{allowed:['planning'],admin:false},
  house:{allowed:['houseTracking'],admin:false},
  publisher:{allowed:['publisher'],admin:false},
  reader:{allowed:['contacts','tasks','planning','houseTracking'],admin:false,level:'read'},
  none:{allowed:[],admin:false},
  admin:{allowed:['contacts','tasks','planning'],admin:true},
};
const stamp='2026-10-08T10:00:00Z';
export const fixtureAccountId = profile => `00000000-0000-4000-8000-${String(Object.keys(profiles).indexOf(profile)+1).padStart(12,'0')}`;
export const sharedTaskId = 'i18n-task-shared-full-limited';
export function createFixture(profile='full') {
  if(!profiles[profile]) throw new Error('Unknown fictitious profile');
  let current=structuredClone(profiles[profile]);
  let revision=1;
  const user={id:fixtureAccountId(profile),aud:'authenticated',role:'authenticated',email:`i18n-${profile}@example.invalid`,email_confirmed_at:stamp,app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:stamp};
  const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',email:user.email,exp:4102444800})).toString('base64url'),'fictional-local-signature'].join('.');
  const fullId=fixtureAccountId('full'),limitedId=fixtureAccountId('limited');
  const tasks=['À faire','En cours','Terminé'].map((status,index)=>({id:`i18n-task-${profile}-${index}`,title:`Tâche privée fictive ${profile} ${index+1}`,status,notes:'Note métier en français conservée telle quelle.',dueDate:'2026-10-08',priority:'normal',createdBy:user.id,createdByLabel:`Compte fictif ${profile}`,createdAt:stamp,updatedAt:stamp,revision:1,assignees:[]}));
  if(['full','limited'].includes(profile))tasks.unshift({id:sharedTaskId,title:'Préparer la visite bilingue — donnée métier française',status:'À faire',notes:'Texte libre français partagé entre les deux comptes, jamais traduit.',dueDate:'2026-10-15',priority:'important',createdBy:fullId,createdByLabel:'Compte fictif FR',createdAt:stamp,updatedAt:stamp,revision:1,assignees:[{userId:limitedId,label:'Compte fictif EN',email:'i18n-limited@example.invalid',access:'contribute',active:true}]});
  const payload=Object.fromEntries(['contacts','leads','properties','vehicles','boats','tasks','suppliers','planningEntries','quotes','documents','vendorQuotes','vendorInvoices','houseTrackingHouses','houseTrackingWorkers','houseTimeEntries','housePayments'].map(key=>[key,[]]));
  payload.contacts=[{id:'i18n-contact-1',name:'Alice Exemple',firstName:'Alice',kind:'Client',email:'alice@example.invalid',phone:'+33000000001',city:'Ville fictive',postalAddress:'',budget:0,source:'Autre',notes:'',createdAt:stamp},{id:'i18n-contact-2',name:'Bruno Démonstration',kind:'Client',email:'bruno@example.invalid',phone:'+33000000002',city:'Ville fictive',postalAddress:'',budget:0,source:'Autre',notes:'',createdAt:stamp}];
  payload.contacts.push({id:'i18n-contact-worker',name:'Camille Fictive',kind:'Intervenant (personnel maison)',email:'camille@example.invalid',phone:'+33000000003',city:'Ville fictive',postalAddress:'',budget:0,source:'Autre',notes:'Personnel fictif',createdAt:stamp});
  payload.properties=[{id:'i18n-property',name:'Villa Démonstration',city:'Ville fictive',type:'Villa',price:1234567.89,status:'Disponible',owner:'Alice Exemple',bedrooms:4,surface:180,notes:'Description française conservée.'}];
  payload.vehicles=[{id:'i18n-vehicle',name:'Voiture de démonstration',brand:'Marque fictive',model:'Modèle fictif',city:'Ville fictive',price:250,status:'Disponible',owner:'Alice Exemple',notes:'Donnée métier française.'}];
  payload.boats=[{id:'i18n-boat',name:'Bateau de démonstration',port:'Port fictif',type:'Voilier',length:12,price:500,status:'Disponible',owner:'Alice Exemple',notes:'Donnée métier française.'}];
  payload.leads=[{id:'i18n-lead',clientName:'Alice Exemple',contactId:'i18n-contact-1',requestType:'Villa',status:'À traiter',budget:5000,city:'Ville fictive',nextAction:'Rappeler Alice',nextActionDate:'2026-10-10',notes:'Demande libre en français',createdAt:stamp}];
  payload.planningEntries=[{id:'i18n-planning',title:'Visite de la villa — titre français',type:'Autre',planningCategory:'Villa',status:'Prévu',priority:'Normal',contactName:'Alice Exemple',assetType:'Property',assetId:'i18n-property',startDate:'2026-10-08',startTime:'10:15',endDate:'2026-10-08',endTime:'11:30',blocksAvailability:false,notes:'Rendez-vous fictif'}];
  payload.houseTrackingHouses=[{id:'i18n-house',name:'Maison Démonstration',address:'1 avenue Fictive',notes:'Texte français',createdAt:stamp}];
  payload.houseTrackingWorkers=[{id:'i18n-worker',contactId:'i18n-contact-worker',contactName:'Camille Fictive',role:'Entretien',hourlyRate:25,status:'Actif',notes:'Texte libre conservé',createdAt:stamp}];
  payload.houseTimeEntries=[{id:'i18n-time',houseId:'i18n-house',houseName:'Maison Démonstration',workerId:'i18n-worker',workerName:'Camille Fictive',date:'2026-10-08',startTime:'09:15',endTime:'11:30',breakMinutes:15,hourlyRate:25,note:'Intervention fictive',createdAt:stamp}];
  payload.housePayments=[{id:'i18n-payment',houseId:'i18n-house',houseName:'Maison Démonstration',workerId:'i18n-worker',workerName:'Camille Fictive',date:'2026-10-08',amount:50,method:'Virement',note:'Paiement fictif',createdAt:stamp}];
  // A stale workspace task must never feed canonical task projections or badges.
  payload.tasks=Array.from({length:11},(_,i)=>({id:`stale-${i}`,title:'TÂCHE PRIVÉE HORS PROJECTION',status:'À faire',owner:'Autre compte',dueDate:'2026-10-08',priority:'normal',notes:''}));
  payload.vendorQuotes=[{id:'i18n-vq',title:'Devis fictif',status:'À valider',totalAmount:100,contactName:'Prestataire fictif',category:'Autre',date:'2026-10-08',notes:''}];
  payload.vendorInvoices=Array.from({length:12},(_,i)=>({id:`i18n-vi-${i}`,title:`Facture fictive ${i+1}`,status:'À payer',amount:100,totalAmount:100,paidAmount:0,contactName:'Prestataire fictif',category:'Autre',issueDate:'2026-10-08',dueDate:'2026-11-08',notes:''}));
  const audit={profile,reads:[],auth:[],blocked:[],writes:[],privateTasksDelivered:0};
  const access=()=>({revision,active:true,generalAdmin:current.admin,fullAccess:Boolean(current.full),modules:Object.fromEntries(modules.map(module=>[module,{level:current.allowed.includes(module)?current.level||'contribute':'none',sensitive:{}}]))});
  const reply=(body,status=200)=>({status,body});
  function respond(method,url,body={}) {
    const path=url.pathname;
    if(method==='OPTIONS')return reply(null,204);
    if(path==='/auth/v1/token'){audit.auth.push('simulated sign in');return reply({access_token:token,refresh_token:'fictional-refresh',token_type:'bearer',expires_in:31536000,user});}
    if(path==='/auth/v1/user'){audit.auth.push('simulated user');return reply(user);}
    if(path==='/auth/v1/logout'){audit.auth.push('simulated sign out');return reply({});}
    const rpc=path.split('/rest/v1/rpc/')[1];
    const readRPC=['crm_access_snapshot','crm_admin_users','crm_admin_history_page','crm_read_module','crm_reference_options','crm_tasks_read','crm_tasks_directory','crm_read_monthly_charges'];
    if(method!=='GET'&&!readRPC.includes(rpc)){audit.blocked.push(method+' '+path);if(method!=='OPTIONS')audit.writes.push(method+' '+path);return reply({error:'Fictional read-only transport'},403);}
    audit.reads.push({path,module:body.p_module??null});
    if(rpc==='crm_access_snapshot')return reply(access());
    if(rpc==='crm_admin_users')return reply({users:[{...user,confirmed:true,active:true,generalAdmin:current.admin,revision,modules:access().modules,izordRole:current.allowed.includes('izord')?'admin':'none',assignments:[]}],invitations:[{id:'fictional-invitation',email:'pending@example.invalid',expires_at:'2026-10-15T10:30:00Z'}],projects:[{id:'fictional-project',title:'Dossier fictif'}],history:[]});
    if(rpc==='crm_admin_history_page')return reply({events:[{id:'9007199254740993',created_at:stamp,action:'access_saved',actor_id:user.id,subject_id:user.id},{id:'9007199254740992',created_at:stamp,action:'invitation_accepted',actor_id:user.id,subject_id:null},{id:'9007199254740991',created_at:stamp,action:'document_shared',actor_id:null,subject_id:user.id},{id:'9007199254740990',created_at:stamp,action:'invitation_prepared',actor_id:user.id,subject_id:null}],nextCursor:null,hasMore:false});
    if(rpc==='crm_tasks_read')return reply(current.allowed.includes('tasks')?tasks:[]);
    if(rpc==='crm_tasks_directory')return reply([...new Set([fullId,limitedId,user.id])].map(id=>({userId:id,label:id===fullId?'Compte fictif FR':id===limitedId?'Compte fictif EN':'Compte fictif',email:id===fullId?'i18n-full@example.invalid':id===limitedId?'i18n-limited@example.invalid':user.email,access:'contribute'})));
    if(rpc==='crm_read_module'){if(!current.allowed.includes(body.p_module))return reply({error:'forbidden'},403);const projected=Object.fromEntries(collectionDefinitions.filter(entry=>entry.module===body.p_module&&entry.collection!=='tasks').map(entry=>[entry.collection,payload[entry.collection]||[]]));return reply({revision:stamp,collections:projected});}
    if(rpc==='crm_reference_options')return reply({contacts:current.allowed.includes('contacts')?payload.contacts:[],leads:current.allowed.includes('leads')?payload.leads:[]});
    if(rpc==='crm_read_monthly_charges')return reply({revision:stamp,sourceRevision:stamp,config:{personRules:[{source:'invoice',personId:'i18n-supplier',included:true},{source:'hours',personId:'i18n-worker',included:true}],exceptions:[],attachments:[]},sources:{invoices:[{id:'i18n-month-invoice',personId:'i18n-supplier',personLabel:'Fournisseur Démonstration',title:'Facture française conservée',invoiceDate:'2026-10-08',amount:1234.56,status:'À payer'}],timeEntries:[{id:'i18n-time',personId:'i18n-worker',personLabel:'Camille Fictive',houseId:'i18n-house',houseName:'Maison Démonstration',date:'2026-10-08',startTime:'09:15',endTime:'11:30',breakMinutes:15,hourlyRate:25}],suppliers:[{id:'i18n-supplier',label:'Fournisseur Démonstration'}],workers:[{id:'i18n-worker',label:'Camille Fictive',status:'Actif'}],houses:payload.houseTrackingHouses},permissions:{canContribute:current.level!=='read',readableSources:current.full?['invoice','hours']:[],exportableSources:[],contactsVisible:current.allowed.includes('contacts')}});
    if(path==='/rest/v1/app_memberships')return reply([{workspace_id:'oar',role:'member'},...(current.allowed.includes('izord')?[{workspace_id:'izord',role:'admin'}]:[])]);
    if(path==='/rest/v1/crm_workspace_state')return reply({payload,updated_at:stamp});
    if(['/rest/v1/izord_projects','/rest/v1/izord_project_versions'].includes(path))return reply([]);
    if(path==='/api/publisher'&&method==='GET'&&['today','history'].includes(url.searchParams.get('action')))return reply(url.searchParams.get('action')==='today'?{state:'empty'}:{posts:[]});
    audit.blocked.push(method+' '+path);return reply({error:'Endpoint outside fictional read-only transport'},403);
  }
  return {profile,user,token,audit,access,respond,tasks,payload,setAccess(next){current={...current,...next};revision++;},expectedShortcuts(){return [...modules.filter(m=>current.allowed.includes(m)),...(current.admin?['admin']:[])].slice(0,4);}};
}
export async function installFixture(context,profile,origin) {
  const fixture=createFixture(profile);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='http://127.0.0.1:4097'||(url.origin===origin&&url.pathname.startsWith('/api/'))){
      const reply=fixture.respond(request.method(),url,request.postDataJSON?.()||{});
      return route.fulfill({status:reply.status,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},contentType:'application/json',body:reply.body===null?'':JSON.stringify(reply.body)});
    }
    if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    fixture.audit.blocked.push(request.method()+' '+url.origin+url.pathname);return route.abort();
  });
  return fixture;
}
