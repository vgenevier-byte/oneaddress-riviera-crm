"use client";

import { useLayoutEffect, useRef } from "react";
import { registerPageRefreshGuard, shouldProtectPageUnload, type PageRefreshState } from "./pageRefresh";

/** Registration survives hidden/inert retained views and reads committed state. */
export function usePageRefreshGuard(state: Partial<PageRefreshState> | (() => Partial<PageRefreshState>)): void {
  const current = useRef(state);
  useLayoutEffect(() => { current.current = state; });
  useLayoutEffect(() => {
    const release = registerPageRefreshGuard(() => {
      const value = typeof current.current === "function" ? current.current() : current.current;
      return { dirty: value.dirty === true, busy: value.busy === true };
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (!shouldProtectPageUnload()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => { release(); window.removeEventListener("beforeunload", warn); };
  }, []);
}
