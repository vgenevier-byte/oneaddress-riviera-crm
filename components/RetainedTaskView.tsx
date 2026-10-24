"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Preserve source forms and File objects on task round trips. Native dialogs
 * leave the top layer while their host is hidden and reopen with the same draft. */
export default function RetainedTaskView({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  const host = useRef<HTMLDivElement>(null);
  const suspendedDialogs = useRef<HTMLDialogElement[]>([]);
  if (active && !visited) setVisited(true);
  useLayoutEffect(() => {
    if (!active) {
      suspendedDialogs.current = Array.from(host.current?.querySelectorAll<HTMLDialogElement>("dialog[open]") || []);
      for (const dialog of suspendedDialogs.current) dialog.close();
    } else {
      for (const dialog of suspendedDialogs.current) if (dialog.isConnected && !dialog.open) dialog.showModal();
      suspendedDialogs.current = [];
    }
  }, [active]);
  return active || visited ? <div ref={host} hidden={!active} inert={!active} style={active ? {display:"contents"} : undefined} data-task-retained-view>{children}</div> : null;
}
