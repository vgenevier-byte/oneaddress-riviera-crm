"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { createProjectData, importProjectJson, exportProjectJson, type ProjectData, type ProjectState, type PhotoRole, LIMITS } from "@/lib/izord/model";
import { calculate, errorsFor, eur, pct, number, rentalExportIssues } from "@/lib/izord/finance";
import { analyzeAgencyFiles, applyAgencyReport, IMPORT_FIELDS, type AgencyReport } from "@/lib/izord/agency";
import { addPhotoFile, assignGalleryPhoto } from "@/lib/izord/photos";
import { generatePresentation } from "@/lib/izord/presentation";
import { createGeneratorRepository, type LoadedProject, type ProjectRecord, type VersionRecord, type ProjectStatus } from "@/lib/izord/repository";
import type { GeneratorDraft } from "@/lib/izord/draftRecovery";
import PresentationPreview from "./PresentationPreview";
import fieldSource from "./fields.json";
import styles from "./IzordGenerator.module.css";

const roles: PhotoRole[] = ["main", "view", "inside", "operation"];
const roleLabels = { main: "Vue d’ensemble", view: "Vue / environnement", inside: "Intérieur", operation: "Photo de la diapositive 2" };
const statusLabels = { draft: "Brouillon", review: "En revue", approved: "Approuvé" };
const repository = createGeneratorRepository(supabase);
const fields = fieldSource as {key: keyof ProjectState; label: string; kind: string; numeric?: boolean; maxLength?: number; options?: {value:string;label:string}[]}[];
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeName(value: string) { return (value || "projet-izord").replace(/[^a-zA-Z0-9À-ÿ_-]+/g, "-").slice(0,70); }
function isConflict(error: unknown) { return error instanceof Error && (error.name === "GeneratorConflictError" || /conflit|revision_conflict|40001/i.test(error.message)); }
function messageOf(error: unknown) { return error instanceof Error ? error.message : "Opération indisponible. Votre brouillon reste en mémoire."; }

export default function IzordGenerator({role,canExport=true,userId,onUnsavedChange,accessSignal,recovery,onDraft}:{role:string;canExport?:boolean;userId:string;onUnsavedChange:(value:boolean)=>void;accessSignal:AbortSignal;recovery?:GeneratorDraft;onDraft:(draft:GeneratorDraft)=>void}) {
  const canWrite = ["admin","partner","contributor"].includes(role), canApprove = ["admin","partner"].includes(role);
  const [projects,setProjects] = useState<ProjectRecord[]>([]), [listLoading,setListLoading] = useState(true);
  const [draftId,setDraftId] = useState(()=>recovery?.draftId??crypto.randomUUID());
  const [data,setData] = useState<ProjectData|null>(recovery?.data??null), [loaded,setLoaded] = useState<LoadedProject|null>(recovery?.loaded??null);
  const [dirty,setDirty] = useState(recovery?.dirty??false), [busy,setBusy] = useState(false), [notice,setNotice] = useState(recovery?"Brouillon repris après vérification des droits. Aucune sauvegarde automatique. Décision et état à enregistrer revérifiés. Contrôlez la liste et les transferts : une opération déjà envoyée peut avoir abouti. Relancez toute analyse ou conversion interrompue.":"");
  const [error,setError] = useState(""), [conflict,setConflict] = useState(recovery?.conflict??false), [remote,setRemote] = useState<LoadedProject|null>(null);
  const [workflow,setWorkflow] = useState<ProjectStatus>(recovery?.workflow??"draft"), [versions,setVersions] = useState<VersionRecord[]>([]);
  const [sourceFiles,setSourceFiles] = useState<File[]>(recovery?.sourceFiles??[]), [reports,setReports] = useState<AgencyReport[]>(recovery?.reports??[]);
  const [reportIndex,setReportIndex] = useState(recovery?.reportIndex??0), [reviewed,setReviewed] = useState(recovery?.reviewed??false), [pdfFiles,setPdfFiles] = useState<File[]>(recovery?.pdfFiles??[]);
  const epoch = useRef(0), controller = useRef<AbortController|null>(null);
  const invalidate = useCallback(() => { epoch.current++; controller.current?.abort(); }, []);
  const report = reports[reportIndex];
  const result = useMemo(() => data ? calculate(data.state) : null,[data]);
  const financialErrors = data ? [...errorsFor(data.state), ...rentalExportIssues(result!)] : [];

  useLayoutEffect(()=>{
    if(!accessSignal.aborted)onDraft({draftId,data,loaded,dirty,sourceFiles,reports,reportIndex,reviewed,pdfFiles,conflict,workflow});
  },[accessSignal,onDraft,draftId,data,loaded,dirty,sourceFiles,reports,reportIndex,reviewed,pdfFiles,conflict,workflow]);

  useEffect(() => {
    let alive=true;
    const stop=()=>{alive=false;invalidate();};
    accessSignal.addEventListener("abort",stop,{once:true});
    if(!accessSignal.aborted)repository.listProjects({signal:accessSignal}).then(value=>{if(alive&&!accessSignal.aborted){setProjects(value);setListLoading(false);}}).catch(()=>{if(alive&&!accessSignal.aborted){setError("La liste des projets est indisponible.");setListLoading(false);}});
    return ()=>{stop();accessSignal.removeEventListener("abort",stop);};
  },[userId,invalidate,accessSignal]);
  useEffect(()=>{onUnsavedChange(dirty);return()=>onUnsavedChange(false);},[dirty,onUnsavedChange]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  function begin(){accessSignal.throwIfAborted();controller.current?.abort();controller.current=new AbortController();return {id:++epoch.current,signal:AbortSignal.any([controller.current.signal,accessSignal])};}
  function current(id:number){return !accessSignal.aborted&&id===epoch.current;}
  function leave(){return !dirty||window.confirm("Ce brouillon n’est pas enregistré. Exportez son JSON pour le récupérer avant de quitter. Continuer sans l’enregistrer ?");}
  function edit(next:ProjectData){if(accessSignal.aborted||!canWrite)return;setData(next);setDirty(true);setNotice("Modifications non enregistrées");setError("");}
  function field(key:keyof ProjectState,value:string|boolean){if(data)edit({...data,state:{...data.state,[key]:value}});}
  function fresh(next=createProjectData(),files:File[]=[]){begin();setDraftId(crypto.randomUUID());setData(next);setLoaded(null);setVersions([]);setSourceFiles(files);setReports([]);setPdfFiles([]);setWorkflow("draft");setDirty(true);setBusy(false);setError("");setConflict(false);setRemote(null);setNotice("Nouveau brouillon — non enregistré");}
  async function refreshList(){const operation=begin();try{const list=await repository.listProjects({signal:operation.signal});if(current(operation.id))setProjects(list);}catch{if(current(operation.id))setError("Liste indisponible.");}}
  async function open(project:ProjectRecord){
    if(!leave())return;const operation=begin();setDraftId(crypto.randomUUID());setData(null);setLoaded(null);setDirty(false);setSourceFiles([]);setReports([]);setPdfFiles([]);setBusy(true);setError("");setNotice("Ouverture…");
    try{const value=await repository.loadProject(project.id,{signal:operation.signal,hydratePhotos:canWrite});const history=await repository.listVersions(project.id,{signal:operation.signal});
      if(current(operation.id)){setDraftId(crypto.randomUUID());setLoaded(value);setData(value.data);setWorkflow(value.project.status);setVersions(history);setDirty(false);setSourceFiles([]);setReports([]);setPdfFiles([]);setConflict(false);setRemote(null);setNotice("Enregistré · révision "+value.project.revision);}
    }catch(e){if(current(operation.id))setError(messageOf(e));}finally{if(current(operation.id))setBusy(false);}
  }
  async function save():Promise<LoadedProject|null>{
    if(accessSignal.aborted||!data||!canWrite||busy||loaded?.project.status==="approved"&&!canApprove)return null;
    const operation=begin(), snapshot=data;setBusy(true);setError("");setNotice("Enregistrement en cours…");
    try{
      const project=loaded?.project??await repository.createProject(snapshot.state.project||"Nouveau projet",{signal:operation.signal});
      if(!current(operation.id))return null;
      // Retain the created identity if a later upload fails; retry never creates a duplicate project.
      if(!loaded)setLoaded({project,data:snapshot,assets:[],sourceDocuments:[]});
      const value=await repository.saveProject({project,data:snapshot,previous:loaded??undefined,status:workflow,sourceFiles},{signal:operation.signal,onProgress:p=>{if(current(operation.id))setNotice(p.stage==="save"?"Enregistrement en cours…":`Transfert ${p.label} · ${Math.round(100*p.completed/Math.max(p.total,1))} %`);}});
      if(!current(operation.id))return null;
      setLoaded(value);setData(value.data);setDirty(false);setSourceFiles([]);setConflict(false);setRemote(null);setNotice("Enregistré · révision "+value.project.revision);
      const [list,history]=await Promise.all([repository.listProjects({signal:operation.signal}),repository.listVersions(project.id,{signal:operation.signal})]);
      // A project/account change also invalidates the value returned to an awaiting export.
      if(!current(operation.id))return null;
      setProjects(list);setVersions(history);return value;
    }catch(e){if(current(operation.id)){setConflict(isConflict(e));setError(messageOf(e));setNotice("Non enregistré — brouillon conservé en mémoire");}return null;}
    finally{if(current(operation.id))setBusy(false);}
  }
  async function exportPpt(){
    if(!canExport)return;
    if(accessSignal.aborted||!data||!canWrite||busy)return;
    let saved=loaded;
    if(dirty||!saved){if(!window.confirm("Enregistrer ces modifications avant de générer et archiver le PowerPoint de cette révision ?"))return;saved=await save();}
    if(!saved)return;
    const operation=begin();setBusy(true);setError("");setNotice("Génération du PowerPoint…");
    try{const blob=await generatePresentation(saved.data,{signal:operation.signal});if(!current(operation.id))return;
      await repository.uploadPresentation(saved.project,blob,{signal:operation.signal,onProgress:p=>{if(current(operation.id))setNotice(`Archivage · ${Math.round(100*p.completed/Math.max(p.total,1))} %`);}});
      if(!current(operation.id))return;
      download(blob,`${safeName(saved.data.state.project)}-r${saved.project.revision}.pptx`);
      const assets=await repository.listAssets(saved.project.id,{signal:operation.signal});if(current(operation.id)){setLoaded({...saved,assets});setNotice(`PowerPoint archivé · révision ${saved.project.revision}`);}
    }catch(e){if(current(operation.id)){setError(messageOf(e));setNotice("Export non archivé");}}finally{if(current(operation.id))setBusy(false);}
  }
  async function importJson(file:File){
    if(!leave())return;
    const operation=begin();try{if(file.size>LIMITS.jsonBytes)throw new Error("Projet JSON trop volumineux (180 Mo maximum).");const next=importProjectJson(await file.text());if(current(operation.id))fresh(next);}catch(e){if(current(operation.id))setError(messageOf(e));}
  }
  async function importPdf(files:File[]){
    const operation=begin();setBusy(true);setError("");setReviewed(false);setReports([]);setNotice("Lecture des fiches PDF…");
    try{const values=await analyzeAgencyFiles(files,{signal:operation.signal,onProgress:(filename,page,total)=>{if(current(operation.id))setNotice(`${filename} · page ${page}/${total}`);}});
      if(current(operation.id)){setReports(values);setPdfFiles(files);setReportIndex(0);setNotice("Vérifiez la fiche avant de l’appliquer.");}
    }catch(e){if(current(operation.id))setError(messageOf(e));}finally{if(current(operation.id))setBusy(false);}
  }
  async function applyReport(){
    if(!report||!reviewed||!leave())return;
    if(loaded&&!dirty&&!window.confirm("Créer un nouveau brouillon à partir de ce PDF ? Le dossier actuellement ouvert restera enregistré séparément."))return;
    const operation=begin();setBusy(true);try{const value=await applyAgencyReport(report,operation.signal);if(current(operation.id)){fresh(value,[pdfFiles[reportIndex]]);setReports([]);setPdfFiles([]);}}catch(e){if(current(operation.id))setError(messageOf(e));}finally{if(current(operation.id))setBusy(false);}
  }
  async function addPhotos(files:File[],photoRole?:PhotoRole){
    if(!data)return;const operation=begin();setBusy(true);setError("");let next=data;
    try{for(const file of files){next=await addPhotoFile(next,file,photoRole,operation.signal);if(!current(operation.id))return;}edit(next);}
    catch(e){if(current(operation.id))setError(messageOf(e));}finally{if(current(operation.id))setBusy(false);}
  }
  async function setPhoto(photoRole:PhotoRole,index:number){if(!data)return;const operation=begin();setBusy(true);try{const next=await assignGalleryPhoto(data,photoRole,index,operation.signal);if(current(operation.id))edit(next);}catch(e){if(current(operation.id))setError(messageOf(e));}finally{if(current(operation.id))setBusy(false);}}
  async function documentAction(action:(signal:AbortSignal)=>Promise<unknown>){
    if(!loaded||busy)return;const operation=begin(),snapshot=loaded;setBusy(true);setError("");
    try{await action(operation.signal);const assets=await repository.listAssets(snapshot.project.id,{signal:operation.signal});if(current(operation.id))setLoaded({...snapshot,assets});}
    catch(e){if(current(operation.id))setError(messageOf(e));}finally{if(current(operation.id))setBusy(false);}
  }
  function jsonDownload(){if(!accessSignal.aborted&&canWrite&&data)canExport && download(new Blob([exportProjectJson(data)],{type:"application/json"}),safeName(data.state.project)+(dirty?"-recuperation":"")+".json");}
  const fieldSet=(keys:string[])=> <div className={styles.fieldGrid}>{keys.map(key=>{const spec=fields.find(f=>f.key===key);if(!spec||!data)return null;const value=data.state[spec.key];return <label key={key} className={spec.kind==="checkbox"?styles.checkbox:undefined}>
    {spec.kind==="checkbox"?<><input id={`izord-${key}`} type="checkbox" checked={value===true} onChange={e=>field(spec.key,e.target.checked)}/>{spec.label}</>:<>{spec.label}{spec.kind==="select"?<select id={`izord-${key}`} value={String(value??"")} onChange={e=>field(spec.key,e.target.value)}>{spec.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:spec.kind==="textarea"?<textarea id={`izord-${key}`} maxLength={spec.maxLength} value={String(value??"")} onChange={e=>field(spec.key,e.target.value)}/>:<input id={`izord-${key}`} inputMode={spec.numeric?"decimal":undefined} maxLength={spec.maxLength} autoComplete="off" value={String(value??"")} placeholder="À renseigner" onChange={e=>field(spec.key,e.target.value)}/>}</>}
    </label>;})}</div>;
  const metric=(label:string,value:string,emphasis=false)=><div className={`${styles.metric} ${emphasis?styles.emphasis:""}`}><span>{label}</span><strong>{value}</strong></div>;
  return <div className={styles.generator} data-izord-generator>
    <p className={styles.muted}>Rôle : {{admin:"Administrateur",partner:"Associé",contributor:"Contributeur",reader:"Lecteur"}[role]??role}. Les droits du dossier sont vérifiés à chaque opération.</p>
    <div className={styles.toolbar}>
      {canWrite&&<><button onClick={()=>{if(leave())fresh();}}>Nouveau projet</button><label className={styles.fileButton}>Importer une fiche PDF<input hidden type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";if(files.length)void importPdf(files);}}/></label><label className={styles.fileButton}>Importer un projet JSON<input hidden type="file" accept="application/json,.json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void importJson(f);}}/></label></>}
      <button className={styles.quiet} disabled={busy} onClick={()=>void refreshList()}>Actualiser la liste</button>
    </div>
    <details open={!data}><summary>Dossiers accessibles ({projects.length})</summary>{listLoading?<p>Chargement des projets…</p>:projects.length===0?<p>Aucun projet accessible.</p>:<ul className={styles.projects}>{projects.map(project=><li key={project.id}><div><strong>{project.title}</strong><span>{String((project.payload as {data?:{state?:{address?:string}}})?.data?.state?.address??"Localisation à renseigner")}</span><span>{statusLabels[project.status]} · révision {project.revision} · {new Date(project.updated_at).toLocaleString("fr-FR")}</span><span>Auteur : {project.author_id||project.owner_id}</span></div><button className={styles.quiet} onClick={()=>void open(project)}>Ouvrir {project.title}</button></li>)}</ul>}</details>
    {notice&&<p role="status" className={styles.status}>{notice}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
    {conflict&&<section className={styles.conflict} aria-label="Conflit de sauvegarde"><h2>Une version plus récente existe</h2><p>Votre brouillon est conservé. Aucun écrasement n’a été effectué. Exportez-le pour rapprocher les modifications avant de recharger la version partagée.</p><div className={styles.toolbar}><button disabled={!canExport} onClick={jsonDownload}>Exporter le JSON de récupération</button><button className={styles.quiet} onClick={async()=>{if(!loaded)return;const operation=begin();try{const value=await repository.loadProject(loaded.project.id,{signal:operation.signal});if(current(operation.id))setRemote(value);}catch(e){if(current(operation.id))setError(messageOf(e));}}}>Comparer à la version partagée</button>{loaded&&<button className={styles.quiet} onClick={()=>void open(loaded.project)}>Recharger la version partagée</button>}</div>{remote&&<details open><summary>Version partagée {remote.project.revision} — votre brouillon reste dans le formulaire</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(remote.data.state,null,2)}</pre></details>}</section>}
    {data&&result&&<>
      <div className={styles.toolbar}>{canWrite&&<><button disabled={busy||(!dirty&&!!loaded)||loaded?.project.status==="approved"&&!canApprove} onClick={()=>void save()}>Enregistrer</button><button className={styles.quiet} disabled={busy||!canExport} onClick={jsonDownload}>{dirty?"Exporter le JSON de récupération":"Exporter le JSON"}</button><button disabled={busy||!canExport||financialErrors.length>0||loaded?.project.status==="approved"} onClick={()=>void exportPpt()}>Générer le PowerPoint</button></>}{busy&&<button className={styles.quiet} onClick={()=>{controller.current?.abort();epoch.current++;setBusy(false);setNotice("Opération interrompue. Vérifiez l’état partagé et les transferts avant de reprendre.");}}>Interrompre</button>}</div>
      <p className={styles.muted}>Les modifications restent en mémoire jusqu’à Enregistrer. En cas de fermeture, exportez le JSON de récupération. Aucun brouillon métier n’est conservé dans le stockage du navigateur.</p>
      <div className={styles.layout}><div><fieldset disabled={!canWrite||busy||loaded?.project.status==="approved"&&!canApprove}>
        <section className={styles.panel}><h2>1. Les hypothèses de l’opération</h2>{fieldSet(["acq","works","resale"])}<p className={styles.muted}>Acquisition FAI, travaux TTC (0 si aucun), revente distincte du prix affiché et des loyers.</p>
          <h3>Une même période · deux alternatives</h3>{fieldSet(["rentalMode","rentalPeriod"])}
          <h3>Location saisonnière</h3>{fieldSet(["weekly","weeks","management","rentalCosts","seasonalCostsReviewed"])}
          <h3>Location annuelle</h3>{fieldSet(["monthly","rentedMonths","annualManagement","annualRentalCosts","annualCostsReviewed"])}
          <p className={styles.note}>Les deux options ne sont jamais additionnées. Les occupations portent sur la période commune après travaux. Charges déjà incluses dans le portage : ne pas les compter à nouveau. Le type de bail et la revente libre ou occupée restent à valider.</p>
          <details><summary>Frais et hypothèses complémentaires</summary>{fieldSet(["regime","notaryRate","notaryQuote","resaleBasis","saleRate","contingency","finance","carrying","furniture","otherCosts","holding","costsReviewed"])}</details>
          <p className={styles.note}>La provision initiale de 2 % est une hypothèse modifiable, pas un taux légal. Le devis notarial remplace la provision. Les montants de portage et de financement sont totaux.</p>
        </section>
        <section className={styles.panel}><h2>2. Le bien et les photographies</h2>{fieldSet(["project","ref","address","type","sea","land","area","mainLabel","mainArea","secondLabel","secondArea","annexLabel","annexArea","measurement","features","asking","propertyWarnings","source"])}
          <h3>Photographies de synthèse</h3><div className={styles.photoGrid}>{roles.map(photoRole=><div key={photoRole} className={styles.photo}><Image src={data.photos[photoRole]} width={480} height={240} unoptimized alt={roleLabels[photoRole]}/><label>{roleLabels[photoRole]}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void addPhotos([file],photoRole);}}/></label><label>Choisir dans la photothèque — {roleLabels[photoRole]}<select value={data.photoGalleryRoles[photoRole]??""} onChange={e=>{if(e.target.value!=="")void setPhoto(photoRole,Number(e.target.value));}}><option value="">Aucune sélection</option>{data.importGallery.map((_,i)=><option key={i} value={i}>Photo {i+1}</option>)}</select></label></div>)}</div>
          <p className={styles.muted}>JPG, PNG et WebP : conversion JPEG et recadrage centré pour la synthèse. Comme dans le HTML, la transparence de l’image entière devient noire lors de la conversion ; le canevas du recadrage utilise le fond ivoire. La photothèque conserve l’image entière redimensionnée. Vérifiez les filigranes et l’orientation.</p>
          {fieldSet(["includePhotoSlide"])}<label>Ajouter à la photothèque<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";if(files.length)void addPhotos(files);}}/></label>
          <Gallery data={data}/><h3>Programme, calendrier et décision proposée</h3>{fieldSet(["program","decisionNotes","decision"])}<p className={styles.muted}>La décision saisie ici et les cases de vérification ne constituent pas l’approbation officielle du dossier.</p>
        </section>
      </fieldset></div>
      <aside><section className={styles.panel}><h2>3. Les résultats en direct</h2>{financialErrors.length>0&&<ul className={styles.error}>{financialErrors.map((text,i)=><li key={i}>{text}</li>)}</ul>}{!data.state.costsReviewed&&<p className={styles.note}>Calcul provisoire : frais à compléter. Les frais non chiffrés sont comptés à zéro, ce qui peut surestimer la marge.</p>}
        <div className={styles.metrics}>{metric("Frais d’acquisition",eur(result.fee))}{metric("Coût global estimé",eur(result.total))}{metric("Marge de revente · hors loyers",eur(result.margin),true)}{metric("Marge / coût global",pct(result.marginPct))}{metric("Écart prix affiché / cible",eur(result.discount))}</div>
        <h3>Scénarios locatifs sur {data.state.rentalPeriod||"—"} mois</h3><table className={styles.costs}><thead><tr><th>Scénario</th><th>Saisonnier</th><th>Annuel</th></tr></thead><tbody>{[["Loyers bruts",result.seasonal.gross,result.annual.gross],["Contribution",result.seasonal.net,result.annual.net],["Revente + location",result.combinedSeasonal,result.combinedAnnual]].map(row=><tr key={String(row[0])}><th>{String(row[0])}</th><td>{eur(row[1])}</td><td>{eur(row[2])}</td></tr>)}</tbody></table>
        {(!result.combinedOK||result.seasonal.issue||result.annual.issue)&&<p className={styles.note}>Vérifiez la période, l’occupation et la durée de portage. Un résultat combiné incomplet reste suspendu.</p>}<p className={styles.muted}>Contribution après les seuls frais locatifs saisis, avant fiscalité ; les frais non vérifiés restent provisoires. Aucun résultat n’est annualisé.</p>
        <details><summary>Détail du coût global</summary><table className={styles.costs}><tbody>{[["Acquisition FAI",result.acq],["Frais d’acquisition",result.fee],["Rénovation",result.works],["Aléas",result.extra],["Financement",number(data.state.finance)||0],["Portage",number(data.state.carrying)||0],["Mobilier",number(data.state.furniture)||0],["Autres frais",number(data.state.otherCosts)||0],["Honoraires de revente",result.saleFee]].map(row=><tr key={String(row[0])}><td>{String(row[0])}</td><td>{eur(row[1])}</td></tr>)}</tbody></table></details>
      </section>
      <section className={styles.panel}><h2>Workflow partagé</h2><p>État officiel : {loaded?statusLabels[loaded.project.status]:"Brouillon non enregistré"}</p>{canWrite&&<label>État à enregistrer<select disabled={busy||loaded?.project.status==="approved"&&!canApprove} value={workflow} onChange={e=>{setWorkflow(e.target.value as ProjectStatus);setDirty(true);}}><option value="draft">Brouillon</option><option value="review">En revue</option>{canApprove&&<option value="approved">Approuvé</option>}</select></label>}<p className={styles.muted}>Générez et archivez les fichiers avant l’approbation : un dossier approuvé refuse tout nouveau transfert. Seuls un associé ou un administrateur peuvent approuver. Les fichiers d’une nouvelle version ne sont jamais publiés automatiquement au lecteur.</p>
        <details><summary>Historique des versions ({versions.length})</summary><ul>{versions.map(version=><li key={version.revision}>Révision {version.revision} · {statusLabels[version.status]} · auteur {version.author_id}</li>)}</ul></details>
      </section>
      <section className={styles.panel}><h2>Documents privés</h2>{loaded&&<button className={styles.quiet} disabled={busy} onClick={()=>void documentAction(async()=>undefined)}>Vérifier les transferts</button>}{!loaded?<p>Enregistrez le dossier pour transférer ses fichiers.</p>:<ul>{loaded.assets.map(asset=><li key={asset.id}><span>{asset.kind} · r{asset.project_revision} · {asset.lifecycle}</span><div className={styles.toolbar}>{asset.lifecycle==="finalized"&&<><button className={styles.quiet} disabled={busy||!canExport} onClick={async()=>{if(!canExport)return;const operation=begin();try{const blob=await repository.downloadAsset(asset,{signal:operation.signal});if(current(operation.id))download(blob,`${asset.kind}-${asset.id}${asset.kind==="presentation"?".pptx":asset.kind==="pdf"?".pdf":".jpg"}`);}catch(e){if(current(operation.id))setError(messageOf(e));}}}>Télécharger</button>{canApprove&&asset.kind==="presentation"&&<button className={styles.quiet} disabled={busy} onClick={()=>void documentAction(signal=>repository.setReaderDownload(asset.id,!asset.reader_download,{signal}))}>{asset.reader_download?"Retirer l’accès lecteur":"Autoriser le lecteur"}</button>}</>}{asset.lifecycle==="pending"&&canWrite&&<button className={styles.quiet} disabled={busy} onClick={()=>void documentAction(signal=>repository.abandonAsset(asset.id,{signal}))}>Abandonner ce transfert</button>}</div></li>)}</ul>}<p className={styles.muted}>Les fichiers finalisés sont immuables. Un transfert interrompu reste à vérifier ; un abandon retire l’autorisation, sans réutiliser le chemin. Une capacité d’upload déjà signée peut rester valide jusqu’à son expiration.</p></section>
      </aside></div>
      <section className={styles.panel}><h2>Aperçu de la présentation</h2><p className={styles.muted}>Les diapositives générées conservent les textes et les photographies modifiables. La photothèque facultative n’est ajoutée que si elle contient des images.</p><PresentationPreview data={data}/></section>
      <section className={styles.note}><strong>Cadre de la simulation — réserves du HTML du 16 septembre 2026, non actualisées.</strong><p>Montants TTC, sans récupération de TVA modélisée. La TVA immobilière sur la revente et l’impôt sur le bénéfice ne sont pas calculés. Le régime fiscal, l’engagement de revendre et une conservation durable en foncière doivent être validés avec les professionnels concernés. Aucune rentabilité garantie.</p><p>Références conservées : <a href="https://www.legifrance.gouv.fr/codes/id/LEGIARTI000053187621/2026-09-01" target="_blank" rel="noreferrer">CGI, article 1115</a> · <a href="https://bofip.impots.gouv.fr/bofip/3290-PGP.html/identifiant=BOI-ENR-DMTOI-10-50-20140429" target="_blank" rel="noreferrer">BOFiP, engagement de revendre (2014)</a>. <a href="https://www.cnaf.notaires.fr/actualites/dmto-et-exoneration-pour-engagement-de-revendre" target="_blank" rel="noreferrer">CNAF — engagement de revendre</a>. Sources datées du HTML, non actualisées dans ce lot.</p></section>
    </>}
    {report&&<section role="dialog" aria-modal="true" aria-label="Vérification de la fiche PDF" className={styles.importDialog}><h2>Relire les données extraites</h2><p>Un PDF = un bien. Aucun regroupement automatique. Les objectifs d’acquisition, de travaux, de revente et de loyers restent à saisir.</p><label>Fiche à examiner<select value={reportIndex} onChange={e=>{setReportIndex(Number(e.target.value));setReviewed(false);}}>{reports.map((_,index)=><option key={index} value={index}>{pdfFiles[index]?.name||`Fiche ${index+1}`}</option>)}</select></label><div className={styles.fieldGrid}>{IMPORT_FIELDS.map(([key,label])=><label key={key}>{label}<input value={report.fields[key]??""} onChange={e=>{setReviewed(false);setReports(values=>values.map((item,i)=>i===reportIndex?{...item,fields:{...item.fields,[key]:e.target.value}}:item));}}/><small className={styles.muted}>Page {report.evidence[key]?.page??"non identifiée"} · {report.evidence[key]?.extract||"Valeur absente ou saisie manuelle"}</small></label>)}</div>
      <ul className={styles.note}>{[...report.warnings,...report.readerWarnings].map((text,i)=><li key={i}>{text}</li>)}</ul><h3>Quatre visuels proposés, à confirmer</h3><p>L’ordre du PDF ne reconnaît pas les pièces. Les filigranes incorporés sont conservés.</p><div className={styles.photoGrid}>{roles.map(photoRole=><label key={photoRole}>{roleLabels[photoRole]}{report.gallery[report.roles[photoRole]]&&<Image src={report.gallery[report.roles[photoRole]].data} alt={roleLabels[photoRole]} width={260} height={140} unoptimized/>}<select value={report.roles[photoRole]} onChange={e=>{setReviewed(false);setReports(values=>values.map((item,i)=>i===reportIndex?{...item,roles:{...item.roles,[photoRole]:Number(e.target.value)}}:item));}}><option value={-1}>À compléter manuellement</option>{report.gallery.map((photo,i)=><option key={i} value={i}>Photo {i+1} · page {photo.page??"?"}</option>)}</select></label>)}</div><details><summary>Toutes les photographies extraites ({report.gallery.length})</summary><div className={styles.gallery}>{report.gallery.map((photo,i)=><figure key={i}><Image src={photo.data} alt={`PDF · photo ${i+1}`} width={300} height={180} unoptimized/><figcaption>Photo {i+1} · page {photo.page??"?"}</figcaption></figure>)}</div></details><details><summary>Mentions et texte extrait</summary><pre>{report.extra.join("\n")+"\n\n"+report.rawText}</pre></details><label className={styles.checkbox}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>J’ai relu les données et contrôlé les photographies proposées.</label><div className={styles.toolbar}><button disabled={!reviewed||busy} onClick={()=>void applyReport()}>Valider et créer la fiche projet</button><button className={styles.quiet} onClick={()=>{setReports([]);setPdfFiles([]);setNotice("Import annulé — projet inchangé");}}>Ne pas appliquer</button></div></section>}
  </div>;
}

function Gallery({data}:{data:ProjectData}) { return <div className={styles.gallery}>{data.importGallery.map((photo,index)=><figure key={index}><Image src={photo.data} unoptimized width={300} height={180} alt={`Photothèque — photo ${index+1}`}/><figcaption>Photo {index+1}</figcaption></figure>)}</div>; }
