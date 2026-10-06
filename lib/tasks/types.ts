export const taskStatuses = ["À faire", "En cours", "Terminé"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const taskPriorities = ["normal", "important", "urgent"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

/** The directory is a server projection, never a contact list or an Auth dump. */
export type TaskRecipient = {
  userId: string;
  label: string;
  access: "read" | "contribute";
  detail?: string;
};
export type TaskAssignee = Omit<TaskRecipient, "access"> & { access: "read" | "contribute" | "none"; active: boolean };
export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  notes: string;
  dueDate: string;
  priority: TaskPriority;
  createdBy: string | null;
  createdByLabel: string;
  createdAt: string | null;
  updatedAt: string;
  updatedBy?: string;
  completedAt?: string;
  revision: number;
  assignees: TaskAssignee[];
  /** Explicit management of recovered tasks only; never a substitute author. */
  managerId?: string | null;
  managerLabel?: string | null;
  managerActive?: boolean;
  owner?: string;
  linkedTo?: string;
  contactId?: string;
  leadId?: string;
};
export type TaskPatch = Partial<Pick<Task, "title" | "status" | "notes" | "dueDate" | "priority" | "linkedTo" | "contactId" | "leadId">> & { assigneeIds?: string[] };
export type TaskMutation = {
  requestId: string;
  id: string;
  expectedRevision: number | null;
  patch: TaskPatch;
  delete?: boolean;
};
export type TaskApi = {
  list: () => Promise<Task[]>;
  directory: () => Promise<TaskRecipient[]>;
  mutate: (request: TaskMutation) => Promise<Task | null>;
  export?: () => Promise<Task[]>;
};
export type TaskPermissions = { read: boolean; contribute: boolean; export: boolean; delete: boolean };
/** Pass only references whose IDs and labels the connected account may read. */
export type TaskLinkOption = { id: string; label: string };
export type TaskDraft = {
  title: string;
  notes: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeIds: string[];
  leadId: string;
  contactId: string;
};
