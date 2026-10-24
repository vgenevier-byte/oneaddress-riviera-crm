export const taskStatuses = ["À faire", "En cours", "Terminé"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const taskPriorities = ["normal", "important", "urgent"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

/** The directory is a server projection, never a contact list or an Auth dump. */
export type TaskRecipient = {
  userId: string;
  label: string;
  /** Optional for older API projections; only a server-confirmed email is exposed. */
  email?: string;
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
  /** Reader-authorized projections only; inaccessible links contain no target identity. */
  links?: TaskLink[];
};
export type TaskPatch = Partial<Pick<Task, "title" | "status" | "notes" | "dueDate" | "priority" | "linkedTo" | "contactId" | "leadId">> & { assigneeIds?: string[]; linkChanges?: TaskLinkChanges };
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
  searchTargets?: (query: string, type?: string, offset?: number, limit?: number) => Promise<TaskTargetPage>;
  resolveTargets?: (refs: TaskTargetRef[]) => Promise<TaskTarget[]>;
  forTarget?: (ref: TaskTargetRef) => Promise<Task[]>;
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
  /** Explicit operations, never a replacement of the partially visible relation list. */
  linkChanges?: TaskLinkChanges;
};

/** A label or a URL is never an identity. Context is part of contextual references. */
export type TaskTargetRef = { type: string; id: string; context?: Record<string, string> };
export type TaskTargetState = "available" | "archived" | "deleted" | "inaccessible";
export type TaskTarget = {
  ref: TaskTargetRef;
  label: string;
  detail?: string;
  status?: string;
  state?: TaskTargetState;
  /** Only fields authorized for this reader, resolved afresh by the server. */
  dueDate?: string;
  financial?: { amount: number; paidAmount: number; dueDate?: string; status: string };
  searchFields?: string[];
  approximate?: boolean;
};
export type TaskTargetPage = { items: TaskTarget[]; hasMore: boolean };
export type TaskLink = {
  id: string;
  primary: boolean;
  state: TaskTargetState;
  target?: TaskTargetRef;
  label?: string;
  detail?: string;
  status?: string;
  financial?: { amount: number; paidAmount: number; dueDate?: string; status: string };
};
export type TaskLinkChanges = {
  add?: TaskTargetRef[];
  remove?: string[];
  primary?: { linkId?: string; target?: TaskTargetRef } | null;
};
export type TaskInitialDraft = { title?: string; dueDate?: string; leadId?: string; contactId?: string; target?: TaskTargetRef };
