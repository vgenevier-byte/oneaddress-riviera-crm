"use client";

import dynamic from "next/dynamic";
import { clearPublisherDrafts } from "@/lib/publisher/draftRecovery";
import { OperationProvider } from "@/lib/access/operations";
import UnifiedNavigation, { type UnifiedTab } from "./UnifiedNavigation";
import { moduleItems, readable, type AccessSnapshot, type ModuleId } from "@/lib/access/modules";
import type { CRMTab } from "./crmNavigation";
const ModuleWorkspace = dynamic(() => import("./ModuleWorkspace"), { ssr: false });
const AccessAdministration = dynamic(() => import("./AccessAdministration"), { ssr: false });
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { draftTarget, reducedIzordRole, resumeGeneratorDraft, temporaryAccessFailure,
  type DraftRecovery, type GeneratorDraft, type VerifiedDraftProject } from "@/lib/izord/draftRecovery";
import { bindCRMCache, clearCRMCache, inspectPersistentCRMCache, isPersistentCRMCacheKey,
  createCRMCacheRecovery, purgeRecoveredCRMCache, broadcastCRMCacheReset,
  CRM_CACHE_CHANGED, CRM_CACHE_RESET_KEY, CRM_CACHE_CHANNEL,
  type PersistentCRMCacheState, type CRMCacheRecovery } from "@/lib/access/crmCache";
import styles from "./AccessPortal.module.css";
import PasswordInput from "./PasswordInput";
import { useAccountLanguage, useI18n } from "@/lib/i18n/I18nProvider";
import LanguageSelector from "./LanguageSelector";

const CRMApp = dynamic(() => import("./CRMApp"), { ssr: false });
const PublisherPage = dynamic(() => import("./publisher/PublisherPage"), { ssr: false });
const MonthlyChargesWorkspace = dynamic(() => import("./monthlyCharges/MonthlyChargesWorkspace"), { ssr: false });
const IzordGenerator = dynamic(() => import("./izord/IzordGenerator"), { ssr: false });
type Membership = { workspace_id: "oar" | "izord"; role: string };
type Access = { permissions?: AccessSnapshot; session: Session | null; memberships: Membership[]; loading: boolean; error: string; phase?: "verified" | "unavailable" | "denied" };
const initial: Access = { session: null, memberships: [], loading: true, error: "" };
type GeneratorHost = { key: string; userId: string; role: string; controller: AbortController; recovery?: GeneratorDraft; capture: (draft: GeneratorDraft) => void };
class AccessCheckFailure extends Error {
  constructor(readonly temporary: boolean, message: string) { super(message); }
}

export default function AccessPortal({ space }: { space: "oar" | "izord" | "publisher" | "choose" | "admin" | "charges" }) {
  const { t } = useI18n();
  const [businessDraft,setBusinessDraft]=useState<{user:string;revision:number;module:ModuleId;value:Record<string,string>}|null>(null);
  const [sourceFocus, setSourceFocus] = useState<{ module: "vendorInvoices" | "houseTracking"; id: string } | undefined>();
  const [view,setView] = useState<UnifiedTab>(space === "charges" ? "monthlyCharges" : space === "izord" ? "izord" : space === "publisher" ? "publisher" : space === "admin" ? "admin" : "dashboard");
  const [navigationRevision, setNavigationRevision] = useState(0);
  const permissionsRef = useRef<string>("");
  const [invitation,setInvitation] = useState<string | null>(null);
  const [invitationReady,setInvitationReady] = useState(false);
  const [invitationError,setInvitationError] = useState(false);
  const [invitationSetup,setInvitationSetup] = useState(false);
  const [invitationAccepted,setInvitationAccepted] = useState(false);
  const [invitationPasswordError,setInvitationPasswordError] = useState(false);

  const [access, setAccess] = useState<Access>(initial);
  useAccountLanguage(access.session?.user.id ?? null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordDisplayReset, setPasswordDisplayReset] = useState(0);
  const [passwordRecovery, setPasswordRecovery] = useState<{ userId: string } | null>(null);
  const passwordRecoveryRef = useRef<{ userId: string } | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const recoverySubmitting = useRef(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(()=>{ let alive=true; const timer=window.setTimeout(async()=>{
    const url=new URL(window.location.href),query=url.searchParams,fragment=new URLSearchParams(url.hash.slice(1));
    const pending=query.get("invite");
    setInvitation(pending);setInvitationSetup(query.get('setup')==='1');
    setInvitationAccepted(!pending&&query.get('setup')==='1');
    let failed=query.has('error')||query.has('error_code')||query.has('invitation_error')||fragment.has('error')||fragment.has('error_code');
    if(pending){
      // Native Auth consumes its fragment and verifies /user. Never interpret an
      // Auth token as the business invitation, or derive rights from metadata.
      const initialized=await supabase.auth.initialize();
      failed ||= Boolean(initialized.error);
      if(!alive)return;
      const cleaned=new URL(window.location.pathname,window.location.origin);
      cleaned.searchParams.set('invite',pending);
      if(query.get('setup')==='1')cleaned.searchParams.set('setup','1');
      // Persist failure across reloads: an old session must not accept a failed link.
      if(failed)cleaned.searchParams.set('invitation_error','1');
      window.history.replaceState(null,'',cleaned.pathname+cleaned.search);
      setInvitationError(failed);
      if(failed)setMessage('access.invalidInvitation');
    }
    if(!alive)return;
    setInvitationReady(true);
    const requested=query.get("module");if(moduleItems.some(m=>m.tab===requested))setView(requested as UnifiedTab);
    const prefix = requested === "vendorInvoices" ? "#vendor-invoice-" : requested === "houseTracking" ? "#house-time-" : null;
    if (prefix && url.hash.startsWith(prefix)) {
      try { setSourceFocus({ module: requested as "vendorInvoices" | "houseTracking", id: decodeURIComponent(url.hash.slice(prefix.length)) }); } catch { /* Invalid anchors do not open a record. */ }
    }
  },0);return()=>{alive=false;window.clearTimeout(timer);}; },[]);
  const [cacheTransition, setCacheTransition] = useState<PersistentCRMCacheState | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [generatorHost, setGeneratorHost] = useState<GeneratorHost | null>(null);
  const generatorRef = useRef<GeneratorHost | null>(null);
  const draftRecovery = useRef<DraftRecovery | null>(null);
  const retryAccess = useRef<()=>void>(()=>{});
  const stopGenerator = useCallback((retain = false) => {
    // Close the imperative lease before React can unmount the editor. This also
    // aborts workers/transfers and invalidates callbacks already awaiting I/O.
    generatorRef.current?.controller.abort();
    generatorRef.current = null;
    setGeneratorHost(null);
    if (!retain) { clearPublisherDrafts(); draftRecovery.current = null; setHasUnsavedChanges(false); }
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { const draft = draftRecovery.current?.draft; if (hasUnsavedChanges || draft?.dirty || draft?.reports.length || draft?.sourceFiles.length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    let alive = true, generation = 0;
    let previousUser: string | null | undefined;
    let lastSession: Session | null = null;
    function failedCheck(error: unknown, session: Session | null, current: number) {
      if (!alive || current !== generation) return;
      const temporary = error instanceof AccessCheckFailure ? error.temporary : temporaryAccessFailure(error);
      stopGenerator(temporary);
      clearCRMCache();
      setAccess({ session, memberships: [], loading: false, phase: temporary ? "unavailable" : "denied", error: temporary
        ? "access.temporarilyUnavailable"
        : error instanceof AccessCheckFailure ? error.message : "access.invalidAccess" });
    }
    function cacheBlocked() {
      const state = inspectPersistentCRMCache();
      if (!state.available || state.count) {
        generation++;
        stopGenerator();
        clearCRMCache();
        setAccess(initial);
        setCacheTransition(state);
        return true;
      }
      setCacheTransition(null);
      return false;
    }
    async function check(session: Session | null) {
      const current = ++generation;
      if (!alive || cacheBlocked()) return;
      const userId = session?.user.id ?? null;
      if (previousUser === undefined || previousUser !== userId) setAccess({ ...initial, session });
      if (previousUser !== undefined && previousUser !== userId) {
        stopGenerator();
        clearCRMCache();
        // Discard pending callbacks, timers, React state and imports from the old account.
        window.location.reload();
        return;
      }
      previousUser = userId;
      lastSession = session;
      if (!session) { stopGenerator(); clearCRMCache(); setAccess({ ...initial, loading: false, phase: "denied" }); return; }
      try {
        const { data: verified, error: authError } = await supabase.auth.getUser(session.access_token);
        if (!alive || current !== generation) return;
        if (authError) throw new AccessCheckFailure(temporaryAccessFailure(authError), "access.sessionUnverified");
        if (verified.user?.id !== userId) throw new AccessCheckFailure(false, "access.sessionInvalid");
        const { data, error, status } = await supabase.from("app_memberships")
          .select("workspace_id, role").eq("user_id", userId).eq("status", "active");
        if (error) throw new AccessCheckFailure(temporaryAccessFailure(error, status), "access.verificationUnavailable");
        if (!alive || current !== generation || cacheBlocked()) return;
        const { data: permissions, error: permissionError } = await supabase.rpc("crm_access_snapshot");
        if (permissionError) throw new AccessCheckFailure(temporaryAccessFailure(permissionError), "access.permissionsUnavailable");
        if (!alive || current !== generation) return;
        const fingerprint = JSON.stringify(permissions);
        if (permissionsRef.current && permissionsRef.current !== fingerprint) {
          stopGenerator(); clearCRMCache(); setMessage("access.rightsChanged");
        }
        permissionsRef.current = fingerprint;
        const memberships = ((data ?? []) as Membership[]).filter(m => m.workspace_id !== "izord" || readable(permissions,"izord"));
        const izordMembership = memberships.find(m => m.workspace_id === "izord");
        if (view === "izord") {
          if (!izordMembership) stopGenerator();
          else {
            // A confirmed reduction closes the old writer before any subsequent
            // project request; even a delayed project reply cannot prolong it.
            if (draftRecovery.current && reducedIzordRole(draftRecovery.current.role, izordMembership.role)) {
              stopGenerator();
              setMessage("access.draftDiscarded");
            }
            let held = draftRecovery.current;
            const target = draftTarget(held?.draft);
            let project: VerifiedDraftProject | null = null;
            if (held?.draft.loaded) {
              // Current project scope is checked with this user's JWT and RLS.
              // Global IZORD membership alone never grants a draft recovery.
              const reply = await supabase.from("izord_projects").select("id,revision,status,payload").eq("id", held.draft.loaded.project.id).maybeSingle();
              if (!alive || current !== generation) return;
              if (target !== draftTarget(draftRecovery.current?.draft)) { void check(session); return; }
              if (reply.error) throw new AccessCheckFailure(temporaryAccessFailure(reply.error, reply.status), "access.projectUnavailable");
              if (!reply.data) throw new AccessCheckFailure(false, "access.projectRemoved");
              project = reply.data as VerifiedDraftProject;
            }
            if (!alive || current !== generation || cacheBlocked()) return;
            // A user may still type while a successful control is in flight.
            // The target is unchanged, but the committed draft can be newer.
            held = draftRecovery.current;
            const host = generatorRef.current;
            if (!host || host.role !== izordMembership.role || project && held?.draft.loaded?.project.status !== project.status) {
              const snapshot = held && resumeGeneratorDraft(held, userId!, izordMembership.role, project);
              const reduced = held && reducedIzordRole(held.role, izordMembership.role);
              stopGenerator();
              if (reduced) setMessage("access.draftDiscarded");
              const next: GeneratorHost = { key: crypto.randomUUID(), userId: userId!, role: izordMembership.role, controller: new AbortController(), recovery: snapshot || undefined, capture: draft => {
                if (generatorRef.current === next && !next.controller.signal.aborted) draftRecovery.current = { userId: next.userId, workspace: "izord", role: next.role, draft };
              } };
              generatorRef.current = next;
              if (snapshot) draftRecovery.current = { userId: userId!, workspace: "izord", role: izordMembership.role, draft: snapshot };
              setGeneratorHost(next);
            }
          }
        }
        if (memberships.some(m => m.workspace_id === "oar")) bindCRMCache(userId!);
        else clearCRMCache();
        setAccess({ session, memberships, permissions, loading: false, error: "", phase: "verified" });
      } catch (error) {
        failedCheck(error, session, current);
      }
    }
    // Defer Supabase calls outside the synchronous auth event callback.
    const subscription = supabase.auth.onAuthStateChange((event, session) => {
      if (passwordRecoveryRef.current && passwordRecoveryRef.current.userId !== session?.user.id) {
        passwordRecoveryRef.current = null;
        setPasswordRecovery(null);
        setRecoveryPassword("");
        setPasswordDisplayReset(value => value + 1);
      }
      if (previousUser !== undefined && previousUser !== (session?.user.id ?? null)) {
        // Invalidate pending membership checks and cached writes in this auth event.
        generation++;
        stopGenerator();
        clearCRMCache();
        setAccess(initial);
      }
      window.setTimeout(() => { if (alive) void check(session); }, 0);
      if (event === "PASSWORD_RECOVERY" && alive && session) {
        const recovery = { userId: session.user.id };
        passwordRecoveryRef.current = recovery;
        setPasswordRecovery(recovery);
        setRecoveryPassword("");
        setPasswordDisplayReset(value => value + 1);
        setMessage("");
      }
    }).data.subscription;
    const refresh = () => {
      if (!alive || cacheBlocked()) return;
      const current = ++generation;
      void supabase.auth.getSession().then(({ data, error }) => {
        if (!alive || current !== generation) return;
        if (error) failedCheck(error, lastSession, current);
        else void check(data.session);
      }).catch(error => failedCheck(error, lastSession, current));
    };
    retryAccess.current = refresh;
    const resetFromOtherTab = () => {
      generation++;
      stopGenerator();
      clearCRMCache();
      setAccess(initial);
      window.location.reload();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CRM_CACHE_RESET_KEY) { resetFromOtherTab(); return; }
      if (event.key === null || isPersistentCRMCacheKey(event.key)) { generation++; stopGenerator(); clearCRMCache(); setAccess(initial); refresh(); }
    };
    const onRecovered = () => { generation++; stopGenerator(); clearCRMCache(); setAccess(initial); refresh(); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CRM_CACHE_CHANNEL) : null;
    if (channel) channel.onmessage = event => { if (event.data?.type === "reset") resetFromOtherTab(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CRM_CACHE_CHANGED, onRecovered);
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { alive = false; generation++; generatorRef.current?.controller.abort(); generatorRef.current = null; draftRecovery.current = null; subscription.unsubscribe(); window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("storage", onStorage); window.removeEventListener(CRM_CACHE_CHANGED, onRecovered); channel?.close(); };
  }, [view,stopGenerator]);

  function confirmLeaving() { return !(hasUnsavedChanges || draftRecovery.current?.draft.dirty || draftRecovery.current?.draft.reports.length) || window.confirm(t("access.confirmLeaving")); }
  async function logout() {
    setBusinessDraft(null);
    if (!confirmLeaving()) return;
    stopGenerator();
    setAccess(initial);
    clearCRMCache();
    const { error } = await supabase.auth.signOut();
    if (error) { await supabase.auth.signOut({ scope: "local" }); }
    broadcastCRMCacheReset();
    window.location.assign("/spaces");
  }
  async function reconnectForDriveDiagnostic() {
    if (!confirmLeaving()) return;
    stopGenerator();
    setBusinessDraft(null);
    setHasUnsavedChanges(false);
    setAccess(initial);
    clearCRMCache();
    await supabase.auth.signOut({ scope: "local" });
    window.history.replaceState(null, "", "/admin");
    window.location.reload();
  }
  async function saveRecoveryPassword() {
    setPasswordDisplayReset(value => value + 1);
    const recovery = passwordRecoveryRef.current;
    if (!recovery || recoverySubmitting.current) return;
    if (recoveryPassword.length < 8) {
      setMessage("access.passwordMinimum");
      return;
    }
    recoverySubmitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      // Keep the form bound to the recovery account while checks are in flight.
      const { data, error } = await supabase.auth.getSession();
      if (passwordRecoveryRef.current !== recovery) return;
      if (error || !data.session || data.session.user.id !== recovery.userId) {
        setMessage("access.recoveryInvalid");
        return;
      }
      const verified = await supabase.auth.getUser(data.session.access_token);
      if (passwordRecoveryRef.current !== recovery) return;
      if (verified.error || verified.data.user?.id !== recovery.userId) {
        setMessage("access.recoveryUnverified");
        return;
      }
      const changed = await supabase.auth.updateUser({ password: recoveryPassword });
      if (passwordRecoveryRef.current !== recovery) return;
      if (changed.error) {
        setMessage("access.passwordUnchanged");
        return;
      }
      passwordRecoveryRef.current = null;
      setPasswordRecovery(null);
      setRecoveryPassword("");
      setMessage("access.passwordSaved");
    } catch {
      if (passwordRecoveryRef.current === recovery) setMessage("access.passwordUnchanged");
    } finally {
      recoverySubmitting.current = false;
      setBusy(false);
    }
  }
  if (cacheTransition) return <CacheRecovery state={cacheTransition} />;
  if (passwordRecovery) return <main className={styles.shell}><div role="banner" className={styles.header}><span className={styles.wordmark}>ONE ADDRESS RIVIERA</span><span>{t("access.privateCRM")}</span><LanguageSelector /></div><section className={styles.card}>
    <h1>{t("access.resetPassword")}</h1>
    <p>{t("access.resetPasswordHint")}</p>
    <form className={styles.form} onInvalidCapture={() => setPasswordDisplayReset(value => value + 1)} onSubmit={event => { event.preventDefault(); void saveRecoveryPassword(); }}>
      <label>{t("access.newPassword")}<PasswordInput resetKey={passwordDisplayReset} name="password" autoComplete="new-password" minLength={8} required value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} disabled={busy} /></label>
      <button type="submit" disabled={busy || access.loading || access.session?.user.id !== passwordRecovery.userId}>{t("access.savePassword")}</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => { passwordRecoveryRef.current = null; setPasswordRecovery(null); setRecoveryPassword(""); setPasswordDisplayReset(value => value + 1); setMessage(""); }}>{t("access.cancel")}</button>
    </form>
    {message && <p role="status">{t(message)}</p>}
  </section></main>;
  const permissions = access.permissions;
  const izord = access.memberships.find(m => m.workspace_id === "izord");
  const allowed = permissions ? moduleItems.filter(m=>readable(permissions,m.tab)) : [];
  const chargesDenied = view === "monthlyCharges" && permissions && !readable(permissions, "monthlyCharges");
  const selected = chargesDenied ? null : (view === "admin" ? permissions?.generalAdmin : permissions && readable(permissions,view)) ? view : allowed[0]?.tab ?? (permissions?.generalAdmin ? "admin" : null);
  function navigate(tab:UnifiedTab, recordId?: string) {
    if(!confirmLeaving())return false;
    stopGenerator(); setHasUnsavedChanges(false); setView(tab);
    setNavigationRevision(value => value + 1);
    const focus = recordId && (tab === "vendorInvoices" || tab === "houseTracking") ? { module: tab, id: recordId } : undefined;
    setSourceFocus(focus);
    const hash = focus ? "#"+(tab === "vendorInvoices" ? "vendor-invoice-" : "house-time-")+encodeURIComponent(focus.id) : "";
    window.history.replaceState(null,"",(tab === "monthlyCharges" ? "/charges" : tab === "izord" ? "/izord" : tab === "publisher" ? "/publisher" : tab === "admin" ? "/admin" : "/?module="+tab)+hash);
    return true;
  }
  if(invitationReady && !access.loading && access.session && permissions && !access.error && !invitation && !invitationAccepted) {
    if(selected && selected!==view) return <SelectAllowed select={()=>setView(selected)} />;
    if(selected && selected!=="monthlyCharges" && selected!=="izord" && selected!=="publisher" && selected!=="admin" && permissions.fullAccess) return <OperationProvider userId={access.session.user.id} access={permissions}><CRMApp key={access.session.user.id+":"+permissions.revision} access={permissions} initialTab={selected as CRMTab} sourceFocus={sourceFocus} onExternalNavigate={navigate} sessionUserId={access.session.user.id} sessionAccessToken={access.session.access_token} sessionEmail={access.session.user.email??"utilisateur"} onUnsavedChange={setHasUnsavedChanges} onLogout={logout} /></OperationProvider>;
    return <OperationProvider userId={access.session.user.id} access={permissions}><main className="crm-shell crm-readable-redesign"><UnifiedNavigation access={permissions} accountId={access.session.user.id} navigationRevision={navigationRevision} active={selected??"dashboard"} onNavigate={navigate} onLogout={logout}/><section className="content-panel">
      {message&&<p role="status">{t(message)}</p>}
      {!selected && <div className="module-workspace"><h1>{chargesDenied ? t("access.chargesDenied") : t("access.noAccess")}</h1><p>{chargesDenied ? t("access.moduleDenied") : t("access.contactAdmin")}</p><button onClick={logout}>{t("access.signOut")}</button></div>}
      {selected==="admin"&&<AccessAdministration key={access.session.user.id+":"+permissions.revision} userId={access.session.user.id} access={permissions} onReconnect={reconnectForDriveDiagnostic} onDirty={setHasUnsavedChanges} onSaved={()=>retryAccess.current()}/>}
      {selected==="izord"&&izord&&generatorHost&&<div className="module-workspace"><h1>IZORD Invest</h1><IzordGenerator key={generatorHost.key} role={permissions.modules.izord?.level==='read'?'reader':izord.role} canExport={Boolean(permissions.modules.izord?.sensitive.export)} userId={access.session.user.id} accessSignal={generatorHost.controller.signal} recovery={generatorHost.recovery} onDraft={generatorHost.capture} onUnsavedChange={setHasUnsavedChanges}/></div>}
      {selected==="publisher"&&permissions.modules.publisher&&<PublisherPage key={access.session.user.id+":"+permissions.revision} userId={access.session.user.id} grant={permissions.modules.publisher} accessRevision={permissions.revision} onUnsavedChange={setHasUnsavedChanges}/>}
      {selected==="monthlyCharges"&&<MonthlyChargesWorkspace key={access.session.user.id+":"+permissions.revision} userId={access.session.user.id} access={permissions} onDirtyChange={setHasUnsavedChanges} onNavigateSource={(source, recordId)=>{ if (readable(permissions, source)) navigate(source, recordId); }}/>}
      {selected && selected!=="monthlyCharges"&&selected!=="admin"&&selected!=="izord"&&selected!=="publisher"&&<ModuleWorkspace onDraftConsumed={()=>setBusinessDraft(null)} userId={access.session.user.id} key={access.session.user.id+":"+permissions.revision+":"+selected} module={selected} sourceFocus={sourceFocus} access={permissions} onDirty={setHasUnsavedChanges} draft={businessDraft?.user===access.session.user.id&&businessDraft.revision===permissions.revision&&businessDraft.module===selected?businessDraft.value:undefined} onNavigate={(tab,value)=>{setBusinessDraft(value?{user:access.session!.user.id,revision:permissions.revision,module:tab,value}:null);navigate(tab);}}/>}
    </section></main></OperationProvider>;
  }
  return <main className={styles.shell}><div role="banner" className={styles.header}><span className={styles.wordmark}>ONE ADDRESS RIVIERA</span><span>{t("access.privateCRM")}</span><LanguageSelector /></div><section className={styles.card}><h1>{t("access.signInTitle")}</h1>
    {(access.loading||!invitationReady)?<p role="status">{t("access.checking")}</p>:!access.session?<><p>{t("access.signInHint")}</p><form className={styles.form} onInvalidCapture={() => setPasswordDisplayReset(value => value + 1)} onSubmit={async e=>{e.preventDefault();setPasswordDisplayReset(value=>value+1);setBusy(true);setMessage("");try{const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error)setMessage("access.signInFailed");}catch{setMessage("access.signInUnavailable");}finally{setBusy(false);}}}><label>{t("access.email")}<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>{t("access.password")}<PasswordInput resetKey={"login:"+passwordDisplayReset} name="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy}>{t("access.signIn")}</button></form></>:<>
      <p>{access.session.user.email}</p>{(invitation||invitationAccepted)?<>{invitationPasswordError&&<p role="alert">{t("access.invitationPasswordFailed")}</p>}{invitationSetup&&<label>{t("access.choosePassword")}<PasswordInput resetKey={"invitation:"+passwordDisplayReset} name="password" autoComplete="new-password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/></label>}<button disabled={busy||invitationError||(invitationSetup&&password.length<8)} onClick={async()=>{
        setPasswordDisplayReset(value=>value+1);setBusy(true);setMessage('');
        try{
          if(!invitationAccepted){
            const r=await supabase.rpc('crm_invite_accept',{p_token:invitation});
            if(r.error){setMessage('access.invitationRefused');return;}
            setInvitationAccepted(true);setInvitation(null);
            // This marker only resumes password setup, never grants permissions.
            if(invitationSetup)window.history.replaceState(null,'','/?setup=1');
          }
          // Validate recipient and privilege history BEFORE touching any password.
          if(invitationSetup){const changed=await supabase.auth.updateUser({password});if(changed.error){setInvitationPasswordError(true);return;}}
          setInvitationPasswordError(false);setPassword('');setInvitation(null);setInvitationAccepted(false);window.history.replaceState(null,'','/');retryAccess.current();
        }catch{setMessage('access.invitationUnavailable');}finally{setBusy(false);}
      }}>{invitationAccepted?t("access.saveMyPassword"):t("access.acceptInvitation")}</button></>:<><p role="alert">{access.error ? t(access.error) : ""}</p><button onClick={()=>retryAccess.current()}>{t("access.retryVerification")}</button></>}<button onClick={logout}>{t("access.signOut")}</button></>}
      {message&&<p role="status">{t(message)}</p>}
    </section></main>;
}
function SelectAllowed({select}:{select:()=>void}) { const { t } = useI18n(); useEffect(select,[select]); return <p role="status">{t("access.opening")}</p>; }



function CacheRecovery({ state }: { state: PersistentCRMCacheState }) {
  const { t } = useI18n();
  const [responsible, setResponsible] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [recovery, setRecovery] = useState<CRMCacheRecovery | null>(null);
  const [error, setError] = useState("");
  function downloadRecovery() {
    try {
      const copy = createCRMCacheRecovery();
      const url = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "oar-copie-recuperation.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRecovery(copy); setConfirmed(false); setError("");
    } catch { setError("access.cacheCopyFailed"); }
  }
  function purge() {
    if (!responsible || !confirmed || !recovery) return;
    try { purgeRecoveredCRMCache(recovery); window.dispatchEvent(new Event(CRM_CACHE_CHANGED)); }
    catch { setRecovery(null); setConfirmed(false); setError("access.cacheChanged"); }
  }
  return <main className={styles.shell}><section className={styles.card} data-cache-transition>
    <LanguageSelector />
    <p className={styles.eyebrow}>{t("access.browserProtection")}</p>
    <h1>{t("access.recoverCopies")}</h1>
    {!state.available ? <p role="alert">{t("access.storageUnavailable")}</p> : <>
      <p>{t("access.cacheCopies", { count: state.count })}</p>
      <p>{t("access.privateProfile")}</p>
      <p>{t("access.savePrivateCopy")}</p>
      <label className={styles.recoveryChoice}><input data-cache-owner type="checkbox" checked={responsible} onChange={event => setResponsible(event.target.checked)} />{t("access.responsible")}</label>
      <button disabled={!responsible} onClick={downloadRecovery}>{t("access.downloadCopy")}</button>
      {recovery && <>
        <label className={styles.recoveryChoice}><input data-cache-recovered type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("access.copyVerified")}</label>
        <button className={styles.secondary} disabled={!responsible || !confirmed} onClick={purge}>{t("access.eraseCopies")}</button>
      </>}
    </>}
    {error && <p role="alert">{t(error)}</p>}
  </section></main>;
}
