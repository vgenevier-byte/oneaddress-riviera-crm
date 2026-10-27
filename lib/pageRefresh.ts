/** Page-wide exit protection, including editors retained behind another view. */
export type PageRefreshState = { dirty: boolean; busy: boolean };
export type PageRefreshGuard = () => PageRefreshState;
const guards = new Set<PageRefreshGuard>();
let pendingOperations = 0;
let requesting = false;
let approvedReload = false;
let resetTimer: ReturnType<typeof setTimeout> | undefined;

export function registerPageRefreshGuard(read: PageRefreshGuard): () => void {
  guards.add(read);
  return () => { guards.delete(read); };
}

/** Hold across the whole operation, including validation and response handling. */
export function beginPageRefreshOperation(): () => void {
  pendingOperations++;
  let released = false;
  return () => { if (!released) { released = true; pendingOperations--; } };
}

function pageState(): PageRefreshState {
  let dirty = false, busy = pendingOperations > 0;
  for (const read of guards) {
    const state = read();
    dirty ||= state.dirty;
    busy ||= state.busy;
  }
  return { dirty, busy };
}

/** Used by each existing unload guard, so approval cannot cause a second dialog. */
export function shouldProtectPageUnload(): boolean {
  if (approvedReload) return false;
  const state = pageState();
  return state.dirty || state.busy;
}

type RefreshOptions = {
  confirm: (message: string) => boolean;
  alert: (message: string) => void;
  reload: () => void;
  confirmMessage: string;
  busyMessage: string;
};
export function requestPageRefresh(options: RefreshOptions): boolean {
  if (requesting) return false;
  requesting = true;
  let committed = false;
  try {
    if (pageState().busy) { options.alert(options.busyMessage); return false; }
    if (pageState().dirty && !options.confirm(options.confirmMessage)) return false;
    // Recheck after confirmation, including imperative writes admitted by a guard.
    if (pageState().busy) { options.alert(options.busyMessage); return false; }
    approvedReload = true;
    options.reload();
    committed = true;
    // A mocked, failed or browser-cancelled navigation must not permanently
    // disable exit protection. A real reload discards this module altogether.
    resetTimer = setTimeout(resetRefreshRequest, 1500);
    return true;
  } finally {
    if (!committed) resetRefreshRequest();
  }
}
function resetRefreshRequest() {
  if (resetTimer !== undefined) clearTimeout(resetTimer);
  resetTimer = undefined;
  approvedReload = false;
  requesting = false;
}
