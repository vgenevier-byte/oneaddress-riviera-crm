"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { matchesTaskContact, taskContactLabel, type TaskContactOption } from "@/lib/tasks/contactOptions";

type Props = {
  options: TaskContactOption[];
  contactId: string;
  onChange: (contactId: string) => void;
  disabled?: boolean;
};

function contactInformation(contact: TaskContactOption) {
  const label = taskContactLabel(contact).trim();
  return [contact.company?.trim(), contact.email?.trim()].filter(value => value && value !== label).join(" · ");
}

/** The text is a local search only. A link changes only after an explicit choice or removal. */
export default function TaskContactPicker({ options, contactId, onChange, disabled = false }: Props) {
  const inputId = useId();
  const listId = `${inputId}-results`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState("");
  const selected = options.find(contact => contact.id === contactId);
  const matches = options.filter(contact => matchesTaskContact(contact, query));
  const listVisible = !disabled && open && Boolean(query.trim());
  const activeIndex = matches.findIndex(contact => contact.id === activeId);

  useEffect(() => {
    if (listVisible && activeIndex >= 0) document.getElementById(`${listId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [listVisible, activeIndex, listId]);

  function choose(id: string) {
    // Recheck the current readable options: a revoked/stale result cannot be selected.
    if (disabled || !options.some(contact => contact.id === id)) return;
    onChange(id);
    setQuery("");
    setOpen(false);
    setActiveId("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (!disabled && listVisible && activeIndex >= 0) choose(matches[activeIndex].id);
      return;
    }
    if (disabled || !query.trim() || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    setOpen(true);
    if (!matches.length) return;
    const nextIndex = event.key === "ArrowDown"
      ? (activeIndex + 1) % matches.length
      : (activeIndex < 0 ? matches.length - 1 : (activeIndex - 1 + matches.length) % matches.length);
    setActiveId(matches[nextIndex].id);
  }

  return <div className="task-contact-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setActiveId(""); }
  }} onKeyDownCapture={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && listVisible) {
      // Cancel the native dialog's Escape action while its suggestions are open.
      event.preventDefault(); event.stopPropagation(); setOpen(false); setActiveId("");
    }
  }}>
    <label htmlFor={inputId}>Contact lié — facultatif</label>
    {contactId && <div className="task-contact-selected">
      <div className="task-contact-identity">
        <strong>{selected ? taskContactLabel(selected) : "Rattachement conservé · détail indisponible"}</strong>
        {selected && contactInformation(selected) && <small>{contactInformation(selected)}</small>}
      </div>
      <button type="button" disabled={disabled} onClick={() => {
        if (disabled) return;
        onChange(""); setQuery(""); setOpen(false); setActiveId("");
      }}>Retirer le contact lié</button>
    </div>}
    <input id={inputId} type="search" role="combobox" aria-autocomplete="list" aria-expanded={listVisible}
      aria-controls={listId} aria-activedescendant={listVisible && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
      autoComplete="off" placeholder="Rechercher par prénom, nom ou entreprise…" value={query} disabled={disabled}
      onFocus={() => { if (!disabled && query.trim()) setOpen(true); }}
      onChange={event => { if (!disabled) { setQuery(event.target.value); setOpen(Boolean(event.target.value.trim())); setActiveId(""); } }}
      onKeyDown={handleKeyDown} />
    {listVisible && <div className="task-contact-results">
      <div id={listId} role="listbox" aria-label="Contacts correspondants">
        {matches.map((contact, index) => <button key={contact.id} id={`${listId}-option-${index}`} type="button" role="option"
          aria-selected={index === activeIndex} tabIndex={-1} disabled={disabled}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveId(contact.id)} onClick={() => choose(contact.id)}>
          <strong>{taskContactLabel(contact)}</strong>
          {contactInformation(contact) && <small>{contactInformation(contact)}</small>}
        </button>)}
      </div>
      {!matches.length && <p role="status">Aucun contact correspondant</p>}
    </div>}
    <style jsx>{`
      .task-contact-picker { display: flex; flex-direction: column; grid-column: 1 / -1; gap: 6px; min-width: 0; max-width: 100%; }
      .task-contact-picker label { font-size: 14px; font-weight: 500; }
      .task-contact-picker input { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; }
      .task-contact-selected { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; border: 1px solid #dce1e7; border-radius: 8px; background: #f4f6f8; }
      .task-contact-identity { flex: 1 1 160px; min-width: 0; display: flex; flex-direction: column; }
      .task-contact-identity strong, .task-contact-identity small, .task-contact-results strong, .task-contact-results small { overflow-wrap: anywhere; }
      .task-contact-selected button { flex: 0 1 auto; font-size: 13px; }
      .task-contact-results { max-height: min(240px, 40vh); overflow-y: auto; overflow-x: hidden; border: 1px solid #cdd1d8; border-radius: 8px; background: #fff; }
      .task-contact-results [role="listbox"] { display: flex; flex-direction: column; }
      .task-contact-results button { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 3px; box-sizing: border-box; width: 100%; min-height: 44px; margin: 0; border: 0; border-bottom: 1px solid #e7e9ec; border-radius: 0; padding: 10px; background: #fff; text-align: left; white-space: normal; }
      .task-contact-results button:last-child { border-bottom: 0; }
      .task-contact-results button[aria-selected="true"] { background: #edf3fb; outline: 2px solid #547ec2; outline-offset: -2px; }
      .task-contact-results small, .task-contact-identity small { color: #687283; font-size: 12px; font-weight: 400; }
      .task-contact-results p { margin: 0; padding: 12px; color: #687283; font-size: 13px; }
    `}</style>
  </div>;
}
