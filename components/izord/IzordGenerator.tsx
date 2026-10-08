"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { specialistMessage } from "@/lib/i18n/catalogs/specialist";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { createProjectData, importProjectJson, exportProjectJson, type ProjectData, type ProjectState, type PhotoRole, LIMITS } from "@/lib/izord/model";
import { calculate, errorsFor, number, rentalExportIssues } from "@/lib/izord/finance";
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
  const { t, label: displayLabel, formatDate: screenDate, locale } = useI18n();
  const eur = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat(locale,{style:"currency",currency:"EUR",minimumFractionDigits:0,maximumFractionDigits:0}).format(value) : displayLabel("À renseigner","izord");
  const pct = (value: number | null) => value === null ? "—" : new Intl.NumberFormat(locale,{minimumFractionDigits:1,maximumFractionDigits:1}).format(value) + " %";

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
  function leave(){return !dirty||window.confirm(t("izord.ce_brouillon_n_est_pas_enregistre_exportez_s_e4fdd1"));}
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
    if(dirty||!saved){if(!window.confirm(t("izord.enregistrer_ces_modifications_avant_de_gener_d18712")))return;saved=await save();}
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
    if(loaded&&!dirty&&!window.confirm(t("izord.creer_un_nouveau_brouillon_a_partir_de_ce_pd_ad88b7")))return;
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
    {spec.kind==="checkbox"?<><input id={`izord-${key}`} type="checkbox" checked={value===true} onChange={e=>field(spec.key,e.target.checked)}/>{t(`izord.field.${spec.key}`)}</>:<>{t(`izord.field.${spec.key}`)}{spec.kind==="select"?<select id={`izord-${key}`} value={String(value??"")} onChange={e=>field(spec.key,e.target.value)}>{spec.options?.map(option=><option key={option.value} value={option.value}>{displayLabel(option.label,"izord")}</option>)}</select>:spec.kind==="textarea"?<textarea id={`izord-${key}`} maxLength={spec.maxLength} value={String(value??"")} onChange={e=>field(spec.key,e.target.value)}/>:<input id={`izord-${key}`} inputMode={spec.numeric?"decimal":undefined} maxLength={spec.maxLength} autoComplete="off" value={String(value??"")} placeholder={t("izord.a_renseigner_e3d2f2")} onChange={e=>field(spec.key,e.target.value)}/>}</>}
    </label>;})}</div>;
  const metric=(label:string,value:string,emphasis=false)=><div className={`${styles.metric} ${emphasis?styles.emphasis:""}`}><span>{displayLabel(label,"izord")}</span><strong>{value}</strong></div>;
  return <div className={styles.generator} data-izord-generator>
    <p className={styles.muted}>{t("izord.role_28da94")}{" "}{displayLabel({admin:"Administrateur",partner:"Associé",contributor:"Contributeur",reader:"Lecteur"}[role]??role,"izord")}{t("izord._les_droits_du_dossier_sont_verifies_a_chaqu_805fa0")}</p>
    <div className={styles.toolbar}>
      {canWrite&&<><button onClick={()=>{if(leave())fresh();}}>{t("izord.nouveau_projet_29f056")}</button><label className={styles.fileButton}>{t("izord.importer_une_fiche_pdf_cc125a")}<input hidden type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";if(files.length)void importPdf(files);}}/></label><label className={styles.fileButton}>{t("izord.importer_un_projet_json_42e564")}<input hidden type="file" accept="application/json,.json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void importJson(f);}}/></label></>}
      <button className={styles.quiet} disabled={busy} onClick={()=>void refreshList()}>{t("izord.actualiser_la_liste_1c2f4d")}</button>
    </div>
    <details open={!data}><summary>{t("izord.dossiers_accessibles_f97a4e")}{projects.length})</summary>{listLoading?<p>{t("izord.chargement_des_projets_f29796")}</p>:projects.length===0?<p>{t("izord.aucun_projet_accessible_5c7d6a")}</p>:<ul className={styles.projects}>{projects.map(project=><li key={project.id}><div><strong>{project.title}</strong><span>{String((project.payload as {data?:{state?:{address?:string}}})?.data?.state?.address??t("izord.locationMissing"))}</span><span>{displayLabel(statusLabels[project.status],"izord")}{" "}{t("izord._revision_65a1bc")}{" "}{project.revision} · {screenDate(project.updated_at,{dateStyle:"short",timeStyle:"short"})}</span><span>{t("izord.auteur_bfd30f")}{" "}{project.author_id||project.owner_id}</span></div><button className={styles.quiet} onClick={()=>void open(project)}>{t("izord.ouvrir_42c077")}{" "}{project.title}</button></li>)}</ul>}</details>
    {notice&&<p role="status" className={styles.status}>{specialistMessage(notice,t)}</p>}{error&&<p role="alert" className={styles.error}>{specialistMessage(error,t)}</p>}
    {conflict&&<section className={styles.conflict} aria-label={t("izord.conflit_de_sauvegarde_55870f")}><h2>{t("izord.une_version_plus_recente_existe_97a83c")}</h2><p>{t("izord.votre_brouillon_est_conserve_aucun_ecrasemen_48480a")}</p><div className={styles.toolbar}><button disabled={!canExport} onClick={jsonDownload}>{t("izord.exporter_le_json_de_recuperation_c6d97e")}</button><button className={styles.quiet} onClick={async()=>{if(!loaded)return;const operation=begin();try{const value=await repository.loadProject(loaded.project.id,{signal:operation.signal});if(current(operation.id))setRemote(value);}catch(e){if(current(operation.id))setError(messageOf(e));}}}>{t("izord.comparer_a_la_version_partagee_d6423a")}</button>{loaded&&<button className={styles.quiet} onClick={()=>void open(loaded.project)}>{t("izord.recharger_la_version_partagee_dc8c85")}</button>}</div>{remote&&<details open><summary>{t("izord.version_partagee_fd7b16")}{" "}{remote.project.revision}{" "}{t("izord._votre_brouillon_reste_dans_le_formulaire_2337ff")}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(remote.data.state,null,2)}</pre></details>}</section>}
    {data&&result&&<>
      <div className={styles.toolbar}>{canWrite&&<><button disabled={busy||(!dirty&&!!loaded)||loaded?.project.status==="approved"&&!canApprove} onClick={()=>void save()}>{t("izord.enregistrer_f7c8bc")}</button><button className={styles.quiet} disabled={busy||!canExport} onClick={jsonDownload}>{dirty?t("izord.exporter_le_json_de_recuperation_c6d97e"):t("izord.exporter_le_json_4be389")}</button><button disabled={busy||!canExport||financialErrors.length>0||loaded?.project.status==="approved"} onClick={()=>void exportPpt()}>{t("izord.generer_le_powerpoint_0577c8")}</button></>}{busy&&<button className={styles.quiet} onClick={()=>{controller.current?.abort();epoch.current++;setBusy(false);setNotice("Opération interrompue. Vérifiez l’état partagé et les transferts avant de reprendre.");}}>{t("izord.interrompre_f36bd2")}</button>}</div>
      <p className={styles.muted}>{t("izord.les_modifications_restent_en_memoire_jusqu_a_2d945c")}</p>
      <div className={styles.layout}><div><fieldset disabled={!canWrite||busy||loaded?.project.status==="approved"&&!canApprove}>
        <section className={styles.panel}><h2>{t("izord.1_les_hypotheses_de_l_operation_988459")}</h2>{fieldSet(["acq","works","resale"])}<p className={styles.muted}>{t("izord.acquisition_fai_travaux_ttc_0_si_aucun_reven_1e998d")}</p>
          <h3>{t("izord.une_meme_periode_deux_alternatives_6a2b4c")}</h3>{fieldSet(["rentalMode","rentalPeriod"])}
          <h3>{t("izord.location_saisonniere_d98bbf")}</h3>{fieldSet(["weekly","weeks","management","rentalCosts","seasonalCostsReviewed"])}
          <h3>{t("izord.location_annuelle_74d90a")}</h3>{fieldSet(["monthly","rentedMonths","annualManagement","annualRentalCosts","annualCostsReviewed"])}
          <p className={styles.note}>{t("izord.les_deux_options_ne_sont_jamais_additionnees_4bc7ff")}</p>
          <details><summary>{t("izord.frais_et_hypotheses_complementaires_670c0e")}</summary>{fieldSet(["regime","notaryRate","notaryQuote","resaleBasis","saleRate","contingency","finance","carrying","furniture","otherCosts","holding","costsReviewed"])}</details>
          <p className={styles.note}>{t("izord.la_provision_initiale_de_2_est_une_hypothese_ce5913")}</p>
        </section>
        <section className={styles.panel}><h2>{t("izord.2_le_bien_et_les_photographies_fe1400")}</h2>{fieldSet(["project","ref","address","type","sea","land","area","mainLabel","mainArea","secondLabel","secondArea","annexLabel","annexArea","measurement","features","asking","propertyWarnings","source"])}
          <h3>{t("izord.photographies_de_synthese_64e942")}</h3><div className={styles.photoGrid}>{roles.map(photoRole=><div key={photoRole} className={styles.photo}><Image src={data.photos[photoRole]} width={480} height={240} unoptimized alt={displayLabel(roleLabels[photoRole],"izord")}/><label>{displayLabel(roleLabels[photoRole],"izord")}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void addPhotos([file],photoRole);}}/></label><label>{t("izord.choisir_dans_la_phototheque_3d6fb6")}{" "}{displayLabel(roleLabels[photoRole],"izord")}<select value={data.photoGalleryRoles[photoRole]??""} onChange={e=>{if(e.target.value!=="")void setPhoto(photoRole,Number(e.target.value));}}><option value="">{t("izord.aucune_selection_b7a999")}</option>{data.importGallery.map((_,i)=><option key={i} value={i}>{t("izord.photo_d01d90")}{" "}{i+1}</option>)}</select></label></div>)}</div>
          <p className={styles.muted}>{t("izord.jpg_png_et_webp_conversion_jpeg_et_recadrage_d70aec")}</p>
          {fieldSet(["includePhotoSlide"])}<label>{t("izord.ajouter_a_la_phototheque_f1b9d3")}<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";if(files.length)void addPhotos(files);}}/></label>
          <Gallery data={data}/><h3>{t("izord.programme_calendrier_et_decision_proposee_ff1ff7")}</h3>{fieldSet(["program","decisionNotes","decision"])}<p className={styles.muted}>{t("izord.la_decision_saisie_ici_et_les_cases_de_verif_35d8cb")}</p>
        </section>
      </fieldset></div>
      <aside><section className={styles.panel}><h2>{t("izord.3_les_resultats_en_direct_490257")}</h2>{financialErrors.length>0&&<ul className={styles.error}>{financialErrors.map((text,i)=><li key={i}>{specialistMessage(text,t)}</li>)}</ul>}{!data.state.costsReviewed&&<p className={styles.note}>{t("izord.calcul_provisoire_frais_a_completer_les_frai_cd9ac1")}</p>}
        <div className={styles.metrics}>{metric("Frais d’acquisition",eur(result.fee))}{metric("Coût global estimé",eur(result.total))}{metric("Marge de revente · hors loyers",eur(result.margin),true)}{metric("Marge / coût global",pct(result.marginPct))}{metric("Écart prix affiché / cible",eur(result.discount))}</div>
        <h3>{t("izord.scenarios_locatifs_sur_27173f")}{" "}{data.state.rentalPeriod||"—"}{" "}{t("izord.mois_339528")}</h3><table className={styles.costs}><thead><tr><th>{t("izord.scenario_8b9a2a")}</th><th>{t("izord.saisonnier_e60dee")}</th><th>{t("izord.annuel_11aad2")}</th></tr></thead><tbody>{[["Loyers bruts",result.seasonal.gross,result.annual.gross],["Contribution",result.seasonal.net,result.annual.net],["Revente + location",result.combinedSeasonal,result.combinedAnnual]].map(row=><tr key={String(row[0])}><th>{displayLabel(String(row[0]),"izord")}</th><td>{eur(row[1])}</td><td>{eur(row[2])}</td></tr>)}</tbody></table>
        {(!result.combinedOK||result.seasonal.issue||result.annual.issue)&&<p className={styles.note}>{t("izord.verifiez_la_periode_l_occupation_et_la_duree_a869cf")}</p>}<p className={styles.muted}>{t("izord.contribution_apres_les_seuls_frais_locatifs_441a3b")}</p>
        <details><summary>{t("izord.detail_du_cout_global_3c12c9")}</summary><table className={styles.costs}><tbody>{[["Acquisition FAI",result.acq],["Frais d’acquisition",result.fee],["Rénovation",result.works],["Aléas",result.extra],["Financement",number(data.state.finance)||0],["Portage",number(data.state.carrying)||0],["Mobilier",number(data.state.furniture)||0],["Autres frais",number(data.state.otherCosts)||0],["Honoraires de revente",result.saleFee]].map(row=><tr key={String(row[0])}><td>{displayLabel(String(row[0]),"izord")}</td><td>{eur(row[1])}</td></tr>)}</tbody></table></details>
      </section>
      <section className={styles.panel}><h2>{t("izord.workflow_partage_5ad012")}</h2><p>{t("izord.etat_officiel_a98513")}{" "}{loaded?displayLabel(statusLabels[loaded.project.status],"izord"):t("izord.brouillon_non_enregistre_7052bf")}</p>{canWrite&&<label>{t("izord.etat_a_enregistrer_93d5a8")}<select disabled={busy||loaded?.project.status==="approved"&&!canApprove} value={workflow} onChange={e=>{setWorkflow(e.target.value as ProjectStatus);setDirty(true);}}><option value="draft">{t("izord.brouillon_57d2d7")}</option><option value="review">{t("izord.en_revue_7da044")}</option>{canApprove&&<option value="approved">{t("izord.approuve_4a06a7")}</option>}</select></label>}<p className={styles.muted}>{t("izord.generez_et_archivez_les_fichiers_avant_l_app_095f31")}</p>
        <details><summary>{t("izord.historique_des_versions_67d508")}{versions.length})</summary><ul>{versions.map(version=><li key={version.revision}>{t("izord.revision_d6cbfa")}{" "}{version.revision} · {displayLabel(statusLabels[version.status],"izord")}{" "}{t("izord._auteur_0d4c34")}{" "}{version.author_id}</li>)}</ul></details>
      </section>
      <section className={styles.panel}><h2>{t("izord.documents_prives_f9ba75")}</h2>{loaded&&<button className={styles.quiet} disabled={busy} onClick={()=>void documentAction(async()=>undefined)}>{t("izord.verifier_les_transferts_35bd5b")}</button>}{!loaded?<p>{t("izord.enregistrez_le_dossier_pour_transferer_ses_f_f99477")}</p>:<ul>{loaded.assets.map(asset=><li key={asset.id}><span>{t(`izord.assetKind.${asset.kind}`)}{" "}{t("izord._r_9ddde8")}{asset.project_revision} · {t(`izord.assetState.${asset.lifecycle}`)}</span><div className={styles.toolbar}>{asset.lifecycle==="finalized"&&<><button className={styles.quiet} disabled={busy||!canExport} onClick={async()=>{if(!canExport)return;const operation=begin();try{const blob=await repository.downloadAsset(asset,{signal:operation.signal});if(current(operation.id))download(blob,`${asset.kind}-${asset.id}${asset.kind==="presentation"?".pptx":asset.kind==="pdf"?".pdf":".jpg"}`);}catch(e){if(current(operation.id))setError(messageOf(e));}}}>{t("izord.telecharger_b332d0")}</button>{canApprove&&asset.kind==="presentation"&&<button className={styles.quiet} disabled={busy} onClick={()=>void documentAction(signal=>repository.setReaderDownload(asset.id,!asset.reader_download,{signal}))}>{asset.reader_download?t("izord.retirer_l_acces_lecteur_339a8c"):t("izord.autoriser_le_lecteur_66b10f")}</button>}</>}{asset.lifecycle==="pending"&&canWrite&&<button className={styles.quiet} disabled={busy} onClick={()=>void documentAction(signal=>repository.abandonAsset(asset.id,{signal}))}>{t("izord.abandonner_ce_transfert_8f5153")}</button>}</div></li>)}</ul>}<p className={styles.muted}>{t("izord.les_fichiers_finalises_sont_immuables_un_tra_ead430")}</p></section>
      </aside></div>
      <section className={styles.panel}><h2>{t("izord.apercu_de_la_presentation_54cbee")}</h2><p className={styles.muted}>{t("izord.les_diapositives_generees_conservent_les_tex_cc85f2")}</p><PresentationPreview data={data}/></section>
      <section className={styles.note}><strong>{t("izord.cadre_de_la_simulation_reserves_du_html_du_1_8d84fe")}</strong><p>{t("izord.montants_ttc_sans_recuperation_de_tva_modeli_826bd2")}</p><p>{t("izord.references_conservees_d4e0d4")}{" "}<a href="https://www.legifrance.gouv.fr/codes/id/LEGIARTI000053187621/2026-09-01" target="_blank" rel="noreferrer">{t("izord.cgi_article_1115_928a70")}</a> · <a href="https://bofip.impots.gouv.fr/bofip/3290-PGP.html/identifiant=BOI-ENR-DMTOI-10-50-20140429" target="_blank" rel="noreferrer">{t("izord.bofip_engagement_de_revendre_2014_6d8e44")}</a>. <a href="https://www.cnaf.notaires.fr/actualites/dmto-et-exoneration-pour-engagement-de-revendre" target="_blank" rel="noreferrer">{t("izord.cnaf_engagement_de_revendre_d0e25e")}</a>{t("izord._sources_datees_du_html_non_actualisees_dans_a81383")}</p></section>
    </>}
    {report&&<section role="dialog" aria-modal="true" aria-label={t("izord.verification_de_la_fiche_pdf_1470a3")} className={styles.importDialog}><h2>{t("izord.relire_les_donnees_extraites_9a1396")}</h2><p>{t("izord.un_pdf_un_bien_aucun_regroupement_automatiqu_08d2c6")}</p><label>{t("izord.fiche_a_examiner_cbb5b1")}<select value={reportIndex} onChange={e=>{setReportIndex(Number(e.target.value));setReviewed(false);}}>{reports.map((_,index)=><option key={index} value={index}>{pdfFiles[index]?.name||t("izord.sheetNumber",{number:index+1})}</option>)}</select></label><div className={styles.fieldGrid}>{IMPORT_FIELDS.map(([key,label])=><label key={key}>{displayLabel(label,"izord")}<input value={report.fields[key]??""} onChange={e=>{setReviewed(false);setReports(values=>values.map((item,i)=>i===reportIndex?{...item,fields:{...item.fields,[key]:e.target.value}}:item));}}/><small className={styles.muted}>{t("izord.page_fb0627")}{" "}{report.evidence[key]?.page??t("izord.non_identifiee_5ece1d")} · {report.evidence[key]?.extract||t("izord.valeur_absente_ou_saisie_manuelle_380571")}</small></label>)}</div>
      <ul className={styles.note}>{[...report.warnings,...report.readerWarnings].map((text,i)=><li key={i}>{specialistMessage(text,t)}</li>)}</ul><h3>{t("izord.quatre_visuels_proposes_a_confirmer_a1f14f")}</h3><p>{t("izord.l_ordre_du_pdf_ne_reconnait_pas_les_pieces_l_7584fa")}</p><div className={styles.photoGrid}>{roles.map(photoRole=><label key={photoRole}>{displayLabel(roleLabels[photoRole],"izord")}{report.gallery[report.roles[photoRole]]&&<Image src={report.gallery[report.roles[photoRole]].data} alt={displayLabel(roleLabels[photoRole],"izord")} width={260} height={140} unoptimized/>}<select value={report.roles[photoRole]} onChange={e=>{setReviewed(false);setReports(values=>values.map((item,i)=>i===reportIndex?{...item,roles:{...item.roles,[photoRole]:Number(e.target.value)}}:item));}}><option value={-1}>{t("izord.a_completer_manuellement_ebd49e")}</option>{report.gallery.map((photo,i)=><option key={i} value={i}>{t("izord.photo_d01d90")}{" "}{i+1}{" "}{t("izord._page_34ef9e")}{" "}{photo.page??"?"}</option>)}</select></label>)}</div><details><summary>{t("izord.toutes_les_photographies_extraites_1a71d7")}{report.gallery.length})</summary><div className={styles.gallery}>{report.gallery.map((photo,i)=><figure key={i}><Image src={photo.data} alt={t("izord.pdfPhotoAlt",{number:i+1})} width={300} height={180} unoptimized/><figcaption>{t("izord.photo_d01d90")}{" "}{i+1}{" "}{t("izord._page_34ef9e")}{" "}{photo.page??"?"}</figcaption></figure>)}</div></details><details><summary>{t("izord.mentions_et_texte_extrait_382644")}</summary><pre>{report.extra.join("\n")+"\n\n"+report.rawText}</pre></details><label className={styles.checkbox}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{t("izord.j_ai_relu_les_donnees_et_controle_les_photog_3897d5")}</label><div className={styles.toolbar}><button disabled={!reviewed||busy} onClick={()=>void applyReport()}>{t("izord.valider_et_creer_la_fiche_projet_2d0cbd")}</button><button className={styles.quiet} onClick={()=>{setReports([]);setPdfFiles([]);setNotice("Import annulé — projet inchangé");}}>{t("izord.ne_pas_appliquer_fbd08c")}</button></div></section>}
  </div>;
}

function Gallery({data}:{data:ProjectData}) {
  const { t } = useI18n();
 return <div className={styles.gallery}>{data.importGallery.map((photo,index)=><figure key={index}><Image src={photo.data} unoptimized width={300} height={180} alt={t("izord.photoAlt",{number:index+1})}/><figcaption>{t("izord.photo_d01d90")}{" "}{index+1}</figcaption></figure>)}</div>; }
