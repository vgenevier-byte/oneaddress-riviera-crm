"use client";

import { useEffect, useLayoutEffect, useRef, type FocusEvent, type RefObject } from "react";

/** Keep an in-flow result list stable until an outside pointer click reaches its target. */
export function useSearchDismissal(container: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const outsidePointer = useRef(false);
  const dismiss = useRef(close);
  useLayoutEffect(() => { dismiss.current = close; }, [close]);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => !container.current?.contains(target as Node | null);
    function pointerDown(event: PointerEvent) { outsidePointer.current = outside(event.target); }
    function click(event: MouseEvent) {
      // Click's target/path is already fixed here. Removing the list cannot move
      // a button between pointerdown and pointerup and cancel its activation.
      if (outside(event.target)) dismiss.current();
      outsidePointer.current = false;
    }
    function cancelPointer() {
      outsidePointer.current = false;
      if (outside(document.activeElement)) dismiss.current();
    }
    function keyDown() {
      outsidePointer.current = false;
      if (outside(document.activeElement)) dismiss.current();
    }
    function leaveWindow() { outsidePointer.current = false; dismiss.current(); }
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("click", click, true);
    document.addEventListener("pointercancel", cancelPointer, true);
    document.addEventListener("keydown", keyDown, true);
    window.addEventListener("blur", leaveWindow);
    return () => {
      outsidePointer.current = false;
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("pointercancel", cancelPointer, true);
      document.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("blur", leaveWindow);
    };
  }, [container, open]);

  return (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !outsidePointer.current) close();
  };
}
