"use client";
import { useEffect, useState } from "react";
import { useScopedOperations, isCancelled } from "@/lib/access/operations";
import type { TaskRecipient } from "@/lib/tasks/types";

type Account = { userId: string; email: string; label: string | null; contactId: string | null; verifiedOwner: boolean };
type Directory = { accounts: Account[]; contacts: { contactId: string; label: string }[] };
type Legacy = { source: string; taskId: string; revision: string; reason: string; original: Record<string, unknown>; recovered?: boolean; taskRevision?: number | null; managerId?: string | null; managerLabel?: string | null; managerActive?: boolean };

/** Separate administrative confirmation and private historical recovery.
 * Neither administrative rights nor a contact category grant task visibility.
 */
export default function TaskIdentityAdministration({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const begin = useScopedOperations("admin");
  const [directory, setDirectory] = useState<Directory>();
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");
  const [contact, setContact] = useState("");
  const [owner, setOwner] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [legacy, setLegacy] = useState<Legacy[]>();
  const [recovery, setRecovery] = useState<Legacy>();
  const [participants, setParticipants] = useState<string[]>([]);
  const [eligible, setEligible] = useState<TaskRecipient[]>([]);
  const [manager, setManager] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string>();
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const op = await begin();
        const r = await op.run(() => op.client.rpc("crm_tasks_admin_directory"));
        if (r.error) throw r.error;
        if (live) setDirectory(r.data);
      } catch (e) { if (live && !isCancelled(e)) setMessage("Confirmation des identités indisponible."); }
    })();
    return () => { live = false; onDirty(false); };
  }, [begin, onDirty]);
  const legacyOpen = legacy !== undefined;
  useEffect(() => {
    if (!legacyOpen) return;
    let live = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const op = await begin(); const r = await op.run(() => op.client.rpc("crm_tasks_legacy_read"));
        if (r.error) throw r.error;
        if (live) setLegacy(r.data);
      } catch (e) {
        if (live && (isCancelled(e) || /forbidden/.test((e as Error).message || ""))) {
          setLegacy(undefined); setRecovery(undefined); setParticipants([]); setManager(""); setEligible([]); setRecoveryConfirmed(false); onDirty(false);
          setMessage("L’accès à la reprise privée a changé. Les données et la saisie ont été retirées.");
        }
      }
    };
    const focused = () => { void check(); };
    window.addEventListener("focus", focused); document.addEventListener("visibilitychange", focused);
    const timer = window.setInterval(focused, 15000);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", focused); };
  }, [legacyOpen, begin, onDirty]);
  const dirty = () => { setConfirmed(false); onDirty(true); };
  const recoveryDirty = () => { setRecoveryConfirmed(false); setRequestId(crypto.randomUUID()); onDirty(true); };
  async function confirmIdentity() {
    if (!confirmed || !selected || !label.trim() || (!owner && !contact)) return;
    setBusy(true);
    try {
      const op = await begin();
      const r = await op.run(() => op.client.rpc("crm_tasks_admin_identity", {
        p_user: selected, p_label: label.trim(), p_contact: owner ? null : contact, p_owner: owner
      }));
      if (r.error) throw r.error;
      setMessage("Liaison confirmée par le serveur. Aucun compte ni droit n’a été créé.");
      onDirty(false); setConfirmed(false);
      const d = await op.run(() => op.client.rpc("crm_tasks_admin_directory"));
      if (!d.error) setDirectory(d.data);
    } catch (e) { if (!isCancelled(e)) setMessage((e as Error).message || "Liaison non confirmée ; la saisie reste disponible."); }
    finally { setBusy(false); }
  }
  async function loadLegacy() {
    setBusy(true);
    try {
      const op = await begin(); const r = await op.run(() => op.client.rpc("crm_tasks_legacy_read"));
      if (r.error) throw r.error;
      const recipients = await op.run(() => op.client.rpc("crm_tasks_directory"));
      if (recipients.error) throw recipients.error;
      setEligible(recipients.data);
      setLegacy(r.data); setMessage("Reprise privée ouverte. L’auteur ancien reste non confirmé.");
    } catch (e) {
      setLegacy(undefined); setRecovery(undefined); setParticipants([]); setManager(""); setEligible([]); setRecoveryConfirmed(false); onDirty(false);
      if (!isCancelled(e)) setMessage("Reprise réservée au propriétaire interne confirmé ayant l’administration et accès à Tâches.");
    }
    finally { setBusy(false); }
  }
  async function recover() {
    if (!recovery || !manager || !requestId || !recoveryConfirmed || (!recovery.recovered && (!participants.length || !participants.includes(manager)))) return;
    setBusy(true);
    try {
      const op = await begin(); const r = await op.run(() => recovery.recovered ? op.client.rpc("crm_tasks_legacy_manager", {
        p_id: recovery.taskId, p_revision: recovery.taskRevision, p_manager_id: manager, p_request_id: requestId
      }) : op.client.rpc("crm_tasks_legacy_recover", {
        p_source: recovery.source, p_id: recovery.taskId, p_revision: recovery.revision,
        p_assignee_ids: participants, p_manager_id: manager, p_request_id: requestId
      }));
      if (r.error) throw r.error;
      const wasRecovered = recovery.recovered;
      setRecovery(undefined); setParticipants([]); setManager(""); setRecoveryConfirmed(false); onDirty(false);
      await loadLegacy(); setMessage(wasRecovered ? "Gestion corrigée sur la même tâche. L’auteur, la date ancienne et l’original sont conservés ; la participation approuvée est journalisée." : "Tâche reprise avec un gestionnaire explicitement désigné. L’auteur historique reste inconnu et l’original est conservé.");
    } catch (e) {
      if (isCancelled(e) || /\btask_recovery_forbidden\b/.test((e as Error).message || "")) {
        setLegacy(undefined); setRecovery(undefined); setParticipants([]); setManager(""); setEligible([]); setRecoveryConfirmed(false); onDirty(false);
        setMessage("L’accès à la reprise privée a changé. Les données et la saisie ont été retirées.");
      } else setMessage((e as Error).message || "Reprise ou correction non confirmée ; la saisie est conservée.");
    }
    finally { setBusy(false); }
  }
  return <section className="panel" data-task-identity-admin><fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}><h2>Identités et reprise Tâches</h2>
    <p>Confirmez une liaison vérifiée entre le compte et une fiche Membre de l’organisation, ou la qualité de propriétaire interne. Aucun rapprochement automatique par nom ou email.</p>
    {message && <p role="status">{message}</p>}
    <label>Compte actif avec accès Tâches<select value={selected} disabled={busy} onChange={e => {
      const a = directory?.accounts.find(a => a.userId === e.target.value); setSelected(e.target.value);
      setLabel(a?.label || ""); setContact(a?.contactId || ""); setOwner(a?.verifiedOwner || false); dirty();
    }}><option value="">Choisir un compte</option>{directory?.accounts.map(a => <option key={a.userId} value={a.userId}>{a.email}{a.label ? ` · ${a.label}` : " · liaison à confirmer"}</option>)}</select></label>
    <label>Libellé nominatif confirmé<input maxLength={120} value={label} onChange={e => { setLabel(e.target.value); dirty(); }} /></label>
    <label><input type="checkbox" checked={owner} onChange={e => { setOwner(e.target.checked); dirty(); }} />Propriétaire interne vérifié</label>
    {!owner && <label>Fiche Membre de l’organisation<select value={contact} onChange={e => { setContact(e.target.value); dirty(); }}><option value="">Choisir une fiche</option>{directory?.contacts.map(c => <option key={c.contactId} value={c.contactId}>{c.label}</option>)}</select></label>}
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />J’ai vérifié personnellement cette identité et cette liaison.</label>
    <button disabled={busy || !confirmed || !selected || !label.trim() || (!owner && !contact)} onClick={() => void confirmIdentity()}>Confirmer la liaison</button>
    <hr /><button disabled={busy} onClick={() => void loadLegacy()}>Ouvrir la reprise historique privée</button>
    {legacy?.length === 0 && <p>Aucune tâche historique à reprendre ou à gérer.</p>}
    {legacy?.map(row => <p key={row.source + row.taskId} data-task-legacy-id={row.taskId}>{String(row.original.title || row.taskId)} · auteur historique non confirmé{row.recovered ? ` · ${row.managerId ? `Gestionnaire : ${row.managerLabel || "Identité confirmée"}${row.managerActive ? "" : " · accès inactif"}` : "Gestion non désignée"}` : ""} <button disabled={busy} onClick={() => { setRecovery(row); setParticipants([]); setManager(""); recoveryDirty(); }}>{row.recovered ? "Corriger la gestion" : "Préparer la reprise"}</button></p>)}
    {recovery && <div data-task-legacy-form data-task-management-editor><h3>{String(recovery.original.title || "Tâche historique")}</h3><p>Le gestionnaire est distinct de l’auteur ancien, qui reste inconnu. L’ID, la date historique et les données originales sont conservés.</p>
      {!recovery.recovered && <fieldset><legend>Participants explicitement approuvés</legend>{eligible.map(a => <label className="unified-check" key={a.userId}><input type="checkbox" checked={participants.includes(a.userId)} onChange={e => { setParticipants(p => e.target.checked ? [...p, a.userId] : p.filter(id => id !== a.userId)); if (!e.target.checked && manager === a.userId) setManager(""); recoveryDirty(); }} />{a.label} · {a.access === "read" ? "Lecture" : "Contribution"}{a.email || a.detail ? ` · ${a.email || a.detail}` : ""}</label>)}</fieldset>}
      <label>Gestionnaire explicitement désigné<select name="managerId" value={manager} onChange={e => { setManager(e.target.value); recoveryDirty(); }}><option value="">Choisir un gestionnaire</option>{eligible.filter(a => recovery.recovered || participants.includes(a.userId)).map(a => <option key={a.userId} value={a.userId}>{a.label} · {a.access === "read" ? "Lecture" : "Contribution"}{a.email || a.detail ? ` · ${a.email || a.detail}` : ""}</option>)}</select></label>
      <p>Le gestionnaire doit être un participant. Contribution permet de gérer les champs ; Suppression reste une permission distincte. Aucun remplacement automatique n’est prévu en cas de perte d’accès.</p>
      {recovery.recovered && <p>Le gestionnaire choisi deviendra aussi participant s’il ne l’est pas encore. L’ancien gestionnaire reste responsable jusqu’à un retrait explicite.</p>}
      <label><input type="checkbox" checked={recoveryConfirmed} onChange={e => setRecoveryConfirmed(e.target.checked)} />{recovery.recovered ? "Je confirme ce gestionnaire et son accès explicite comme participant à cette tâche." : "Je confirme les participants et le gestionnaire de cette tâche historique."}</label>
      <button disabled={busy || !recoveryConfirmed || !manager || (!recovery.recovered && !participants.includes(manager))} onClick={() => void recover()}>{recovery.recovered ? "Confirmer la correction de gestion" : "Confirmer la reprise"}</button>
      <button disabled={busy} onClick={() => { setRecovery(undefined); setManager(""); setRecoveryConfirmed(false); onDirty(false); }}>Annuler {recovery.recovered ? "la correction" : "la reprise"}</button>
    </div>}
  </fieldset></section>;
}
