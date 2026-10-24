"use client";

import { forwardRef, useImperativeHandle, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { createSearchIndex, searchIndex } from "@/lib/search";
import { useSearchDismissal } from "./useSearchDismissal";
import styles from "./search.module.css";

export type SearchableInputOption = { value: string; label?: string; searchText?: string; secondary?: string };
export type SearchableInputProps = InputHTMLAttributes<HTMLInputElement> & {
  options?: readonly (SearchableInputOption | string)[];
  loading?: boolean;
  error?: string;
};

/** Existing free-text inputs retain arbitrary text, with shared ranked suggestions. */
export const SearchableInput = forwardRef<HTMLInputElement, SearchableInputProps>(function SearchableInput({ options, list, loading = false, error, onChange, onFocus, onBlur, onKeyDown,
  value, defaultValue, id, disabled, className, style, ...props }: SearchableInputProps, forwardedRef) {
  const { language } = useI18n();
  const english = language === "en";
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-suggestions`;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const controlledValue = useRef(value);
  useLayoutEffect(() => { controlledValue.current = value; }, [value]);
  useImperativeHandle(forwardedRef, () => inputRef.current!);
  const [localValue, setLocalValue] = useState(String(defaultValue ?? ""));
  const text = String(value ?? localValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [limit, setLimit] = useState(12);
  const [datalistOptions, setDatalistOptions] = useState<SearchableInputOption[]>([]);
  const candidates = useMemo(() => [...(options ?? []).map(option => typeof option === "string" ? { value: option } : option), ...datalistOptions], [options, datalistOptions]);
  const index = useMemo(() => createSearchIndex(candidates, option => [option.value, option.label, option.searchText, option.secondary],
    { getId: option => option.value, getLabel: option => option.label || option.value }), [candidates]);
  const results = useMemo(() => searchIndex(index, text), [index, text]);
  const visible = results.slice(0, limit);
  const expanded = open && !disabled;
  const onPickerBlur = useSearchDismissal(containerRef, expanded, () => { setOpen(false); setActive(-1); });

  function readDatalist() {
    if (!list) return;
    const element = document.getElementById(list);
    const next = element ? Array.from(element.querySelectorAll("option")).filter(option => !option.disabled)
      .map(option => ({ value: option.value, label: option.label || option.textContent || option.value,
        searchText: option.dataset.search, secondary: option.dataset.secondary })) : [];
    setDatalistOptions(previous => previous.length === next.length && previous.every((option, position) =>
      option.value === next[position].value && option.label === next[position].label
      && option.searchText === next[position].searchText && option.secondary === next[position].secondary) ? previous : next);
  }
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    function reset(event: Event) {
      queueMicrotask(() => {
        if (event.defaultPrevented || !inputRef.current) return;
        setLocalValue(String(defaultValue ?? "")); setOpen(false); setActive(-1);
        inputRef.current.value = String(controlledValue.current ?? defaultValue ?? "");
      });
    }
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue]);
  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, listId]);

  function choose(next: string) {
    if (disabled || loading || error || !candidates.some(option => option.value === next) || !inputRef.current) return;
    const input = inputRef.current;
    // Native input setter keeps React's value tracker and existing form handlers intact.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setLocalValue(input.value); setOpen(false); setActive(-1);
  }

  return <span ref={containerRef} className={styles.control} style={style} data-searchable-input="true"
    onBlur={onPickerBlur}
    onKeyDownCapture={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing && expanded) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
      }
    }}>
    <input {...props} ref={inputRef} id={inputId} value={text} disabled={disabled} className={className}
      role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
      aria-activedescendant={expanded && active >= 0 && active < visible.length ? `${listId}-${active}` : undefined}
      aria-busy={loading} autoComplete="off"
      onFocus={event => { readDatalist(); setOpen(true); setLimit(12); onFocus?.(event); }}
      onBlur={onBlur}
      onChange={event => { setLocalValue(event.currentTarget.value); setOpen(true); setLimit(12); setActive(-1); readDatalist(); onChange?.(event); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault(); event.stopPropagation();
          if (expanded && active >= 0 && visible[active]) choose(visible[active].item.value);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          setActive(previous => visible.length ? event.key === "ArrowDown" ? (previous + 1) % visible.length
            : previous <= 0 || previous >= visible.length ? visible.length - 1 : previous - 1 : -1);
        } else onKeyDown?.(event);
      }} />
    {expanded && <span className={styles.popup}>
      {loading && <span className={styles.message} role="status">{english ? "Loading…" : "Chargement…"}</span>}
      {error && <span className={styles.message} role="alert">{error}</span>}
      {!loading && !error && <>
        <span id={listId} role="listbox" aria-label={english ? "Suggestions" : "Suggestions"} className={styles.list}>
          {visible.map(({ item: option, approximate }, position) => <button id={`${listId}-${position}`} key={option.value}
            type="button" role="option" aria-selected={text === option.value} data-active={position === active} tabIndex={-1}
            className={styles.option} onPointerDown={event => { if (event.pointerType === "mouse") event.preventDefault(); }} onMouseEnter={() => setActive(position)} onClick={() => choose(option.value)}>
            <strong>{option.label || option.value}</strong>
            {option.secondary && <small>{option.secondary}</small>}
            {approximate && <small className={styles.approximate}>{english ? "Approximate match" : "Correspondance approchée"}</small>}
          </button>)}
        </span>
        {!results.length && <span className={styles.message} role="status">{english ? "No suggestion — free text is allowed" : "Aucune suggestion — la saisie libre reste possible"}</span>}
        {results.length > limit && <button type="button" className={styles.more} onPointerDown={event => { if (event.pointerType === "mouse") event.preventDefault(); }}
          onClick={() => setLimit(previous => previous + 24)}>{english ? "Show more" : "Afficher plus"}</button>}
      </>}
    </span>}
  </span>;
});

export default SearchableInput;
