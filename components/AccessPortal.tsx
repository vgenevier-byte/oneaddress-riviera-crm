"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
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

const CRMApp = dynamic(() => import("./CRMApp"), { ssr: false });
const IzordGenerator = dynamic(() => import("./izord/IzordGenerator"), { ssr: false });
type Membership = { workspace_id: "oar" | "izord"; role: string };
type Access = { session: Session | null; memberships: Membership[]; loading: boolean; error: string; phase?: "verified" | "unavailable" | "denied" };
const initial: Access = { session: null, memberships: [], loading: true, error: "" };
type GeneratorHost = { key: string; userId: string; role: string; controller: AbortController; recovery?: GeneratorDraft; capture: (draft: GeneratorDraft) => void };
class AccessCheckFailure extends Error {
  constructor(readonly temporary: boolean, message: string) { super(message); }
}

export default function AccessPortal({ space }: { space: "oar" | "izord" | "choose" }) {
  const [access, setAccess] = useState<Access>(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
    if (!retain) { draftRecovery.current = null; setHasUnsavedChanges(false); }
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { const draft = draftRecovery.current?.draft; if (draft?.dirty || draft?.reports.length || draft?.sourceFiles.length) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

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
        ? "Accès indisponible : vérification temporairement impossible. Les opérations sont suspendues. Le brouillon reste uniquement en mémoire dans cet onglet ; ne le fermez pas. La reprise exige le même compte et des droits revérifiés, sans sauvegarde automatique."
        : error instanceof AccessCheckFailure ? error.message : "Session ou accès non valide. Le brouillon a été écarté. Reconnectez-vous ou contactez votre administrateur." });
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
        if (authError) throw new AccessCheckFailure(temporaryAccessFailure(authError), "Session non vérifiée.");
        if (verified.user?.id !== userId) throw new AccessCheckFailure(false, "Session invalide.");
        const { data, error, status } = await supabase.from("app_memberships")
          .select("workspace_id, role").eq("user_id", userId).eq("status", "active");
        if (error) throw new AccessCheckFailure(temporaryAccessFailure(error, status), "Vérification des accès indisponible.");
        if (!alive || current !== generation || cacheBlocked()) return;
        const memberships = (data ?? []) as Membership[];
        const izordMembership = memberships.find(m => m.workspace_id === "izord");
        if (space === "izord") {
          if (!izordMembership) stopGenerator();
          else {
            // A confirmed reduction closes the old writer before any subsequent
            // project request; even a delayed project reply cannot prolong it.
            if (draftRecovery.current && reducedIzordRole(draftRecovery.current.role, izordMembership.role)) {
              stopGenerator();
              setMessage("Vos droits ont changé. L’ancien brouillon et ses fichiers ont été écartés ; seuls les accès actuels sont disponibles.");
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
              if (reply.error) throw new AccessCheckFailure(temporaryAccessFailure(reply.error, reply.status), "Vérification du dossier indisponible.");
              if (!reply.data) throw new AccessCheckFailure(false, "L’accès à ce dossier a été retiré. Le brouillon n’est plus récupérable dans cet espace.");
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
              if (reduced) setMessage("Vos droits ont changé. L’ancien brouillon et ses fichiers ont été écartés ; seuls les accès actuels sont disponibles.");
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
        setAccess({ session, memberships, loading: false, error: "", phase: "verified" });
      } catch (error) {
        failedCheck(error, session, current);
      }
    }
    // Defer Supabase calls outside the synchronous auth event callback.
    const subscription = supabase.auth.onAuthStateChange((event, session) => {
      if (previousUser !== undefined && previousUser !== (session?.user.id ?? null)) {
        // Invalidate pending membership checks and cached writes in this auth event.
        generation++;
        stopGenerator();
        clearCRMCache();
        setAccess(initial);
      }
      window.setTimeout(() => { if (alive) void check(session); }, 0);
      if (event === "PASSWORD_RECOVERY") window.setTimeout(async () => {
        if (!alive) return;
        const nextPassword = window.prompt("Choisis ton nouveau mot de passe :");
        if (!nextPassword || nextPassword.length < 8) { setMessage("Le mot de passe doit contenir au moins 8 caractères."); return; }
        const { error } = await supabase.auth.updateUser({ password: nextPassword });
        setMessage(error ? "Mot de passe non modifié." : "Mot de passe enregistré.");
      }, 300);
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
  }, [space,stopGenerator]);

  function confirmLeaving() { return !(hasUnsavedChanges || draftRecovery.current?.draft.dirty || draftRecovery.current?.draft.reports.length) || window.confirm("Des modifications ne sont pas encore sauvegardées. Annulez pour les sauvegarder ou utiliser Backup fichier avant de quitter. Quitter quand même ?"); }
  async function logout() {
    if (!confirmLeaving()) return;
    stopGenerator();
    setAccess(initial);
    clearCRMCache();
    const { error } = await supabase.auth.signOut();
    if (error) { await supabase.auth.signOut({ scope: "local" }); }
    broadcastCRMCacheReset();
    window.location.assign("/spaces");
  }
  if (cacheTransition) return <CacheRecovery state={cacheTransition} />;
  const oar = access.memberships.some(m => m.workspace_id === "oar");
  const izord = access.memberships.find(m => m.workspace_id === "izord");
  if (!access.loading && space === "oar" && oar && access.session) return <>
    <nav className={styles.workspaceNav} aria-label="Espaces"><Link href="/spaces" onClick={event => { if (!confirmLeaving()) event.preventDefault(); }}>Mes espaces</Link>{izord && <Link href="/izord" onClick={event => { if (!confirmLeaving()) event.preventDefault(); }}>IZORD Invest</Link>}</nav>
    <CRMApp key={access.session.user.id} sessionUserId={access.session.user.id} sessionAccessToken={access.session.access_token} sessionEmail={access.session.user.email ?? "utilisateur"} onUnsavedChange={setHasUnsavedChanges} onLogout={logout} />
  </>;

  return <main className={styles.shell}>
    <div role="banner" className={styles.header}><span className={styles.wordmark}>ONE ADDRESS RIVIERA <span>×</span> IZORD INVEST</span><span>Espace privé</span></div>
    <section className={`${styles.card} ${space === "izord" && izord && access.session ? styles.generatorCard : ""}`}>
      <p className={styles.eyebrow}>{space === "izord" ? "IZORD INVEST" : "VOTRE ESPACE DE TRAVAIL"}</p>
      <h1>{space === "izord" ? "Fiches projets" : "Mes espaces"}</h1>
      {access.loading ? <p role="status">Vérification des accès…</p> : !access.session ? <>
        <p>Connectez-vous avec votre compte individuel.</p>
        <form className={styles.form} onSubmit={async e => {
          e.preventDefault(); setBusy(true); setMessage("");
          try { const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (error) setMessage("Connexion impossible. Vérifiez vos identifiants."); }
          catch { setMessage("Connexion indisponible."); } finally { setBusy(false); }
        }}>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
          <button disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
        </form>
      </> : <>
        <p className={styles.identity}>{access.session.user.email}</p>
        {access.error ? <><p role="alert">{access.error}</p>{access.phase === "unavailable" && <button onClick={()=>retryAccess.current()}>Réessayer la vérification</button>}</> : <>
          {space === "oar" && !oar && <p role="alert">Votre compte ne dispose pas d’un accès OAR.</p>}
          {space === "izord" && !izord && <p role="alert">Votre compte ne dispose pas d’un accès IZORD.</p>}
          {!oar && !izord && <p>Aucune adhésion active. Une invitation doit être acceptée avant l’accès.</p>}
          {space === "izord" && izord && generatorHost && <IzordGenerator key={generatorHost.key} role={izord.role} userId={access.session.user.id} accessSignal={generatorHost.controller.signal} recovery={generatorHost.recovery} onDraft={generatorHost.capture} onUnsavedChange={setHasUnsavedChanges} />}
          <nav className={styles.links} aria-label="Espaces autorisés">
            {oar && <Link href="/" onClick={event => { if (!confirmLeaving()) event.preventDefault(); }}>One Address Riviera — CRM <span>Ouvrir →</span></Link>}
            {izord && space !== "izord" && <Link href="/izord">IZORD Invest — Fiches projets <span>Ouvrir →</span></Link>}
            {space !== "choose" && <Link href="/spaces" onClick={event => { if (!confirmLeaving()) event.preventDefault(); }}>Mes espaces</Link>}
          </nav>
        </>}
        <button className={styles.secondary} onClick={logout}>Se déconnecter</button>
      </>}
      {message && <p role="status">{message}</p>}
    </section>
    <footer className={styles.footer}>Des accès individuels, propres à chaque espace.</footer>
  </main>;
}


function CacheRecovery({ state }: { state: PersistentCRMCacheState }) {
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
    } catch { setError("La copie n’a pas pu être préparée. Les données restent dans ce navigateur."); }
  }
  function purge() {
    if (!responsible || !confirmed || !recovery) return;
    try { purgeRecoveredCRMCache(recovery); window.dispatchEvent(new Event(CRM_CACHE_CHANGED)); }
    catch { setRecovery(null); setConfirmed(false); setError("Les copies ont changé ou n’ont pas pu être effacées. Fermez les anciens onglets CRM et téléchargez une nouvelle copie avant de réessayer."); }
  }
  return <main className={styles.shell}><section className={styles.card} data-cache-transition>
    <p className={styles.eyebrow}>PROTECTION DU NAVIGATEUR</p>
    <h1>Récupérer les anciennes copies CRM</h1>
    {!state.available ? <p role="alert">Le stockage de ce navigateur est inaccessible. Les anciennes copies ne peuvent pas être vérifiées. Réservez ce profil à son propriétaire et utilisez un profil distinct pour un autre compte.</p> : <>
      <p>{state.count} copie(s) CRM d’une utilisation antérieure sont encore enregistrées dans ce profil. La connexion et les espaces restent fermés jusqu’à leur récupération et leur effacement.</p>
      <p>Ce profil doit rester réservé au propriétaire de ces données. Si elles ne vous appartiennent pas, fermez cette page et utilisez un autre profil navigateur.</p>
      <p>Fermez les autres onglets de l’ancien CRM. Enregistrez la copie dans un emplacement privé sur votre ordinateur, hors du navigateur, puis vérifiez que le fichier a bien été conservé. Aucun envoi n’est effectué.</p>
      <label className={styles.recoveryChoice}><input data-cache-owner type="checkbox" checked={responsible} onChange={event => setResponsible(event.target.checked)} />Je suis responsable de ces données et je réalise leur récupération dans mon profil privé.</label>
      <button disabled={!responsible} onClick={downloadRecovery}>Télécharger la copie de récupération</button>
      {recovery && <>
        <label className={styles.recoveryChoice}><input data-cache-recovered type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />J’ai vérifié le fichier enregistré dans un emplacement privé et fermé les autres onglets de l’ancien CRM.</label>
        <button className={styles.secondary} disabled={!responsible || !confirmed} onClick={purge}>Effacer les anciennes copies du navigateur</button>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
