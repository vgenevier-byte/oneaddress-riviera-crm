"use client";
import { moduleMessage } from "@/lib/i18n/moduleMessage";
import { useI18n } from "@/lib/i18n/I18nProvider";

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
function scrubText(value: string | null | undefined) {
  return (value ?? "Non communiqué").slice(0,400)
    .replace(/(?:Bearer\s+|ya29\.)[\w.\-]+/gi, "[expurgé]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[expurgé]");
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
  const {t} = useI18n();

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
    <h2 id="google-drive-diagnostic-title">{t("modules.googleDriveDiagnostic.googleDrive")}</h2>
    <p>{t("modules.googleDriveDiagnostic.privateMetadataCheckForTheDocumentsContactsDestinationAndItsAccessPermissions")}</p>
    <button type="button" onClick={() => void verify()} disabled={busy}>{busy ? t("modules.googleDriveDiagnostic.checkingGoogleDrive") : t("modules.googleDriveDiagnostic.checkGoogleDrive")}</button>
    {busy && <p role="status">{t("modules.googleDriveDiagnostic.checkingTheCRMSessionThenGoogleDrive")}</p>}
    {failure && <p role="alert">{moduleMessage(failure.message, t)}</p>}
    {needsReconnect && <button type="button" onClick={() => void onReconnect()}>{t("modules.googleDriveDiagnostic.signInToTheCRMAgain")}</button>}
    {result && <DiagnosticResult result={result}/>}
  </section>;
}

function Capabilities({ value }: { value: DiagnosticCapabilities | undefined }) {
  const {t, label: uiLabel} = useI18n();

  const labels = { canListChildren: "Consulter les éléments", canAddChildren: "Ajouter des éléments", canEdit: "Modifier", canShare: "Partager", canManageMembers: "Gérer les membres" };
  return <p>{t("modules.googleDriveDiagnostic.observedCapabilitiesOfTheTechnicalIdentityOnly")} {Object.entries(labels).map(([key,label]) => uiLabel(label, "modules") + " : " + (value?.[key] === true ? t("modules.googleDriveDiagnostic.yes") : value?.[key] === false ? t("modules.googleDriveDiagnostic.no") : t("modules.googleDriveDiagnostic.unknown"))).join(" ; ")}{t("modules.googleDriveDiagnostic.thisCheckDoesNotPerformAnyOfTheseActions")}</p>;
}
function PermissionList({ acl, label }: { acl: DiagnosticACL | undefined; label: string }) {
  const safeText = (value: string | null | undefined) => scrubText(value ?? t("modules.googleDriveDiagnostic.notProvided"));

  const {t, label: uiLabel} = useI18n();

  const permissions = acl?.data?.filter(p => !p.deleted) ?? [];
  return <div>
    <h4>{label}</h4>
    <p>{acl?.status === "available" ? t("modules.googleDriveDiagnostic.visiblePermissionsRecorded") : t("modules.googleDriveDiagnostic.permissionsIncompleteOrUnavailable")}{acl?.reason && <>  {t("modules.googleDriveDiagnostic.reason")} {safeText(acl.reason)}.</>}</p>
    {permissions.length > 0 ? <div className={styles.table}><table><thead><tr><th>{t("modules.googleDriveDiagnostic.identity")}</th><th>{t("modules.googleDriveDiagnostic.role")}</th><th>{t("modules.googleDriveDiagnostic.source")}</th></tr></thead><tbody>{permissions.map((p,index) => <tr key={(p.id ?? "permission") + index}>
      <td>{safeText(p.emailAddress ?? p.domain ?? p.id)}<small>{safeText(p.type)}</small></td><td>{uiLabel(role(p.role), "modules")}</td>
      <td>{p.permissionDetails.length ? p.permissionDetails.map((detail,i) => <div key={i}>{detail.inherited === true ? t("modules.googleDriveDiagnostic.inherited") : detail.inherited === false ? t("modules.googleDriveDiagnostic.direct") : t("modules.googleDriveDiagnostic.unknownSource")}{detail.inheritedFrom && <>  {t("modules.googleDriveDiagnostic.from")} {safeText(detail.inheritedFrom)}</>}{detail.role && <> · {uiLabel(role(detail.role), "modules")}</>}</div>) : t("modules.googleDriveDiagnostic.sourceNotProvided")}</td>
    </tr>)}</tbody></table></div> : <p>{t("modules.googleDriveDiagnostic.noVisiblePermissionsProvidedNoAdditionalAccessIsInferred")}</p>}
  </div>;
}
function Principal({ value, email }: { value: DiagnosticPrincipal | undefined; email: string }) {
  const safeText = (value: string | null | undefined) => scrubText(value ?? t("modules.googleDriveDiagnostic.notProvided"));

  const {t, label: uiLabel} = useI18n();

  return <li><strong>{safeText(email)}</strong> : {value?.observation === "observed"
    ? t("modules.googleDriveDiagnostic.visiblePermissionObserved") + value.visiblePermissions.map(p => uiLabel(role(p.role), "modules")).join(", ") + ")"
    : value?.observation === "not-observed" ? t("modules.googleDriveDiagnostic.noVisibleNamedPermission") : t("modules.googleDriveDiagnostic.unknownPermission")}.
    {" "}<strong>{t("modules.googleDriveDiagnostic.effectiveAccessNotVerified")}</strong>  {t("modules.googleDriveDiagnostic.thisPersonsGroupsAndGoogleSessionHaveNotBeenChecked")}</li>;
}
function Manager({ permission, resourceId }: { permission: DiagnosticPermission; resourceId: string }) {
  const safeText = (value: string | null | undefined) => scrubText(value ?? t("modules.googleDriveDiagnostic.notProvided"));

  const {t, label: uiLabel} = useI18n();

  return <li>{safeText(permission.emailAddress ?? permission.domain ?? permission.id)} · {uiLabel(role(permission.role), "modules")}  {t("modules.googleDriveDiagnostic.resource")} {safeText(resourceId)}. <strong>{t("modules.googleDriveDiagnostic.notAutomaticallyApproved")}</strong></li>;
}
function DiagnosticResult({ result }: { result: GoogleDriveDiagnosticResponse }) {
  const safeText = (value: string | null | undefined) => scrubText(value ?? t("modules.googleDriveDiagnostic.notProvided"));

  const {t, locale} = useI18n();

  const bytes = (value?: string | null) => value && /^\d+$/.test(value) ? t("modules.diagnostic.bytes", {count: BigInt(value).toLocaleString(locale)}) : t("modules.googleDriveDiagnostic.unknown_ca7b3b");
  const folders = result.contactsFolder?.folders ?? [];
  return <div className={styles.result} aria-label={t("modules.googleDriveDiagnostic.googleDriveDiagnosticResult")}>
    <h3>{t("modules.googleDriveDiagnostic.checkResult")}</h3>
    <p role="status"><strong>{result.crmAuthentication.status === "validated" ? t("modules.googleDriveDiagnostic.crmSigninValidated") : result.crmAuthentication.status === "required" ? t("modules.googleDriveDiagnostic.crmSigninRequired") : t("modules.googleDriveDiagnostic.crmSigninUnconfirmed")}</strong></p>
    <p><strong>{result.googleAuthentication.status === "succeeded" ? t("modules.googleDriveDiagnostic.googleAuthenticationSucceededThroughTheWIFTechnicalIdentity") : result.googleAuthentication.status === "failed" ? t("modules.googleDriveDiagnostic.googleAuthenticationFailed") : t("modules.googleDriveDiagnostic.googleAuthenticationUnconfirmed")}</strong></p>
    {result.error && <p role="alert">{result.error.stage === "crm" ? t("modules.googleDriveDiagnostic.crmError") : result.error.stage === "configuration" ? t("modules.googleDriveDiagnostic.googleConfigurationError") : t("modules.googleDriveDiagnostic.googleError")} · {safeText(result.error.code)} : {moduleMessage(result.error.message, t)}</p>}
    <p>{t("modules.googleDriveDiagnostic.configuredDrive")} <code>{GOOGLE_DRIVE_DIAGNOSTIC_DRIVE_ID}</code>.<br/>{t("modules.googleDriveDiagnostic.expectedTechnicalIdentity")} {GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT}.</p>
    <h3>{t("modules.googleDriveDiagnostic.driveAndDocumentsContacts")}</h3>
    {result.sharedDrive?.data ? <p>{t("modules.googleDriveDiagnostic.observedDrive")} <strong>{safeText(result.sharedDrive.data.name)}</strong> · {safeText(result.sharedDrive.data.id)}.</p> : <p>{t("modules.googleDriveDiagnostic.driveIdentityAndNameUnconfirmed")}{result.sharedDrive?.reason && <>  {t("modules.googleDriveDiagnostic.reason")} {safeText(result.sharedDrive.reason)}.</>}</p>}
    <Capabilities value={result.sharedDrive?.data?.capabilities}/>
    {result.contactsFolder && <p>{t("modules.googleDriveDiagnostic.folderSearch")} {result.contactsFolder.search.status === "available" ? t("modules.googleDriveDiagnostic.metadataAvailable") : t("modules.googleDriveDiagnostic.incompleteOrUnavailable")}{result.contactsFolder.search.reason && <> · {safeText(result.contactsFolder.search.reason)}</>}{t("modules.googleDriveDiagnostic.observedCandidates")} {result.contactsFolder.observedCandidateCount}  {t("modules.googleDriveDiagnostic.detailedLocations")} {folders.length}.</p>}
    {folders.length === 0 ? <p>{t("modules.googleDriveDiagnostic.noVisibleDocumentsContactsFolderConfirmedThisDoesNotProveItIs")}</p> : <p>{folders.length}  {t("modules.googleDriveDiagnostic.documentsContactsLocationsObservedNoLocationIsSelectedOrApprovedAutomatically")}</p>}
    <h3>{t("modules.googleDriveDiagnostic.observedDriveAccess")}</h3>
    <ul><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_HUMAN} value={result.humanPrincipals?.find(p => p.email === GOOGLE_DRIVE_DIAGNOSTIC_HUMAN)}/><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT} value={result.technicalPrincipal}/></ul>
    <PermissionList acl={result.drivePermissions} label={t("modules.googleDriveDiagnostic.drivePermissions")}/>
    {folders.map(folder => <section className={styles.folder} key={folder.metadata.id}>
      <h3>{safeText(folder.metadata.name)} · {safeText(folder.metadata.id)}</h3>
      <p>{t("modules.googleDriveDiagnostic.drive")} {safeText(folder.metadata.driveId)}{t("modules.googleDriveDiagnostic.observedParents")} {folder.metadata.parents.length ? folder.metadata.parents.map(safeText).join(", ") : t("modules.googleDriveDiagnostic.unknown_fe8209")}{t("modules.googleDriveDiagnostic.inheritanceDisabled")} {folder.metadata.inheritedPermissionsDisabled === null ? t("modules.googleDriveDiagnostic.unknown") : folder.metadata.inheritedPermissionsDisabled ? t("modules.googleDriveDiagnostic.yes") : t("modules.googleDriveDiagnostic.no")}.</p>
      <Capabilities value={folder.metadata.capabilities}/>
      <ul><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_HUMAN} value={folder.humanPrincipals.find(p => p.email === GOOGLE_DRIVE_DIAGNOSTIC_HUMAN)}/><Principal email={GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT} value={folder.technicalPrincipal}/></ul>
      <PermissionList acl={folder.permissions} label={t("modules.googleDriveDiagnostic.folderPermissions")}/>
      {folder.parents.map(parent => <div key={parent.id}><h4>{t("modules.googleDriveDiagnostic.parent")} {safeText(parent.metadata.data?.name)} · {safeText(parent.id)}</h4><PermissionList acl={parent.permissions} label={t("modules.googleDriveDiagnostic.parentPermissions")}/></div>)}
      <p>{t("modules.googleDriveDiagnostic.visibleDirectParentsAreCheckedTheFullAncestryHasNotBeenEstablished")}</p>
    </section>)}
    <h3>{t("modules.googleDriveDiagnostic.identifiedManagers")}</h3>
    {result.managers?.length ? <ul>{result.managers.map((manager,index) => <Manager key={manager.resourceId + index} {...manager}/>)}</ul> : <p>{t("modules.googleDriveDiagnostic.noManagersConfirmedInTheAvailableMetadataUnknownManagersAreNotValidated")}</p>}
    <h3>{t("modules.googleDriveDiagnostic.capacity")}</h3>
    <p>{t("modules.googleDriveDiagnostic.scopeCheckedTechnicalIdentityQuotaLimit")} {bytes(result.quota?.data?.limit)}  {t("modules.googleDriveDiagnostic.used")} {bytes(result.quota?.data?.usage)}  {t("modules.googleDriveDiagnostic.availableWithinThisScopeOnly")} {bytes(result.quota?.data?.available)}.</p>
    <p><strong>{t("modules.googleDriveDiagnostic.pooledOrganisationCapacityAndSharedDriveFreeSpaceUnknown")}</strong>  {t("modules.googleDriveDiagnostic.aMissingLimitDoesNotImplyUnlimitedCapacity")}{result.quota?.reason && <>  {t("modules.googleDriveDiagnostic.reason")} {safeText(result.quota.reason)}.</>}</p>
    <p>{t("modules.googleDriveDiagnostic.thisCheckConcernsMetadataOnlyNoFoldersSharingPermissionsOrDocumentsAre")}</p>
  </div>;
}
