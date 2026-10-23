"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Contact } from "@/lib/types";
import { sortSelectOptions } from "@/lib/selectOptions";
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
  /** Optional controlled mode; legacy supplier consumers keep their behavior. */
  value?: string;
  onSelect?: (contact: Contact | null) => boolean | void;
  onQueryChange?: (query: string) => void;
  queryValue?: string;
  selectedRecord?: Contact | null;
  searchMode?: "vendor" | "all";
  loading?: boolean;
  disabled?: boolean;
  onOpenContact?: (id: string) => void;
  resultLabel?: (contact: Contact) => string;
  labels?: { placeholder?: string; empty?: string; change?: string; clear?: string; open?: string; loading?: string; unavailable?: string };
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
  required = false,
  value, onSelect, onQueryChange, queryValue, selectedRecord, searchMode = "vendor",
  loading = false, disabled = false, onOpenContact, resultLabel, labels
}: Props) {
  const {t, language} = useI18n();

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
  const [activeContactId, setActiveContactId] = useState("");

  const controlled = value !== undefined;
  const effectiveId = controlled ? value : selectedContactId;
  const [changing, setChanging] = useState(false);
  const selectedContact = useMemo(
    () =>
      contacts.find((contact) => contact.id === effectiveId) ||
      (selectedRecord?.id === effectiveId ? selectedRecord : null) ||
      (defaultContact?.id === effectiveId ? defaultContact : null),
    [contacts, defaultContact, effectiveId, selectedRecord]
  );
  const normalizedQuery = normalizeVendorContactSearch(queryValue ?? query);
  const [previousQueryValue, setPreviousQueryValue] = useState(queryValue);
  if (previousQueryValue !== queryValue) {
    setPreviousQueryValue(queryValue);
    setIsOpen(Boolean(queryValue && normalizedQuery.length >= 2));
    setActiveContactId("");
  }
  const results = useMemo(
    () => searchMode === "all"
      ? sortSelectOptions(contacts, resultLabel || getVendorBusinessName, language).slice(0, 50)
      : searchVendorContacts(contacts, normalizedQuery, 10),
    [contacts, language, normalizedQuery, resultLabel, searchMode]
  );
  const activeIndex = results.findIndex(contact => contact.id === activeContactId);
  if (
    previousDefaults.defaultContactId !== defaultContactId ||
    previousDefaults.fallbackContactName !== fallbackContactName ||
    previousDefaults.hasDefaultContact !== hasDefaultContact
  ) {
    setPreviousDefaults({ defaultContactId, fallbackContactName, hasDefaultContact });
    setSelectedContactId(defaultContactId);
    setChanging(false);
    setPreserveFallback(Boolean(fallbackContactName && !hasDefaultContact));
    setQuery("");
    setIsOpen(false);
    setActiveContactId("");
  }

  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;

    function resetPicker() {
      setSelectedContactId(defaultContactId);
      setChanging(false);
      setPreserveFallback(Boolean(fallbackContactName && !hasDefaultContact));
      setQuery("");
      setIsOpen(false);
      setActiveContactId("");
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

    // Controlled consumers may display results in the document flow. Closing
    // after click prevents the outside target from moving before mouseup.
    const eventName = controlled ? "click" : "mousedown";
    document.addEventListener(eventName, closeOnOutsideClick);
    return () => document.removeEventListener(eventName, closeOnOutsideClick);
  }, [controlled]);

  function focusSearch() {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function startChanging() {
    if (disabled) return;
    if (!controlled) setSelectedContactId("");
    setChanging(true);
    setPreserveFallback(false);
    setQuery("");
    onQueryChange?.("");
    setIsOpen(false);
    setActiveContactId("");
    focusSearch();
  }

  function clearSelection() {
    if (disabled || onSelect?.(null) === false) return;
    setChanging(false);
    setSelectedContactId("");
    setPreserveFallback(false);
    setQuery("");
    setIsOpen(false);
    setActiveContactId("");
  }

  function selectContact(contact: Contact) {
    if (disabled || onSelect?.(contact) === false) return;
    setChanging(false);
    setSelectedContactId(contact.id);
    setPreserveFallback(false);
    setQuery("");
    setIsOpen(false);
    setActiveContactId("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveContactId(results[activeIndex < 0 ? 0 : (activeIndex + 1) % results.length].id);
      return;
    }

    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveContactId(results[activeIndex < 0 ? results.length - 1 : (activeIndex - 1 + results.length) % results.length].id);
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

  const unresolvedSelection = Boolean(controlled && effectiveId && !selectedContact);
  const showSelectedCard = !changing && Boolean(selectedContact || unresolvedSelection || (preserveFallback && fallbackContactName));
  const selectedBusinessName = selectedContact
    ? getVendorBusinessName(selectedContact)
    : fallbackContactName || labels?.unavailable || "Contact lié";
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
        {label === "Prestataire" ? t("modules.moduleWorkspace.supplier") : label}
      </label>
      <input type="hidden" name={name} value={effectiveId} />
      <input
        type="hidden"
        name="preserveLegacyContact"
        value={!controlled && preserveFallback ? "true" : ""}
      />

      {showSelectedCard ? (
        <div className="business-contact-picker-selection">
          <div className="business-contact-picker-selection-copy">
            <strong>{selectedContact && resultLabel ? resultLabel(selectedContact) : selectedBusinessName}</strong>
            {selectedPersonName && selectedPersonName !== selectedBusinessName ? (
              <span>{t("modules.searchableBusinessContactPicker.contactPerson")} {selectedPersonName}</span>
            ) : null}
            {selectedProfession ? <span>{selectedProfession}</span> : null}
            {selectedPhone ? <span>{selectedPhone}</span> : null}
            {!controlled && preserveFallback ? <small>{t("modules.searchableBusinessContactPicker.historicalContactNotLinkedToTheCRM")}</small> : null}
          </div>
          <div className="business-contact-picker-actions">
            {effectiveId && onOpenContact && <button type="button" className="secondary-button" onClick={() => onOpenContact(effectiveId)}>{labels?.open || "Ouvrir le contact"}</button>}
            <button type="button" className="secondary-button" disabled={disabled} onClick={startChanging}>

              {labels?.change || t("modules.searchableBusinessContactPicker.change")}
            </button>
            <button type="button" className="danger-link" disabled={disabled} onClick={clearSelection}>

              {labels?.clear || t("modules.searchableBusinessContactPicker.clear")}
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
            value={queryValue ?? query}
            disabled={disabled}
            placeholder={labels?.placeholder || t("modules.searchableBusinessContactPicker.searchForACompanyOrContact")}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              onQueryChange?.(nextQuery);
              setIsOpen(normalizeVendorContactSearch(nextQuery).length >= 2);
              setActiveContactId("");
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
                        personName ? t("modules.vendors.supplierPerson", {name: personName}) : "",
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
                      disabled={disabled}
                      className={`business-contact-picker-result${index === activeIndex ? " is-active" : ""}`}
                      onMouseEnter={() => setActiveContactId(contact.id)}
                      onClick={() => selectContact(contact)}
                    >
                      <strong>{resultLabel ? resultLabel(contact) : businessName}</strong>
                      {secondaryParts.filter(Boolean).length > 0 ? (
                        <span>{secondaryParts.filter(Boolean).join(" · ")}</span>
                      ) : null}
                      {contactDetails ? <small>{contactDetails}</small> : null}
                    </button>
                  );
                })
              ) : (
                <p className="business-contact-picker-empty" role="status">

                  {loading ? labels?.loading || "Recherche…" : labels?.empty || t("modules.searchableBusinessContactPicker.noSuppliersFound")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
