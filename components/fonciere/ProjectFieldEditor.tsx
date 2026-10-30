"use client";

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type ProjectFieldEditorHandle = { open: () => void };

/** An empty answer never closes an active editor. Native toggle events also
 * synchronize automatic validation reveals with the same React state. */
const ProjectFieldEditor = forwardRef<ProjectFieldEditorHandle, {
  hasValue: boolean; summary: ReactNode; children: ReactNode; className?: string;
  "data-extra-field"?: string; "data-local-contact-field"?: string;
  onCloseEmpty?: () => void;
}>(function ProjectFieldEditor({ hasValue, summary, children, onCloseEmpty, ...attributes }, ref) {
  const [open, setOpen] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const focusRequested = useRef(false);
  const focusEditor = useCallback(() => {
    const control = details.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([aria-hidden="true"]),textarea,select:not([aria-hidden="true"])')
      || details.current?.querySelector<HTMLElement>("button");
    control?.focus();
  }, []);
  useImperativeHandle(ref, () => ({ open() {
    if (open) focusEditor();
    else { focusRequested.current = true; setOpen(true); }
  } }), [open, focusEditor]);
  useLayoutEffect(() => {
    if (open && focusRequested.current) { focusRequested.current = false; focusEditor(); }
  }, [open, focusEditor]);
  return <details {...attributes} ref={details} open={open} hidden={!hasValue && !open || undefined} onToggle={event => {
    const next = event.currentTarget.open;
    setOpen(next);
    if (!next && !hasValue) onCloseEmpty?.();
  }}><summary onClick={event => {
    event.preventDefault();
    setOpen(!open);
    if (open && !hasValue) onCloseEmpty?.();
  }}>{summary}</summary>{children}</details>;
});
export default ProjectFieldEditor;
