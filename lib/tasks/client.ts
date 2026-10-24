"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScopedOperations, isCancelled, type ScopedOperation } from "@/lib/access/operations";
import type { AccessSnapshot } from "@/lib/access/modules";
import type { Task as LegacyTask } from "@/lib/types";
import { searchTaskTargets } from "./targets";
import type { Task, TaskApi, TaskTarget, TaskTargetPage } from "./types";
import { effectiveTaskLeadId } from "./domain";

export const TASKS_CHANGED = "oar-tasks-changed";

/** Captured identity, fresh module checks, and the canonical per-task RPC only. */
export function useTaskApi(): TaskApi {
  const begin = useScopedOperations("tasks");
  return useMemo(() => {
    async function call<T>(op: ScopedOperation, name: string, args = {}): Promise<T> {
      const result = await op.run(() => op.client.rpc(name, args));
      if (result.error) throw new Error(result.error.message);
      return result.data as T;
    }
    async function rpc<T>(name: string, args = {}): Promise<T> { return call(await begin(), name, args); }
    async function publisher(op: ScopedOperation, ids?: string[], exporting = false): Promise<{ items: TaskTarget[]; forbidden?: boolean }> {
      if (ids && ids.length > 100) {
        const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, (index + 1) * 100));
        const pages = await Promise.all(chunks.map(chunk => publisher(op, chunk, exporting)));
        return { items: pages.flatMap(page => page.items), forbidden: pages.some(page => page.forbidden) };
      }
      return op.run(async () => {
        const response = await fetch(`/api/tasks/publisher${exporting ? "?export=1" : ""}`, { method: ids ? "POST" : "GET", signal: op.signal,
          headers: { Authorization: `Bearer ${op.token}`, ...(ids ? { "Content-Type": "application/json" } : {}) },
          ...(ids ? { body: JSON.stringify({ ids }) } : {}) });
        if (response.status === 403) return { items: [], forbidden: true };
        if (!response.ok) throw new Error("Catalogue Publisher indisponible.");
        const data = await response.json() as { items: TaskTarget[] };
        return { items: data.items.filter(item => item?.ref?.type && item.ref.id) };
      });
    }
    async function enrich(op: ScopedOperation, tasks: Task[], exporting = false): Promise<Task[]> {
      const ids = [...new Set(tasks.flatMap(task => (task.links ?? []).flatMap(link => link.target?.type === "publisher_creation" ? [link.target.id] : [])))];
      if (!ids.length) return tasks;
      let current: { items: TaskTarget[]; forbidden?: boolean };
      try { current = await publisher(op, ids, exporting); }
      catch { current = { items: [], forbidden: true }; }
      await op.check();
      return tasks.map(task => ({ ...task, links: task.links?.map(link => {
        if (link.target?.type !== "publisher_creation") return link;
        const item = current.items.find(item => item.ref.id === link.target!.id);
        if (item) return { ...link, target: item.ref, state: item.state ?? "available", label: item.label, detail: item.detail, status: item.status };
        if (current.forbidden) return { id: link.id, primary: link.primary, state: "inaccessible" as const };
        return { id: link.id, primary: link.primary, state: "deleted" as const, target: link.target };
      }) }));
    }
    async function read(name: string, args = {}): Promise<Task[]> {
      const op = await begin(); return enrich(op, await call<Task[]>(op, name, args), name === "crm_tasks_export");
    }
    return {
      list: () => read("crm_tasks_read"),
      directory: () => rpc("crm_tasks_directory"),
      export: () => read("crm_tasks_export"),
      resolveTargets: async refs => {
        const op = await begin();
        const ordinary = refs.filter(ref => ref.type !== "publisher_creation");
        const resolved = ordinary.length ? await call<TaskTarget[]>(op, "crm_task_targets_resolve", { p_refs: ordinary }) : [];
        const items = resolved.filter(item => item?.ref?.type && item.ref.id && item.state !== "inaccessible");
        const ids = refs.filter(ref => ref.type === "publisher_creation").map(ref => ref.id);
        return ids.length ? [...items, ...(await publisher(op, ids)).items] : items;
      },
      forTarget: async ref => {
        const op = await begin();
        if (ref.type === "publisher_creation") {
          const confirmation = await publisher(op, [ref.id]);
          if (!confirmation.items.some(item => item.ref.id === ref.id)) return [];
        }
        return enrich(op, await call<Task[]>(op, "crm_tasks_for_target", { p_ref: ref }));
      },
      searchTargets: async (query, type, offset = 0, limit = 40) => {
        // Search the full authorized catalogue, then apply the common exact/fuzzy
        // ranker before the display page. No candidate or label is browser-cached.
        const op = await begin();
        return searchTaskTargets(async (pageOffset, pageSize) => {
          return call<TaskTargetPage>(op, "crm_task_targets_search", {
            p_query: "", p_type: type || null, p_offset: pageOffset, p_limit: pageSize
          });
        }, query, offset, limit, async () => !type || type === "publisher_creation" ? (await publisher(op)).items : []);
      },
      mutate: async request => {
        const op = await begin();
        const publisherIds = [...new Set([...(request.patch.linkChanges?.add ?? []), ...(request.patch.linkChanges?.primary?.target ? [request.patch.linkChanges.primary.target] : [])].filter(ref => ref.type === "publisher_creation").map(ref => ref.id))];
        if (publisherIds.length) {
          const confirmation = await publisher(op, publisherIds);
          if (publisherIds.some(id => !confirmation.items.some(item => item.ref.id === id))) throw new Error("Référence Publisher inaccessible ou supprimée.");
        }
        const task = await call<Task | null>(op, "crm_tasks_mutate", {
          p_request_id: request.requestId, p_id: request.id,
          p_revision: request.expectedRevision, p_patch: request.patch,
          p_delete: request.delete ?? false
        });
        window.dispatchEvent(new Event(TASKS_CHANGED));
        return task ? (await enrich(op, [task]))[0] : null;
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
