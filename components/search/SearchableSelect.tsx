"use client";

import { forwardRef, useImperativeHandle, Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { createSearchIndex, searchIndex } from "@/lib/search";
import { useSearchDismissal } from "./useSearchDismissal";
import styles from "./search.module.css";

type Option = { value: string; label: string; secondary: string; search: string; disabled: boolean };
type OptionProps = { value?: string | number; label?: string; children?: ReactNode; disabled?: boolean; "data-search"?: string; "data-secondary"?: string };
export type SearchableSelectProps = SelectHTMLAttributes<HTMLSelectElement> & { loading?: boolean; error?: string; placeholder?: string };

function textOf(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : "").join("");
}
function optionsOf(children: ReactNode, parentDisabled = false): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type === "option") {
      const label = child.props.label ?? textOf(child.props.children);
      return [{ value: String(child.props.value ?? label), label, secondary: child.props["data-secondary"] ?? "",
        search: child.props["data-search"] ?? "", disabled: parentDisabled || Boolean(child.props.disabled) }];
    }
    return optionsOf(child.props.children, parentDisabled || Boolean(child.props.disabled));
  });
}

/** Native form value/validation with an explicit, searchable record choice. Typing never changes the value. */
export const SearchableSelect = forwardRef<HTMLSelectElement, SearchableSelectProps>(function SearchableSelect({ children, value, defaultValue, id, className, style, disabled, required, loading = false,
  error, placeholder, onChange, onInvalid, ...nativeProps }: SearchableSelectProps, forwardedRef) {
  const { language } = useI18n();
  const english = language === "en";
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-suggestions`;
  const nativeRef = useRef<HTMLSelectElement>(null);
  const controlledValue = useRef(value);
  useLayoutEffect(() => { controlledValue.current = value; }, [value]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  useImperativeHandle(forwardedRef, () => nativeRef.current!);
  const options = useMemo(() => optionsOf(children), [children]);
  const initialValue = String(defaultValue ?? options.find(option => !option.disabled)?.value ?? "");
  const [localValue, setLocalValue] = useState(initialValue);
  const selectedValue = String(value ?? localValue);
  const selected = options.find(option => option.value === selectedValue);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [limit, setLimit] = useState(12);
  const [invalid, setInvalid] = useState(false);
  const index = useMemo(() => createSearchIndex(options.filter(option => !option.disabled), option => [option.label, option.secondary, option.search],
    { getId: option => option.value, getLabel: option => option.label }), [options]);
  const results = useMemo(() => searchIndex(index, query), [index, query]);
  const visible = results.slice(0, limit);
  const expanded = open && !disabled;
  const clearOption = options.find(option => option.value === "" && !option.disabled);
  const selectedLabel = selected?.label ?? (selectedValue ? english ? "Saved selection (unavailable)" : "Sélection conservée (indisponible)" : "");

  useEffect(() => {
    const form = nativeRef.current?.form;
    if (!form) return;
    function reset(event: Event) {
      // The reset event precedes the browser's default action. WebKit may apply
      // that action after React commits, so restore both state and DOM afterward.
      queueMicrotask(() => {
        if (event.defaultPrevented || !nativeRef.current) return;
        setLocalValue(initialValue); setQuery(""); setEditing(false); setOpen(false); setActive(-1); setInvalid(false);
        nativeRef.current.value = String(controlledValue.current ?? initialValue);
      });
    }
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initialValue]);
  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, listId]);

  function close() { setOpen(false); setActive(-1); setEditing(false); setQuery(""); }
  const onPickerBlur = useSearchDismissal(containerRef, expanded, close);
  function choose(next: string) {
    // Always recheck the latest authorized/business-filtered options, including disabled states.
    if (disabled || loading || error || !options.some(option => option.value === next && !option.disabled) || !nativeRef.current) return;
    const select = nativeRef.current;
    select.value = next;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setInvalid(false); close();
  }

  return <span ref={containerRef} className={styles.control} style={style} data-searchable-select="true"
    onBlur={onPickerBlur}
    onKeyDownCapture={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing && expanded) {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }}>
    <span className={styles.inputRow}>
      <input ref={inputRef} id={inputId} type="search" role="combobox" aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={listId} aria-activedescendant={expanded && active >= 0 && active < visible.length ? `${listId}-${active}` : undefined}
        aria-label={nativeProps["aria-label"]}
        aria-labelledby={nativeProps["aria-labelledby"]} aria-describedby={[nativeProps["aria-describedby"], invalid ? `${inputId}-validation` : ""].filter(Boolean).join(" ") || undefined}
        aria-invalid={invalid || Boolean(error) || undefined} aria-required={required || undefined} aria-busy={loading}
        className={className} autoComplete="off" disabled={disabled} placeholder={placeholder || (english ? "Search…" : "Rechercher…")}
        value={editing ? query : selectedLabel}
        onFocus={event => { setOpen(true); setLimit(12); if (!editing) event.currentTarget.select(); }}
        onClick={() => setOpen(true)}
        onChange={event => { setQuery(event.currentTarget.value); setEditing(true); setOpen(true); setLimit(12); setActive(-1); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault(); event.stopPropagation();
            if (expanded && active >= 0 && visible[active]) choose(visible[active].item.value);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(previous => visible.length ? event.key === "ArrowDown" ? (previous + 1) % visible.length
              : previous <= 0 || previous >= visible.length ? visible.length - 1 : previous - 1 : -1);
          }
        }} />
      {clearOption && selectedValue !== "" && !disabled && <button className={styles.clear} type="button"
        aria-label={english ? "Clear selection" : "Retirer la sélection"} onClick={() => choose("")}>×</button>}
      <button className={styles.toggle} type="button" disabled={disabled} tabIndex={-1}
        aria-label={english ? "Show suggestions" : "Afficher les suggestions"} onClick={() => {
          if (open) close(); else { inputRef.current?.focus(); setOpen(true); }
        }}>⌄</button>
    </span>
    <select {...nativeProps} ref={nativeRef} id={`${inputId}-native`} tabIndex={-1} aria-hidden="true"
      className={styles.native} disabled={disabled} required={required} value={selectedValue}
      onInvalid={event => { event.preventDefault(); setInvalid(true); inputRef.current?.focus(); onInvalid?.(event); }}
      onChange={event => {
        setLocalValue(event.currentTarget.value);
        onChange?.(event);
        // Some recipient controls explicitly reset currentTarget.value after adding an entry.
        setLocalValue(event.currentTarget.value);
      }}>
      {!selected && <option value={selectedValue}>{selectedLabel}</option>}
      {options.map(option => <option key={option.value} value={option.value}
        // Retained historical values remain successful form controls. Disabled choices
        // stay excluded from the searchable index and cannot be explicitly selected.
        disabled={option.disabled && option.value !== selectedValue}
        data-search={option.search} data-secondary={option.secondary}>{option.label}</option>)}
    </select>
    {invalid && <small id={`${inputId}-validation`} className={styles.validation} role="alert">{english ? "Select a result." : "Sélectionnez un résultat."}</small>}
    {expanded && <span className={styles.popup}>
      {editing && selectedValue !== "" && <small className={styles.retained}>{english ? "Selected: " : "Sélection : "}{selectedLabel}</small>}
      {loading && <span className={styles.message} role="status">{english ? "Loading…" : "Chargement…"}</span>}
      {error && <span className={styles.message} role="alert">{error}</span>}
      {!loading && !error && <>
        <span id={listId} role="listbox" aria-label={english ? "Suggestions" : "Suggestions"} className={styles.list}>
          {visible.map(({ item: option, approximate }, position) => <button id={`${listId}-${position}`} key={option.value}
            type="button" role="option" aria-selected={selectedValue === option.value} data-active={position === active}
            tabIndex={-1} className={styles.option} onPointerDown={event => { if (event.pointerType === "mouse") event.preventDefault(); }}
            onMouseEnter={() => setActive(position)} onClick={() => choose(option.value)}>
            <strong>{option.label || (english ? "None" : "Aucun")}</strong>
            {option.secondary && <small>{option.secondary}</small>}
            {approximate && <small className={styles.approximate}>{english ? "Approximate match" : "Correspondance approchée"}</small>}
          </button>)}
        </span>
        {!results.length && <span className={styles.message} role="status">{english ? "No results" : "Aucun résultat"}</span>}
        {results.length > limit && <button type="button" className={styles.more}
          onPointerDown={event => { if (event.pointerType === "mouse") event.preventDefault(); }} onClick={() => setLimit(previous => previous + 24)}>
          {english ? `Show more (${results.length - limit})` : `Afficher plus (${results.length - limit})`}</button>}
      </>}
    </span>}
  </span>;
});

export default SearchableSelect;
