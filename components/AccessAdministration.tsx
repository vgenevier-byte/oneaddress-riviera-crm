"use client";
import { SearchMatchHint } from "@/components/search/SearchMatchHint";
import { searchProjects, type ProjectIdentity } from "@/lib/fonciere/projectSearch";
import { createSearchIndex, searchIndex } from "@/lib/search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import AdminHistory from "@/lib/access/AdminHistory";
import { useScopedOperations, isCancelled } from "@/lib/access/operations";
import type { AccessSnapshot } from "@/lib/access/modules";
import GoogleDriveDiagnostic from "./GoogleDriveDiagnostic";
import ArbitrageAdministration from "./fonciere/ArbitrageAdministration";
import { emptyGrants, moduleItems, moduleSensitivePermissions, sensitiveNeedsContribution, type AccessLevel, type ModuleGrant, type ModuleId } from "@/lib/access/modules";
import { navigationGroups } from "./unifiedNavigationStructure";
import styles from "./AccessAdministration.module.css";

const invitationErrorKeys: Record<string, string> = {
  "Envoi non activé ou configuration non approuvée.": "admin.deliveryDisabled",
  "Authentification requise.": "admin.authenticationRequired",
  "Session invalide.": "admin.invalidSession",
  "Administration générale requise.": "admin.adminRequired",
  "Destinataire ou invitation invalide.": "admin.invalidRecipient",
  "Invitation refusée : vérifiez les droits et le destinataire.": "admin.invitationDeclined",
  "Envoi non confirmé. Vérifiez et révoquez l’invitation dans les invitations en attente.": "admin.deliveryCheckRevoke",
  "Envoi non confirmé ; cette invitation est révoquée. Vous pouvez reprendre.": "admin.deliveryRevoked"
};
function invitationErrorKey(error: unknown) { return typeof error === "string" ? invitationErrorKeys[error] ?? "admin.sendUnconfirmed" : "admin.sendUnconfirmed"; }
type User = { id: string; email: string; confirmed: boolean; active: boolean; generalAdmin: boolean; revision: number; modules: Record<ModuleId, ModuleGrant>; izordRole: string | null; assignments: string[]; fonciereAssignments: string[] };
type Project = ProjectIdentity & { ownerId?: string; status?: string };
type AdminData = { invitations: { id: string; email: string; expires_at: string }[]; users: User[]; projects: Project[]; fonciereProjects: Project[]; canAssignFonciere: boolean };
const directModules = ["dashboard", "contacts", "tasks"] as const;

export default function AccessAdministration({ onDirty, onSaved, userId, access, onReconnect }: { onDirty: (dirty: boolean) => void; onSaved: () => void; userId: string; access: AccessSnapshot; onReconnect: () => Promise<void> }) {
  const { t, formatDate } = useI18n();
  const begin = useScopedOperations("admin");
  const loadRequest = useRef({ sequence: 0 });
  const [historyReload, setHistoryReload] = useState(0);
  const [arbitrageConfigDirty, setArbitrageConfigDirty] = useState(false);
  const [data, setData] = useState<AdminData | null>(null), [edit, setEdit] = useState<User | null>(null), [message, setMessage] = useState(""), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [inviteEmail, setInviteEmail] = useState("");
  const [userQuery, setUserQuery] = useState(""), [projectQuery, setProjectQuery] = useState(""), [fonciereQuery, setFonciereQuery] = useState("");
  const load = useCallback(async () => {
    const lease = loadRequest.current, sequence = ++lease.sequence;
    try { const op = await begin(); const r = await op.run(() => op.client.rpc("crm_admin_users")); if (sequence !== lease.sequence) return; if (r.error) throw r.error; setData(r.data); }
    catch (error) { if (sequence === lease.sequence && !isCancelled(error)) setMessage("admin.readFailed"); }
  }, [begin]);
  async function reload() { setHistoryReload(value => value + 1); await load(); }
  useEffect(() => { const lease = loadRequest.current, sequence = lease.sequence; void Promise.resolve().then(() => { if (sequence === lease.sequence) void load(); }); return () => { lease.sequence++; }; }, [load]);
  useEffect(() => { onDirty(dirty || arbitrageConfigDirty); return () => onDirty(false); }, [dirty, arbitrageConfigDirty, onDirty]);
  const userIndex = useMemo(() => createSearchIndex(data?.users ?? [], user => [user.email, user.id], { getId: user => user.id, getLabel: user => user.email }), [data]);
  const projectIndex = useMemo(() => createSearchIndex(data?.projects ?? [], project => [project.title, project.id], { getId: project => project.id, getLabel: project => project.title }), [data]);
  const visibleUsers = useMemo(() => searchIndex(userIndex, userQuery), [userIndex, userQuery]);
  const visibleProjects = useMemo(() => searchIndex(projectIndex, projectQuery), [projectIndex, projectQuery]);
  const visibleFonciere = useMemo(() => searchProjects(data?.fonciereProjects ?? [], fonciereQuery), [data, fonciereQuery]);
  const update = (next: User) => { setEdit(next); setDirty(true); };
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const op = await begin();
      const result = await op.run(() => op.client.rpc("crm_admin_save", { p_user: edit.id, p_revision: edit.revision, p_active: edit.active, p_general_admin: edit.generalAdmin, p_grants: edit.modules, p_izord_role: edit.izordRole, p_assignments: edit.assignments, p_fonciere_assignments: edit.fonciereAssignments }));
      if (result.error) throw result.error;
      setDirty(false); setEdit({ ...edit, revision: result.data }); setMessage("admin.saved"); await op.check(); onSaved(); await reload();
    } catch (error) { if (!isCancelled(error)) setMessage("admin.saveFailed"); }
    finally { setBusy(false); }
  }
  function select(user: User) {
    if (dirty && !window.confirm(t("admin.discardChanges"))) return;
    setEdit({ ...user, modules: { ...emptyGrants(), ...user.modules }, assignments: user.assignments ?? [], fonciereAssignments: user.fonciereAssignments ?? [] }); setDirty(false); setMessage("");
    setProjectQuery(""); setFonciereQuery("");
  }
  function moduleRow(module: ModuleId) {
    if (!edit) return null;
    const grant = edit.modules[module], permissions = moduleSensitivePermissions(module);
    return <div key={module} className={styles.moduleRow} data-admin-module={module}>
      <div className={styles.moduleName}>{t(`navigation.module.${module}`)}{module === "fonciere" && <small>{t("admin.projectsDescription")}</small>}{module === "izord" && <small>{t("admin.presentationsDescription")}</small>}</div>
      <select aria-label={t("admin.levelFor", { module: t(`navigation.module.${module}`) })} value={grant.level} disabled={busy} onChange={event => {
        const level = event.target.value as AccessLevel;
        const sensitive = module === "fonciere" ? { delete: level === "contribute" && Boolean(grant.sensitive.delete), export: level !== "none" && Boolean(grant.sensitive.export) } : {};
        update({ ...edit, modules: { ...edit.modules, [module]: { level, sensitive } } });
      }}>
        <option value="none">{t("admin.none")}</option><option value="read">{t("admin.read")}</option><option value="contribute">{t("admin.contribute")}</option>
      </select>
      {permissions.length > 0 && <div className={styles.permissions}>{permissions.map(key => {
        const disabled = busy || grant.level === "none" || sensitiveNeedsContribution(key) && grant.level !== "contribute" || key === "bank_write" && !grant.sensitive.bank_read || key === "payment" && !edit.modules.contacts.sensitive.bank_read;
        return <label className={`unified-check ${module === "fonciere" ? styles.foncierePermission : ""}`} key={key}><input type="checkbox" checked={Boolean(grant.sensitive[key])} disabled={disabled} onChange={event => update({ ...edit, modules: { ...edit.modules, [module]: { ...grant, sensitive: { ...grant.sensitive, [key]: event.target.checked } } } })}/><span>{t(module === "fonciere" && key === "delete" ? "admin.foncierePermission.delete" : `admin.permission.${key}`)}{module === "fonciere" && <small>{t(`admin.foncierePermission.${key}Hint`)}</small>}</span></label>;
      })}</div>}
    </div>;
  }
  return <div className="module-workspace"><p className="eyebrow">{t("navigation.module.admin")}</p><h1>{t("admin.title")}</h1><p>{t("admin.hint")}</p><GoogleDriveDiagnostic userId={userId} access={access} onReconnect={onReconnect}/>{message && <p role="status">{t(message)}</p>}
    <div className="unified-admin"><section className="panel"><h2>{t("admin.users")}</h2><label>{t("modules.moduleWorkspace.search")}<input type="search" aria-label={`${t("modules.moduleWorkspace.search")} · ${t("admin.users")}`} value={userQuery} onChange={event => setUserQuery(event.target.value)}/></label>
      {visibleUsers.map(({ item: user, approximate }) => <button className="unified-user" key={user.id} disabled={busy} onClick={() => select(user)}>{user.email}<SearchMatchHint approximate={approximate}/><small>{!user.confirmed ? t("admin.pendingAcceptance") : user.active ? t("admin.active") : t("admin.inactive")}</small></button>)}
      <button disabled={busy} onClick={() => { if (!dirty || window.confirm(t("admin.discardInput"))) { setEdit({ id: "invitation", email: "", confirmed: false, active: true, generalAdmin: false, revision: 0, modules: emptyGrants(), izordRole: null, assignments: [], fonciereAssignments: [] }); setDirty(false); } }}>{t("admin.inviteUser")}</button>
    </section>
    {edit && <section className={`panel ${styles.editor}`}><h2>{edit.id === "invitation" ? t("admin.newInvitation") : edit.email}</h2>
      {edit.id === "invitation" ? <label>{t("admin.recipientEmail")}<input type="email" value={inviteEmail} onChange={event => { setInviteEmail(event.target.value); setDirty(true); }}/></label> : <><p className={styles.accountHint}>{t("admin.accountHint")}</p><label><input type="checkbox" checked={edit.active} disabled={busy} onChange={event => update({ ...edit, active: event.target.checked })}/>{t("admin.activeAccess")}</label><label><input type="checkbox" checked={edit.generalAdmin} disabled={busy} onChange={event => update({ ...edit, generalAdmin: event.target.checked })}/>{t("admin.generalAdmin")}</label></>}
      <section aria-label={t("admin.module")} className={styles.moduleGroups}>{directModules.map(moduleRow)}{navigationGroups.map(group => <section className={styles.moduleGroup} key={group.id} data-admin-group={group.id}><h3>{t(`navigation.group.${group.id}`)}</h3>{group.modules.map(moduleRow)}</section>)}</section>
      <section className={styles.assignments} aria-labelledby="admin-role-title"><h3 id="admin-role-title">{t("admin.businessRole")}</h3><label>{t("admin.izordRole")}<select value={edit.izordRole ?? ""} disabled={busy} onChange={event => update({ ...edit, izordRole: event.target.value || null })}><option value="">{t("admin.noRole")}</option><option value="reader">{t("admin.reader")}</option><option value="contributor">{t("admin.contributor")}</option><option value="partner">{t("admin.partner")}</option><option value="admin">{t("admin.izordAdmin")}</option></select></label><p>{t("admin.businessRoleHint")}</p>
        {!edit.izordRole && (edit.modules.fonciere.level !== "none" || edit.modules.izord.level !== "none") && <p role="status">{t("admin.roleRequired")}</p>}
        {edit.izordRole === "reader" && (edit.modules.fonciere.level === "contribute" || edit.modules.izord.level === "contribute") && <p role="status">{t("admin.readerLimits")}</p>}
        {["admin", "partner"].includes(edit.izordRole ?? "") && <p>{t("admin.globalRoleHint")}</p>}
      </section>
      <section className={styles.assignments} aria-labelledby="admin-fonciere-assignments-title"><h3 id="admin-fonciere-assignments-title">{t("admin.fonciereAssignments")}</h3><p>{t("admin.fonciereAssignmentsHint")}</p>
        {data && !data.canAssignFonciere && <p role="status">{t("admin.fonciereAssignmentAdminLimited")}</p>}
        <label>{t("modules.moduleWorkspace.search")}<input type="search" aria-label={`${t("modules.moduleWorkspace.search")} · ${t("navigation.module.fonciere")}`} value={fonciereQuery} onChange={event => setFonciereQuery(event.target.value)}/></label>
        {visibleFonciere.length === 0 && <p>{t("admin.noMatchingProjects")}</p>}
        <div className={styles.assignmentList}>{visibleFonciere.map(({ item: project, approximate }) => <label className="unified-check" key={project.id}><input type="checkbox" data-fonciere-assignment={project.id} disabled={busy || !data?.canAssignFonciere} checked={edit.fonciereAssignments.includes(project.id)} onChange={event => update({ ...edit, fonciereAssignments: event.target.checked ? [...edit.fonciereAssignments, project.id] : edit.fonciereAssignments.filter(id => id !== project.id) })}/><span>{project.project_reference && <small className={styles.projectReference}>{project.project_reference}</small>}{project.title}<SearchMatchHint approximate={approximate}/>{project.status === "archived" && <small> · {t("admin.archivedProject")}</small>}{project.ownerId === edit.id && <small className={styles.accountHint}>{t("admin.projectOwnerHint")}</small>}</span></label>)}</div>
      </section>
      <section className={styles.assignments} aria-labelledby="admin-presentation-assignments-title"><h3 id="admin-presentation-assignments-title">{t("admin.presentationAssignments")}</h3><p>{t("admin.presentationAssignmentsHint")}</p>
        <label>{t("modules.moduleWorkspace.search")}<input type="search" aria-label={`${t("modules.moduleWorkspace.search")} · ${t("navigation.module.izord")}`} value={projectQuery} onChange={event => setProjectQuery(event.target.value)}/></label>
        {visibleProjects.length === 0 && <p>{t("admin.noMatchingProjects")}</p>}
        <div className={styles.assignmentList}>{visibleProjects.map(({ item: project, approximate }) => <label className="unified-check" key={project.id}><input type="checkbox" data-presentation-assignment={project.id} disabled={busy} checked={edit.assignments.includes(project.id)} onChange={event => update({ ...edit, assignments: event.target.checked ? [...edit.assignments, project.id] : edit.assignments.filter(id => id !== project.id) })}/>{project.title}<SearchMatchHint approximate={approximate}/></label>)}</div>
      </section>
      {edit.id === "invitation" ? <button disabled={busy || !inviteEmail} onClick={async () => {
        setBusy(true);
        try {
          const op = await begin(); const response = await op.run(() => fetch("/api/access/invite", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + op.token }, signal: op.signal, body: JSON.stringify({ email: inviteEmail, grants: edit.modules, izordRole: edit.izordRole, assignments: edit.assignments, fonciereAssignments: edit.fonciereAssignments }) }));
          const result = await op.run(() => response.json()); setMessage(response.ok ? "admin.invitationSent" : invitationErrorKey(result?.error)); if (response.ok) { setDirty(false); await op.check(); await reload(); }
        } catch (error) { if (!isCancelled(error)) setMessage("admin.sendUnconfirmed"); }
        finally { setBusy(false); }
      }}>{t("admin.sendInvitation")}</button> : <button disabled={busy || !dirty} onClick={() => void save()}>{busy ? t("admin.saving") : t("admin.save")}</button>}
      <button disabled={busy} onClick={() => { setEdit(null); setDirty(false); void reload(); }}>{t("admin.cancelReload")}</button>
    </section>}
    </div>
    {data && <ArbitrageAdministration users={data.users} onDirty={setArbitrageConfigDirty}/>}
    <section className="panel"><h2>{t("admin.pendingInvitations")}</h2>{data?.invitations?.map(invitation => <p key={invitation.id}>{invitation.email} · {t("admin.expires", { date: formatDate(invitation.expires_at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })} <button disabled={busy} onClick={async () => {
      if (!window.confirm(t("admin.confirmRevoke"))) return;
      try { const op = await begin(); const result = await op.run(() => op.client.rpc("crm_invite_revoke", { p_id: invitation.id })); if (result.error) throw result.error; setMessage("admin.revoked"); await op.check(); await reload(); }
      catch (error) { if (!isCancelled(error)) setMessage("admin.revokeFailed"); }
    }}>{t("admin.revokeInvitation")}</button></p>)}</section><AdminHistory key={userId + ":" + JSON.stringify(access) + ":" + historyReload} users={data?.users ?? []}/>
  </div>;
}
