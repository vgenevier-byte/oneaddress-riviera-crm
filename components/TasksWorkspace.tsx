"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buildTaskPatch, draftForTask, effectiveTaskLeadId, filterAndSortTasks, formatTaskTimestamp, parisCivilDate, priorityLabels, TASK_NOTE_LIMIT, TaskRequestLedger, taskCapabilities, taskDueLabel, taskDueState, taskManagementLabel, type TaskFilters } from "@/lib/tasks/domain";
import { taskPriorities, taskStatuses, type Task, type TaskApi, type TaskDraft, type TaskLinkOption, type TaskPermissions, type TaskRecipient, type TaskMutation } from "@/lib/tasks/types";

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
  links?: { leads?: TaskLinkOption[]; contacts?: TaskLinkOption[] };
};

type Editor = { scope: string; id: string; base?: Task; draft: TaskDraft; revision: number | null };

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Opération non confirmée.";
}

function lostAccess(error: unknown) {
  return (error instanceof DOMException && error.name === "AbortError") || /\b(tasks_forbidden|task_forbidden|task_not_visible|tasks_access_denied|tasks_write_forbidden)\b/i.test(messageOf(error));
}

function Dialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `task-dialog-${title.replace(/\s/g, "-")}`;
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="taskws-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="taskws-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Fermer">×</button></div>
    {children}
  </dialog>;
}

export default function TasksWorkspace(props: TasksWorkspaceProps) {
  const scope = `${props.sessionKey}|${props.userId}|${JSON.stringify(props.permissions)}`;
  return <ScopedTasksWorkspace key={scope} {...props} scope={scope} />;
}

/** Account/permission changes remount this entire private state, including drafts. */
function ScopedTasksWorkspace({ api, userId, permissions, onTasksChange, onDirty, onDraftConsumed, query, onQueryChange, draft, links, scope }: TasksWorkspaceProps & { scope: string }) {
  const scopeRef = useRef(scope);
  const callbacks = useRef({ onTasksChange, onDirty, onDraftConsumed });
  useLayoutEffect(() => { callbacks.current = { onTasksChange, onDirty, onDraftConsumed }; }, [onTasksChange, onDirty, onDraftConsumed]);
  const [collection, setCollection] = useState<{ scope: string; items: Task[] }>({ scope, items: [] });
  const [directory, setDirectory] = useState<{ scope: string; items: TaskRecipient[] }>({ scope, items: [] });
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
      if (lostAccess(error)) { accept([], capturedScope); setEditor(null); setDirectory({ scope: capturedScope, items: [] }); requests.current.clear(); callbacks.current.onDirty?.(false); }
      setMessage(lostAccess(error) ? "L’accès a changé. Les tâches et la saisie privée ont été retirées." : "Actualisation non confirmée. Vérifiez la connexion puis réessayez.");
    } finally { if (capturedScope === scopeRef.current && capturedLease === lease.current && readSequence === sequence.current) setLoading(false); }
  }, [accept, api, permissions.read, scope]);

  useEffect(() => {
    ++lease.current;
    const capturedLease = lease.current;
    queueMicrotask(() => { if (capturedLease === lease.current) void refresh(); });
    const endLifetime = () => { ++sequence.current; ++lease.current; callbacks.current.onDirty?.(false); };
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
    const capturedScope = scope, capturedLease = lease.current;
    try { const items = await api.directory(); if (capturedScope === scopeRef.current && capturedLease === lease.current) setDirectory({ scope: capturedScope, items }); }
    catch (error) { if (capturedScope === scopeRef.current && capturedLease === lease.current) {
      if (lostAccess(error)) { accept([], capturedScope); setEditor(null); setDirectory({ scope: capturedScope, items: [] }); requests.current.clear(); callbacks.current.onDirty?.(false); }
      setMessage(lostAccess(error) ? "Vos droits ont changé. La saisie privée a été retirée." : "Annuaire indisponible. La saisie est conservée ; aucun responsable n’a été ajouté.");
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
  const retainedRecipients = currentEditor?.base?.assignees.filter(person => !recipients.some(candidate => candidate.userId === person.userId)) ?? [];
  const leadOptions = links?.leads ?? [], contactOptions = links?.contacts ?? [];

  return <section className="taskws" aria-label="Tâches privées" data-task-workspace>
    {!permissions.read ? <p role="status">Vous n’avez plus accès à Tâches.</p> : <>
      <div className="taskws-heading"><div><h2>Tâches</h2><p>{tasks.length} tâche{tasks.length > 1 ? "s" : ""} vous concerne{tasks.length > 1 ? "nt" : ""} · Terminées conservées</p></div><div className="taskws-buttons">
        <button type="button" onClick={() => void refresh()} disabled={loading}>Actualiser</button>
        {permissions.export && api.export && <button type="button" onClick={() => void exportTasks()}>Exporter mes tâches</button>}
        {permissions.contribute && <button type="button" className="taskws-primary" onClick={() => openEditor()}>Ajouter une tâche</button>}
      </div></div>
      <p className="taskws-help">Actualisation à l’ouverture, au retour dans l’onglet, toutes les 15 secondes quand il est visible et après un enregistrement. Chaque opération vérifie les droits actuels.</p>
      {message && <p role="status" className="taskws-message">{message}</p>}
      {loading && <p role="status">Actualisation des tâches…</p>}
      <div className="taskws-filters">
        <label>Périmètre<select value={filters.relation} onChange={event => setFilters(previous => ({ ...previous, relation: event.target.value as TaskFilters["relation"] }))}><option value="related">Toutes celles qui me concernent</option><option value="assigned">Mes affectations</option><option value="created">Créées par moi</option></select></label>
        <label>Statut<select value={filters.status} onChange={event => setFilters(previous => ({ ...previous, status: event.target.value as TaskFilters["status"] }))}><option value="all">Tous les statuts</option>{taskStatuses.map(status => <option key={status} value={status}>{status === "Terminé" ? "Terminées" : status}</option>)}</select></label>
        <label>Priorité<select value={filters.priority} onChange={event => setFilters(previous => ({ ...previous, priority: event.target.value as TaskFilters["priority"] }))}><option value="all">Toutes les priorités</option>{taskPriorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label>
        <label>Recherche<input type="search" value={query ?? filters.query ?? ""} onChange={event => onQueryChange ? onQueryChange(event.target.value) : setFilters(previous => ({ ...previous, query: event.target.value }))} placeholder="Dans mes tâches visibles" /></label>
      </div>
      <nav aria-label="Sections des tâches" className="taskws-anchors">{taskStatuses.map((status, index) => <a href={`#task-section-${index}`} key={status}>{status === "Terminé" ? "Terminées" : status} ({visibleTasks.filter(task => task.status === status).length})</a>)}</nav>
      <p className="taskws-help">Tri : retards, échéances proches, priorité puis ordre stable. Les tâches sans échéance restent à part.</p>
      <div className="taskws-board">{taskStatuses.map((status, index) => {
        const column = visibleTasks.filter(task => task.status === status);
        return <section className="taskws-column" id={`task-section-${index}`} key={status} aria-labelledby={`task-section-title-${index}`}>
          <h3 id={`task-section-title-${index}`}>{status === "Terminé" ? "Terminées" : status} <span>{column.length}</span></h3>
          {!column.length && <p className="taskws-help">Aucune tâche dans cette section.</p>}
          {column.map(task => {
            const capability = taskCapabilities(task, userId, permissions), busy = pendingIds.includes(task.id);
            return <article className="taskws-card" key={task.id} data-task-id={task.id} data-notification-target={`task-${task.id}`}>
              <button className="taskws-title" type="button" onClick={() => { setDetailId(task.id); setMessage(""); }}>{task.title}</button>
              <div className="taskws-meta"><span className={`taskws-priority taskws-priority-${task.priority}`}>{priorityLabels[task.priority]}</span><span className={`taskws-due-${taskDueState(task.dueDate, today)}`}>{taskDueLabel(task.dueDate, today)}</span></div>
              <p className="taskws-persons">Responsables : {task.assignees.length ? task.assignees.map(person => `${person.label}${person.active ? "" : " (accès inactif)"}`).join(", ") : "Aucun · personnelle au créateur"}</p>
              <p className="taskws-help">Créée par {task.createdByLabel || "Auteur historique non confirmé"}</p>
              {task.createdBy === null && <p className="taskws-help">{taskManagementLabel(task)}</p>}
              {task.notes && <p className="taskws-note-excerpt">{task.notes.length > 160 ? `${task.notes.slice(0, 160)}…` : task.notes}</p>}
              {task.status === "Terminé" && <p className="taskws-help">Terminée le {formatTaskTimestamp(task.completedAt)}</p>}
              <div className="taskws-card-actions"><button type="button" onClick={() => setDetailId(task.id)}>Détail</button>{capability.progress && <button type="button" disabled={busy} onClick={() => openEditor(task)}>Modifier</button>}
                <label>Avancement<select aria-label={`Statut de ${task.title}`} value={task.status} disabled={!capability.progress || busy} onChange={event => void mutate(requests.current.prepare(task.id, task.revision, { status: event.target.value as Task["status"] }))}>{taskStatuses.map(option => <option key={option}>{option}</option>)}</select></label>
                {capability.delete && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Supprimer la tâche « ${task.title} » ?`)) void mutate(requests.current.prepare(task.id, task.revision, {}, true)); }}>Supprimer</button>}
              </div>{busy && <p role="status">Confirmation serveur en cours…</p>}
            </article>;
          })}
        </section>;
      })}</div>
      {detail && <Dialog title="Détail de la tâche" onClose={() => setDetailId(null)}>
        <h3>{detail.title}</h3><div className="taskws-meta"><span>{priorityLabels[detail.priority]}</span><span>{taskDueLabel(detail.dueDate, today)}</span><span>{detail.status}</span></div>
        <dl><dt>Créée par</dt><dd>{detail.createdByLabel || "Auteur historique non confirmé"}</dd><dt>Créée le</dt><dd>{formatTaskTimestamp(detail.createdAt)}</dd><dt>Responsables</dt><dd>{detail.assignees.length ? detail.assignees.map(person => `${person.label} · ${person.active ? person.access === "read" ? "Lecture" : "Contribution" : "Accès inactif"}`).join(" ; ") : "Aucun · personnelle au créateur"}</dd>{detail.status === "Terminé" && <><dt>Terminée le</dt><dd>{formatTaskTimestamp(detail.completedAt)}</dd></>}</dl>
        {detail.createdBy === null && <p className="taskws-help">{taskManagementLabel(detail)}. Ce rôle est distinct de l’auteur historique.</p>}
        {effectiveTaskLeadId(detail) && leadOptions.some(option => option.id === effectiveTaskLeadId(detail)) && <p>Lead lié : {leadOptions.find(option => option.id === effectiveTaskLeadId(detail))?.label}</p>}
        {detail.contactId && contactOptions.some(option => option.id === detail.contactId) && <p>Contact lié : {contactOptions.find(option => option.id === detail.contactId)?.label}</p>}
        <h3>Notes</h3><p className="taskws-notes">{detail.notes || "Aucune note."}</p>
        <div className="taskws-buttons"><button type="button" onClick={() => setDetailId(null)}>Fermer</button>{taskCapabilities(detail, userId, permissions).progress && <button type="button" className="taskws-primary" onClick={() => openEditor(detail)}>Modifier</button>}</div>
      </Dialog>}
      {currentEditor && <Dialog title={currentEditor.base ? "Modifier la tâche" : "Ajouter une tâche"} onClose={() => { setEditor(null); callbacks.current.onDirty?.(false); }} busy={editorBusy}>
        {message && <p role="alert" className="taskws-message">{message}</p>}
        {currentEditor.base ? <p className="taskws-help">Créée par {currentEditor.base.createdByLabel || "Auteur historique non confirmé"} · {formatTaskTimestamp(currentEditor.base.createdAt)}{currentEditor.base.completedAt ? ` · Terminée le ${formatTaskTimestamp(currentEditor.base.completedAt)}` : ""}</p> : <p className="taskws-help">Votre identité et la date de création seront enregistrées par le serveur.</p>}
        {currentEditor.base?.createdBy === null && <p className="taskws-help">{taskManagementLabel(latest ?? currentEditor.base)}. Le gestionnaire peut gérer les champs avec Contribution ; l’auteur ancien reste non confirmé.</p>}
        {!editorCapabilities.fields && <p className="taskws-help">En tant que responsable contributeur, vous pouvez modifier les notes et l’avancement.</p>}
        {conflict && latest && <section className="taskws-conflict"><h3>Une autre modification a été enregistrée</h3><p>Votre saisie reste ci-dessous. La version serveur actuelle est :</p><dl><dt>Titre</dt><dd>{latest.title}</dd><dt>Notes</dt><dd className="taskws-notes">{latest.notes || "Aucune note"}</dd><dt>Échéance</dt><dd>{taskDueLabel(latest.dueDate, today)}</dd><dt>Priorité et statut</dt><dd>{priorityLabels[latest.priority]} · {latest.status}</dd><dt>Responsables</dt><dd>{latest.assignees.map(person => person.label).join(", ") || "Aucun"}</dd></dl><button type="button" onClick={() => setEditor(previous => previous?.id === latest.id ? { ...previous, base: latest, revision: latest.revision } : previous)}>Reprendre sur cette révision avec ma saisie</button><p className="taskws-help">Cette action permet un nouvel enregistrement explicite après comparaison.</p></section>}
        <form onSubmit={submit} className="taskws-form">
          <label className="taskws-full">Titre<input name="title" maxLength={500} required value={currentEditor.draft.title} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("title", event.target.value)} /></label>
          <label>Date limite<input name="dueDate" type="date" value={currentEditor.draft.dueDate} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("dueDate", event.target.value)} /></label>
          <label>Priorité<select name="priority" value={currentEditor.draft.priority} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("priority", event.target.value as TaskDraft["priority"])}>{taskPriorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label>
          <label className="taskws-full">Avancement<select name="status" value={currentEditor.draft.status} disabled={editorBusy || !editorCapabilities.progress} onChange={event => changeDraft("status", event.target.value as TaskDraft["status"])}>{taskStatuses.map(status => <option key={status}>{status}</option>)}</select></label>
          <label className="taskws-full">Notes<textarea name="notes" rows={6} maxLength={TASK_NOTE_LIMIT} value={currentEditor.draft.notes} disabled={editorBusy || !editorCapabilities.progress} onChange={event => changeDraft("notes", event.target.value)} /><small>{currentEditor.draft.notes.length.toLocaleString("fr-FR")} / {TASK_NOTE_LIMIT.toLocaleString("fr-FR")} caractères · Texte commun aux participants autorisés</small></label>
          <fieldset className="taskws-full" disabled={!editorCapabilities.fields || editorBusy}><legend>Responsables</legend><p className="taskws-help">Comptes actifs de l’organisation disposant de Tâches. Un lecteur consulte ; un contributeur peut avancer la tâche.</p>
            {recipients.map(person => <label className="taskws-recipient" key={person.userId}><input type="checkbox" checked={selectedRecipients.includes(person.userId)} disabled={currentEditor.base?.createdBy === null && currentEditor.base.managerId === person.userId} onChange={event => changeDraft("assigneeIds", event.target.checked ? [...selectedRecipients, person.userId] : selectedRecipients.filter(id => id !== person.userId))} /><span>{person.label}{person.userId === userId ? " (moi)" : ""}<small>{person.access === "read" ? "Lecture" : "Contribution"}{person.detail ? ` · ${person.detail}` : ""}{currentEditor.base?.createdBy === null && currentEditor.base.managerId === person.userId ? " · Gestionnaire, participant conservé" : ""}</small></span></label>)}
            {retainedRecipients.map(person => <label className="taskws-recipient" key={person.userId}><input type="checkbox" checked={selectedRecipients.includes(person.userId)} disabled={!selectedRecipients.includes(person.userId) || (currentEditor.base?.createdBy === null && currentEditor.base.managerId === person.userId)} onChange={() => changeDraft("assigneeIds", selectedRecipients.filter(id => id !== person.userId))} /><span>{person.label}<small>{currentEditor.base?.createdBy === null && currentEditor.base.managerId === person.userId ? "Gestionnaire conservé · correction de gestion privée requise" : "Affectation conservée · accès inactif ou indisponible. Décochez pour retirer explicitement."}</small></span></label>)}
            {!recipients.length && <p className="taskws-help">Aucun destinataire éligible reçu. Vous pouvez conserver une tâche personnelle.</p>}
            {!selectedRecipients.length && <p className="taskws-help">Aucun responsable sélectionné : tâche personnelle, visible uniquement par son créateur.</p>}
            <button type="button" onClick={() => void loadDirectory()}>Actualiser les personnes éligibles</button>
          </fieldset>
          {(leadOptions.length > 0 || currentEditor.draft.leadId) && <label className="taskws-full">Lead lié<select name="leadId" value={currentEditor.draft.leadId} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("leadId", event.target.value)}><option value="">Aucun lead lié</option>{currentEditor.draft.leadId && !leadOptions.some(option => option.id === currentEditor.draft.leadId) && <option value={currentEditor.draft.leadId}>Rattachement conservé · détail indisponible</option>}{leadOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
          {(contactOptions.length > 0 || currentEditor.draft.contactId) && <label className="taskws-full">Contact lié<select name="contactId" value={currentEditor.draft.contactId} disabled={!editorCapabilities.fields || editorBusy} onChange={event => changeDraft("contactId", event.target.value)}><option value="">Aucun contact lié</option>{currentEditor.draft.contactId && !contactOptions.some(option => option.id === currentEditor.draft.contactId) && <option value={currentEditor.draft.contactId}>Rattachement conservé · détail indisponible</option>}{contactOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
          <div className="taskws-full taskws-buttons"><button type="button" disabled={editorBusy} onClick={() => { setEditor(null); callbacks.current.onDirty?.(false); }}>Annuler</button><button className="taskws-primary" type="submit" disabled={editorBusy || conflict || !editorCapabilities.progress}>{editorBusy ? "Confirmation en cours…" : currentEditor.base ? "Enregistrer" : "Créer la tâche"}</button></div>
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
      .taskws-dialog-heading > button { flex: 0 0 auto; font-size: 20px; }
      .taskws-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
      .taskws-full { grid-column: 1 / -1; }
      .taskws-dialog textarea { resize: vertical; min-height: 120px; }
      .taskws-dialog small { font-size: 12px; font-weight: 400; color: #687283; }
      .taskws-dialog fieldset { border: 1px solid #dce1e7; border-radius: 8px; padding: 12px; margin: 0; }
      .taskws-dialog legend { font-weight: 600; padding: 0 4px; }
      .taskws-dialog .taskws-recipient { display: flex; flex-direction: row; align-items: flex-start; gap: 9px; padding: 8px 0; }
      .taskws-recipient > input { flex: 0 0 18px; width: 18px; height: 18px; margin: 2px 0 0; }
      .taskws-recipient > span { flex: 1; }
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
