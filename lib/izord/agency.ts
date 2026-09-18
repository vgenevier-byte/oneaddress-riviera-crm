/** Conservative original HTML agency parser; evidence and warnings remain user-reviewable. */
import { fmt, BASE } from "./finance";
import { LIMITS, PHOTO_ROLES, createProjectData, assertProjectImageBudget, type GalleryPhoto, type PhotoRole, type ProjectData } from "./model";
import { fileData, resizeImported, cropPhoto, RATIOS, checkAbort } from "./photos";
import { PDF_READER_SOURCE } from "./agency-worker";
export type PdfPage = { page:number; text:string };
export type ExtractionEvidence = { page:number|null; extract:string };
export type AgencyExtraction = { filename:string; pages:number; fields:Record<string,string>; evidence:Record<string,ExtractionEvidence>; extra:string[]; warnings:string[]; agency:string; parser:string; rawText:string };
export type AgencyReport = AgencyExtraction & { gallery:GalleryPhoto[]; readerWarnings:string[]; roles:Record<PhotoRole,number>; sourceFile:File };
export type PdfReadResult = { pages:PdfPage[]; images:{bytes:Uint8Array;page:number;width:number;height:number}[]; warnings:string[] };
export const IMPORT_FIELDS: [string,string][]=[['project','Nom du projet'],['ref','Référence agence'],['address','Adresse / localisation'],['type','Typologie'],['sea','Vue mer'],['land','Terrain (m²)'],['area','Surface annoncée (m²)'],['asking','Prix demandé (€)'],['features','Équipements / particularités'],['measurement','Nature des surfaces'],['propertyWarnings','Points à confirmer']];
export const ROLE_LABELS={main:'1 · Vue d’ensemble',view:'2 · Vue / environnement',inside:'3 · Intérieur',operation:'4 · État existant'};
export function cleanText(s: unknown){return String(s||'').replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();}
export function importNum(s: unknown){let x=cleanText(s).replace(/\s/g,'');if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x))x=x.replace(/\./g,'');const n=Number(x.replace(',','.'));return Number.isFinite(n)&&n>=0?String(n):'';}
export function parseAgency(pages: PdfPage[],filename: string): AgencyExtraction{
 const fields: Record<string,string>={},evidence: Record<string,ExtractionEvidence>={},extra: string[]=[],warnings: string[]=[];const cleaned=pages.map(x=>({...x,flat:cleanText(x.text)}));const all=cleaned.map(x=>x.flat).join('\n');const raw=pages.map(x=>x.text).join('\n');
 const record=(key:string,value:unknown,pg:number|null,extract:unknown)=>{if(value===undefined||value===null||value==='')return;fields[key]=String(value);evidence[key]={page:pg,extract:cleanText(extract).slice(0,230)};};
 const match=(key:string,re:RegExp,group=1,fn:(value:string)=>string=x=>x)=>{for(const p of cleaned){const m=p.flat.match(re);if(m){record(key,fn(m[group]),p.page,m[0]);return m;}}return null;};
 const isLogi=/LOGI\s+SERVICE/i.test(all),isHR=/Hermitage\s+Riviera/i.test(all);let agency=isLogi?'LOGI SERVICE IMMOBILIER':isHR?'Hermitage Riviera':'Agence à confirmer';
 match('ref',/\bR[ée]f[ée]rence\s*:?\s*([A-Z0-9][A-Z0-9_/-]{2,25})/i);
 if(!fields.ref&&isHR)match('ref',/\b(HR\d{3,8})\b/);
 match('type',/Type de bien\s*:?\s*(Maison|Villa|Appartement|Terrain|Immeuble)\b/i,1,x=>/^villa$/i.test(x)?'Maison':x[0].toUpperCase()+x.slice(1).toLowerCase());
 if(!fields.type){for(const p of cleaned){const m=p.flat.slice(0,500).match(/\b(Villa|Maison|Appartement)\s+(?:[A-ZÀ-Ÿ]|à [Vv]endre)/);if(m){record('type',m[1]==='Villa'?'Maison':m[1],p.page,m[0]);break;}}}
 let city='',postal='',sector='';for(const p of pages){const c=p.text.match(/(?:^|\n)Ville\s*:?\s*\n?\s*([^\n]+)/i);const z=p.text.match(/(?:^|\n)Code postal\s*:?\s*\n?\s*(\d{5})/i);if(c&&!city)city=cleanText(c[1]);if(z&&!postal)postal=z[1];}
 if(isHR){const m=raw.match(/Villa\s+([^,\n]+),\s*([^\n]+?)(?=\s+Au calme|\s+Vue mer|\n)/i);if(m){city=cleanText(m[1]);sector=cleanText(m[2]);}}
 if(!city){const m=all.slice(0,800).match(/(?:Maison|Appartement|Villa)\s+à\s+[Vv]endre\s*[-–:]\s*([^\d]{3,40}?)(?=\s+(?:Informations|Référence|Surfaces|Prix))/);if(m)city=cleanText(m[1]);}
 let exact: string|null=null;for(const p of pages){const m=p.text.match(/(?:^|\n)Adresse (?:du bien|du logement|exacte)\s*:?\s*\n?\s*([^\n]+)(?:\n([^\n]+))?/i);if(m&&/\d/.test(m[1])&&/\b(?:rue|avenue|boulevard|chemin|place|route|allée|impasse|quai)\b/i.test(m[1])){exact=cleanText(m[1]+(/\b\d{5}\b/.test(m[2]||'')?' — '+m[2]:''));record('address',exact,p.page,m[0]);break;}}
 if(!exact){const loc=[postal,city].filter(Boolean).join(' ')+(sector?' / '+sector:'');fields.address=loc?loc+' — adresse exacte à confirmer':'';evidence.address={page:city?1:null,extract:'Localisation seulement ; aucune adresse du bien identifiée. L’adresse de l’agence n’est pas utilisée.'};warnings.push('Adresse exacte non communiquée ou non reconnue.');}
 fields.project=[fields.type==='Maison'?'Maison':fields.type||'Projet',city?('— '+city):'',sector?('/ '+sector):''].filter(Boolean).join(' ').slice(0,58);if(fields.ref)fields.ref=fields.ref.slice(0,75);
 const nr='([0-9][0-9 .,]{0,14})';let ar=match('area',new RegExp('\\bSURFACE HABITABLE\\s*:?\\s*'+nr+'\\s*m\\s*[²2]','i'),1,importNum);if(ar)fields.measurement='Surface habitable annoncée par l’agence ; mesurage à confirmer.';
 if(!ar){ar=match('area',new RegExp('\\bSurface(?: totale| du bien| Loi Carrez| Carrez)?\\s*:?\\s*'+nr+'\\s*m\\s*[²2]','i'),1,importNum);if(ar)fields.measurement='Surface annoncée ; qualification habitable / Carrez à confirmer.';}
 match('land',new RegExp('\\b(?:Surface (?:du |de )?terrain|Terrain)\\s*:?\\s*'+nr+'\\s*m\\s*[²2]','i'),1,importNum);if(!fields.land)warnings.push('Surface du terrain non communiquée ou non reconnue.');
 const pprice=match('asking',/\bPrix(?: affiché| demandé| de vente)?\s*:?\s*([0-9][0-9 .,]{3,18})\s*(?:EUR|€|¤)/i,1,importNum);
 if(!pprice){for(const p of cleaned){let found=false;for(const m of p.flat.slice(0,1000).matchAll(/([0-9][0-9 .,]{3,18})\s*(?:EUR|€|¤)/gi)){const v=importNum(m[1]),prev=p.flat.slice(Math.max(0,(m.index??0)-60),m.index);if(+v>=50000&&!/capital|garanti|d[ée]pense|estim[ée]|loyer/i.test(prev)){record('asking',v,p.page,m[0]);found=true;break;}}if(found)break;}}
 let sea=false;if(match('sea',/\b(sans vue mer|pas de vue mer|aucune vue mer|vue mer\s*:?\s*non)\b/i,1,()=>'Non'))sea=true;
 else if(match('sea',/\b((?:vue mer|vue sur la mer)[^.;]{0,15}partielle|aper[çc]u mer)\b/i,1,()=>'Partielle'))sea=true;
 else if(match('sea',/\b((?:vue|vue sur la)\s*:?\s*mer)\b/i,1,()=>'Oui'))sea=true;
 if(!sea){fields.sea='À confirmer';if(/\bcanal\b/i.test(all)){warnings.push('Vue canal mentionnée ; vue mer non confirmée.');fields.environment='Canal';}else if(/Bord de mer\s*:?\s*Oui/i.test(all))warnings.push('« Bord de mer » ne confirme pas une vue mer.');else warnings.push('Vue mer non renseignée ou non reconnue.');}
 const beds=match('bedrooms',/\bChambres\s*:?\s*(\d{1,2})\b/i);const rooms=match('rooms',/\bNombre (?:de )?pi[èe]ces\s*:?\s*(\d{1,2})\b/i);match('levels',/\bNombre (?:de )?niveaux\s*:?\s*(\d{1,2})\b/i);
 match('berth',/\bamarrage de\s*(\d+(?:[,.]\d+)?\s*[x×]\s*\d+(?:[,.]\d+)?)\s*m[èe]tres/i,1,x=>cleanText(x).replace(/x/i,'×')+' m');
 const feature=[];if(rooms)feature.push(fields.rooms+' pièces');if(beds)feature.push(fields.bedrooms+' chambres');if(fields.berth)feature.push('Amarrage '+fields.berth);if(/piscine chauff[ée]e/i.test(all))feature.push('Piscine chauffée');else if(/\bPiscine\s*:?(?:\s+Oui|\s*[-•])/i.test(all))feature.push('Piscine');if(/ascenseur (?:int[ée]rieur|oui)/i.test(all))feature.push('Ascenseur');if(feature.join(' · ').length<75&&/\bJardin\s*:?\s*Oui\b/i.test(all))feature.push('Jardin');fields.features=feature.join(' · ').slice(0,90);
 if(/(?:maison d[’']amis|maison (?:de |d[’'])?gardien|d[ée]pendance)/i.test(all)&&fields.type==='Maison'){fields.type='Maison + dépendance';warnings.push('Ventilation des surfaces par bâtiment à confirmer.');fields.mainLabel='Maison principale';fields.secondLabel='Maison annexe';}
 // Ventiler uniquement si les surfaces sont explicitement chiffrées dans l’annonce.
 match('mainArea',/\bMaison principale\s*(?:de|:)\s*([\d .,]+)\s*m\s*[²2]/i,1,importNum);
 match('secondArea',/\b(?:Maison de gardien|Maison d[’']amis|Dépendance)\s*(?:de|:)\s*([\d .,]+)\s*m\s*[²2]/i,1,importNum);
 if(!fields.mainArea)fields.mainLabel='Ventilation par bâtiment à préciser';
 const charges=match('agencyCharges',/\bCharges (?:forfaitaires|annuelles|mensuelles|de copropriété)\s*:?\s*([\d .,]+)\s*(?:EUR|€|¤)/i,1,importNum);if(charges){extra.push(charges[0]);warnings.push('Charges '+fmt(+fields.agencyCharges)+' € : nature / périodicité à vérifier avant intégration.');}
 const comment=all.match(/Commentaires\s+([\d .,]+)\s*(?:€|¤|EUR)/i);if(comment){extra.push('Mention non qualifiée : '+cleanText(comment[0]));warnings.push('Mention '+fmt(+importNum(comment[1]))+' € non qualifiée : ne pas la compter automatiquement.');}
 const fee=all.match(/(?:frais d[’']agence|honoraires)[^.;]{0,55}(?:charge du vendeur|charge de l[’']acqu[ée]reur)/i);if(fee)extra.push(cleanText(fee[0]));
 fields.agencyFee=fee?cleanText(fee[0]):'Honoraires à vérifier auprès de l’agence';
 fields.source=(filename+' · '+agency+' · '+(fields.ref||'référence à confirmer')+' · Données et photos de l’agence ; extraction à vérifier.').slice(0,210);
 let concise=[];if(!exact)concise.push('Adresse exacte à confirmer.');if(!fields.land)concise.push('Terrain non renseigné.');if(fields.sea==='À confirmer')concise.push(fields.environment==='Canal'?'Vue canal ; vue mer à confirmer.':'Vue mer à confirmer.');if(charges)concise.push('Charges / montants annexes à clarifier.');if(!fields.mainArea&&fields.type==='Maison + dépendance')concise.push('Surfaces par bâtiment à préciser.');fields.propertyWarnings=concise.join(' ').slice(0,175);
 fields.program='Programme de rénovation à définir.\nActe et livraison : dates à valider.';fields.decisionNotes='Prix cible, travaux, revente et location à estimer.\nFinancement et pièces techniques à vérifier.';
 if(!fields.area)warnings.push('Surface du bien non renseignée ou non reconnue.');if(!fields.asking)warnings.push('Prix demandé non renseigné ou non reconnu.');
 const chars=raw.replace(/\s/g,'');if(chars.length<60)warnings.unshift('Texte non exploitable : ce PDF peut être scanné. Aucun OCR n’est intégré ; compléter les champs manuellement.');if((raw.match(/�/g)||[]).length>8)warnings.unshift('Encodage de texte partiellement illisible : vérifiez tous les champs.');
 return {filename,pages:pages.length,fields,evidence,extra,warnings,agency,parser:isLogi?'Fiche structurée Logi Service':isHR?'Brochure Hermitage Riviera':'Détection générique — vérification renforcée',rawText:pages.map(p=>'PAGE '+p.page+'\n'+p.text).join('\n\n')};
}

export function workerRead(buffer: ArrayBuffer, options: { signal?: AbortSignal; onProgress?: (page:number,total:number)=>void } = {}): Promise<PdfReadResult> {
  checkAbort(options.signal);
  if (!buffer.byteLength || buffer.byteLength > LIMITS.fileBytes || !new TextDecoder("latin1").decode(buffer.slice(0, 1024)).includes("%PDF-")) return Promise.reject(new Error("Ce fichier n’est pas un PDF reconnu (25 Mo maximum)."));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([PDF_READER_SOURCE], { type: "text/javascript" }));
    let worker: Worker;
    try { worker = new Worker(url); } catch (error) { URL.revokeObjectURL(url); reject(error); return; }
    const finish = () => { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); worker.terminate(); URL.revokeObjectURL(url); };
    const abort = () => { finish(); reject(new DOMException("Lecture annulée.", "AbortError")); };
    const timeout = setTimeout(() => { finish(); reject(new Error("Lecture interrompue après 60 secondes : PDF trop complexe pour ce lecteur.")); }, 60_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{progress?:number;total?:number;error?:string;result?:PdfReadResult}>) => {
      if (event.data.progress) options.onProgress?.(event.data.progress, event.data.total ?? 0);
      if (event.data.error) { finish(); reject(new Error(event.data.error)); }
      if (event.data.result) {
        finish(); const result = event.data.result;
        if (result.pages.length > 120 || result.images.length > 80 || result.pages.reduce((sum,page)=>sum+page.text.length,0) > 4_000_000) { reject(new Error("Résultat PDF trop volumineux.")); return; }
        resolve(result);
      }
    };
    worker.onerror = event => { finish(); reject(new Error(event.message || "Lecture du PDF impossible.")); };
    worker.postMessage(buffer, [buffer]);
  });
}
export async function analyzeAgencyFiles(files: File[] | FileList, options: { signal?:AbortSignal; onProgress?:(filename:string,page:number,total:number)=>void } = {}): Promise<AgencyReport[]> {
  const selected = Array.from(files); if (selected.length > LIMITS.pdfFiles) throw new Error("Maximum six PDF par import. Chaque PDF reste un bien distinct.");
  const reports: AgencyReport[] = [];
  for (const file of selected) {
    checkAbort(options.signal);
    if (!/\.pdf$/i.test(file.name) || file.type && file.type !== "application/pdf") throw new Error("Utilisez une fiche au format PDF.");
    if (!file.size || file.size > LIMITS.fileBytes) throw new Error(`${file.name} : maximum 25 Mo par PDF, fichier non vide.`);
    const bytes = await file.arrayBuffer(); checkAbort(options.signal);
    const data = await workerRead(bytes, { signal: options.signal, onProgress:(page,total)=>options.onProgress?.(file.name,page,total) });
    const extraction = parseAgency(data.pages, file.name); const gallery: GalleryPhoto[] = [];
    for (const image of data.images) {
      checkAbort(options.signal);
      try { const value = await resizeImported(await fileData(new Blob([Uint8Array.from(image.bytes)], { type: "image/jpeg" }), options.signal), options.signal); gallery.push({ page:image.page,width:image.width,height:image.height,data:value,label:`Photo ${gallery.length + 1} · p. ${image.page}`,source:"PDF" }); }
      catch (error) { checkAbort(options.signal); extraction.warnings.push(`Une photographie n’a pas pu être décodée : ${error instanceof Error ? error.message : "JPEG non lisible"}`); }
    }
    reports.push({ ...extraction, gallery, readerWarnings:data.warnings || [], roles:{ main:gallery.length?0:-1,view:gallery.length>1?1:-1,inside:gallery.length>2?2:-1,operation:gallery.length>3?3:-1 }, sourceFile:file });
  }
  return reports;
}
/** Caller must explicitly obtain review consent and replacement confirmation before applying. */
export async function applyAgencyReport(report: AgencyReport, signal?: AbortSignal): Promise<ProjectData> {
  checkAbort(signal); const next = createProjectData();
  for (const key of Object.keys(BASE)) if (key in report.fields && typeof next.state[key] === "string") { if (report.fields[key].length > 1000) throw new Error(`Champ importé trop long : ${key}.`); next.state[key] = report.fields[key]; }
  for (const key of ["acq","works","resale","weekly"]) next.state[key] = "";
  next.state.costsReviewed = false;
  for (const role of PHOTO_ROLES) { const index = report.roles[role]; if (index === -1) continue; const photo = report.gallery[index]; if (!Number.isInteger(index) || !photo) throw new Error("Affectation de photographie invalide."); next.photos[role] = await cropPhoto(photo.data, RATIOS[role], signal); next.photoGalleryRoles[role] = index; }
  next.importMeta = { filename:report.filename,pages:report.pages,agency:report.agency,parser:report.parser,evidence:report.evidence,extra:report.extra,warnings:[...report.warnings,...report.readerWarnings],validatedAt:new Date().toISOString(),roles:{...report.roles} };
  next.importGallery = report.gallery.map(photo=>({...photo})); assertProjectImageBudget(next); checkAbort(signal); return next;
}
