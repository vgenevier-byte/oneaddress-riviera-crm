"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { addressCountryCode, addressDisplayText, addressFingerprint, formatAddress, manualAddress, normalizeAddressForDisplay, normalizeAddressValue, type AddressValue } from "@/lib/address";
import { ignAddressProvider, type AddressProvider, type AddressSuggestion } from "@/lib/addressProvider";
import styles from "./AddressField.module.css";

export type AddressFieldProps = {
  name: string;
  value?: string;
  metadata?: AddressValue;
  metadataName?: string;
  onChange?: (text: string) => void;
  onSelect?: (address: AddressValue) => void;
  onMetadataChange?: (address: AddressValue | undefined) => void;
  city?: string;
  cityFieldName?: string;
  country?: string;
  lang?: "fr" | "en";
  label?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  id?: string;
  maxLength?: number;
  disabled?: boolean;
  provider?: AddressProvider;
  textMode?: "full" | "line1";
  reuseAddresses?: { label: string; address: string; metadata?: AddressValue }[];
};

const messages = {
  fr: {
    address: "Adresse", placeholder: "Commencez à saisir une adresse…", loading: "Recherche…", resolving: "Vérification de l’adresse…",
    empty: "Aucune suggestion. Vous pouvez enregistrer votre saisie manuelle.", error: "Recherche indisponible. La saisie manuelle reste disponible.",
    manual: "Suggestions en France uniquement. Pour les autres pays, saisissez l’adresse manuellement.", hint: "Choisissez une suggestion pour remplir les champs, ou conservez votre saisie manuelle.",
    country: "Pays / pays de recherche", complement: "Complément (résidence, bâtiment, appartement…)", number: "Numéro et suffixe", street: "Voie", postalCode: "Code postal", city: "Ville",
    addressPrecision: "Adresse au numéro", streetPrecision: "Rue : numéro non confirmé", cityPrecision: "Commune : adresse non confirmée",
    replace: "Remplacer le texte actuel et ses corrections manuelles par cette adresse ? Le complément renseigné séparément sera conservé ; vérifiez qu’il correspond à la nouvelle adresse.",
    confirmed: "Adresse sélectionnée. Les champs restent modifiables.", manualPrecision: "Adresse saisie manuellement. Les champs restent modifiables.",
    reuse: "Reprendre une adresse existante", reusePlaceholder: "Choisir une fiche autorisée…", use: "Utiliser cette adresse",
  },
  en: {
    address: "Address", placeholder: "Start typing an address…", loading: "Searching…", resolving: "Checking the address…",
    empty: "No suggestions. You can save the address entered manually.", error: "Search unavailable. Manual entry remains available.",
    manual: "Suggestions cover France only. For other countries, enter the address manually.", hint: "Choose a suggestion to fill the fields, or keep your manual entry.",
    country: "Country / search country", complement: "Additional details (residence, building, apartment…)", number: "House number and suffix", street: "Street", postalCode: "Postal code", city: "City",
    addressPrecision: "House number address", streetPrecision: "Street: house number unconfirmed", cityPrecision: "Municipality: address unconfirmed",
    replace: "Replace the current text and its manual corrections with this address? Additional details entered in the separate field will be kept; check that they belong to the new address.",
    confirmed: "Address selected. You can still edit every field.", manualPrecision: "Address entered manually. You can still edit every field.",
    reuse: "Reuse an existing address", reusePlaceholder: "Choose an authorised record…", use: "Use this address",
  },
};

export function AddressField({ name, value = "", metadata, metadataName = `${name}Details`, onChange, onSelect, onMetadataChange,
  city, cityFieldName, country, lang, label, className = "full", placeholder, required, multiline = true, id, maxLength = 2000, disabled = false,
  provider = ignAddressProvider, textMode = "full", reuseAddresses = [] }: AddressFieldProps) {
  const { language } = useI18n();
  const copy = messages[lang || language];
  const uniqueId = useId();
  const inputId = id || `address-${uniqueId}`;
  const helpId = `${inputId}-help`, listId = `${inputId}-list`, statusId = `${inputId}-status`;
  const [text, setText] = useState(value);
  const [details, setDetails] = useState<AddressValue | undefined>(() => normalizeAddressForDisplay(metadata, value, textMode));
  const [searchCountry, setSearchCountry] = useState(metadata?.country || country || "");
  const [complement, setComplement] = useState(metadata?.complement || "");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "resolving" | "empty" | "error" | "selected">("idle");
  const [reuseIndex, setReuseIndex] = useState("");
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const synthetic = useRef(false);
  const initialText = useRef(value);
  const externalValue = useRef(value);
  const externalMetadata = useRef(metadata);
  const externalCountry = useRef(country);
  const detailsRef = useRef(details);
  const lastPublished = useRef<{ text: string; metadata?: AddressValue } | null>(null);

  // Parent forms can load another record or reuse an address from a linked record.
  useEffect(() => {
    if (externalValue.current === value && externalMetadata.current === metadata && externalCountry.current === country) return;
    const published = lastPublished.current;
    const manualEcho = metadata?.source === "manual" && published?.metadata?.source === "manual"
      && metadata.country === published.metadata.country && metadata.complement === published.metadata.complement;
    const echo = published && value === published.text && (metadata === undefined || JSON.stringify(metadata) === JSON.stringify(published.metadata) || manualEcho)
      && (externalCountry.current === country || country === published.metadata?.country);
    externalValue.current = value; externalMetadata.current = metadata; externalCountry.current = country;
    if (echo) {
      if (manualEcho && metadata) {
        const canonical = normalizeAddressForDisplay(metadata, value, textMode);
        setDetails(canonical); detailsRef.current = canonical;
        lastPublished.current = { text: value, metadata: canonical };
      }
      return;
    }
    sequence.current += 1; pending.current?.abort();
    const normalized = normalizeAddressForDisplay(metadata, value, textMode);
    // Synchronize externally controlled values, without interpreting the legacy free text.
    setText(value);
    setDetails(normalized); detailsRef.current = normalized; setComplement(normalized?.complement || ""); setSearchCountry(normalized?.country || country || "");
    setSearchEnabled(false); setSuggestions([]); setStatus("idle");
  }, [value, metadata, country, textMode]);

  function cancel() { sequence.current += 1; pending.current?.abort(); pending.current = null; }

  useEffect(() => () => { sequence.current += 1; pending.current?.abort(); }, []);

  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const reset = () => {
      sequence.current += 1; pending.current?.abort();
      const normalized = normalizeAddressForDisplay(metadata, value, textMode);
      setText(value); setDetails(normalized); detailsRef.current = normalized;
      setComplement(normalized?.complement || ""); setSearchCountry(normalized?.country || country || "");
      setSuggestions([]); setActive(-1); setSearchEnabled(false); setStatus("idle"); setReuseIndex("");
      initialText.current = value;
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [value, metadata, country, textMode]);

  useEffect(() => {
    if (disabled || !focused || !searchEnabled || text.trim().length < 3 || !provider.coversCountry(searchCountry)) return;
    const controller = new AbortController(), current = ++sequence.current;
    let cancelled = false, timedOut = false;
    const timer = setTimeout(async () => {
      pending.current?.abort(); pending.current = controller;
      setStatus("loading"); setActive(-1);
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
      try {
        const found = await provider.search(text, { signal: controller.signal, city, country: searchCountry });
        if (cancelled || current !== sequence.current) return;
        setSuggestions(found); setStatus(found.length ? "idle" : "empty");
      } catch {
        if (!cancelled && current === sequence.current && (!controller.signal.aborted || timedOut)) { setSuggestions([]); setStatus("error"); }
      } finally { clearTimeout(timeout); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [text, searchCountry, focused, searchEnabled, city, provider, disabled]);

  function notifyForm(nextText: string, nextDetails?: AddressValue) {
    // Existing CRM forms track changed named fields with bubbling input/change events.
    synthetic.current = true;
    if (input.current) {
      const prototype = input.current instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input.current, nextText);
      input.current.dispatchEvent(new Event("input", { bubbles: true }));
      input.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (hidden.current) {
      hidden.current.value = JSON.stringify(nextDetails || {});
      hidden.current.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    synthetic.current = false;
  }

  function publish(nextText: string, nextDetails: AddressValue | undefined, selected = false) {
    lastPublished.current = { text: nextText, metadata: nextDetails };
    setText(nextText); setDetails(nextDetails); detailsRef.current = nextDetails;
    onChange?.(nextText);
    if (selected && nextDetails) onSelect?.(nextDetails);
    onMetadataChange?.(nextDetails);
    notifyForm(nextText, nextDetails);
  }

  function syncCity(nextCity: string) {
    if (!cityFieldName || !input.current?.form) return;
    const sibling = input.current.form.elements.namedItem(cityFieldName);
    if (sibling instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(sibling, nextCity);
      sibling.dispatchEvent(new Event("input", { bubbles: true })); sibling.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function changeText(nextText: string) {
    if (synthetic.current) return;
    cancel();
    setSuggestions([]); setActive(-1); setStatus("idle"); setSearchEnabled(true);
    const next = nextText.trim() ? manualAddress(nextText, complement, searchCountry) : undefined;
    publish(nextText, next);
  }

  function updateStructured(key: "houseNumber" | "street" | "postalCode" | "city" | "country" | "complement", nextValue: string) {
    cancel(); setSearchEnabled(false); setSuggestions([]); setStatus("idle");
    if (key === "complement") setComplement(nextValue);
    if (key === "country") setSearchCountry(nextValue);
    const base = details || manualAddress(text, complement);
    const next: AddressValue = { ...base, [key]: nextValue, source: "manual", precision: "manual", latitude: undefined, longitude: undefined, sourceId: undefined };
    if (key === "country") next.countryCode = addressCountryCode(nextValue);
    const hasStructure = Boolean(base.line1 || base.street || base.postalCode || base.city);
    if ((key === "houseNumber" || key === "street") && (next.street || next.houseNumber)) next.line1 = [next.houseNumber, next.street].filter(Boolean).join(" ");
    if (hasStructure) next.formattedAddress = formatAddress(next);
    else if (key === "complement") {
      const suffix = complement ? `\n${complement}` : "";
      const main = suffix && text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
      next.formattedAddress = [main, nextValue].filter(Boolean).join("\n");
    }
    next.fingerprint = addressFingerprint(next.formattedAddress);
    publish(addressDisplayText(next, textMode), next.formattedAddress.trim() ? next : undefined);
    if (key === "city") syncCity(next.city);
  }

  async function select(suggestion: AddressSuggestion) {
    if ((initialText.current.trim() || complement.trim()) && !window.confirm(copy.replace)) return;
    cancel(); const current = sequence.current, controller = new AbortController(); pending.current = controller;
    setSearchEnabled(false); setSuggestions([]); setActive(-1); setStatus("resolving");
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
      const resolved = await provider.resolve(suggestion, { signal: controller.signal });
      if (current !== sequence.current || controller.signal.aborted) return;
      const next = { ...resolved, complement };
      next.formattedAddress = formatAddress(next); next.fingerprint = addressFingerprint(next.formattedAddress);
      setSearchCountry(next.country); initialText.current = next.formattedAddress;
      publish(addressDisplayText(next, textMode), next, true); setStatus("selected");
      syncCity(next.city);
      input.current?.focus();
    } catch {
      if (current === sequence.current && (!controller.signal.aborted || timedOut)) setStatus("error");
    } finally { clearTimeout(timer); }
  }

  function reuse() {
    const source = reuseAddresses[Number(reuseIndex)];
    if (reuseIndex === "" || !source || ((text.trim() || complement.trim()) && !window.confirm(copy.replace))) return;
    cancel();
    const normalized = normalizeAddressValue(source.metadata, source.address) || manualAddress(source.address);
    const next = { ...normalized, complement: complement || normalized.complement };
    if (normalized.line1 || normalized.city) next.formattedAddress = formatAddress(next);
    next.fingerprint = addressFingerprint(next.formattedAddress);
    setComplement(next.complement); setSearchCountry(next.country); setSearchEnabled(false); setSuggestions([]); setStatus("selected");
    initialText.current = next.formattedAddress;
    publish(addressDisplayText(next, textMode), next, true);
    syncCity(next.city);
  }

  useEffect(() => {
    const form = input.current?.form;
    if (!form || !cityFieldName) return;
    const invalidate = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.name !== cityFieldName) return;
      const current = detailsRef.current;
      if (!current || addressFingerprint(current.city) === addressFingerprint(target.value)) return;
      const hasStructure = Boolean(current.line1 || current.street || current.postalCode || current.city);
      const next: AddressValue = hasStructure ? { ...current, city: target.value, source: "manual", precision: "manual", latitude: undefined, longitude: undefined, sourceId: undefined }
        : manualAddress(input.current?.value || "", current.complement, current.country, current.countryCode);
      if (hasStructure) { next.formattedAddress = formatAddress(next); next.fingerprint = addressFingerprint(next.formattedAddress); }
      const nextText = addressDisplayText(next, textMode);
      lastPublished.current = { text: nextText, metadata: next };
      setText(nextText);
      setDetails(next); detailsRef.current = next;
      onChange?.(nextText); onMetadataChange?.(next);
      synthetic.current = true;
      if (input.current) {
        const prototype = input.current instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input.current, nextText);
        input.current.dispatchEvent(new Event("input", { bubbles: true })); input.current.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (hidden.current) { hidden.current.value = JSON.stringify(next); hidden.current.dispatchEvent(new Event("change", { bubbles: true })); }
      synthetic.current = false;
    };
    form.addEventListener("input", invalidate);
    return () => form.removeEventListener("input", invalidate);
  }, [cityFieldName, onChange, onMetadataChange, textMode]);

  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setActive(index => Math.min(index + 1, suggestions.length - 1)); }
    if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    if (event.key === "Enter" && active >= 0 && suggestions[active]) { event.preventDefault(); void select(suggestions[active]); }
    if (event.key === "Escape") { event.preventDefault(); cancel(); setSuggestions([]); setStatus("idle"); setSearchEnabled(false); }
    if (event.key === "Tab") { setSuggestions([]); setSearchEnabled(false); }
  }

  const open = focused && suggestions.length > 0;
  const structured = Boolean(details && (details.line1 || details.street || details.city || details.postalCode));
  const inputProps = {
    id: inputId, name, value: text, maxLength, required, disabled, placeholder: placeholder || copy.placeholder, autoComplete: "off",
    role: "combobox", "aria-autocomplete": "list" as const, "aria-expanded": open, "aria-controls": listId,
    "aria-activedescendant": open && active >= 0 ? `${listId}-${active}` : undefined,
    "aria-describedby": `${helpId} ${statusId}`, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => changeText(event.target.value),
    onFocus: () => setFocused(true), onBlur: () => { setFocused(false); }, onKeyDown: keyDown,
  };
  return <div className={`${className} ${styles.field}`} data-address-field={name}>
    {reuseAddresses.length > 0 && <div className={styles.reuse}>
      <label>{copy.reuse}<select aria-label={copy.reuse} disabled={disabled} value={reuseIndex} onChange={event => setReuseIndex(event.target.value)}>
        <option value="">{copy.reusePlaceholder}</option>
        {reuseAddresses.map((source, index) => <option key={`${source.label}-${index}`} value={index}>{source.label}</option>)}
      </select></label>
      <button type="button" className="secondary-button" disabled={disabled || reuseIndex === ""} onClick={reuse}>{copy.use}</button>
    </div>}
    <label htmlFor={inputId}>{label || copy.address}</label>
    <div className={styles.search}>
      {multiline ? <textarea {...inputProps} ref={input as React.Ref<HTMLTextAreaElement>} rows={3} /> : <input {...inputProps} ref={input as React.Ref<HTMLInputElement>} />}
      {open && <ul id={listId} role="listbox" aria-label={label || copy.address} className={styles.suggestions}>
        {suggestions.map((suggestion, index) => <li key={suggestion.key} role="none"><button type="button" role="option" id={`${listId}-${index}`}
          aria-selected={active === index} disabled={disabled} tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => void select(suggestion)}>
          <span>{suggestion.label}</span><small>{suggestion.kind === "housenumber" ? copy.addressPrecision : suggestion.kind === "municipality" ? copy.cityPrecision : copy.streetPrecision}</small>
        </button></li>)}
      </ul>}
    </div>
    <small id={helpId}>{copy.hint}</small>
    <div id={statusId} role="status" aria-live="polite" className={styles.status}>
      {status === "loading" ? copy.loading : status === "resolving" ? copy.resolving : status === "empty" ? copy.empty : status === "error" ? copy.error : status === "selected" ? copy.confirmed : ""}
    </div>
    {structured && <div className={styles.structure}>
      <label>{copy.number}<input disabled={disabled} value={details?.houseNumber || ""} autoComplete="off" onChange={event => updateStructured("houseNumber", event.target.value)} /></label>
      <label>{copy.street}<input disabled={disabled} value={details?.street || ""} autoComplete="off" onChange={event => updateStructured("street", event.target.value)} /></label>
      <label>{copy.postalCode}<input disabled={disabled} value={details?.postalCode || ""} autoComplete="off" onChange={event => updateStructured("postalCode", event.target.value)} /></label>
      <label>{copy.city}<input disabled={disabled} value={details?.city || ""} autoComplete="off" onChange={event => updateStructured("city", event.target.value)} /></label>
    </div>}
    <div className={styles.structure}>
      <label>{copy.complement}<input disabled={disabled} value={complement} autoComplete="off" onChange={event => updateStructured("complement", event.target.value)} /></label>
      <label>{copy.country}<input disabled={disabled} value={searchCountry} placeholder="France" autoComplete="country-name" onChange={event => updateStructured("country", event.target.value)} /></label>
    </div>
    <small className={styles.coverage}>{copy.manual}</small>
    {structured && details?.source === "manual" && <small>{copy.manualPrecision}</small>}
    <small className={styles.attribution}><a href="https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/autocompletion/" target="_blank" rel="noopener noreferrer">{provider.attribution}</a></small>
    <input ref={hidden} type="hidden" name={metadataName} value={JSON.stringify(details || {})} />
  </div>;
}
