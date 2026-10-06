import { workspaceFingerprint } from "./access/workspaceSync";

const equal = (left: unknown, right: unknown) => workspaceFingerprint(left) === workspaceFingerprint(right);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Rebase edits made during this server operation onto its authoritative payload.
 * Conflicting edits remain available locally, with autosave blocked by the caller.
 * The confirmed trashed document can never be resurrected by a local draft.
 */
export function mergeDocumentTrashCompletion<T extends { documents?: unknown[] }>(base: T, local: T, server: T, documentId: string): { data: T; conflicted: boolean } {
  let conflicted = false;
  function merge(previous: unknown, current: unknown, remote: unknown): unknown {
    if (equal(current, previous)) return remote;
    if (equal(remote, previous) || equal(current, remote)) return current;
    if (record(previous) && record(current) && record(remote)) {
      const next: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(previous), ...Object.keys(current), ...Object.keys(remote)])) {
        const value = merge(previous[key], current[key], remote[key]);
        if (value !== undefined) next[key] = value;
      }
      return next;
    }
    if (Array.isArray(previous) && Array.isArray(current) && Array.isArray(remote) && [...previous, ...current, ...remote].every(item => record(item) && typeof item.id === "string")) {
      const before = new Map(previous.map(item => [item.id, item]));
      const currentRows = new Map(current.map(item => [item.id, item]));
      const remoteRows = new Map(remote.map(item => [item.id, item]));
      const next = remote.map(item => {
        const old = before.get(item.id), changed = currentRows.get(item.id);
        if (!changed && old) {
          if (!equal(item, old)) conflicted = true;
          return undefined;
        }
        return changed ? merge(old, changed, item) : item;
      }).filter(item => item !== undefined);
      for (const item of current) {
        if (remoteRows.has(item.id)) continue;
        const old = before.get(item.id);
        if (!old || !equal(old, item)) {
          if (old) conflicted = true;
          next.push(item);
        }
      }
      return next;
    }
    conflicted = true;
    return current;
  }
  const data = merge(base, local, server) as T;
  return { data: { ...data, documents: (data.documents ?? []).filter(item => !record(item) || item.id !== documentId) }, conflicted };
}
