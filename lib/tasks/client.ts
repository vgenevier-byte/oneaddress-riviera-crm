"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScopedOperations, isCancelled } from "@/lib/access/operations";
import type { AccessSnapshot } from "@/lib/access/modules";
import type { Task as LegacyTask } from "@/lib/types";
import type { Task, TaskApi } from "./types";
import { effectiveTaskLeadId } from "./domain";

export const TASKS_CHANGED = "oar-tasks-changed";

/** Captured identity, fresh module checks, and the canonical per-task RPC only. */
export function useTaskApi(): TaskApi {
  const begin = useScopedOperations("tasks");
  return useMemo(() => {
    async function rpc<T>(name: string, args = {}): Promise<T> {
      const op = await begin();
      const result = await op.run(() => op.client.rpc(name, args));
      if (result.error) throw new Error(result.error.message);
      return result.data as T;
    }
    return {
      list: () => rpc<Task[]>("crm_tasks_read"),
      directory: () => rpc("crm_tasks_directory"),
      export: () => rpc<Task[]>("crm_tasks_export"),
      mutate: async request => {
        const task = await rpc<Task | null>("crm_tasks_mutate", {
          p_request_id: request.requestId, p_id: request.id,
          p_revision: request.expectedRevision, p_patch: request.patch,
          p_delete: request.delete ?? false
        });
        window.dispatchEvent(new Event(TASKS_CHANGED));
        return task;
      }
    };
  }, [begin]);
}

/** Read model for existing Dashboard, notifications and linked business views.
 * Never enters workspace JSON, browser caches or a global save.
 */
export function useTaskProjection(api: TaskApi, sessionKey: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{scope:string;tasks:Task[]}>({scope:sessionKey,tasks:[]});
  const tasks = snapshot.scope === sessionKey && enabled ? snapshot.tasks : [];
  const accept = useCallback((items:Task[]) => setSnapshot({scope:sessionKey,tasks:items}), [sessionKey]);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    await Promise.resolve();
    const ticket = ++generation.current;
    if (!enabled) return;
    try {
      const next = await api.list();
      if (ticket !== generation.current) return;
      accept(next); setMessage("");
    } catch (error) {
      if (ticket !== generation.current) return;
      accept([]);
      if (!isCancelled(error)) setMessage("Les tâches ne peuvent pas être actualisées. Rechargez pour vérifier votre accès.");
    }
  }, [api, enabled, accept]);
  useEffect(() => {
    const initialRead = window.setTimeout(() => { void refresh(); }, 0);
    const focused = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", focused);
    window.addEventListener(TASKS_CHANGED, focused);
    // Also detects revocations while an already-open page stays focused.
    const timer = window.setInterval(focused, 15000);
    return () => {
      invalidate();
      window.clearTimeout(initialRead);
      window.clearInterval(timer);
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", focused);
      window.removeEventListener(TASKS_CHANGED, focused);
    };
  }, [sessionKey, refresh, invalidate]);
  return { tasks, message, refresh, accept };
}

export function taskPermissions(access: AccessSnapshot) {
  const grant = access.modules.tasks;
  return { read: grant?.level === "read" || grant?.level === "contribute",
    contribute: grant?.level === "contribute", export: Boolean(grant?.sensitive.export),
    delete: Boolean(grant?.sensitive.delete) };
}

export function taskForBusinessView(task: Task): LegacyTask {
  const leadId = effectiveTaskLeadId(task);
  return { ...task, createdBy: task.createdBy ?? undefined,
    owner: task.assignees.map(person => person.label).join(", "),
    leadId, linkedTo: leadId } as LegacyTask;
}
