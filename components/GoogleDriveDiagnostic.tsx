"use client";

import { useEffect, useRef, useState } from "react";
import { isCancelled, useScopedOperations, type ScopedOperation } from "@/lib/access/operations";
import type { AccessSnapshot } from "@/lib/access/modules";
import {
  canUseGoogleDriveDiagnostic, GOOGLE_DRIVE_DIAGNOSTIC_DRIVE_ID,
  GOOGLE_DRIVE_DIAGNOSTIC_HUMAN, GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT,
  type DiagnosticACL, type DiagnosticCapabilities, type DiagnosticPermission, type DiagnosticPrincipal,
  type GoogleDriveDiagnosticResponse,
} from "@/lib/googleDriveDiagnostic";
import styles from "./GoogleDriveDiagnostic.module.css";

type Props = { userId: string; access: AccessSnapshot; onReconnect: () => Promise<void> };
type Failure = { message: string; reconnect: boolean };
const roles: Record<string, string> = { organizer: "Gestionnaire", fileOrganizer: "Gestionnaire de contenu", writer: "Contributeur", commenter: "Commentateur", reader: "Lecteur", owner: "Propriétaire" };
const role = (value: string | null) => value ? roles[value] ?? value : "Rôle inconnu";
function safeText(value: string | null | undefined) {
  return (value ?? "Non communiqué").slice(0,400)
    .replace(/(?:Bearer\s+|ya29\.)[\w.\-]+/gi, "[expurgé]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[expurgé]");
}
function bytes(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return "Inconnue";
  return BigInt(value).toLocaleString("fr-FR") + " octets";
}
const knownResponse = (value: unknown): value is GoogleDriveDiagnosticResponse => {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<GoogleDriveDiagnosticResponse>;
  return result.scope === "contacts" && result.readOnly === true &&
    ["validated", "required", "unavailable"].includes(result.crmAuthentication?.status ?? "") &&
    ["succeeded", "failed", "unknown"].includes(result.googleAuthentication?.status ?? "");
};

export default function GoogleDriveDiagnostic(props: Props) {
  if (!canUseGoogleDriveDiagnostic(props.userId, props.access)) return null;
  return <GoogleDriveDiagnosticControl key={props.userId + ":" + JSON.stringify(props.access)} {...props}/>;
}
function GoogleDriveDiagnosticControl({ userId, access, onReconnect }: Props) {
  const begin = useScopedOperations("admin");
  const allowed = canUseGoogleDriveDiagnostic(userId, access);
  const [result, setResult] = useState<GoogleDriveDiagnosticResponse | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const lifetime = useRef({ active: true, generation: 0 });
  useEffect(() => {
    const lease = lifetime.current;
    lease.active = true;
    lease.generation++;
    return () => { lease.active = false; lease.generation++; };
  }, []);

  async function verify() {
    if (!allowed || busy) return;
    const lease = lifetime.current, generation = ++lease.generation;
    const current = () => lease.active && lease.generation === generation;
    setBusy(true); setFailure(null); setResult(null);
    let op: ScopedOperation | undefined;
    try {
      op = await begin();
      await op.check();
      const response = await fetch("/api/drive/diagnostic?scope=contacts", {
        method: "GET", headers: { Authorization: "Bearer " + op.token },
        signal: op.signal, cache: "no-store",
      });
      op.signal.throwIfAborted();
      const value: unknown = await response.json().catch(() => null);
      op.signal.throwIfAborted();
      if (response.status === 401 && (!knownResponse(value) || value.crmAuthentication.status !== "validated")) {
        // A failed CRM session returns no metadata. Do not display a late result
        // or disclose an error body when the normal account checks can no longer pass.
        try { await op.check(); } catch { op.signal.throwIfAborted(); }
        if (current()) setFailure({ message: "Connexion CRM absente ou expirée. Reconnectez-vous normalement au CRM, puis relancez le contrôle.", reconnect: true });
        return;
      }
      await op.check();
      if (!current()) return;
      if (!knownResponse(value)) {
        setFailure({ message: "Réponse du diagnostic non confirmée. Relancez le contrôle.", reconnect: false });
        return;
      }
      setResult(value);
    } catch (error) {
      if (!current() || op?.signal.aborted) return;
      setResult(null);
      setFailure(isCancelled(error)
        ? { message: "Session CRM ou droits non confirmés. Reconnectez-vous au CRM avant de relancer le contrôle.", reconnect: true }
        : { message: "Contrôle indisponible : la connexion au CRM ou au serveur n’a pas pu être confirmée. Relancez le contrôle.", reconnect: false });
    } finally { if (current()) setBusy(false); }
  }
  if (!allowed) return null;
  const needsReconnect = failure?.reconnect || result?.reconnect === true || result?.crmAuthentication.status === "required";
  return <section className={`panel ${styles.panel}`} aria-labelledby="google-drive-diagnostic-title">
    <h2 id="google-drive-diagnostic-title">Google Drive</h2>
    <p>Contrôle privé des métadonnées de la destination Documents contacts et de ses accès.</p>
    <button type="button" onClick={() => void verify()} disabled={busy}>{busy ? "Vérification Google Drive…" : "Vérifier Google Drive"}</button>
    {busy && <p role="status">Vérification de la session CRM, puis de Google Drive…</p>}
    {failure && <p role="alert">{failure.message}</p>}
    {needsReconnect && <button type="button" onClick={() => void onReconnect()}>Se reconnecter au CRM</button>}
    {result && <DiagnosticResult result={result}/>}
  </section>;
}

function Capabilities({ value }: { value: DiagnosticCapabilities | undefined }) {
  const labels = { canListChildren: "Consulter les éléments", canAddChildren: "Ajouter des éléments", canEdit: "Modifier", canShare: "Partager", canManageMembers: "Gérer les membres" };
  return <p>Capacités observées de l’identité technique uniquement : {Object.entries(labels).map(([key,label]) => label + " : " + (value?.[key] === true ? "oui" : value?.[key] === false ? "non" : "inconnu")).join(" ; ")}. Ce contrôle n’exerce aucune de ces actions.</p>;
}
function PermissionList({ acl, label }: { acl: DiagnosticACL | undefined; label: string }) {
  const permissions = acl?.data?.filter(p => !p.deleted) ?? [];
  return <div>
    <h4>{label}</h4>
    <p>{acl?.status === "available" ? "Permissions visibles relevées." : "Permissions incomplètes ou indisponibles."}{acl?.reason && <> Motif : {safeText(acl.reason)}.</>}</p>
    {permissions.length > 0 ? <div className={styles.table}><table><thead><tr><th>Identité</th><th>Rôle</th><th>Origine</th></tr></thead><tbody>{permissions.map((p,index) => <tr key={(p.id ?? "permission") + index}>
      <td>{safeText(p.emailAddress ?? p.domain ?? p.id)}<small>{safeText(p.type)}</small></td><td>{role(p.role)}</td>
      <td>{p.permissionDetails.length ? p.permissionDetails.map((detail,i) => <div key={i}>{detail.inherited === true ? "Héritée" : detail.inherited === false ? "Directe" : "Origine inconnue"}{detail.inheritedFrom && <> depuis {safeText(detail.inheritedFrom)}</>}{detail.role && <> · {role(detail.role)}</>}</div>) : "Origine non communiquée"}</td>
    </tr>)}</tbody></table></div> : <p>Aucune permission visible communiquée. Aucun accès supplémentaire n’est déduit.</p>}
  </div>;
}
function Principal({ value, email }: { value: DiagnosticPrincipal | undefined; email: string }) {
  return <li><strong>{safeText(email)}</strong> : {value?.observation === "observed"
    ? "permission visible observée (" + value.visiblePermissions.map(p => role(p.role)).join(", ") + ")"
    : value?.observation === "not-observed" ? "aucune permission nominative visible" : "permission inconnue"}.
    {" "}<strong>Accès effectif non vérifié.</strong> Les groupes et la session Google de cette personne ne sont pas vérifiés.</li>;
}
function Manager({ permission, resourceId }: { permission: DiagnosticPermission; resourceId: string }) {
  return <li>{safeText(permission.emailAddress ?? permission.domain ?? permission.id)} · {role(permission.role)} · ressource {safeText(resourceId)}. <strong>Non approuvé automatiquement.</strong></li>;
}
function DiagnosticResult({ result }: { result: GoogleDriveDiagnosticResponse }) {
  const folders = result.contactsFolder?.folders ?? [];
  return <div className={styles.result} aria-label="Résultat du diagnostic Google Drive">
    <h3>Résultat du contrôle</h3>
    <p role="status"><strong>{result.crmAuthentication.status === "validated" ? "Connexion CRM validée." : result.crmAuthentication.status === "required" ? "Connexion CRM requise." : "Connexion CRM non confirmée."}</strong></p>
    <p><strong>{result.googleAuthentication.status === "succeeded" ? "Authentification Google réussie via l’identité technique WIF." : result.googleAuthentication.status === "failed" ? "Authentification Google en échec." : "Authentification Google non confirmée."}</strong></p>
    {result.error && <p role="alert">{result.error.stage === "crm" ? "Erreur CRM" : result.error.stage === "configuration" ? "Erreur de configuration Google" : "Erreur Google"} · {safeText(result.error.code)} : {safeText(result.error.message)}</p>}
    <p>Drive configuré : <code>{GOOGLE_DRIVE_DIAGNOSTIC_DRIVE_ID}</code>.<br/>Identité technique attendue : {GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT}.</p>
    <h3>Drive et Documents contacts</h3>
    {result.sharedDrive?.data ? <p>Drive observé : <strong>{safeText(result.sharedDrive.data.name)}</strong> · {safeText(result.sharedDrive.data.id)}.</p> : <p>Identité et nom du Drive non confirmés.{result.sharedDrive?.reason && <> Motif : {safeText(result.sharedDrive.reason)}.</>}</p>}
    <Capabilities value={result.sharedDrive?.data?.capabilities}/>
    {result.contactsFolder && <p>Recherche du dossier : {result.contactsFolder.search.status === "available" ? "métadonnées disponibles" : "incomplète ou indisponible"}{result.contactsFolder.search.reason && <> · {safeText(result.contactsFolder.search.reason)}</>}. Candidats observés : {result.contactsFolder.observedCandidateCount} ; emplacements détaillés : {folders.length}.</p>}
    {folders.length === 0 ? <p>Aucun dossier « Documents contacts » visible confirmé. Cela ne prouve pas son absence.</p> : <p>{folders.length} emplacement(s) « Documents contacts » observé(s). Aucun emplacement n’est sélectionné ou approuvé automatiquement.</p>}
    <h3>Accès observés au Drive</h3>
    <ul><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_HUMAN} value={result.humanPrincipals?.find(p => p.email === GOOGLE_DRIVE_DIAGNOSTIC_HUMAN)}/><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT} value={result.technicalPrincipal}/></ul>
    <PermissionList acl={result.drivePermissions} label="Permissions du Drive"/>
    {folders.map(folder => <section className={styles.folder} key={folder.metadata.id}>
      <h3>{safeText(folder.metadata.name)} · {safeText(folder.metadata.id)}</h3>
      <p>Drive : {safeText(folder.metadata.driveId)}. Parents observés : {folder.metadata.parents.length ? folder.metadata.parents.map(safeText).join(", ") : "inconnus"}. Héritage désactivé : {folder.metadata.inheritedPermissionsDisabled === null ? "inconnu" : folder.metadata.inheritedPermissionsDisabled ? "oui" : "non"}.</p>
      <Capabilities value={folder.metadata.capabilities}/>
      <ul><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_HUMAN} value={folder.humanPrincipals.find(p => p.email === GOOGLE_DRIVE_DIAGNOSTIC_HUMAN)}/><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT} value={folder.technicalPrincipal}/></ul>
      <PermissionList acl={folder.permissions} label="Permissions du dossier"/>
      {folder.parents.map(parent => <div key={parent.id}><h4>Parent : {safeText(parent.metadata.data?.name)} · {safeText(parent.id)}</h4><PermissionList acl={parent.permissions} label="Permissions du parent"/></div>)}
      <p>Les parents directs visibles sont contrôlés ; l’ascendance complète n’est pas établie.</p>
    </section>)}
    <h3>Gestionnaires identifiés</h3>
    {result.managers?.length ? <ul>{result.managers.map((manager,index) => <Manager key={manager.resourceId + index} {...manager}/>)}</ul> : <p>Aucun gestionnaire confirmé dans les métadonnées disponibles. Les gestionnaires inconnus ne sont pas validés.</p>}
    <h3>Capacité</h3>
    <p>Périmètre consulté : quota de l’identité technique. Limite : {bytes(result.quota?.data?.limit)} ; utilisé : {bytes(result.quota?.data?.usage)} ; disponible dans ce seul périmètre : {bytes(result.quota?.data?.available)}.</p>
    <p><strong>Capacité mutualisée de l’organisation et espace libre du Drive partagé : inconnus.</strong> Une limite absente ne signifie pas une capacité illimitée.{result.quota?.reason && <> Motif : {safeText(result.quota.reason)}.</>}</p>
    <p>Ce contrôle porte uniquement sur des métadonnées. Aucun dossier, partage ou document n’est modifié.</p>
  </div>;
}
