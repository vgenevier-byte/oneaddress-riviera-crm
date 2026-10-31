"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { isCancelled, useScopedOperations } from "@/lib/access/operations";
import { usePageRefreshGuard } from "@/lib/usePageRefreshGuard";
import styles from "./ProjectsWorkspace.module.css";

type CopyState = "pending" | "copying" | "synced" | "retry";
type DriveStatus = {
  primary?:boolean; configured: boolean; projectId: string; status: CopyState; error?: string;
  files: { assetId: string; name: string; category: string; status: CopyState; error?: string }[];
  canRetry: boolean; canOpen: boolean;
};
const labels: Record<CopyState, [string, string]> = {
  pending: ["En attente de copie", "Waiting to copy"], copying: ["Copie en cours", "Copying"],
  synced: ["Synchronisé avec Google Drive", "Synced with Google Drive"], retry: ["Copie à reprendre", "Copy needs attention"],
};

/** Display confirmed file state; direct uploads resume from their preserved draft. */
export default function ProjectDriveSync({ projectId, revision, lang, accessSignal }: {
  projectId: string; revision: number; lang: "fr" | "en"; accessSignal?: AbortSignal;
}) {
  const begin = useScopedOperations("fonciere");
  const [snapshot, setSnapshot] = useState<DriveStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  usePageRefreshGuard({ busy });
  const epoch = useRef(0);
  const tr = (fr: string, en: string) => lang === "en" ? en : fr;
  const refresh = useCallback(async (signal: AbortSignal) => {
    const ticket = ++epoch.current;
    const op = await begin();
    const combined = AbortSignal.any([op.signal, signal, ...(accessSignal ? [accessSignal] : [])]);
    const response = await op.run(() => fetch(`/api/fonciere/drive?project=${encodeURIComponent(projectId)}`, {
      headers: { Authorization: `Bearer ${op.token}`, "Accept-Language": lang }, cache: "no-store", signal: combined,
    }));
    if (!response.ok) throw new Error("status-unavailable");
    const value = await response.json() as DriveStatus;
    await op.check(); combined.throwIfAborted();
    if (ticket === epoch.current && value.projectId === projectId) { setSnapshot(value); setError(""); }
  }, [begin, projectId, accessSignal, lang]);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => { void refresh(controller.signal).catch(failure => { if (!controller.signal.aborted && !accessSignal?.aborted && !isCancelled(failure)) { setSnapshot(null); setError("status-unavailable"); } }); };
    load();
    const timer = window.setInterval(load, 15000);
    window.addEventListener("focus", load);
    const revoke = () => { controller.abort(); epoch.current++; setSnapshot(null); };
    accessSignal?.addEventListener("abort", revoke, { once: true });
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); accessSignal?.removeEventListener("abort", revoke); };
  }, [refresh, revision, accessSignal]);
  async function retry() {
    if (busy || !snapshot?.canRetry || accessSignal?.aborted) return;
    setBusy(true); setError("");
    try {
      const op = await begin();
      const signal = AbortSignal.any([op.signal, ...(accessSignal ? [accessSignal] : [])]);
      const response = await op.run(() => fetch("/api/fonciere/drive", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${op.token}`, "Accept-Language": lang }, body: JSON.stringify({ projectId }), signal }));
      if (!response.ok) throw new Error("retry-unavailable");
      await refresh(signal);
    } catch (failure) { if (!isCancelled(failure) && !accessSignal?.aborted) setError("retry-unavailable"); }
    finally { if (!accessSignal?.aborted) setBusy(false); }
  }
  async function openFolder() {
    if (busy || !snapshot?.canOpen || accessSignal?.aborted) return;
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setBusy(true); setError("");
    try {
      const op = await begin();
      const signal = AbortSignal.any([op.signal, ...(accessSignal ? [accessSignal] : [])]);
      const response = await op.run(() => fetch(`/api/fonciere/drive/folder?project=${encodeURIComponent(projectId)}`, { headers: { Authorization: `Bearer ${op.token}`, "Accept-Language": lang }, cache: "no-store", signal }));
      if (!response.ok) throw new Error("folder-unavailable");
      const result = await response.json() as { url?: string };
      await op.check(); signal.throwIfAborted();
      if (!result.url || !/^https:\/\/drive\.google\.com\/drive\/folders\/[\w-]+$/.test(result.url)) throw new Error("folder-unavailable");
      if (popup) popup.location.replace(result.url); else window.location.assign(result.url);
    } catch (failure) { popup?.close(); if (!isCancelled(failure) && !accessSignal?.aborted) setError("folder-unavailable"); }
    finally { if (!accessSignal?.aborted) setBusy(false); }
  }
  const active = snapshot?.projectId === projectId ? snapshot : null;
  return <section className={styles.driveSync} aria-label={tr("Fichiers Google Drive", "Google Drive files")} data-project-drive>
    <h4>Google Drive</h4>
    <p role="status">{active ? active.primary?active.status==="synced"?tr("Fichiers enregistrés dans Google Drive", "Files saved in Google Drive"):active.status==="pending"?tr("Dossier Drive en préparation", "Preparing Drive folder"):active.status==="retry"?tr("Fichiers Drive à vérifier", "Drive files need verification"):tr("Vérification Drive en cours", "Checking Drive"):labels[active.status]?.[lang === "en" ? 1 : 0] || labels.pending[lang === "en" ? 1 : 0] : tr("État de la copie en cours de vérification…", "Checking copy status…")}</p>
    {active && !active.configured && <p>{tr("Projet enregistré. La destination Google Drive doit être configurée par l’administrateur.", "Project saved. An administrator must configure the Google Drive destination.")}</p>}
    {active?.error && <p className={styles.driveError}>{active.error}</p>}
    {error && <p role="alert" className={styles.driveError}>{error === "retry-unavailable" ? tr("Reprise non confirmée. Vérifiez vos droits et réessayez.", "Retry was not confirmed. Check your access and try again.") : error === "folder-unavailable" ? tr("Dossier inaccessible avec vos droits actuels. La copie reste conservée.", "Folder unavailable with your current access. The copy is retained.") : tr("État Google Drive indisponible. Le projet enregistré est conservé.", "Google Drive status unavailable. Your saved project is retained.")}</p>}
    <div className={styles.documentActions}>
      {active?.canRetry && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void retry()}><RefreshCw size={15}/>{tr("Réessayer la copie", "Retry copy")}</button>}
      {active?.canOpen && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void openFolder()}><FolderOpen size={15}/>{tr("Ouvrir le dossier Google Drive", "Open Google Drive folder")}</button>}
    </div>
    {Boolean(active?.files.length) && <details><summary>{tr("État par fichier", "File copy status")} ({active!.files.length})</summary><ul>{active!.files.map(file => <li key={file.assetId}><strong>{file.name}</strong><span>{labels[file.status]?.[lang === "en" ? 1 : 0] || labels.pending[lang === "en" ? 1 : 0]}</span>{file.error && <span className={styles.driveError}>{file.error}</span>}</li>)}</ul></details>}
    <p className={styles.muted}>{active?.primary?tr("Les fichiers en attente restent dans votre brouillon. Reprenez l’enregistrement pour terminer leur transfert.","Pending files remain in your draft. Resume saving to finish their transfer."):tr("La copie continue après fermeture de cet onglet. Les droits Google Drive restent indépendants des autorisations CRM.", "Copying continues after this tab closes. Google Drive permissions remain independent from CRM access.")}</p>
  </section>;
}
