"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isCancelled, useScopedOperations } from "@/lib/access/operations";
import { useFonciereLocale } from "@/lib/fonciere/locale";
import styles from "./ProjectAccess.module.css";

type AccessOption = { userId: string; email: string; role: "admin" | "partner" | "contributor" | "reader"; assigned: boolean; inherited: boolean };
type Props = { projectId: string; userId?: string; accessSignal?: AbortSignal; onDirty?: (dirty: boolean) => void };

export default function ProjectAccess({ projectId, userId, accessSignal, onDirty }: Props) {
  const [locale] = useFonciereLocale(), begin = useScopedOperations("izord");
  const [options, setOptions] = useState<AccessOption[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const t = (fr: string, en: string) => locale === "fr" ? fr : en;
  const read = useCallback(async (local: AbortController) => {
    const op = await begin(), signal = AbortSignal.any([op.signal, local.signal, ...(accessSignal ? [accessSignal] : [])]);
    const result = await op.run(() => op.client.rpc("fonciere_access_options", { p_project: projectId }).abortSignal(signal));
    signal.throwIfAborted(); if (result.error || !Array.isArray(result.data)) throw new Error("forbidden");
    setOptions(result.data as AccessOption[]); setLoadedFor(projectId); setLoading(false); setBusy(false);
  }, [begin, projectId, accessSignal]);

  useEffect(() => {
    const local = new AbortController(); controller.current = local;
    const timer = window.setTimeout(() => { void read(local).catch(failure => { if (!local.signal.aborted && !isCancelled(failure)) { setLoading(false); setBusy(false); setError(locale === "fr" ? "Les accès au projet sont indisponibles pour ce compte." : "Project access is unavailable for this account."); } }); }, 0);
    return () => { window.clearTimeout(timer); local.abort(); controller.current?.abort(); };
  }, [read, userId, locale]);
  useEffect(() => { onDirty?.(busy); return () => onDirty?.(false); }, [busy, onDirty]);

  async function assign(option: AccessOption, assigned: boolean) {
    if (busy || loading || loadedFor !== projectId || option.inherited || accessSignal?.aborted) return;
    const local = new AbortController(); controller.current?.abort(); controller.current = local;
    setBusy(true); setError(""); setNotice("");
    try {
      const op = await begin(), signal = AbortSignal.any([op.signal, local.signal, ...(accessSignal ? [accessSignal] : [])]);
      const result = await op.run(() => op.client.rpc("fonciere_assign_project", { p_project: projectId, p_user: option.userId, p_assigned: assigned }).abortSignal(signal));
      signal.throwIfAborted(); if (result.error) throw new Error("forbidden");
      await read(local); signal.throwIfAborted(); setNotice(t("Accès au projet mis à jour.", "Project access updated."));
    } catch (failure) {
      if (!local.signal.aborted && !isCancelled(failure)) setError(t("La modification des accès n’a pas été confirmée. Rechargez le projet pour vérifier l’affectation.", "The access change was not confirmed. Reload the project to verify the assignment."));
    } finally { if (!local.signal.aborted && !accessSignal?.aborted) setBusy(false); }
  }

  const roles = { admin: t("Administrateur", "Administrator"), partner: t("Associé", "Partner"), contributor: t("Contributeur", "Contributor"), reader: t("Lecture", "Reader") };
  const pending = loading || loadedFor !== projectId;
  return <section className={styles.panel} aria-labelledby="fonciere-access-title" aria-busy={pending || busy}>
    <h3 id="fonciere-access-title">{t("Accès au projet", "Project access")}</h3>
    <p>{t("Chaque affectation est enregistrée immédiatement pour ce projet et ses documents. Le rôle et les permissions de rubrique restent applicables.", "Each assignment is saved immediately for this project and its documents. Existing role and module permissions still apply.")}</p>
    {pending && !error ? <p className={styles.message} role="status">{t("Chargement des accès…", "Loading access…")}</p> : !pending && <div className={styles.list}>{options.map(option => <label className={styles.row} key={option.userId}>
      <input type="checkbox" checked={option.assigned || option.inherited} disabled={busy || option.inherited || accessSignal?.aborted} onChange={event => { void assign(option, event.target.checked); }} />
      <span className={styles.identity}>{option.email || option.userId}<span className={styles.detail}>{roles[option.role]}{option.inherited ? t(" · Accès lié au rôle ou à la propriété du projet", " · Access inherited from role or project ownership") : ""}</span></span>
    </label>)}</div>}
    {error && <p className={`${styles.message} ${styles.error}`} role="alert">{error}</p>}
    {notice && <p className={styles.message} role="status">{notice}</p>}
  </section>;
}
