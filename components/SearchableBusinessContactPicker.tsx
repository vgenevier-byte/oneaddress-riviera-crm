"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Contact } from "@/lib/types";
import {
  getVendorBusinessName,
  getVendorContactPersonName,
  getVendorContactProfession,
  normalizeVendorContactSearch,
  searchVendorContacts
} from "@/lib/vendorContacts";

type Props = {
  contacts: Contact[];
  defaultContact?: Contact | null;
  defaultContactId?: string;
  fallbackContactName?: string;
  fallbackContactPersonName?: string;
  fallbackProfession?: string;
  fallbackPhone?: string;
  label?: string;
  name?: string;
  required?: boolean;
};

export default function SearchableBusinessContactPicker({
  contacts,
  defaultContact = null,
  defaultContactId = "",
  fallbackContactName = "",
  fallbackContactPersonName = "",
  fallbackProfession = "",
  fallbackPhone = "",
  label = "Prestataire",
  name = "contactId",
  required = false
}: Props) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasDefaultContact = useMemo(
    () =>
      contacts.some((contact) => contact.id === defaultContactId) ||
      defaultContact?.id === defaultContactId,
    [contacts, defaultContact?.id, defaultContactId]
  );
  const [previousDefaults, setPreviousDefaults] = useState({
    defaultContactId,
    fallbackContactName,
    hasDefaultContact
  });
  const [query, setQuery] = useState("");
  const [selectedContactId, setSelectedContactId] = useState(defaultContactId);
  const [preserveFallback, setPreserveFallback] = useState(
    Boolean(fallbackContactName && !hasDefaultContact)
  );
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedContact = useMemo(
    () =>
      contacts.find((contact) => contact.id === selectedContactId) ||
      (defaultContact?.id === selectedContactId ? defaultContact : null),
    [contacts, defaultContact, selectedContactId]
  );
  const normalizedQuery = normalizeVendorContactSearch(query);
  const results = useMemo(
    () => searchVendorContacts(contacts, normalizedQuery, 10),
    [contacts, normalizedQuery]
  );
  if (
    previousDefaults.defaultContactId !== defaultContactId ||
    previousDefaults.fallbackContactName !== fallbackContactName ||
    previousDefaults.hasDefaultContact !== hasDefaultContact
  ) {
    setPreviousDefaults({ defaultContactId, fallbackContactName, hasDefaultContact });
    setSelectedContactId(defaultContactId);
    setPreserveFallback(Boolean(fallbackContactName && !hasDefaultContact));
    setQuery("");
    setIsOpen(false);
    setActiveIndex(-1);
  }

  if (activeIndex >= results.length) setActiveIndex(-1);

  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;

    function resetPicker() {
      setSelectedContactId(defaultContactId);
      setPreserveFallback(Boolean(fallbackContactName && !hasDefaultContact));
      setQuery("");
      setIsOpen(false);
      setActiveIndex(-1);
    }

    form.addEventListener("reset", resetPicker);
    return () => form.removeEventListener("reset", resetPicker);
  }, [defaultContactId, fallbackContactName, hasDefaultContact]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function focusSearch() {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function startChanging() {
    setSelectedContactId("");
    setPreserveFallback(false);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(-1);
    focusSearch();
  }

  function clearSelection() {
    setSelectedContactId("");
    setPreserveFallback(false);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function selectContact(contact: Contact) {
    setSelectedContactId(contact.id);
    setPreserveFallback(false);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => (index < 0 ? 0 : (index + 1) % results.length));
      return;
    }

    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) =>
        index < 0 ? results.length - 1 : (index - 1 + results.length) % results.length
      );
      return;
    }

    if (event.key === "Enter" && isOpen && results[activeIndex]) {
      event.preventDefault();
      selectContact(results[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  const showSelectedCard = Boolean(selectedContact || (preserveFallback && fallbackContactName));
  const selectedBusinessName = selectedContact
    ? getVendorBusinessName(selectedContact)
    : fallbackContactName;
  const selectedPersonName = selectedContact
    ? getVendorContactPersonName(selectedContact)
    : fallbackContactPersonName;
  const selectedProfession = selectedContact
    ? getVendorContactProfession(selectedContact)
    : fallbackProfession;
  const selectedPhone = selectedContact ? selectedContact.phone : fallbackPhone;

  return (
    <div className="business-contact-picker-field" ref={containerRef}>
      <label className="business-contact-picker-label" htmlFor={inputId}>
        {label}
      </label>
      <input type="hidden" name={name} value={selectedContactId} />
      <input
        type="hidden"
        name="preserveLegacyContact"
        value={preserveFallback ? "true" : ""}
      />

      {showSelectedCard ? (
        <div className="business-contact-picker-selection">
          <div className="business-contact-picker-selection-copy">
            <strong>{selectedBusinessName}</strong>
            {selectedPersonName && selectedPersonName !== selectedBusinessName ? (
              <span>Référent : {selectedPersonName}</span>
            ) : null}
            {selectedProfession ? <span>{selectedProfession}</span> : null}
            {selectedPhone ? <span>{selectedPhone}</span> : null}
            {preserveFallback ? <small>Contact historique non lié au CRM</small> : null}
          </div>
          <div className="business-contact-picker-actions">
            <button type="button" className="secondary-button" onClick={startChanging}>
              Changer
            </button>
            <button type="button" className="danger-link" onClick={clearSelection}>
              Effacer
            </button>
          </div>
        </div>
      ) : (
        <div className="business-contact-picker-combobox">
          <input
            id={inputId}
            ref={inputRef}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen && normalizedQuery.length >= 2}
            aria-controls={listboxId}
            aria-activedescendant={
              isOpen && results[activeIndex]
                ? `${listboxId}-option-${activeIndex}`
                : undefined
            }
            aria-required={required}
            autoComplete="off"
            value={query}
            placeholder="Rechercher une entreprise ou un contact…"
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              setIsOpen(normalizeVendorContactSearch(nextQuery).length >= 2);
              setActiveIndex(-1);
            }}
            onFocus={() => setIsOpen(normalizedQuery.length >= 2)}
            onKeyDown={handleKeyDown}
          />

          {isOpen && normalizedQuery.length >= 2 ? (
            <div className="business-contact-picker-results" id={listboxId} role="listbox">
              {results.length > 0 ? (
                results.map((contact, index) => {
                  const businessName = getVendorBusinessName(contact);
                  const personName = getVendorContactPersonName(contact);
                  const profession = getVendorContactProfession(contact);
                  const secondaryParts = contact.companyName
                    ? [
                        personName ? `Référent : ${personName}` : "",
                        profession,
                        contact.city
                      ]
                    : [profession, contact.city];
                  const contactDetails = [contact.phone, contact.email].filter(Boolean).join(" · ");

                  return (
                    <button
                      id={`${listboxId}-option-${index}`}
                      key={contact.id}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`business-contact-picker-result${index === activeIndex ? " is-active" : ""}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectContact(contact)}
                    >
                      <strong>{businessName}</strong>
                      {secondaryParts.filter(Boolean).length > 0 ? (
                        <span>{secondaryParts.filter(Boolean).join(" · ")}</span>
                      ) : null}
                      {contactDetails ? <small>{contactDetails}</small> : null}
                    </button>
                  );
                })
              ) : (
                <p className="business-contact-picker-empty" role="status">
                  Aucun prestataire trouvé
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
