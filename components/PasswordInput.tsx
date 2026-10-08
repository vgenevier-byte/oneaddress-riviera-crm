"use client";

import { Eye, EyeOff } from "lucide-react";
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import styles from "./PasswordInput.module.css";
import { useI18n } from "@/lib/i18n/I18nProvider";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  resetKey: string | number;
};

type InputSelection = {
  start: number | null;
  end: number | null;
  direction: "forward" | "backward" | "none" | null;
  scrollLeft: number;
  restoreFocus: boolean;
};

export default function PasswordInput({ resetKey, className, disabled, ...props }: PasswordInputProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<InputSelection | null>(null);
  const pointerSelectionRef = useRef<InputSelection | null>(null);
  const [display, setDisplay] = useState({ resetKey, visible: false });
  const visible = display.resetKey === resetKey && display.visible;
  const label = visible ? t("access.hidePassword") : t("access.showPassword");
  const Icon = visible ? EyeOff : Eye;

  useLayoutEffect(() => {
    const input = inputRef.current;
    const selection = selectionRef.current;
    selectionRef.current = null;
    if (!input || !selection) return;
    if (selection.restoreFocus) input.focus({ preventScroll: true });
    if (selection.start !== null && selection.end !== null) {
      input.setSelectionRange(selection.start, selection.end, selection.direction ?? "none");
    }
    input.scrollLeft = selection.scrollLeft;
  }, [visible]);

  function toggleVisibility() {
    const input = inputRef.current;
    if (input) {
      selectionRef.current = pointerSelectionRef.current ?? {
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
        scrollLeft: input.scrollLeft,
        restoreFocus: false,
      };
    }
    pointerSelectionRef.current = null;
    setDisplay({ resetKey, visible: !visible });
  }

  return (
    <span className={styles.root}>
      <input
        {...props}
        ref={inputRef}
        type={visible ? "text" : "password"}
        className={[styles.input, className].filter(Boolean).join(" ")}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <button
        type="button"
        className={styles.toggle}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        disabled={disabled}
        onPointerDown={event => {
          const input = inputRef.current;
          if (!input) return;
          pointerSelectionRef.current = {
            start: input.selectionStart,
            end: input.selectionEnd,
            direction: input.selectionDirection,
            scrollLeft: input.scrollLeft,
            restoreFocus: document.activeElement === input,
          };
          // WebKit needs the touch default to deliver the click. Restore the
          // input's focus and selection after toggling; keyboard keeps its focus.
          if (event.pointerType === "mouse" && document.activeElement === input) event.preventDefault();
        }}
        onPointerCancel={() => { pointerSelectionRef.current = null; }}
        onKeyDown={() => { pointerSelectionRef.current = null; }}
        onClick={toggleVisibility}
      >
        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </span>
  );
}
