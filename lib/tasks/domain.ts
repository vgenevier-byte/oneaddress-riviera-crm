import { taskPriorities, taskStatuses, type Task, type TaskDraft, type TaskMutation, type TaskPatch, type TaskPermissions, type TaskPriority } from "./types";

export const TASK_NOTE_LIMIT = 10_000;
export const priorityLabels: Record<TaskPriority, string> = { normal: "Normale", important: "Importante", urgent: "Urgente" };

export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function parisCivilDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function taskDueState(value: string, today = parisCivilDate()): "none" | "invalid" | "late" | "today" | "upcoming" {
  if (!value) return "none";
  if (!isCivilDate(value)) return "invalid";
  return value < today ? "late" : value === today ? "today" : "upcoming";
}

export function formatCivilDate(value: string): string {
  if (!isCivilDate(value)) return "Échéance historique à vérifier";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function taskDueLabel(value: string, today = parisCivilDate()): string {
  const state = taskDueState(value, today);
  if (state === "none") return "Sans échéance";
  if (state === "invalid") return "Échéance historique à vérifier";
  return `${state === "late" ? "En retard" : state === "today" ? "Aujourd’hui" : "À venir"} · ${formatCivilDate(value)}`;
}

export function formatTaskTimestamp(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Non renseignée";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

/** No inferred author/recipient identity is used for capabilities. Server checks remain authoritative. */
export function taskCapabilities(task: Task, userId: string, permissions: TaskPermissions) {
  const creator = Boolean(task.createdBy && task.createdBy === userId);
  const assigned = task.assignees.some(value => value.userId === userId && value.active);
  const read = permissions.read && (creator || assigned);
  const manager = task.createdBy === null && task.managerId === userId && task.managerActive === true && assigned;
  const managesFields = creator || manager;
  return { read, fields: read && managesFields && permissions.contribute, progress: read && permissions.contribute, delete: read && managesFields && permissions.contribute && permissions.delete };
}

/** The deprecated output alias can only supply the same effective lead reference. */
export function effectiveTaskLeadId(task: Pick<Task, "leadId" | "linkedTo">): string {
  const canonical = task.leadId || "", alias = task.linkedTo || "";
  if (canonical && alias && canonical !== alias) throw new Error("Rattachements lead contradictoires. Relisez la référence avant de modifier la tâche.");
  return canonical || alias;
}

export function taskManagementLabel(task: Task): string {
  if (task.createdBy !== null) return "";
  if (!task.managerId) return "Gestion non désignée · correction privée requise";
  return `Gestionnaire : ${task.managerLabel || "Identité confirmée"}${task.managerActive === true ? "" : " · accès de gestion inactif, correction privée requise"}`;
}

export type TaskFilters = { relation: "related" | "created" | "assigned"; status: "all" | Task["status"]; priority: "all" | TaskPriority; query?: string };

export function filterAndSortTasks(tasks: Task[], userId: string, filters: TaskFilters, today = parisCivilDate()): Task[] {
  const ranks: Record<TaskPriority, number> = { urgent: 0, important: 1, normal: 2 };
  const query = filters.query?.trim().toLocaleLowerCase("fr-FR") ?? "";
  return tasks.filter(task => {
    const creator = Boolean(task.createdBy && task.createdBy === userId);
    const assigned = task.assignees.some(value => value.userId === userId && value.active);
    return (filters.relation === "created" ? creator : filters.relation === "assigned" ? assigned : creator || assigned)
      && (filters.status === "all" || task.status === filters.status)
      && (filters.priority === "all" || task.priority === filters.priority)
      && (!query || [task.title, task.notes, task.createdByLabel, ...task.assignees.map(value => value.label)].join(" ").toLocaleLowerCase("fr-FR").includes(query));
  }).sort((a, b) => {
    const aState = taskDueState(a.dueDate, today), bState = taskDueState(b.dueDate, today);
    const bucket = (state: string) => state === "late" ? 0 : state === "today" || state === "upcoming" ? 1 : 2;
    return bucket(aState) - bucket(bState)
      || ((isCivilDate(a.dueDate) && isCivilDate(b.dueDate)) ? a.dueDate.localeCompare(b.dueDate) : 0)
      || ranks[a.priority] - ranks[b.priority]
      || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
      || a.id.localeCompare(b.id);
  });
}

export function draftForTask(task?: Task, initial?: { title?: string; leadId?: string; contactId?: string }): TaskDraft {
  return { title: task?.title ?? initial?.title ?? "", notes: task?.notes ?? "", dueDate: task?.dueDate ?? "", priority: task?.priority ?? "normal", status: task?.status ?? "À faire", assigneeIds: task?.assignees.map(value => value.userId) ?? [], leadId: task ? effectiveTaskLeadId(task) : initial?.leadId ?? "", contactId: task?.contactId ?? initial?.contactId ?? "" };
}

function sameIds(first: string[], second: string[]) {
  return first.length === second.length && [...first].sort().every((value, index) => value === [...second].sort()[index]);
}

export function buildTaskPatch(draft: TaskDraft, base?: Task, fields = true): TaskPatch {
  if (draft.notes.length > TASK_NOTE_LIMIT) throw new Error(`Les notes sont limitées à ${TASK_NOTE_LIMIT.toLocaleString("fr-FR")} caractères.`);
  if (!taskStatuses.includes(draft.status)) throw new Error("Statut invalide.");
  if (fields && !draft.title.trim()) throw new Error("Indiquez un titre.");
  if (fields && draft.title.trim().length > 500) throw new Error("Le titre est limité à 500 caractères.");
  if (fields && draft.dueDate && !isCivilDate(draft.dueDate)) throw new Error("La date limite doit être une date réelle au format AAAA-MM-JJ.");
  if (fields && !taskPriorities.includes(draft.priority)) throw new Error("Priorité invalide.");
  if (fields && new Set(draft.assigneeIds).size !== draft.assigneeIds.length) throw new Error("Un responsable est sélectionné plusieurs fois.");
  const patch: TaskPatch = {};
  if (!base || draft.notes !== base.notes) patch.notes = draft.notes;
  if (!base || draft.status !== base.status) patch.status = draft.status;
  if (fields) {
    if (!base || draft.title.trim() !== base.title) patch.title = draft.title.trim();
    if (!base || draft.dueDate !== base.dueDate) patch.dueDate = draft.dueDate;
    if (!base || draft.priority !== base.priority) patch.priority = draft.priority;
    if (!base || !sameIds(draft.assigneeIds, base.assignees.map(value => value.userId))) patch.assigneeIds = [...draft.assigneeIds];
    if (!base || draft.leadId !== effectiveTaskLeadId(base)) patch.leadId = draft.leadId;
    if (!base || draft.contactId !== (base.contactId ?? "")) patch.contactId = draft.contactId;
  }
  return patch;
}

/** Lost responses reuse the same request; a changed payload gets a new request. */
export class TaskRequestLedger {
  private requests = new Map<string, { fingerprint: string; request: TaskMutation }>();
  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}
  prepare(id: string, expectedRevision: number | null, patch: TaskPatch, remove = false): TaskMutation {
    const fingerprint = JSON.stringify({ expectedRevision, patch, remove });
    const current = this.requests.get(id);
    if (current?.fingerprint === fingerprint) return current.request;
    const request = { requestId: this.newId(), id, expectedRevision, patch, ...(remove ? { delete: true } : {}) };
    this.requests.set(id, { fingerprint, request });
    return request;
  }
  confirmed(id: string) { this.requests.delete(id); }
  clear() { this.requests.clear(); }
}
