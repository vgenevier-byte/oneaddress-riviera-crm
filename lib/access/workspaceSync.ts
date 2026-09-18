// A token refresh is deliberately absent from this state: only business data and
// an acknowledged server revision decide whether the workspace needs saving.
export type WorkspaceWrite = { fingerprint: string; revision: string };
export function workspaceFingerprint(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
    }
    return value;
  });
}

export class WorkspaceSyncGuard {
  private fingerprint: string | null = null;
  private revision = "";
  conflicted = false;

  load(payload: unknown, revision: string) {
    this.fingerprint = workspaceFingerprint(payload);
    this.revision = revision;
    this.conflicted = false;
  }

  dirty(payload: unknown) {
    return this.fingerprint !== null && workspaceFingerprint(payload) !== this.fingerprint;
  }

  prepare(payload: unknown): WorkspaceWrite | null {
    if (!this.revision || this.conflicted) return null;
    return { fingerprint: workspaceFingerprint(payload), revision: this.revision };
  }

  saved(write: WorkspaceWrite, revision: string) {
    if (!revision || write.revision !== this.revision || this.conflicted) return false;
    this.fingerprint = write.fingerprint;
    this.revision = revision;
    return true;
  }

  conflict() { this.conflicted = true; }
}
