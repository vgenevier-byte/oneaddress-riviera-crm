"use client";
import { moduleMessage } from "@/lib/i18n/moduleMessage";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buildTaskPatch, draftForTask, effectiveTaskLeadId, filterAndSortTasks, parisCivilDate, priorityLabels, TASK_NOTE_LIMIT, TaskRequestLedger, taskCapabilities, taskDueState, type TaskFilters } from "@/lib/tasks/domain";
import { taskPriorities, taskStatuses, type Task, type TaskApi, type TaskDraft, type TaskLinkOption, type TaskPermissions, type TaskRecipient, type TaskMutation } from "@/lib/tasks/types";
import { taskContactLabel, type TaskContactOption } from "@/lib/tasks/contactOptions";
import TaskContactPicker from "./TaskContactPicker";

export type TasksWorkspaceProps = {
  api: TaskApi;
  userId: string;
  /** Changes with account/session identity. No browser cache is shared between accounts. */
  sessionKey: string;
  permissions: TaskPermissions;
  onTasksChange?: (tasks: Task[]) => void;
  onDirty?: (dirty: boolean) => void;
  onDraftConsumed?: () => void;
  query?: string;
  onQueryChange?: (query: string) => void;
  draft?: { title?: string; leadId?: string; contactId?: string };
  links?: { leads?: TaskLinkOption[]; contacts?: TaskContactOption[] };
};

type Editor = { scope: string; id: string; base?: Task; draft: TaskDraft; revision: number | null };
type Directory = { scope: string; items: TaskRecipient[]; remembered: TaskRecipient[]; status: "idle" | "loading" | "ready" | "error" };

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Opération non confirmée.";
}

function lostAccess(error: unknown) {
  return (error instanceof DOMException && error.name === "AbortError") || /\b(tasks_forbidden|task_forbidden|task_not_visible|tasks_access_denied|tasks_write_forbidden)\b/i.test(messageOf(error));
}

function Dialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const {t} = useI18n();

  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `task-dialog-${title.replace(/\s/g, "-")}`;
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="taskws-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="taskws-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label={t("modules.tasksWorkspace.close")}>×</button></div>
    {children}
  </dialog>;
}

export default function TasksWorkspace(props: TasksWorkspaceProps) {
  const scope = `${props.sessionKey}|${props.userId}|${JSON.stringify(props.permissions)}`;
  return <ScopedTasksWorkspace key={scope} {...props} scope={scope} />;
}

/** Account/permission changes remount this entire private state, including drafts. */
function ScopedTasksWorkspace({ api, userId, permissions, onTasksChange, onDirty, onDraftConsumed, query, onQueryChange, draft, links, scope }: TasksWorkspaceProps & { scope: string }) {
  const {t, label: uiLabel, formatDate: uiDate, locale} = useI18n();

  const contactLabel = (contact: TaskContactOption) => [contact.firstName, contact.name, contact.company].some(value => value?.trim()) ? taskContactLabel(contact) : t("modules.contacts.unnamed");
  const formatTaskTimestamp = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? uiDate(value, {dateStyle: "short", timeStyle: "short"}) : t("modules.contactDocuments.notProvided");
  const taskDueLabel = (value: string, reference = today) => {
    const state = taskDueState(value, reference);
    return state === "none" ? t("modules.common.noDeadline") : state === "invalid" ? t("modules.common.historicalDeadlineToCheck") : uiLabel(state === "late" ? "En retard" : state === "today" ? "Aujourd’hui" : "À venir", "modules") + " · " + uiDate(value);
  };
  const taskManagementLabel = (task: Task) => task.createdBy !== null ? "" : !task.managerId ? t("modules.common.noManagerAssignedPrivateCorrectionRequired") : t("modules.tasks.manager", {name: task.managerLabel || t("modules.common.confirmedIdentity"), inactive: task.managerActive === true ? "" : t("modules.tasks.inactiveManager")});
  const scopeRef = useRef(scope);
  const callbacks = useRef({ onTasksChange, onDirty, onDraftConsumed });
  useLayoutEffect(() => { callbacks.current = { onTasksChange, onDirty, onDraftConsumed }; }, [onTasksChange, onDirty, onDraftConsumed]);
  const [collection, setCollection] = useState<{ scope: string; items: Task[] }>({ scope, items: [] });
  const [directory, setDirectory] = useState<Directory>({ scope, items: [], remembered: [], status: "idle" });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TaskFilters>({ relation: "related", status: "all", priority: "all", query: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [today, setToday] = useState(parisCivilDate);
  const requests = useRef(new TaskRequestLedger());
  const pending = useRef(new Set<string>());
  const sequence = useRef(0);
  const directorySequence = useRef(0);
  const lease = useRef(0);
  const knownVisible = useRef(new Set<string>());
  const visibilityEpochs = useRef(new Map<string, number>());
  const editorRef = useRef<Editor | null>(null);
  useLayoutEffect(() => { editorRef.current = editor; }, [editor]);
  const consumedDraft = useRef("");
  const tasks = collection.scope === scope && permissions.read ? collection.items : [];
  const recipients = directory.scope === scope ? directory.items : [];
  const currentEditor = editor?.scope === scope && permissions.contribute ? editor : null;
  const detail = tasks.find(task => task.id === detailId);
  const latest = currentEditor?.base ? tasks.find(task => task.id === currentEditor.id) : undefined;
  const conflict = Boolean(latest && currentEditor?.revision !== latest.revision);
  const visibleTasks = filterAndSortTasks(tasks, userId, { ...filters, query: query ?? filters.query }, today);

  const accept = useCallback((items: Task[], capturedScope: string) => {
    if (scopeRef.current !== capturedScope) return;
    const nextVisible = new Set(items.map(task => task.id));
    for (const id of knownVisible.current) if (!nextVisible.has(id)) visibilityEpochs.current.set(id, (visibilityEpochs.current.get(id) ?? 0) + 1);
    knownVisible.current = nextVisible;
    setCollection({ scope: capturedScope, items });
    setDetailId(previous => previous && items.some(task => task.id === previous) ? previous : null);
    setEditor(previous => previous?.base && !items.some(task => task.id === previous.id) ? null : previous);
    if (editorRef.current?.base && !items.some(task => task.id === editorRef.current?.id)) callbacks.current.onDirty?.(false);
  }, []);

  const refresh = useCallback(async () => {
    const capturedScope = scope, capturedLease = lease.current, readSequence = ++sequence.current;
    if (!permissions.read) return;
    setLoading(true);
    try {
      const items = await api.list();
      if (capturedScope !== scopeRef.current || capturedLease !== lease.current || readSequence !== sequence.current) return;
      accept(items, capturedScope); setToday(parisCivilDate());
    } catch (error) {
      if (capturedScope !== scopeRef.current || capturedLease !== lease.current || readSequence !== sequence.current) return;
      if (lostAccess(error)) { accept([], capturedScope); setEditor(null); ++directorySequence.current; setDirectory({ scope: capturedScope, items: [], remembered: [], status: "idle" }); requests.current.clear(); callbacks.current.onDirty?.(false); }
      setMessage(lostAccess(error) ? "L’accès a changé. Les tâches et la saisie privée ont été retirées." : "Actualisation non confirmée. Vérifiez la connexion puis réessayez.");
    } finally { if (capturedScope === scopeRef.current && capturedLease === lease.current && readSequence === sequence.current) setLoading(false); }
  }, [accept, api, permissions.read, scope]);

  useEffect(() => {
    ++lease.current;
    const capturedLease = lease.current;
    queueMicrotask(() => { if (capturedLease === lease.current) void refresh(); });
    const endLifetime = () => { ++sequence.current; ++directorySequence.current; ++lease.current; callbacks.current.onDirty?.(false); };
    return endLifetime;
  }, [refresh, scope]);

  useEffect(() => { callbacks.current.onTasksChange?.(collection.scope === scope && permissions.read ? collection.items : []); }, [collection, permissions.read, scope]);

  useEffect(() => {
    const focus = () => { void refresh(); };
    const visibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
    window.addEventListener("oar-tasks-changed", focus);
    const clock = window.setInterval(() => setToday(parisCivilDate()), 60_000);
    const polling = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("oar-tasks-changed", focus); window.clearInterval(clock); window.clearInterval(polling); };
  }, [refresh]);

  const loadDirectory = useCallback(async () => {
    const capturedScope = scope, capturedLease = lease.current, readSequence = ++directorySequence.current;
    setDirectory(previous => ({ ...previous, status: "loading" }));
    try {
      const items = await api.directory();
      if (capturedScope !== scopeRef.current || capturedLease !== lease.current || readSequence !== directorySequence.current) return;
      setDirectory(previous => ({ scope: capturedScope, items, remembered: [...new Map([...previous.remembered, ...items].map(person => [person.userId, person])).values()], status: "ready" }));
    }
    catch (error) { if (capturedScope === scopeRef.current && capturedLease === lease.current && readSequence === directorySequence.current) {
      if (lostAccess(error)) {
        accept([], capturedScope); setEditor(null); setDirectory({ scope: capturedScope, items: [], remembered: [], status: "idle" }); requests.current.clear(); callbacks.current.onDirty?.(false);
        setMessage("Vos droits ont changé. La saisie privée a été retirée.");
      } else setDirectory(previous => ({ ...previous, status: "error" }));
    } }
  }, [accept, api, scope]);

  useEffect(() => {
    const key = `${scope}|${JSON.stringify(draft)}`;
    if (!draft || consumedDraft.current === key || !permissions.contribute) return;
    consumedDraft.current = key;
    const capturedLease = lease.current;
    queueMicrotask(() => { if (capturedLease === lease.current) { setEditor({ scope, id: crypto.randomUUID(), draft: draftForTask(undefined, draft), revision: null }); callbacks.current.onDraftConsumed?.(); } });
    void loadDirectory();
  }, [draft, loadDirectory, permissions.contribute, scope]);

  function openEditor(task?: Task) {
    if (!permissions.contribute || (task && !taskCapabilities(task, userId, permissions).progress)) return;
    try {
      const values = draftForTask(task);
      setDetailId(null); setMessage("");
      setEditor({ scope, id: task?.id ?? crypto.randomUUID(), base: task, revision: task?.revision ?? null, draft: values });
      void loadDirectory();
    } catch (error) { setMessage(messageOf(error)); }
  }

  function changeDraft<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setEditor(previous => previous?.scope === scope ? { ...previous, draft: { ...previous.draft, [key]: value } } : previous);
    callbacks.current.onDirty?.(true);
  }

  function forgetTask(id: string) {
    const remaining = tasks.filter(task => task.id !== id);
    accept(remaining, scope); requests.current.confirmed(id); callbacks.current.onDirty?.(false);
  }

  async function mutate(request: TaskMutation, closeEditor = false) {
    if (pending.current.has(request.id)) return;
    const capturedScope = scope, capturedLease = lease.current, capturedVisibility = visibilityEpochs.current.get(request.id) ?? 0;
    pending.current.add(request.id); setPendingIds([...pending.current]); setMessage("");
    try {
      const confirmed = await api.mutate(request);
      if (capturedScope !== scopeRef.current || capturedLease !== lease.current || capturedVisibility !== (visibilityEpochs.current.get(request.id) ?? 0)) return;
      requests.current.confirmed(request.id);
      // Only confirmed data is shown; a status change never captures a browser timestamp.
      setCollection(previous => {
        if (previous.scope !== capturedScope) return previous;
        const items = previous.items.filter(task => task.id !== request.id);
        if (confirmed) items.push(confirmed);
        return { scope: capturedScope, items };
      });
      if (closeEditor) setEditor(null);
      if (!confirmed) setDetailId(null);
      if (!editorRef.current || (closeEditor && editorRef.current.id === request.id)) callbacks.current.onDirty?.(false);
      setMessage(confirmed ? "Enregistrement confirmé par le serveur." : "Suppression confirmée par le serveur.");
      // Reload the authoritative projection, including current assignment visibility.
      await refresh();
    } catch (error) {
      if (capturedScope !== scopeRef.current || capturedLease !== lease.current || capturedVisibility !== (visibilityEpochs.current.get(request.id) ?? 0)) return;
      if (lostAccess(error)) {
        forgetTask(request.id); setEditor(null); setDetailId(null);
        setMessage("Cette opération n’est plus autorisée. La tâche et sa saisie privée ont été retirées.");
        await refresh();
      } else if (/revision_conflict|conflict/i.test(messageOf(error))) {
        setMessage("Conflit : la tâche a été modifiée. Votre saisie est conservée. Relisez la version actuelle avant de reprendre.");
        await refresh();
      } else {
        setMessage(/network|fetch|connexion|Failed/i.test(messageOf(error)) ? "Connexion interrompue. Résultat non confirmé ; votre saisie est conservée. Réessayer utilise la même demande." : `Enregistrement non confirmé. Votre saisie est conservée. ${messageOf(error)}`);
      }
    } finally {
      if (capturedScope === scopeRef.current && capturedLease === lease.current) { pending.current.delete(request.id); setPendingIds([...pending.current]); }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!currentEditor) return;
    try {
      const capabilities = currentEditor.base ? taskCapabilities(latest ?? currentEditor.base, userId, permissions) : { fields: permissions.contribute, progress: permissions.contribute };
      if (!capabilities.progress) return;
      const patch = buildTaskPatch(currentEditor.draft, currentEditor.base, capabilities.fields);
      if (!Object.keys(patch).length) { setMessage("Aucun changement à enregistrer."); return; }
      callbacks.current.onDirty?.(true);
      void mutate(requests.current.prepare(currentEditor.id, currentEditor.revision, patch), true);
    } catch (error) { setMessage(messageOf(error)); }
  }

  async function exportTasks() {
    if (!permissions.export || !api.export) return;
    const capturedScope = scope, capturedLease = lease.current;
    try {
      const items = await api.export(); if (scopeRef.current !== capturedScope || capturedLease !== lease.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: "application/json" }));
      try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = "taches.json"; anchor.click(); } finally { URL.revokeObjectURL(url); }
    } catch (error) { if (scopeRef.current === capturedScope && capturedLease === lease.current) setMessage(`Export non confirmé. ${messageOf(error)}`); }
  }

  const editorCapabilities = currentEditor?.base ? taskCapabilities(latest ?? currentEditor.base, userId, permissions) : { fields: permissions.contribute, progress: permissions.contribute, delete: false };
  const editorBusy = Boolean(currentEditor && pendingIds.includes(currentEditor.id));
  const selectedRecipients = currentEditor ? currentEditor.draft.assigneeIds : [];
  const availableRecipients = recipients.filter(person => !selectedRecipients.includes(person.userId));
  const recipientDetails = new Map([...directory.remembered, ...(currentEditor?.base?.assignees ?? []), ...recipients].map(person => [person.userId, person]));
  const requiredManagerId = currentEditor?.base?.createdBy === null ? currentEditor.base.managerId : null;
  const leadOptions = links?.leads ?? [], contactOptions = links?.contacts ?? [];
  const detailContact = detail?.contactId ? contactOptions.find(option => option.id === detail.contactId) : undefined;

  function addRecipient(id: string) {
    if (!currentEditor || !editorCapabilities.fields || editorBusy || !recipients.some(person => person.userId === id) || selectedRecipients.includes(id)) return;
    setEditor(previous => previous?.scope === scope && previous.id === currentEditor.id && !previous.draft.assigneeIds.includes(id) ? { ...previous, draft: { ...previous.draft, assigneeIds: [...previous.draft.assigneeIds, id] } } : previous);
    callbacks.current.onDirty?.(true);
  }

  function removeRecipient(id: string) {
    if (!currentEditor || !editorCapabilities.fields || editorBusy || id === requiredManagerId || !selectedRecipients.includes(id)) return;
    setEditor(previous => previous?.scope === scope && previous.id === currentEditor.id && !(previous.base?.createdBy === null && previous.base.managerId === id) ? { ...previous, draft: { ...previous.draft, assigneeIds: previous.draft.assigneeIds.filter(selected => selected !== id) } } : previous);
    callbacks.current.onDirty?.(true);
  }

  return <section className="taskws" aria-label={t("modules.tasksWorkspace.privateTasks")} data-task-workspace>
    {!permissions.read ? <p role="status">{t("modules.tasksWorkspace.youNoLongerHaveAccessToTasks")}</p> : <>
      <div className="taskws-heading"><div><h2>{t("modules.tasksWorkspace.tasks")}</h2><p>{t("modules.tasks.count", {count: tasks.length})}</p></div><div className="taskws-buttons">
        <button type="button" onClick={() => void refresh()} disabled={loading}>{t("modules.tasksWorkspace.refresh")}</button>
        {permissions.export && api.export && <button type="button" onClick={() => void exportTasks()}>{t("modules.tasksWorkspace.exportMyTasks")}</button>}
        {permissions.contribute && <button type="button" className="taskws-primary" onClick={() => openEditor()}>{t("modules.tasksWorkspace.addATask")}</button>}
      </div></div>
      <p className="taskws-help">{t("modules.tasksWorkspace.tasksRefreshWhenOpenedWhenYouReturnToTheTabEvery15")}</p>
      {message && <p role="status" className="taskws-message">{moduleMessage(message, t)}</p>}
      {loading && <p role="status">{t("modules.tasksWorkspace.refreshingTasks")}</p>}
      <div className="taskws-filters">
        <label>{t("modules.tasksWorkspace.scope")}<select value={filters.relation} onChange={event => setFilters(previous => ({ ...previous, relation: event.target.value as TaskFilters["relation"] }))}><option value="related">{t("modules.tasksWorkspace.allTasksInvolvingMe")}</option><option value="assigned">{t("modules.tasksWorkspace.assignedToMe")}</option><option value="created">{t("modules.tasksWorkspace.createdByMe")}</option></select></label>
        <label>{t("modules.tasksWorkspace.status")}<select value={filters.status} onChange={event => setFilters(previous => ({ ...previous, status: event.target.value as TaskFilters["status"] }))}><option value="all">{t("modules.tasksWorkspace.allStatuses")}</option>{taskStatuses.map(status => <option key={status} value={status}>{status === "Terminé" ? t("modules.tasksWorkspace.completed") : uiLabel(status, "modules")}</option>)}</select></label>
        <label>{t("modules.tasksWorkspace.priority")}<select value={filters.priority} onChange={event => setFilters(previous => ({ ...previous, priority: event.target.value as TaskFilters["priority"] }))}><option value="all">{t("modules.tasksWorkspace.allPriorities")}</option>{taskPriorities.map(priority => <option key={priority} value={priority}>{uiLabel(priorityLabels[priority], "modules")}</option>)}</select></label>
        <label>{t("modules.moduleWorkspace.search")}<input type="search" value={query ?? filters.query ?? ""} onChange={event => onQueryChange ? onQueryChange(event.target.value) : setFilters(previous => ({ ...previous, query: event.target.value }))} placeholder={t("modules.tasksWorkspace.searchMyVisibleTasks")} /></label>
      </div>
      <nav aria-label={t("modules.tasksWorkspace.taskSections")} className="taskws-anchors">{taskStatuses.map((status, index) => <a href={`#task-section-${index}`} key={status}>{status === "Terminé" ? t("modules.tasksWorkspace.completed") : uiLabel(status, "modules")} ({visibleTasks.filter(task => task.status === status).length})</a>)}</nav>
      <p className="taskws-help">{t("modules.tasksWorkspace.sortedByOverdueDatesUpcomingDeadlinesPriorityThenAStableOrderTasks")}</p>
      <div className="taskws-board">{taskStatuses.map((status, index) => {
        const column = visibleTasks.filter(task => task.status === status);
        return <section className="taskws-column" id={`task-section-${index}`} key={status} aria-labelledby={`task-section-title-${index}`}>
          <h3 id={`task-section-title-${index}`}>{status === "Terminé" ? t("modules.tasksWorkspace.completed") : uiLabel(status, "modules")} <span>{column.length}</span></h3>
          {!column.length && <p className="taskws-help">{t("modules.tasksWorkspace.noTasksInThisSection")}</p>}
          {column.map(task => {
            const capability = taskCapabilities(task, userId, permissions), busy = pendingIds.includes(task.id);
            return <article className="taskws-card" key={task.id} data-task-id={task.id} data-notification-target={`task-${task.id}`}>
              <button className="taskws-title" type="button" onClick={() => { setDetailId(task.id); setMessage(""); }}>{task.title}</button>
              <div className="taskws-meta"><span className={`taskws-priority taskws-priority-${task.priority}`}>{uiLabel(priorityLabels[task.priority], "modules")}</span><span className={`taskws-due-${taskDueState(task.dueDate, today)}`}>{taskDueLabel(task.dueDate, today)}</span></div>
              <p className="taskws-persons">{t("modules.tasksWorkspace.assignees")} {task.assignees.length ? task.assignees.map(person => `${person.label}${person.active ? "" : t("modules.tasksWorkspace.inactiveAccess_594462")}`).join(", ") : t("modules.tasksWorkspace.nonePrivateToItsCreator")}</p>
              <p className="taskws-help">{t("modules.tasksWorkspace.createdBy")} {task.createdByLabel || t("modules.tasksWorkspace.historicalAuthorUnconfirmed")}</p>
              {task.createdBy === null && <p className="taskws-help">{taskManagementLabel(task)}</p>}
              {task.notes && <p className="taskws-note-excerpt">{task.notes.length > 160 ? `${task.notes.slice(0, 160)}…` : task.notes}</p>}
              {task.status === "Terminé" && <p className="taskws-help">{t("modules.tasksWorkspace.completedOn")} {formatTaskTimestamp(task.completedAt)}</p>}
              <div className="taskws-card-actions"><button type="button" onClick={() => setDetailId(task.id)}>{t("modules.tasksWorkspace.details")}</button>{capability.progress && <button type="button" disabled={busy} onClick={() => openEditor(task)}>{t("modules.tasksWorkspace.edit")}</button>}
                <label>{t("modules.tasksWorkspace.progress")}<select aria-label={t("modules.tasks.statusOf", {title: task.title})} value={task.status} disabled={!capability.progress || busy} onChange={event => void mutate(requests.current.prepare(task.id, task.revision, { status: event.target.value as Task["status"] }))}>{taskStatuses.map(option => <option key={option} value={option}>{uiLabel(option, "modules")}</option>)}</select></label>
                {capability.delete && <button type="button" disabled={busy} onClick={() => { if (window.confirm(t("modules.tasks.deleteConfirm", {title: task.title}))) void mutate(requests.current.prepare(task.id, task.revision, {}, true)); }}>{t("modules.tasksWorkspace.delete")}</button>}
              </div>{busy && <p role="status">{t("modules.tasksWorkspace.awaitingServerConfirmation")}</p>}
            </article>;
          })}
        </section>;
      })}</div>
      {detail && <Dialog title={t("modules.tasksWorkspace.taskDetails")} onClose={() => setDetailId(null)}>
        <h3>{detail.title}</h3><div className="taskws-meta"><span>{uiLabel(priorityLabels[detail.priority], "modules")}</span><span>{taskDueLabel(detail.dueDate, today)}</span><span>{uiLabel(detail.status, "modules")}</span></div>
        <dl><dt>{t("modules.tasksWorkspace.createdBy")}</dt><dd>{detail.createdByLabel || t("modules.tasksWorkspace.historicalAuthorUnconfirmed")}</dd><dt>{t("modules.tasksWorkspace.createdOn")}</dt><dd>{formatTaskTimestamp(detail.createdAt)}</dd><dt>{t("modules.tasksWorkspace.assignees_a6d3cc")}</dt><dd>{detail.assignees.length ? detail.assignees.map(person => `${person.label} · ${person.active ? person.access === "read" ? t("modules.moduleWorkspace.read") : t("modules.moduleWorkspace.contribute") : t("modules.tasksWorkspace.inactiveAccess")}`).join(" ; ") : t("modules.tasksWorkspace.nonePrivateToItsCreator")}</dd>{detail.status === "Terminé" && <><dt>{t("modules.tasksWorkspace.completedOn")}</dt><dd>{formatTaskTimestamp(detail.completedAt)}</dd></>}</dl>
        {detail.createdBy === null && <p className="taskws-help">{taskManagementLabel(detail)}{t("modules.tasksWorkspace.thisRoleIsSeparateFromTheHistoricalAuthor")}</p>}
        {effectiveTaskLeadId(detail) && leadOptions.some(option => option.id === effectiveTaskLeadId(detail)) && <p>{t("modules.tasksWorkspace.linkedEnquiry")} {leadOptions.find(option => option.id === effectiveTaskLeadId(detail))?.label}</p>}
        {detail.contactId && <p>{t("modules.tasksWorkspace.linkedContact")} {detailContact ? contactLabel(detailContact) : t("modules.tasksWorkspace.linkRetainedDetailsUnavailable")}</p>}
        <h3>{t("modules.tasksWorkspace.notes")}</h3><p className="taskws-notes">{detail.notes || t("modules.tasksWorkspace.noNotes")}</p>
        <div className="taskws-buttons"><button type="button" onClick={() => setDetailId(null)}>{t("modules.tasksWorkspace.close")}</button>{taskCapabilities(detail, userId, permissions).progress && <button type="button" className="taskws-primary" onClick={() => openEditor(detail)}>{t("modules.tasksWorkspace.edit")}</button>}</div>
      </Dialog>}
      {currentEditor && <Dialog title={currentEditor.base ? t("modules.tasksWorkspace.editTask") : t("modules.tasksWorkspace.addATask")} onClose={() => { setEditor(null); callbacks.current.onDirty?.(false); }} busy={editorBusy}>
        {message && <p role="alert" className="taskws-message">{moduleMessage(message, t)}</p>}
        {currentEditor.base ? <p className="taskws-help">{t("modules.tasksWorkspace.createdBy")} {currentEditor.base.createdByLabel || t("modules.tasksWorkspace.historicalAuthorUnconfirmed")} · {formatTaskTimestamp(currentEditor.base.createdAt)}{currentEditor.base.completedAt ? t("modules.tasks.completedDate", {date: formatTaskTimestamp(currentEditor.base.completedAt)}) : ""}</p> : <p className="taskws-help">{t("modules.tasksWorkspace.theServerWillRecordYourIdentityAndTheCreationDate")}</p>}
        {currentEditor.base?.createdBy === null && <p className="taskws-help">{taskManagementLabel(latest ?? currentEditor.base)}{t("modules.tasksWorkspace.theManagerCanEditFieldsWithContributeAccessTheHistoricalAuthorRemains")}</p>}
        {!editorCapabilities.fields && <p className="taskws-help">{t("modules.tasksWorkspace.asAnAssigneeWithContributeAccessYouCanEditNotesAndProgress")}</p>}
        {conflict && latest && <section className="taskws-conflict"><h3>{t("modules.tasksWorkspace.anotherChangeHasBeenSaved")}</h3><p>{t("modules.tasksWorkspace.yourInputIsRetainedBelowTheCurrentServerVersionIs")}</p><dl><dt>{t("modules.tasksWorkspace.title")}</dt><dd>{latest.title}</dd><dt>{t("modules.tasksWorkspace.notes")}</dt><dd className="taskws-notes">{latest.notes || t("modules.tasksWorkspace.noNotes_41980d")}</dd><dt>{t("modules.tasksWorkspace.deadline")}</dt><dd>{taskDueLabel(latest.dueDate, today)}</dd><dt>{t("modules.tasksWorkspace.priorityAndStatus")}</dt><dd>{uiLabel(priorityLabels[latest.priority], "modules")} · {uiLabel(latest.status, "modules")}</dd><dt>{t("modules.tasksWorkspace.assignees_a6d3cc")}</dt><dd>{latest.assignees.map(person => person.label).join(", ") || t("modules.tasksWorkspace.none")}</dd></dl><button type="button" onClick={() => setEditor(previous => previous?.id === latest.id ? { ...previous, base: latest, revision: latest.revision } : previous)}>{t("modules.tasksWorkspace.continueFromThisRevisionWithMyInput")}</button><p className="taskws-help">{t("modules.tasksWorkspace.thisLetsYouSaveAgainExplicitlyAfterComparingTheVersions")}</p></section>}
        <form onSubmit={submit} className="taskws-form">
          <label className="taskws-full">{t("modules.tasksWorkspace.title")}<input name="title" maxLength={500} required value={currentEditor.draft.title} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("title", event.target.value)} /></label>
          <label>{t("modules.tasksWorkspace.dueDate")}<input name="dueDate" type="date" value={currentEditor.draft.dueDate} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("dueDate", event.target.value)} /></label>
          <label>{t("modules.tasksWorkspace.priority")}<select name="priority" value={currentEditor.draft.priority} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("priority", event.target.value as TaskDraft["priority"])}>{taskPriorities.map(priority => <option key={priority} value={priority}>{uiLabel(priorityLabels[priority], "modules")}</option>)}</select></label>
          <label className="taskws-full">{t("modules.tasksWorkspace.progress")}<select name="status" value={currentEditor.draft.status} disabled={editorBusy || !editorCapabilities.progress} onChange={event => changeDraft("status", event.target.value as TaskDraft["status"])}>{taskStatuses.map(status => <option key={status} value={status}>{uiLabel(status, "modules")}</option>)}</select></label>
          <label className="taskws-full">{t("modules.tasksWorkspace.notes")}<textarea name="notes" rows={6} maxLength={TASK_NOTE_LIMIT} value={currentEditor.draft.notes} disabled={editorBusy || !editorCapabilities.progress} onChange={event => changeDraft("notes", event.target.value)} /><small>{currentEditor.draft.notes.length.toLocaleString(locale)} / {TASK_NOTE_LIMIT.toLocaleString(locale)}  {t("modules.tasksWorkspace.charactersSharedTextForAuthorisedParticipants")}</small></label>
          <fieldset className="taskws-full" disabled={!editorCapabilities.fields || editorBusy} data-task-directory={directory.status}><legend>{t("modules.tasksWorkspace.assignees_a6d3cc")}</legend><p className="taskws-help">{t("modules.tasksWorkspace.selectActiveOrganisationAccountsWithAccessToTasksReadersCanViewTasks")}</p>
            {directory.status === "loading" && <p role="status">{t("modules.tasksWorkspace.loadingEligiblePeopleYourInputAndSelectionsAreRetained")}</p>}
            {directory.status === "error" && <p role="alert">{t("modules.tasksWorkspace.directoryUnavailableYourInputAndSelectionsAreRetainedRetryToRefreshEligible")}</p>}
            <p className="taskws-help" aria-live="polite">{t("modules.tasks.assigneeCount", {count: selectedRecipients.length})}</p>
            <select name="recipientToAdd" aria-label={t("modules.tasksWorkspace.selectAnAssignee")} className="taskws-add-recipient" value="" disabled={directory.status === "loading" || !availableRecipients.length} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} onChange={event => { const id = event.currentTarget.value; event.currentTarget.value = ""; addRecipient(id); }}><option value="">{t("modules.tasksWorkspace.selectAnAssignee")}</option>{availableRecipients.map(person => <option key={person.userId} value={person.userId}>{person.label}{person.userId === userId ? t("modules.tasksWorkspace.me") : ""} · {person.access === "read" ? t("modules.moduleWorkspace.read") : t("modules.moduleWorkspace.contribute")}{person.email ? ` · ${person.email}` : ""}{person.detail && person.detail !== person.email ? ` · ${person.detail}` : ""}</option>)}</select>
            {selectedRecipients.length > 0 && <ul className="taskws-recipients" aria-label={t("modules.tasksWorkspace.selectedAssignees")}>{selectedRecipients.map(id => {
              const person = recipientDetails.get(id), label = person?.label ?? t("modules.tasksWorkspace.assigneeUnavailable");
              const retained = !recipients.some(candidate => candidate.userId === id), required = id === requiredManagerId;
              return <li className="taskws-recipient" key={id} data-task-recipient-id={id} data-task-recipient-kind={retained ? "retained" : "eligible"}><span>{label}{id === userId ? t("modules.tasksWorkspace.me") : ""}<small>{retained ? required ? t("modules.tasksWorkspace.managerRetainedPrivateManagementCorrectionRequired") : t("modules.tasksWorkspace.assignmentRetainedAccessInactiveOrUnavailableRemoveItExplicitlyIfNeeded") : `${person?.access === "read" ? t("modules.moduleWorkspace.read") : t("modules.moduleWorkspace.contribute")}${required ? t("modules.tasksWorkspace.managerRetainedParticipant") : ""}`}{person?.email ? ` · ${person.email}` : ""}{person?.detail && person.detail !== person.email ? ` · ${person.detail}` : ""}</small></span><button type="button" aria-label={t("modules.common.removePerson", {name: label})} disabled={required} onClick={() => removeRecipient(id)}>×</button></li>;
            })}</ul>}
            {directory.status === "ready" && !recipients.length && <p role="status" className="taskws-help">{t("modules.tasksWorkspace.noEligibleAccountsYouCanKeepAPersonalTask")}</p>}
            {!selectedRecipients.length && <p className="taskws-help">{t("modules.tasksWorkspace.noAssigneeSelectedAPersonalTaskVisibleOnlyToItsCreator")}</p>}
            <button type="button" disabled={directory.status === "loading"} onClick={() => void loadDirectory()}>{directory.status === "error" ? t("modules.tasksWorkspace.retryLoadingAssignees") : t("modules.tasksWorkspace.refreshEligiblePeople")}</button>
          </fieldset>
          {(leadOptions.length > 0 || currentEditor.draft.leadId) && <label className="taskws-full">{t("modules.tasksWorkspace.linkedEnquiry_98abe0")}<select name="leadId" value={currentEditor.draft.leadId} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("leadId", event.target.value)}><option value="">{t("modules.tasksWorkspace.noLinkedEnquiry")}</option>{currentEditor.draft.leadId && !leadOptions.some(option => option.id === currentEditor.draft.leadId) && <option value={currentEditor.draft.leadId}>{t("modules.tasksWorkspace.linkRetainedDetailsUnavailable")}</option>}{leadOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
          <TaskContactPicker key={currentEditor.id} options={contactOptions} contactId={currentEditor.draft.contactId} disabled={!editorCapabilities.fields || editorBusy} onChange={id => changeDraft("contactId", id)} />
          <div className="taskws-full taskws-buttons"><button type="button" disabled={editorBusy} onClick={() => { setEditor(null); callbacks.current.onDirty?.(false); }}>{t("modules.tasksWorkspace.cancel")}</button><button className="taskws-primary" type="submit" disabled={editorBusy || conflict || !editorCapabilities.progress}>{editorBusy ? t("modules.tasksWorkspace.awaitingConfirmation") : currentEditor.base ? t("modules.tasksWorkspace.save") : t("modules.tasksWorkspace.createTask")}</button></div>
        </form>
      </Dialog>}
    </>}
    <style jsx global>{`
      .taskws { container: task-panel / inline-size; min-width: 0; width: 100%; color: inherit; }
      .taskws *, .taskws-dialog * { box-sizing: border-box; min-width: 0; overflow-wrap: anywhere; }
      .taskws h2, .taskws h3, .taskws-dialog h2, .taskws-dialog h3 { margin: 0 0 12px; }
      .taskws p, .taskws-dialog p { margin: 8px 0; }
      .taskws-heading, .taskws-dialog-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .taskws-buttons, .taskws-anchors, .taskws-meta, .taskws-card-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .taskws button, .taskws-dialog button { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; max-width: 100%; padding: 8px 12px; border: 1px solid #d8d9e0; border-radius: 8px; background: #fff; color: #293345; white-space: normal; text-align: center; cursor: pointer; }
      .taskws button:disabled, .taskws-dialog button:disabled { opacity: .6; cursor: default; }
      .taskws button:focus-visible, .taskws a:focus-visible, .taskws-dialog button:focus-visible, .taskws input:focus-visible, .taskws select:focus-visible, .taskws-dialog input:focus-visible, .taskws-dialog select:focus-visible, .taskws-dialog textarea:focus-visible { outline: 3px solid #547ec2; outline-offset: 2px; }
      .taskws .taskws-primary, .taskws-dialog .taskws-primary { background: #24374a; color: #fff; border-color: #24374a; }
      .taskws-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 12px; margin: 16px 0; }
      .taskws label, .taskws-dialog label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; font-weight: 500; }
      .taskws input, .taskws select, .taskws-dialog input, .taskws-dialog select, .taskws-dialog textarea { width: 100%; max-width: 100%; min-width: 0; padding: 9px; border: 1px solid #cdd1d8; border-radius: 7px; background: #fff; color: #293345; font: inherit; }
      .taskws-anchors { margin-bottom: 12px; }
      .taskws-anchors a { color: #304862; border: 1px solid #d9dfe4; padding: 8px 10px; border-radius: 8px; text-decoration: none; font-size: 14px; }
      .taskws-board { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }
      .taskws-column { padding: 14px; border: 1px solid #dde1e6; border-radius: 12px; background: #f4f6f8; scroll-margin-top: 20px; }
      .taskws-column > h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .taskws-column h3 > span { font-size: 13px; background: #e1e7ed; border-radius: 30px; padding: 2px 8px; }
      .taskws-card { background: #fff; border: 1px solid #e0e4e9; border-radius: 10px; padding: 14px; margin-top: 12px; }
      .taskws .taskws-title { display: block; width: 100%; border: 0; padding: 0; min-height: 28px; font-weight: 700; font-size: 16px; text-align: left; justify-content: flex-start; }
      .taskws-meta { font-size: 13px; margin: 10px 0; }
      .taskws-priority { padding: 3px 7px; background: #e9eef3; border-radius: 5px; }
      .taskws-priority-important { background: #fff0ca; color: #71520b; }
      .taskws-priority-urgent { background: #ffe0dc; color: #912d23; }
      .taskws-due-late { color: #982f24; }
      .taskws-due-today { color: #7f5c05; }
      .taskws-help, .taskws-dialog .taskws-help { color: #687283; font-size: 13px; font-weight: 400; }
      .taskws-persons { font-size: 14px; }
      .taskws-note-excerpt, .taskws-notes { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
      .taskws-card-actions { margin-top: 12px; align-items: end; }
      .taskws-card-actions label { flex: 1 1 140px; }
      .taskws-message, .taskws-conflict { padding: 12px; border: 1px solid #e1c793; background: #fff8e9; border-radius: 8px; }
      .taskws-dialog { box-sizing: border-box; width: min(720px, calc(100vw - 24px)); max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px); overflow-y: auto; overflow-x: clip; padding: 20px; border: 1px solid #d8dfe6; border-radius: 14px; margin: auto; color: #293345; background: #fff; }
      .taskws-dialog::backdrop { background: rgba(20, 30, 42, .5); }
      .taskws-dialog-heading { flex-wrap: nowrap; align-items: center; margin-bottom: 12px; }
      .taskws-dialog-heading h2 { margin: 0; flex: 1; }
      .taskws-dialog .taskws-dialog-heading > button { flex: 0 0 auto; width: auto; font-size: 20px; }
      .taskws-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
      .taskws-full { grid-column: 1 / -1; }
      .taskws-dialog textarea { resize: vertical; min-height: 120px; }
      .taskws-dialog small { font-size: 12px; font-weight: 400; color: #687283; }
      .taskws-dialog fieldset { border: 1px solid #dce1e7; border-radius: 8px; padding: 12px; margin: 0; }
      .taskws-dialog legend { font-weight: 600; padding: 0 4px; }
      .taskws-dialog .taskws-add-recipient { margin-top: 4px; min-height: 42px; }
      .taskws-recipients { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 12px 0; }
      .taskws-dialog .taskws-recipient { display: flex; flex: 0 1 auto; max-width: 100%; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid #dce1e7; border-radius: 8px; background: #f4f6f8; font-size: 14px; }
      .taskws-recipient > span { flex: 1; }
      .taskws-dialog .taskws-recipient > button { flex: 0 0 38px; width: 38px; padding: 0; }
      .taskws-recipient small { display: block; margin-top: 3px; }
      .taskws-dialog dl { display: grid; grid-template-columns: minmax(0, 130px) minmax(0, 1fr); gap: 8px 12px; font-size: 14px; }
      .taskws-dialog dt { font-weight: 600; }
      .taskws-dialog dd { margin: 0; }
      .taskws-conflict { margin-bottom: 14px; }
      @container task-panel (min-width: 640px) { .taskws-board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @container task-panel (min-width: 940px) { .taskws-board { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (max-width: 430px) { .taskws-dialog { padding: 14px; } .taskws-form { grid-template-columns: minmax(0, 1fr); } .taskws-dialog dl { grid-template-columns: minmax(0, 1fr); gap: 4px; } .taskws-dialog dd { margin-bottom: 8px; } }
    `}</style>
  </section>;
}
