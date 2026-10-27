"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { TASKS_CHANGED } from "@/lib/tasks/client";
import { taskTargetKey } from "@/lib/tasks/domain";
import type { Task, TaskApi, TaskInitialDraft, TaskPermissions, TaskTargetRef } from "@/lib/tasks/types";
import TasksWorkspace from "./TasksWorkspace";
import { usePageRefreshGuard } from "@/lib/usePageRefreshGuard";

type TaskLinksContext = {
  api: TaskApi; permissions: TaskPermissions; sessionKey: string;
  create: (reference: TaskTargetRef, options?: { title?: string; dueDate?: string }) => void;
  openTask: (id: string) => void;
  openTarget: (reference: TaskTargetRef) => void;
};
const Context = createContext<TaskLinksContext | null>(null);
export const useTaskLinks = () => useContext(Context);

export default function TaskLinkProvider({ api, userId, sessionKey, permissions, onOpenTarget, children }: {
  api: TaskApi; userId: string; sessionKey: string; permissions: TaskPermissions;
  onOpenTarget?: (reference: TaskTargetRef) => void; children: ReactNode;
}) {
  const { language } = useI18n(); const en = language === "en";
  const scope = `${sessionKey}|${userId}|${JSON.stringify(permissions)}`;
  const [panel, setPanel] = useState<{ scope: string; key: string; draft?: TaskInitialDraft; taskId?: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const visiblePanel = panel?.scope === scope && permissions.read ? panel : null;
  const close = useCallback(() => { if (dirty && !window.confirm(en ? "Close this task and discard unsaved changes?" : "Fermer cette tâche et abandonner les modifications non enregistrées ?")) return; setPanel(null); setDirty(false); }, [dirty, en]);
  const create = useCallback((reference: TaskTargetRef, options?: { title?: string; dueDate?: string }) => {
    if (!permissions.contribute) return;
    setDirty(false);
    setPanel({ scope, key: crypto.randomUUID(), draft: { title: (en ? englishTaskTitle(options?.title) : options?.title) || (en ? "Check the linked item" : "Vérifier l’élément lié"), dueDate: options?.dueDate, target: reference } });
  }, [scope, permissions.contribute, en]);
  const openTask = useCallback((id: string) => { if (permissions.read) { setDirty(false); setPanel({ scope, key: crypto.randomUUID(), taskId: id }); } }, [scope, permissions.read]);
  const closed = useCallback(() => { setPanel(null); setDirty(false); }, []);
  usePageRefreshGuard({ dirty: dirty && Boolean(visiblePanel) });
  const openTarget = useCallback((reference: TaskTargetRef) => { closed(); onOpenTarget?.(reference); }, [closed, onOpenTarget]);
  const title = visiblePanel?.draft ? en ? "Create a linked task" : "Créer une tâche liée" : en ? "Linked task" : "Tâche liée";
  return <Context.Provider value={{ api, permissions, sessionKey: scope, create, openTask, openTarget }}>{children}
    {visiblePanel && <div className="task-source-overlay" role="region" aria-label={title}>
      <div className="task-source-panel"><header><h2>{title}</h2><button type="button" onClick={close}>{en ? "Return to source" : "Revenir à la fiche"}</button></header>
        <TasksWorkspace key={visiblePanel.key} api={api} userId={userId} sessionKey={scope} permissions={permissions} draft={visiblePanel.draft} focusTaskId={visiblePanel.taskId} onDirty={setDirty} onSaved={closed} onEditorClosed={closed} onOpenTarget={openTarget} />
      </div>
    </div>}
    <style jsx global>{`
.task-source-overlay{position:fixed;inset:0;z-index:1700;background:rgba(20,30,42,.45);padding:20px;overflow:auto}.task-source-panel{width:min(1200px,100%);margin:auto;background:#fff;color:#293345;padding:20px;border-radius:14px;min-height:240px}.task-source-panel>header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap}.task-source-panel>header h2{margin:0;font-size:20px}.task-source-panel>header button,.task-source-actions button{min-height:38px;border:1px solid #cdd1d8;border-radius:8px;background:#fff;color:#293345;padding:8px 12px;cursor:pointer}.task-source-actions{padding:10px 0;font-size:13px;min-width:0;overflow-wrap:anywhere}.task-source-actions summary{cursor:pointer;font-weight:600;min-height:34px;display:flex;align-items:center;gap:8px}.task-source-actions details>div{padding:8px;border:1px solid #dce1e7;border-radius:8px;margin-top:4px}.task-source-actions ul{list-style:none;margin:8px 0;padding:0;display:grid;gap:6px}.task-source-actions li{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.task-source-actions button:focus-visible,.task-source-actions summary:focus-visible,.task-source-panel>header button:focus-visible{outline:3px solid #547ec2;outline-offset:2px}.task-source-actions small{color:#687283;display:block;margin:6px 0}.task-source-actions button:disabled{opacity:.6;cursor:default}@media(max-width:600px){.task-source-overlay{padding:8px}.task-source-panel{padding:12px}}
`}</style>
  </Context.Provider>;
}

/** A source action holds only a real reference. Inverse counts are loaded on
 * expansion, with task and target visibility rechecked independently. */
export function TaskSourceActions({ reference, title, dueDate, saved = true }: {
  reference?: TaskTargetRef; title?: string; dueDate?: string; saved?: boolean;
}) {
  const context = useTaskLinks(); const { language, label, formatDate } = useI18n(); const en = language === "en";
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<{ scope: string; key: string; tasks: Task[] }>({ scope: "", key: "", tasks: [] });
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const epoch = useRef(0);
  const key = reference ? taskTargetKey(reference) : "";
  const scope = context?.sessionKey ?? "";
  const api = context?.api;
  const readable = context?.permissions.read === true;
  const tasks = snapshot.scope === scope && snapshot.key === key && readable ? snapshot.tasks : [];
  useEffect(() => {
    if (!expanded || !saved || !key || !readable || !api?.forTarget) return;
    let cancelled = false;
    async function refresh() {
      const ticket = ++epoch.current; setLoading(true); setError("");
      try {
        const items = await api!.forTarget!(JSON.parse(keyToRef()));
        if (!cancelled && ticket === epoch.current) setSnapshot({ scope, key, tasks: items });
      } catch { if (!cancelled && ticket === epoch.current) { setSnapshot({ scope, key, tasks: [] }); setError(en ? "Linked tasks unavailable. Check your access and retry." : "Tâches liées indisponibles. Vérifiez vos droits et réessayez."); } }
      finally { if (!cancelled && ticket === epoch.current) setLoading(false); }
    }
    // key uses sorted context tuples; reconstruct from the current reference
    // captured by this scope rather than copying any label into the relation.
    function keyToRef() { const [type, id, entries] = JSON.parse(key) as [string, string, [string, string][]]; return JSON.stringify({ type, id, context: Object.fromEntries(entries) }); }
    void refresh(); const change = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener(TASKS_CHANGED, change); window.addEventListener("focus", change);
    const timer = window.setInterval(change, 15000);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener(TASKS_CHANGED, change); window.removeEventListener("focus", change); };
  }, [expanded, saved, key, readable, api, scope, en]);
  if (!context || !readable) return null;
  return <section className="task-source-actions" data-task-source={reference?.type}>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>{en ? "Linked tasks" : "Tâches liées"}{expanded && !loading && !error && <span>({tasks.length})</span>}</summary>
      <div>{!saved || !reference ? <p>{en ? "Save this item first to link a task to its confirmed identifier." : "Enregistrez cet élément avant de lui rattacher une tâche avec son identifiant confirmé."}</p> : <>
        {loading && <p role="status">{en ? "Loading visible tasks…" : "Chargement des tâches visibles…"}</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && !tasks.length && <p>{en ? "No visible linked tasks" : "Aucune tâche liée visible"}</p>}
        <ul>{tasks.map(task => <li key={task.id}><button type="button" onClick={() => context.openTask(task.id)}>{task.title}</button><span>{label(task.status, "modules")}{task.dueDate ? ` · ${formatDate(task.dueDate)}` : ""}</span></li>)}</ul>
        {context.permissions.contribute && <button type="button" onClick={() => context.create(reference, { title, dueDate })}>{en ? "Create a task" : "Créer une tâche"}</button>}
        <small>{en ? "Only tasks you are authorized to view appear here." : "Seules les tâches que vous êtes autorisé à consulter apparaissent ici."}</small>
      </>}</div>
    </details>
  </section>;
}

export function LinkedTasks({ target, ...props }: { target?: TaskTargetRef; title?: string; dueDate?: string; saved?: boolean }) { return <TaskSourceActions reference={target} {...props} />; }

function englishTaskTitle(value?: string): string | undefined {
  if (!value) return value;
  const titles: Record<string, string> = {
    "Vérifier le devis client": "Check the customer quote", "Vérifier la réservation": "Check the booking",
    "Vérifier la facture à payer": "Check the invoice to pay", "Vérifier l’intervention et ses frais": "Check the intervention and expenses",
    "Contrôler le paiement enregistré": "Review the recorded payment", "Vérifier le suivi de la maison": "Check house tracking",
    "Vérifier le dossier intervenant (historique)": "Check the historical worker record", "Vérifier ou compléter les heures": "Check or complete working hours",
    "Vérifier ou compléter le dossier contact": "Check or complete the contact record", "Vérifier ou compléter le dossier": "Check or complete the record",
    "Suivre la demande client": "Follow up the customer enquiry", "Vérifier l’élément du planning": "Check the schedule item", "Vérifier le RIB": "Check the bank account"
  };
  return titles[value] ?? value;
}
