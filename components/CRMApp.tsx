"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Variables } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/engine";
import { crmMessages } from "@/lib/i18n/catalogs/crm";
import { modulesMessages } from "@/lib/i18n/catalogs/modules";
import collectionCatalog from "@/lib/access/collections.json";
const contactMutationFields = new Set([...Object.keys(collectionCatalog.find(schema => schema.collection === "contacts")?.fields ?? {}), "notes", "preferences", "importantNotes", "supplierPriceNotes", "supplierCommissionNotes"]);

type UITranslate = ReturnType<typeof useI18n>["t"];
const defaultCRMTranslate: UITranslate = (key, variables) => translate(key, "fr", variables);
type PlanningDisplay = { t: UITranslate; enum: (value: string) => string; shortDate: (value?: string) => string; timeRange: (start?: string, end?: string) => string };

type ScreenNotice = string | { key: string; variables?: Variables };
function screenNotice(key: string, variables?: Variables): ScreenNotice { return { key, variables }; }
function displayValue(value: unknown) { return String(value ?? ""); }
const knownCRMErrors = new Map(Object.entries(crmMessages).filter(([key]) => key.startsWith("crm.errors.") && key !== "crm.errors.unknown").map(([key, message]) => [message.fr, key]));
function safeCRMError(error: unknown): ScreenNotice {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return screenNotice(knownCRMErrors.get(text) || "crm.errors.unknown");
}

// Exact application-owned form outcomes only; never render an arbitrary server message.
const knownConfirmedFormMessages = new Map<string, string>(([
  "modules.common.newerDraftRetained",
  "modules.common.saveUnconfirmedReview",
  "modules.common.enterATitle",
  "modules.moduleWorkspace.operationUnconfirmed",
  "modules.moduleWorkspace.conflictTheDataHasChangedReloadBeforeContinuing",
  "modules.moduleWorkspace.aSaveIsAlreadyInProgress",
  "modules.moduleWorkspace.savingInterruptedYourSessionOrPermissionsHaveChanged",
  "modules.moduleWorkspace.connectionInterruptedSaveUnconfirmedYourInputIsRetained",
  "modules.moduleWorkspace.saveRefusedCheckTheFieldsAndYourPermissionsYourInputIsRetained",
  "modules.moduleWorkspace.editingUnauthorisedOrSavingInProgress",
  "modules.moduleWorkspace.savingInterruptedTheAccountOrPermissionsHaveChanged",
  "modules.moduleWorkspace.conflictTheDataHasChangedYourInputIsRetainedReloadBeforeContinuing",
  "modules.moduleWorkspace.saveUnconfirmedYourInputIsRetainedCheckTheConnectionAndYourPermissions",
  "modules.moduleWorkspace.editOneItemAtATime",
  "modules.moduleWorkspace.invalidScheduleDates",
  "modules.houseWorkerEditor.enterAValidHourlyRateWithNoMoreThanTwoDecimalPlaces"
] as const).map(key => [modulesMessages[key].fr, key]));
function confirmedFormNotice(message: string) {
  return { key: getContactIdentityValidationError(message) ? `crm.contacts.validation.${message}` : knownConfirmedFormMessages.get(message) || knownCRMErrors.get(message) || "crm.errors.unknown" };
}
function ConfirmedFormMessage({ message, inline = false }: { message: string; inline?: boolean }) {
  const { t } = useI18n();
  if (!message) return null;
  const notice = confirmedFormNotice(message);
  const Element = inline ? "span" : "p";
  return <Element role={notice.key === "modules.common.newerDraftRetained" ? "status" : "alert"}>{t(notice.key)}</Element>;
}

/** Screen-only formatting. Export generators and stored business notes retain their original helpers. */
function useCRMDisplay() {
  const i18n = useI18n();
  const { t, label, formatDate, locale } = i18n;
  const current = useCommittedValue({ t, label });
  const screenText = useCallback((notice: ScreenNotice) => typeof notice === "string" ? label(notice, "crm") : t(notice.key, notice.variables), [t, label]);
  const dialogText = useCallback((notice: ScreenNotice) => typeof notice === "string" ? current.current.label(notice, "crm") : current.current.t(notice.key, notice.variables), [current]);
  const dialogT: UITranslate = useCallback((key, variables) => current.current.t(key, variables), [current]);
  const date = (value?: string) => value ? formatDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const money = (value: number, maximumFractionDigits = 0) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits }).format(value);
  const timeRange = (start?: string, end?: string) => start && end ? `${start} → ${end}` : start || (end ? t("crm.screen.untilTime", { time: end }) : "");
  const shortDate = (value?: string) => value ? formatDate(value, { day: "2-digit", month: "2-digit" }) : t("crm.screen.dateMissing");
  const planningDisplay: PlanningDisplay = { t, enum: value => label(value, "crm"), shortDate, timeRange };
  const screen = {
    date,
    dateTime: (value?: string) => value ? formatDate(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
    money,
    quoteDate: (value?: string) => value ? formatDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—",
    euro: (value: unknown) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(normalizeEuroAmount(value)).replace(/[\u00a0\u202f]/g, " "),
    shortDate,
    monthTitle: (value: string) => formatDate(`${value}-01`, { month: "long", year: "numeric" }),
    reservation: (start?: string, end?: string) => start && end ? t("crm.screen.reservationPeriod", { start: date(start), end: date(end) }) : start ? t("crm.screen.reservationFrom", { start: date(start) }) : end ? t("crm.screen.reservationUntil", { end: date(end) }) : t("crm.screen.reservationMissing"),
    due: (value?: string) => !value ? t("crm.screen.dateMissing") : getDueStatus(value) === "overdue" ? t("crm.screen.overdueDate", { date: date(value) }) : getDueStatus(value) === "today" ? t("crm.screen.todayDate", { date: date(value) }) : t("crm.screen.dueDate", { date: date(value) }),
    action: (item: ActionTrackedItem) => { const actor = item.updatedBy || item.createdBy; if (!actor) return t("crm.screen.actionUnassigned"); const when = item.updatedAt || item.createdAt; return when ? t("crm.screen.lastActionDate", { actor, date: formatDate(when, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) }) : t("crm.screen.lastAction", { actor }); },
    balance: (value: number) => value > 0 ? t("crm.screen.balanceDue", { amount: money(value, 2) }) : value < 0 ? t("crm.screen.balanceAdvance", { amount: money(Math.abs(value), 2) }) : t("crm.screen.balanceZero"),
    timeRange,
    planningRange: (entry: Pick<PlanningEntry, "startDate" | "endDate" | "startTime" | "endTime">) => { const start = [date(entry.startDate), entry.startTime].filter(Boolean).join(" · "); if (entry.endDate && entry.endDate !== entry.startDate) return `${start} → ${[date(entry.endDate), entry.endTime].filter(Boolean).join(" · ")}`; const time = timeRange(entry.startTime, entry.endTime); return [date(entry.startDate), time].filter(Boolean).join(" · "); },
    enum: (canonical: string) => label(canonical, "crm"),
    category: (canonical: string) => [...supplierCategories, ...planningCategoryOptions, "Tous", "Clients", "Prestataires", "Propriétaires", "Membres de l’organisation"].includes(canonical as never) ? label(canonical, "crm") : canonical,
    planningSegment: (event: any, dayIso?: string) => getPlanningCalendarDaySegmentStatus(event, dayIso, planningDisplay),
    planningExplanation: (event: any) => getPlanningTimingExplanation(event, planningDisplay),
    planningEventLabel: (event: any, dayIso?: string) => getPlanningCalendarEventLabel(event, dayIso, planningDisplay),
  };
  return { ...i18n, label: (canonical: unknown, namespace?: string) => label(displayValue(canonical), namespace), screen, screenText, dialogText, dialogT };
}

import { BusinessForm, BusinessLabel, BusinessButton, BusinessSelect, useBusinessPermissions } from "./BusinessPermissions";
import { useConfirmedForm, type FormSave, type FormSaveResult } from "@/lib/access/useConfirmedForm";
import { useScopedOperations, isCancelled } from "@/lib/access/operations";
import HouseWorkerEditor from "./HouseWorkerEditor";
import QuickRepliesView from "./QuickRepliesView";
import { ContactPostalAddressField, ContactPostalAddressDetails } from "./ContactPostalAddress";
import ContactDocuments, { ContactDocumentLibrary } from "./ContactDocuments";
import { getContactFormUpdate, mergeContactUpdate, readPostalAddress } from "@/lib/contactEditing";
import { getContactLabel, getContactPersonName, getContactSecondaryLabel, getContactIdentityValidationError, validateContactIdentity, type ContactIdentityValidation } from "@/lib/contactIdentity";
import SearchableBusinessContactPicker from "./SearchableBusinessContactPicker";
import vendorFinanceStyles from "./VendorFinanceDialogs.module.css";
import { VendorInvoiceDuplicateDialog } from "./VendorFinanceDialogs";
import VendorQuotesView from "./VendorQuotesView";
import MobileCRMHeader from "./MobileCRMHeader";
import UnifiedNavigation, { type UnifiedTab } from "./UnifiedNavigation";
import { readable, type AccessSnapshot } from "@/lib/access/modules";
import { type MobileSecondaryAction } from "./MobileMoreMenu";
import { VendorBankAccounts, VendorInvoicePayment, VendorBankContactDialog } from "./VendorBanking";
import {
  crmNavigationItems,
  getCRMTabSearchPlaceholder,
  getCRMTabTitle,
  isCRMTabSearchable,
  type CRMTab
} from "./crmNavigation";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import Image from "next/image";

import { isCompletedTaskStatus } from "@/lib/taskMaintenance";
import TasksWorkspace from "./TasksWorkspace";
import { taskContactOptions } from "@/lib/tasks/contactOptions";
import { normalizeContactSearch } from "@/lib/contactSearch";
import { createContactSearchIndex, searchContactSuggestions, searchDirectContacts } from "@/lib/contactSuggestions";
import { useTaskApi, useTaskProjection, taskPermissions, taskForBusinessView } from "@/lib/tasks/client";
import { parisCivilDate, isCivilDate, TaskRequestLedger, effectiveTaskLeadId } from "@/lib/tasks/domain";
import { crmCache } from "@/lib/access/crmCache";
import { useCommittedValue } from "@/lib/access/useCommittedValue";
import { WorkspaceSyncGuard, workspaceFingerprint } from "@/lib/access/workspaceSync";
import { supabase } from "@/lib/supabase";
import { fetchDriveAPI } from "@/lib/driveClient";
import { mergeDocumentTrashCompletion } from "@/lib/documentTrashClient";
import type {
  CRMData,
  Contact,
  ContactKind,
  Lead,
  LeadStatus,
  Property,
  PropertyStatus,
  Vehicle,
  VehicleStatus,
  Boat,
  BoatStatus,
  Task,
  TaskStatus,
  Supplier,
  PlanningEntry,
  PlanningEntryType,
  PlanningEntryStatus,
  PlanningPriority,
  PlanningCategory,
  VendorInvoice,
  VendorQuote,
  HouseTrackingHouse,
  HouseTrackingWorker,
  HouseTimeEntry,
  HousePayment,
} from "@/lib/types";
import {
  getVendorBusinessName,
  getVendorContactPersonName,
  getVendorContactProfession,
  isEligibleVendorContact,
  normalizeVendorContactSearch
} from "@/lib/vendorContacts";
import {
  getHouseTimeAmount,
  getHouseTimeHours,
  getHouseTrackingWorkerHistorySummary,
  houseTrackingWorkerHasHistory,
  isQuarterHourTime,
  isHouseTrackingWorkerActive,
  permanentlyDeleteHouseTrackingWorker,
  QUARTER_HOUR_TIME_OPTIONS,
  parseHouseHourlyRate,
  houseHourlyRateInput,
  type HouseWorkerEdit,
  setHouseTrackingWorkerStatus
} from "@/lib/houseTracking";
import {
  formatEuroAmount,
  formatEuroInput,
  normalizeEuroAmount,
  parseEuroAmount,
  sumEuroAmounts
} from "@/lib/currency";
import {
  deleteVendorQuoteWithDecision,
  deleteOrphanAutomaticVendorInvoice,
  isAutomaticVendorInvoice,
  isEmptyAutomaticVendorInvoice,
  isOrphanAutomaticVendorInvoice,
  validateVendorQuoteIdempotently,
  preserveVendorQuoteIdentity,
  findVendorInvoiceDuplicates,
  canSaveVendorInvoice,
  type VendorQuoteDeletionChoice,
  type VendorInvoiceDuplicate,
  getVendorInvoiceRemaining,
  getVendorInvoiceStatus,
  getVendorInvoiceTotalRemaining,
  normalizeVendorInvoiceFinancials,
  normalizeVendorQuoteFinancials
} from "@/lib/vendorFinance";

const STORAGE_KEY = "oneaddress-riviera-crm-v1";
const QUOTES_STORAGE_KEY = "oneaddress-riviera-crm-quotes-v1";
const ACTOR_STORAGE_KEY = "oneaddress-riviera-crm-active-actor-v1";
const SHARED_WORKSPACE_ID = "oneaddress-riviera";
const CRM_DOCUMENTS_BUCKET = "crm-documents";
const leadStatuses: LeadStatus[] = ["Nouveau", "Contacté", "Devis", "Négociation", "Gagné", "Perdu"];
const propertyStatuses: PropertyStatus[] = ["Disponible", "Mandat en cours", "Loué", "Vendu"];
const vehicleStatuses: VehicleStatus[] = ["Disponible", "En location", "En maintenance", "Vendu"];
const boatStatuses: BoatStatus[] = ["Disponible", "En charter", "En maintenance", "Vendu"];

const contactKinds: ContactKind[] = ["Client", "Propriétaire", "Prestataire", "Membre de l’organisation"];
const contactLevels = ["Standard", "VIP", "Ultra VIP"] as const;
const contactLanguages = ["Français", "Anglais", "Italien", "Autre"] as const;
const contactRelationshipStatuses = ["Prospect", "Actif", "Dormant", "Prestataire"] as const;
const supplierCategories = ["Chauffeur", "Chef", "Sécurité", "Conciergerie", "Paysagiste", "Gestion nuisibles", "Pisciniste", "Femme de ménage", "Nounou", "Artisan rénovation", "Technicien volets", "Lavage voiture", "Garage / mécanicien", "Jardinier", "Peinture", "Électricité", "Plomberie", "Autre"] as const;
const crmActors = ["Vincent"] as const;
type CRMActor = typeof crmActors[number] | "";

const emptyData: CRMData = {
  contacts: [],
  leads: [],
  properties: [],
  vehicles: [],
  boats: [],
  tasks: [],
  suppliers: [],
  planningEntries: [],
  quotes: [],
  documents: [],
  vendorQuotes: [],
  vendorInvoices: [],
  houseTrackingHouses: [],
  houseTrackingWorkers: [],
  houseTimeEntries: [],
  housePayments: []
};


function isSupplierContact(contact: Contact) {
  return contact.kind !== "Membre de l’organisation" && (contact.kind === "Prestataire" || Boolean(contact.supplierCategory));
}

function getContactSupplierCategory(contact: Contact) {
  return contact.supplierCategory || "Autre";
}

function getSupplierCategoryFromForm(form: FormData) {
  const customCategory = String(form.get("supplierCategoryCustom") ?? "").trim();
  const selectedCategory = String(form.get("supplierCategory") ?? "").trim();
  return customCategory || selectedCategory;
}

function getContactSupplierZone(contact: Contact) {
  return contact.supplierZone || contact.city || "";
}

function supplierToContact(supplier: Supplier): Contact {
  const supplierName = String(supplier.name || "").trim();
  const contactName = String(supplier.contactName || "").trim();
  const notes = [
    supplier.notes ? supplier.notes : "",
    supplier.priceNotes ? `Prix : ${supplier.priceNotes}` : "",
    supplier.commissionNotes ? `Commission / marge : ${supplier.commissionNotes}` : ""
  ].filter(Boolean).join("\n");

  return {
    id: `contact-${supplier.id}`,
    name: supplierName || contactName || "Prestataire à compléter",
    kind: "Prestataire",
    email: supplier.email || "",
    phone: supplier.phone || "",
    city: supplier.zone || "",
    postalAddress: supplier.zone || "",
    budget: 0,
    source: "Ancien module Prestataires",
    notes,
    clientLevel: "Standard",
    preferredLanguage: "Français",
    relationshipStatus: supplier.status === "Inactif" ? "Dormant" : supplier.status === "À vérifier" ? "Prospect" : "Actif",
    preferences: supplier.category || "",
    importantNotes: supplier.reliability === "À éviter" ? "À éviter" : "",
    supplierCategory: supplier.category || "Autre",
    supplierContactName: contactName,
    supplierZone: supplier.zone || "",
    supplierQuality: supplier.quality || "Standard",
    supplierReliability: supplier.reliability || "À tester",
    supplierPriceNotes: supplier.priceNotes || "",
    supplierCommissionNotes: supplier.commissionNotes || "",
    supplierStatus: supplier.status || "Actif",
    createdAt: String(supplier.createdAt || new Date().toISOString()).slice(0, 10)
  };
}

function mergeContactsWithLegacySuppliers(contacts: Contact[], suppliers: Supplier[]) {
  const merged = [...contacts];
  const existingKeys = new Set(
    merged.map((contact) => [contact.id, contact.name, contact.email, contact.phone].map((value) => String(value || "").trim().toLowerCase()).join("|"))
  );

  suppliers.forEach((supplier) => {
    const contact = supplierToContact(supplier);
    const key = [contact.id, contact.name, contact.email, contact.phone].map((value) => String(value || "").trim().toLowerCase()).join("|");
    const looseDuplicate = merged.some((existing) => {
      const sameName = existing.name && contact.name && existing.name.trim().toLowerCase() === contact.name.trim().toLowerCase();
      const sameEmail = existing.email && contact.email && existing.email.trim().toLowerCase() === contact.email.trim().toLowerCase();
      const samePhone = existing.phone && contact.phone && existing.phone.trim().toLowerCase() === contact.phone.trim().toLowerCase();
      return sameName || sameEmail || samePhone;
    });

    if (!existingKeys.has(key) && !looseDuplicate) {
      merged.push(contact);
      existingKeys.add(key);
    }
  });

  return merged;
}

type CRMDocument = {
  id: string;
  title: string;
  category: "Logo" | "Documents" | "Assurance" | "Contrat" | "Administratif" | "Identité / Kbis" | "Maison" | "Véhicule" | "Bateau" | "Autre";
  status: "À jour" | "À vérifier" | "Expiré";
  url: string;
  storagePath?: string;
  fileName?: string;
  uploadedAt?: string;
  location: string;
  expiryDate: string;
  notes: string;
  addedAt: string;
  addedBy: string;
  updatedAt?: string;
  updatedBy?: string;
  isFolder?: boolean;
  folderId?: string;
  parentFolderId?: string;
  driveFolderId?: string;
  driveParentFolderId?: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  driveWebContentLink?: string;
  mimeType?: string;
  size?: number;
};

function normalizeCRMDocument(value: unknown): CRMDocument | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const category = String(raw.category || "Autre") as CRMDocument["category"];
  const status = String(raw.status || "À jour") as CRMDocument["status"];
  const isFolder = Boolean(raw.isFolder);

  return {
    id: String(raw.id || makeId(isFolder ? "folder" : "doc")),
    title: String(raw.title || (isFolder ? "Dossier" : "Document")),
    category: (
      category === "Logo" ||
      category === "Documents" ||
      category === "Assurance" ||
      category === "Contrat" ||
      category === "Administratif" ||
      category === "Identité / Kbis" ||
      category === "Maison" ||
      category === "Véhicule" ||
      category === "Bateau" ||
      category === "Autre"
    ) ? category : "Autre",
    status: (
      status === "À jour" ||
      status === "À vérifier" ||
      status === "Expiré"
    ) ? status : "À jour",
    url: String(raw.url || ""),
    storagePath: String(raw.storagePath || ""),
    fileName: String(raw.fileName || ""),
    uploadedAt: String(raw.uploadedAt || ""),
    location: String(raw.location || ""),
    expiryDate: String(raw.expiryDate || raw.uploadDate || ""),
    notes: String(raw.notes || ""),
    addedAt: String(raw.addedAt || new Date().toISOString()),
    addedBy: String(raw.addedBy || "À compléter"),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : "",
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : "",
    isFolder,
    folderId: String(raw.folderId || raw.parentFolderId || ""),
    parentFolderId: String(raw.parentFolderId || raw.folderId || ""),
    driveFolderId: String(raw.driveFolderId || ""),
    driveParentFolderId: String(raw.driveParentFolderId || ""),
    driveFileId: String(raw.driveFileId || ""),
    driveWebViewLink: String(raw.driveWebViewLink || raw.webViewLink || ""),
    driveWebContentLink: String(raw.driveWebContentLink || raw.webContentLink || ""),
    mimeType: String(raw.mimeType || ""),
    size: Number(raw.size || 0)
  };
}

function normalizeSharedCRMData(payload: any): CRMData {
  const contacts = Array.isArray(payload?.contacts) ? payload.contacts as Contact[] : [];
  const legacySuppliers = Array.isArray(payload?.suppliers) ? payload.suppliers as Supplier[] : [];

  return {
    contacts: mergeContactsWithLegacySuppliers(contacts, legacySuppliers),
    leads: Array.isArray(payload?.leads) ? payload.leads : [],
    properties: Array.isArray(payload?.properties) ? payload.properties : [],
    vehicles: Array.isArray(payload?.vehicles) ? payload.vehicles : [],
    boats: Array.isArray(payload?.boats) ? payload.boats : [],
    tasks: [], // Canonical Tasks cannot be restored from a workspace snapshot.
    suppliers: [],
    planningEntries: Array.isArray(payload?.planningEntries) ? payload.planningEntries : [],
    quotes: Array.isArray(payload?.quotes)
      ? payload.quotes.map(normalizeQuoteRequest).filter((quote: QuoteRequest | null): quote is QuoteRequest => Boolean(quote))
      : [],
    documents: Array.isArray(payload?.documents)
      ? payload.documents.map(normalizeCRMDocument).filter((document: CRMDocument | null): document is CRMDocument => Boolean(document))
      : [],
    vendorQuotes: Array.isArray(payload?.vendorQuotes)
      ? payload.vendorQuotes.map((quote: VendorQuote) => normalizeVendorQuoteFinancials(quote))
      : [],
    vendorInvoices: Array.isArray(payload?.vendorInvoices)
      ? payload.vendorInvoices.map(normalizeVendorInvoice).filter((invoice: VendorInvoice | null): invoice is VendorInvoice => Boolean(invoice))
      : [],
    houseTrackingHouses: Array.isArray(payload?.houseTrackingHouses)
      ? payload.houseTrackingHouses.map(normalizeHouseTrackingHouse).filter((house: HouseTrackingHouse | null): house is HouseTrackingHouse => Boolean(house))
      : [],
    houseTrackingWorkers: Array.isArray(payload?.houseTrackingWorkers)
      ? payload.houseTrackingWorkers.map(normalizeHouseTrackingWorker).filter((worker: HouseTrackingWorker | null): worker is HouseTrackingWorker => Boolean(worker))
      : [],
    houseTimeEntries: Array.isArray(payload?.houseTimeEntries)
      ? payload.houseTimeEntries.map(normalizeHouseTimeEntry).filter((entry: HouseTimeEntry | null): entry is HouseTimeEntry => Boolean(entry))
      : [],
    housePayments: Array.isArray(payload?.housePayments)
      ? payload.housePayments.map(normalizeHousePayment).filter((payment: HousePayment | null): payment is HousePayment => Boolean(payment))
      : []
  };
}
function crmDataHasContent(value: CRMData) {
  return (
    value.contacts.length > 0 ||
    value.leads.length > 0 ||
    value.properties.length > 0 ||
    value.vehicles.length > 0 ||
    value.boats.length > 0 ||
    value.tasks.length > 0 ||
    (((value as any).suppliers ?? []) as Supplier[]).length > 0 ||
    (((value as any).planningEntries ?? []) as PlanningEntry[]).length > 0 ||
    (((value as any).quotes ?? []) as QuoteRequest[]).length > 0 ||
    (((value as any).documents ?? []) as CRMDocument[]).length > 0 ||
    (((value as any).vendorQuotes ?? []) as VendorQuote[]).length > 0 ||
    (((value as any).vendorInvoices ?? []) as VendorInvoice[]).length > 0 ||
    (((value as any).houseTrackingHouses ?? []) as HouseTrackingHouse[]).length > 0 ||
    (((value as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]).length > 0 ||
    (((value as any).houseTimeEntries ?? []) as HouseTimeEntry[]).length > 0 ||
    (((value as any).housePayments ?? []) as HousePayment[]).length > 0
  );
}

function readLocalCRMDataSafely() {
  if (typeof window === "undefined") return emptyData;

  try {
    const raw = crmCache.getItem(STORAGE_KEY);
    return normalizeSharedCRMData(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyData;
  }
}

type Tab = CRMTab;

type Toast = {
  message: ScreenNotice;
  tone: "success" | "warning";
};

type ActionNotification = {
  id: string;
  title: string;
  detail: string;
  tab: Tab;
  tone: "danger" | "warning" | "info";
  targetId?: string;
};

const currency = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0
});
const houseCurrency = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2
});


function normalizeVendorInvoice(value: unknown): VendorInvoice | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const amount = parseEuroAmount(raw.amount);
  const paidAmount = parseEuroAmount(raw.paidAmount);
  const status = String(raw.status || getVendorInvoiceStatus(amount, paidAmount, String(raw.dueDate || ""))) as VendorInvoice["status"];

  return {
    ...raw,
    id: String(raw.id || makeId("invoice")),
    contactId: String(raw.contactId || ""),
    contactName: String(raw.contactName || ""),
    contactPersonName: String(raw.contactPersonName || ""),
    category: String(raw.category || "Prestataire"),
    title: String(raw.title || "Facture prestataire"),
    ...(raw.invoiceReference !== undefined ? { invoiceReference: String(raw.invoiceReference) } : {}),
    ...(raw.paymentBankAccountId !== undefined ? { paymentBankAccountId: String(raw.paymentBankAccountId) } : {}),
    invoiceDate: String(raw.invoiceDate || ""),
    dueDate: String(raw.dueDate || ""),
    amount: Number.isFinite(amount) ? amount : 0,
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
    sourceQuoteId: String(raw.sourceQuoteId || ""),
    sourceQuoteReference: String(raw.sourceQuoteReference || ""),
    invoiceReceivedAt: String(raw.invoiceReceivedAt || ""),
    linkedDocumentId: String(raw.linkedDocumentId || ""),
    invoiceDocumentUrl: String(raw.invoiceDocumentUrl || raw.documentUrl || raw.url || ""),
    invoiceDocumentStoragePath: String(raw.invoiceDocumentStoragePath || raw.invoiceStoragePath || ""),
    invoiceDocumentName: String(raw.invoiceDocumentName || raw.documentName || ""),
    status: getVendorInvoiceStatusFromValue(status),
    paymentMethod: String(raw.paymentMethod || ""),
    notes: String(raw.notes || ""),
    createdAt: String(raw.createdAt || new Date().toISOString())
  };
}

function getVendorInvoiceStatusFromValue(value: unknown): VendorInvoice["status"] {
  if (
    value === "En attente de facture" ||
    value === "À payer" ||
    value === "Partiellement payé" ||
    value === "Payé" ||
    value === "En retard" ||
    value === "Annulé"
  ) {
    return value;
  }

  return "À payer";
}

function normalizeHouseTrackingHouse(value: unknown): HouseTrackingHouse | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;

  return {
    id: String(raw.id || makeId("house")),
    name: String(raw.name || "Maison à compléter"),
    address: String(raw.address || ""),
    notes: String(raw.notes || ""),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    createdBy: raw.createdBy ? String(raw.createdBy) : undefined,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined
  };
}

function normalizeHouseTrackingWorker(value: unknown): HouseTrackingWorker | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  // Keep existing references until confirmed cleanup; never recreate cleared keys.
  const existingDocumentReferences = Object.fromEntries(Object.entries(raw).filter(([key]) =>
    key.startsWith("document") || ["storagePath", "fileName", "uploadedAt"].includes(key)));
  const hourlyRate = raw.hourlyRate == null || String(raw.hourlyRate).trim() === ""
    ? undefined : Number(String(raw.hourlyRate).replace(",", "."));

  return {
    ...existingDocumentReferences,
    id: String(raw.id || makeId("worker")),
    contactId: String(raw.contactId || ""),
    contactName: String(raw.contactName || "Intervenant à compléter"),
    role: String(raw.role || "Intervenant"),
    hourlyRate: hourlyRate !== undefined && Number.isFinite(hourlyRate) ? hourlyRate : undefined,
    status: raw.status === "Inactif" ? "Inactif" : "Actif",
    notes: String(raw.notes || ""),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    createdBy: raw.createdBy ? String(raw.createdBy) : undefined,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined
  };
}

function normalizeHouseTimeEntry(value: unknown): HouseTimeEntry | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const breakMinutes = Number(raw.breakMinutes || 0);
  const hourlyRate = Number(raw.hourlyRate || 0);

  return {
    id: String(raw.id || makeId("hours")),
    houseId: String(raw.houseId || ""),
    houseName: String(raw.houseName || "Maison"),
    workerId: String(raw.workerId || ""),
    workerName: String(raw.workerName || "Intervenant"),
    date: String(raw.date || new Date().toISOString().slice(0, 10)),
    startTime: String(raw.startTime || ""),
    endTime: String(raw.endTime || ""),
    breakMinutes: Number.isFinite(breakMinutes) ? breakMinutes : 0,
    hourlyRate: Number.isFinite(hourlyRate) ? hourlyRate : 0,
    note: String(raw.note || ""),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    createdBy: raw.createdBy ? String(raw.createdBy) : undefined,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined
  };
}

function normalizeHousePayment(value: unknown): HousePayment | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  const amount = parseEuroAmount(raw.amount);
  const methodValue = String(raw.method || "Virement");
  const method = (methodValue === "Espèces" || methodValue === "CB" || methodValue === "Chèque" || methodValue === "Autre" ? methodValue : "Virement") as HousePayment["method"];

  return {
    id: String(raw.id || makeId("payment")),
    houseId: String(raw.houseId || ""),
    houseName: String(raw.houseName || "Maison"),
    workerId: String(raw.workerId || ""),
    workerName: String(raw.workerName || "Intervenant"),
    date: String(raw.date || new Date().toISOString().slice(0, 10)),
    amount: Number.isFinite(amount) ? amount : 0,
    method,
    note: String(raw.note || ""),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    createdBy: raw.createdBy ? String(raw.createdBy) : undefined,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined
  };
}

function getCurrentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function getMonthFromDate(value?: string) {
  return String(value || "").slice(0, 7);
}

function formatHours(value: number) {
  const totalMinutes = Math.max(Math.round(Number(value || 0) * 60), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, "0")}`;
}


function formatHouseBalanceLabel(balance: number) {
  if (balance > 0) return `${houseCurrency.format(balance)} à payer`;
  if (balance < 0) return `${houseCurrency.format(Math.abs(balance))} d’avance`;
  return "À jour";
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now()}`;
}

function safeNumber(value: FormDataEntryValue | null) {
  return parseEuroAmount(value);
}

type ActionTrackedItem = {
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
  createdAt?: string;
};

function isCRMActor(value: string | null): value is CRMActor {
  return value === "Vincent";
}

function stampCreated<T extends object>(item: T, actor: string): T {
  const now = new Date().toISOString();

  return {
    ...item,
    createdBy: actor,
    updatedBy: actor,
    updatedAt: now
  };
}

function stampUpdated<T extends object>(item: T, actor: string): T {
  return {
    ...item,
    updatedBy: actor,
    updatedAt: new Date().toISOString()
  };
}


// CRM_PLANNING_CALENDAR_READABLE_STEP1_20260622
function getPlanningEntryTimeLabel(entry: any) {
  const start = String(entry?.startTime || entry?.arrivalTime || "").trim();
  const end = String(entry?.endTime || entry?.departureTime || "").trim();

  if (start && end) return `${start}–${end}`;
  if (start) return start;
  if (end) return `jusqu’à ${end}`;
  return "";
}

function getPlanningEntryCalendarTitle(entry: any) {
  const time = getPlanningEntryTimeLabel(entry);
  const contact = String(entry?.contactName || entry?.linkedContact || entry?.workerName || entry?.providerName || "").trim();
  const title = String(entry?.title || entry?.name || "").trim();
  const asset = String(entry?.assetName || entry?.linkedAsset || entry?.houseName || "").trim();

  const main = contact || title || "Intervention";
  const detail = title && contact && title !== contact ? title : asset;

  return [time, main, detail].filter(Boolean).join(" · ");
}

function formatDateTimeFR(value?: string) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getActionMetaLabel(item: ActionTrackedItem) {
  const actor = item.updatedBy || item.createdBy;

  if (!actor) return "Action non attribuée";

  const dateLabel = formatDateTimeFR(item.updatedAt || item.createdAt);
  return dateLabel ? `Dernière action : ${actor} · ${dateLabel}` : `Dernière action : ${actor}`;
}

function ActionMeta({ item }: { item: ActionTrackedItem }) {
  const { screen } = useCRMDisplay();
  return <small className="action-meta">{screen.action(item)}</small>;
}


function contactToSupabaseRow(contact: Contact, userId: string) {
  return {
    id: contact.id,
    user_id: userId,
    name: contact.name,
    first_name: contact.firstName || "",
    civility: contact.civility || "",
    company_name: contact.companyName || "",
    kind: contact.kind || "Client",
    organization_function: contact.organizationFunction || "",
    client_level: contact.clientLevel || "Standard",
    preferred_language: contact.preferredLanguage || "Français",
    relationship_status: contact.relationshipStatus || "Prospect",
    email: contact.email || "",
    phone: contact.phone || "",
    city: contact.city || "",
    postal_address: contact.postalAddress || "",
    budget: contact.budget || 0,
    source: contact.source || "",
    preferences: contact.preferences || "",
    important_notes: contact.importantNotes || "",
    notes: contact.notes || "",
    updated_at: new Date().toISOString()
  };
}

function contactFromSupabaseRow(row: any): Contact {
  return {
    id: String(row.id || makeId("contact")),
    name: String(row.name || ""),
    firstName: String(row.first_name || ""),
    civility: String(row.civility || "") as Contact["civility"],
    companyName: String(row.company_name || ""),
    kind: (() => { const rawKind = String(row.kind || "Client"); return rawKind === "Membre de l’organisation" ? rawKind : rawKind === "Partenaire" || rawKind === "Prestataire" ? "Prestataire" : rawKind === "Propriétaire" ? "Propriétaire" : "Client"; })() as ContactKind,
    organizationFunction: String(row.organization_function || ""),
    clientLevel: String(row.client_level || "Standard") as Contact["clientLevel"],
    preferredLanguage: String(row.preferred_language || "Français") as Contact["preferredLanguage"],
    relationshipStatus: String(row.relationship_status || "Prospect") as Contact["relationshipStatus"],
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    city: String(row.city || ""),
    postalAddress: String(row.postal_address || ""),
    budget: Number(row.budget || 0),
    source: String(row.source || ""),
    preferences: String(row.preferences || ""),
    importantNotes: String(row.important_notes || ""),
    notes: String(row.notes || ""),
    createdAt: String(row.created_at || new Date().toISOString()).slice(0, 10)
  };
}



function isOpenLead(lead: Lead) {
  return lead.status !== "Gagné" && lead.status !== "Perdu";
}

function getDueStatus(value?: string) {
  if (!value) return "none";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const date = new Date(`${value}T00:00:00`);
  date.setHours(0, 0, 0, 0);

  if (date.getTime() < today.getTime()) return "overdue";
  if (date.getTime() === today.getTime()) return "today";

  return "future";
}

function getDueLabel(value?: string) {
  const status = getDueStatus(value);

  if (!value) return "Date non renseignée";
  if (status === "overdue") return `En retard · ${formatDateFR(value)}`;
  if (status === "today") return `Aujourd'hui · ${formatDateFR(value)}`;

  return `Date ${formatDateFR(value)}`;
}

function priorityWeight(priority?: string) {
  if (priority === "Haute") return 0;
  if (priority === "Moyenne") return 1;
  return 2;
}

function sortByUrgency<T extends { dueDate: string; priority?: string; value?: number }>(items: T[]) {
  return [...items].sort((a, b) => {
    const statusA = getDueStatus(a.dueDate);
    const statusB = getDueStatus(b.dueDate);

    const statusWeight = {
      overdue: 0,
      today: 1,
      future: 2,
      none: 3
    };

    const statusDiff = statusWeight[statusA] - statusWeight[statusB];
    if (statusDiff !== 0) return statusDiff;

    const dateA = a.dueDate ? new Date(`${a.dueDate}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
    const dateB = b.dueDate ? new Date(`${b.dueDate}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;

    if (dateA !== dateB) return dateA - dateB;

    const priorityDiff = priorityWeight(a.priority) - priorityWeight(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    

  return (b.value ?? 0) - (a.value ?? 0);
  });
}

function formatDateFR(value?: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatReservationPeriod(start?: string, end?: string) {
  if (start && end) return `Réservation du ${formatDateFR(start)} au ${formatDateFR(end)}`;
  if (start) return `Réservation à partir du ${formatDateFR(start)}`;
  if (end) return `Réservation jusqu'au ${formatDateFR(end)}`;
  return "Dates de réservation non renseignées";
}


function getContactClientLevel(contact: Contact) {
  return contact.clientLevel || "Standard";
}

function getContactPreferredLanguage(contact: Contact) {
  return contact.preferredLanguage || "Français";
}

function getContactRelationshipStatus(contact: Contact) {
  return contact.relationshipStatus || "Prospect";
}



function csvEscape(value: unknown) {
  const stringValue = String(value ?? "");
  const escaped = stringValue.replace(/"/g, '""');

  if (escaped.includes(",") || escaped.includes("\n") || escaped.includes('"')) {
    return `"${escaped}"`;
  }

  return escaped;
}

function toCsv(headers: string[], rows: unknown[][]) {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ].join("\n");
}

function downloadTextFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

function exportCRMAsCsv(data: CRMData) {
  const sections = [
    {
      title: "CONTACTS",
      headers: ["Nom", "Type", "Niveau client", "Langue", "Relation", "Email", "Téléphone", "Ville", "Adresse postale", "Budget", "Source", "Préférences", "Notes importantes", "Notes", "Fonction"],
      rows: data.contacts.map((contact) => [
        contact.entityType === "company" ? getContactLabel(contact) : contact.name,
        contact.kind,
        getContactClientLevel(contact),
        getContactPreferredLanguage(contact),
        getContactRelationshipStatus(contact),
        contact.email,
        contact.phone,
        contact.city,
        contact.postalAddress,
        contact.budget,
        contact.source,
        contact.preferences ?? "",
        contact.importantNotes ?? "",
        contact.notes,
        contact.organizationFunction ?? ""
      ])
    },
    {
      title: "LEADS",
      headers: ["Catégorie", "Contact", "Statut", "Valeur", "Priorité", "Date réponse", "Début réservation", "Fin réservation", "Prochaine action", "Notes"],
      rows: data.leads.map((lead) => [
        lead.category,
        lead.contactName,
        lead.status,
        lead.value,
        lead.priority,
        lead.dueDate,
        lead.rentalStartDate,
        lead.rentalEndDate,
        lead.nextAction,
        lead.notes ?? ""
      ])
    },
    {
      title: "BIENS",
      headers: ["Nom", "Ville", "Type", "Prix", "Statut", "Propriétaire", "Chambres", "Surface"],
      rows: data.properties.map((property) => [
        (property as { name?: string; title?: string }).name ?? (property as { name?: string; title?: string }).title ?? "",
        property.city,
        "type" in property ? property.type : "",
        property.price,
        property.status,
        property.owner,
        property.bedrooms,
        property.surface
      ])
    },
    {
      title: "VOITURES",
      headers: ["Nom", "Marque", "Modèle", "Ville", "Prix / jour", "Statut", "Propriétaire", "Année", "Kilométrage"],
      rows: (data.vehicles ?? []).map((vehicle) => [
        vehicle.name,
        vehicle.brand,
        vehicle.model,
        vehicle.city,
        vehicle.price,
        vehicle.status,
        vehicle.owner,
        vehicle.year,
        vehicle.mileage
      ])
    },
    {
      title: "BATEAUX",
      headers: ["Nom", "Port", "Type", "Prix / jour", "Statut", "Propriétaire", "Année", "Longueur"],
      rows: (data.boats ?? []).map((boat) => [
        boat.name,
        boat.port,
        boat.type,
        boat.price,
        boat.status,
        boat.owner,
        boat.year,
        boat.length
      ])
    },
    {
      title: "TÂCHES",
      headers: ["ID", "Titre", "Responsables", "Statut", "Date limite", "Priorité", "Notes", "Créée par", "Compte créateur", "Créée le", "Terminée le", "Lead lié", "Contact lié", "Gestionnaire de reprise", "Compte gestionnaire"],
      rows: data.tasks.map((task) => [
        task.id,
        task.title,
        task.owner,
        task.status,
        task.dueDate,
        task.priority || "normal",
        task.notes || "",
        task.createdByLabel || "",
        task.createdBy || "",
        task.createdAt || "",
        task.completedAt || "",
        effectiveTaskLeadId(task),
        task.contactId || "",
        task.managerLabel || "",
        task.managerId || ""
      ])
    },
    {
      title: "PLANNING",
      headers: ["Titre", "Planning", "Type", "Contact", "Actif", "Date début", "Heure arrivée", "Date fin", "Heure départ", "Bloque disponibilité", "Notes"],
      rows: ((data as any).planningEntries ?? []).map((entry: PlanningEntry) => [
        entry.title,
        entry.planningCategory || "Villa",
        entry.type,
        entry.contactName,
        entry.assetId || "",
        entry.startDate,
        entry.startTime || "",
        entry.endDate,
        entry.endTime || "",
        entry.blocksAvailability ? "Oui" : "Non",
        entry.notes ?? ""
      ])
    }
  ];

  const content = sections
    .map((section) => [
      section.title,
      toCsv(section.headers, section.rows)
    ].join("\n"))
    .join("\n\n");

  const date = new Date().toISOString().slice(0, 10);
  downloadTextFile(`oneaddress-riviera-crm-${date}.csv`, content, "text/csv;charset=utf-8");
}



function parseAssetKey(value: FormDataEntryValue | null): {
  assetType: "" | "Property" | "Vehicle" | "Boat";
  assetId: string;
} {
  const rawValue = String(value ?? "");

  if (!rawValue.includes(":")) {
    return { assetType: "", assetId: "" };
  }

  const [rawAssetType, assetId = ""] = rawValue.split(":");

  if (rawAssetType === "Property") {
    return { assetType: "Property", assetId };
  }

  if (rawAssetType === "Vehicle") {
    return { assetType: "Vehicle", assetId };
  }

  if (rawAssetType === "Boat") {
    return { assetType: "Boat", assetId };
  }

  return { assetType: "", assetId: "" };
}

function getPropertyDisplayName(property: Property) {
  const flexibleProperty = property as Property & { name?: string; title?: string };
  return flexibleProperty.name ?? flexibleProperty.title ?? "Bien sans nom";
}

type QuoteBillingUnit = "day" | "week" | "fixed";

type QuoteLine = {
  id: string;
  category: string;
  description: string;
  unitPrice: number;
  billingUnit: QuoteBillingUnit;
  deposit: number;
};

type QuoteStatus = "Draft" | "Sent" | "Negotiation" | "Accepted" | "Declined";

type QuoteRequest = {
  id: string;
  leadId?: string;
  clientName: string;
  title: string;
  location: string;
  guestCount: string;
  categories: string[];
  items?: QuoteLine[];
  startDate: string;
  endDate: string;
  unitPrice: number;
  supplierCost?: number;
  depositReceived?: number;
  balanceReceived?: number;
  paymentNotes?: string;
  paymentStatus?: "Non payé" | "Acompte reçu" | "Partiel" | "Payé" | "Annulé / remboursé";
  expectedDeposit?: number;
  paymentDueDate?: string;
  bookingStatus?: "À préparer" | "Prestataire à confirmer" | "Confirmé" | "En cours" | "Terminé" | "Annulé";
  clientConfirmed?: boolean;
  depositConfirmed?: boolean;
  supplierConfirmed?: boolean;
  balanceConfirmed?: boolean;
  detailsSent?: boolean;
  serviceCompleted?: boolean;
  operationNotes?: string;
  assignedContactId?: string;
  validityDate: string;
  paymentTerms: string;
  cancellationTerms: string;
  included: string;
  excluded: string;
  notes: string;
  status: QuoteStatus;
  statusUpdatedAt?: string;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

type QuoteLeadDraft = {
  key: string;
  leadId?: string;
  quoteId?: string;
  clientName: string;
  category: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  unitPrice: number;
  notes: string;
};


const quoteStatuses: QuoteStatus[] = ["Draft", "Sent", "Negotiation", "Accepted", "Declined"];

function getQuoteStatus(value: unknown): QuoteStatus {
  if (value === "Sent" || value === "Negotiation" || value === "Accepted" || value === "Declined" || value === "Draft") {
    return value;
  }

  return "Draft";
}

function getQuoteStatusLabel(status: QuoteStatus) {
  const labels: Record<QuoteStatus, string> = {
    Draft: "Draft",
    Sent: "Sent",
    Negotiation: "Negotiation",
    Accepted: "Accepted",
    Declined: "Declined"
  };

  return labels[status];
}

function getQuoteStatusFrenchLabel(status: QuoteStatus) {
  const labels: Record<QuoteStatus, string> = {
    Draft: "Brouillon",
    Sent: "Envoyé",
    Negotiation: "Négociation",
    Accepted: "Gagné",
    Declined: "Perdu"
  };

  return labels[status];
}



function getLeadStatusFromQuoteStatus(status: QuoteStatus): LeadStatus {
  if (status === "Draft") return "Nouveau";
  if (status === "Sent") return "Contacté";
  if (status === "Negotiation") return "Négociation";
  if (status === "Accepted") return "Gagné";
  if (status === "Declined") return "Perdu";

  return "Nouveau";
}

function createQuoteId() {
  return `quote-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function escapeQuoteHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatQuoteText(value: string) {
  return escapeQuoteHtml(value).replace(/\n/g, "<br />");
}

function readQuoteNumber(value: FormDataEntryValue | null) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatQuoteDate(value: string) {
  if (!value) return "Not specified";

  const parsedDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsedDate);
}

function formatQuoteLongDate(value: string) {
  if (!value) return "Not specified";

  const parsedDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(parsedDate);
}

function formatQuotePrice(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

function getQuoteBillingUnit(value: unknown): QuoteBillingUnit {
  if (value === "week") return "week";
  if (value === "fixed") return "fixed";
  return "day";
}

function getQuoteUnitLabel(unit: QuoteBillingUnit) {
  if (unit === "week") return "week";
  if (unit === "fixed") return "fixed fee";
  return "day";
}

function getQuoteCategoryLabel(category: string) {
  const labels: Record<string, string> = {
    Villa: "Villa",
    Bateau: "Yacht",
    Voiture: "Car",
    Conciergerie: "Concierge services",
    Yacht: "Yacht",
    Car: "Car",
    "Concierge services": "Concierge services"
  };

  return labels[category] ?? category;
}

function getQuoteCategoryFrenchLabel(category: string) {
  const labels: Record<string, string> = {
    Villa: "Villa",
    Bateau: "Bateau",
    Voiture: "Voiture",
    Conciergerie: "Conciergerie",
    Yacht: "Bateau",
    Car: "Voiture",
    "Concierge services": "Conciergerie"
  };

  return labels[category] ?? category;
}

function getQuoteUnitShortLabel(unit: QuoteBillingUnit) {
  if (unit === "week") return "/ week";
  if (unit === "fixed") return "fixed fee";
  return "/ day";
}

function getQuoteDurationDays(quote: QuoteRequest) {
  if (!quote.startDate || !quote.endDate) return 1;

  const start = new Date(`${quote.startDate}T00:00:00`);
  const end = new Date(`${quote.endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;

  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
  return Math.max(diff, 1);
}

function getQuoteBillingQuantity(quote: QuoteRequest, unit: QuoteBillingUnit) {
  const days = getQuoteDurationDays(quote);

  if (unit === "week") return Math.max(Math.ceil(days / 7), 1);
  if (unit === "fixed") return 1;

  return days;
}

function getQuoteQuantityLabel(quote: QuoteRequest, unit: QuoteBillingUnit) {
  const quantity = getQuoteBillingQuantity(quote, unit);
  const label = getQuoteUnitLabel(unit);

  if (unit === "fixed") return "1 fixed fee";

  return `${quantity} ${label}${quantity > 1 ? "s" : ""}`;
}

function getQuoteItems(quote: QuoteRequest): QuoteLine[] {
  if (Array.isArray(quote.items) && quote.items.length > 0) {
    return quote.items
      .map((item) => ({
        id: String(item.id ?? createQuoteId()),
        category: String(item.category ?? "").trim(),
        description: String(item.description ?? "").trim(),
        unitPrice: Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : 0,
        billingUnit: getQuoteBillingUnit(item.billingUnit),
        deposit: Number.isFinite(Number(item.deposit)) ? Number(item.deposit) : 0
      }))
      .filter((item) => item.category);
  }

  return (Array.isArray(quote.categories) ? quote.categories : []).map((category) => ({
    id: category,
    category,
    description: "",
    unitPrice: Number.isFinite(quote.unitPrice) ? quote.unitPrice : 0,
    billingUnit: "day",
    deposit: 0
  }));
}

function getQuoteLineSubtotal(quote: QuoteRequest, item: QuoteLine) {
  return item.unitPrice * getQuoteBillingQuantity(quote, item.billingUnit);
}

function getQuoteSubtotal(quote: QuoteRequest) {
  return getQuoteItems(quote).reduce((sum, item) => sum + getQuoteLineSubtotal(quote, item), 0);
}

function getQuoteDepositTotal(quote: QuoteRequest) {
  return getQuoteItems(quote).reduce((sum, item) => sum + item.deposit, 0);
}

function getQuoteTotal(quote: QuoteRequest) {
  return getQuoteSubtotal(quote);
}

function openQuotePdf(quote: QuoteRequest) {
  const popup = window.open("", "_blank", "width=900,height=1100");

  if (!popup) {
    window.alert("Unable to open the quote. Please allow pop-ups for this site.");
    return;
  }

  const quoteItems = getQuoteItems(quote);
  const categories = quoteItems.length ? quoteItems.map((item) => getQuoteCategoryLabel(item.category)).join(", ") : "Non renseigné";
  const durationDays = getQuoteDurationDays(quote);
  const subtotal = getQuoteSubtotal(quote);
  const depositTotal = getQuoteDepositTotal(quote);
  const quoteReference = quote.id.replace("quote-", "DEV-").toUpperCase();

  const issuedAt = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date());

  const linesHtml = quoteItems.length
    ? quoteItems.map((item) => `
      <tr>
        <td>
          <strong>${escapeQuoteHtml(getQuoteCategoryLabel(item.category))}</strong>
          ${item.description ? `<br /><small>${escapeQuoteHtml(item.description)}</small>` : ""}
        </td>
        <td>${formatQuotePrice(item.unitPrice)} ${escapeQuoteHtml(getQuoteUnitShortLabel(item.billingUnit))}</td>
        <td>${escapeQuoteHtml(getQuoteQuantityLabel(quote, item.billingUnit))}</td>
        <td>${formatQuotePrice(getQuoteLineSubtotal(quote, item))}</td>
        <td>${item.deposit > 0 ? formatQuotePrice(item.deposit) : "—"}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">Aucune prestation renseignée</td></tr>`;

  const includedHtml = quote.included
    ? `<section class="notes-block"><h2>Included</h2><p>${formatQuoteText(quote.included)}</p></section>`
    : "";

  const excludedHtml = quote.excluded
    ? `<section class="notes-block"><h2>Not included</h2><p>${formatQuoteText(quote.excluded)}</p></section>`
    : "";

  const notesHtml = quote.notes
    ? `<section class="notes-block"><h2>Notes</h2><p>${formatQuoteText(quote.notes)}</p></section>`
    : "";

  popup.document.open();
  popup.document.write(addQuoteDownloadToolbar(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeQuoteHtml(quoteReference)} · One Address Riviera</title>
  <style>
    body {
      margin: 0;
      padding: 42px;
      background: #f7f4ed;
      color: #011d30;
      font-family: Arial, sans-serif;
    }

    .page {
      max-width: 860px;
      margin: 0 auto;
      background: #fffaf1;
      border: 1px solid #d8c7a6;
      padding: 46px;
    }

    .top {
      display: flex;
      justify-content: space-between;
      gap: 28px;
      border-bottom: 1px solid #d8c7a6;
      padding-bottom: 28px;
      margin-bottom: 34px;
    }

    .brand {
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: #a9813f;
      font-weight: 800;
      font-size: 12px;
      margin-bottom: 12px;
    }

    h1 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 46px;
      font-weight: 400;
      line-height: 1;
    }

    .meta {
      text-align: right;
      color: #68706d;
      font-size: 13px;
      line-height: 1.7;
    }

    .intro {
      margin: 0 0 30px;
      color: #68706d;
      line-height: 1.7;
    }

    .client-name {
      color: #011d30;
      font-weight: 800;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 24px;
    }

    th {
      text-align: left;
      color: #a9813f;
      letter-spacing: 0.13em;
      text-transform: uppercase;
      font-size: 10px;
      padding: 14px 0;
      border-bottom: 1px solid rgba(216, 199, 166, 0.75);
      vertical-align: top;
    }

    td {
      padding: 14px 0;
      border-bottom: 1px solid rgba(216, 199, 166, 0.55);
      vertical-align: top;
      line-height: 1.5;
    }

    td small {
      color: #68706d;
    }

    .section-title {
      margin: 34px 0 0;
      color: #a9813f;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-size: 11px;
    }

    .total-card {
      margin-top: 34px;
      padding: 26px;
      border: 1px solid #d8c7a6;
      background: rgba(169, 129, 63, 0.08);
      text-align: right;
    }

    .total-card span {
      display: block;
      color: #a9813f;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 8px;
    }

    .total-card strong {
      display: block;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 34px;
      font-weight: 400;
    }

    .total-card small {
      display: block;
      margin-top: 12px;
      color: #68706d;
      line-height: 1.5;
    }

    .notes-block {
      margin-top: 28px;
      padding-top: 22px;
      border-top: 1px solid #d8c7a6;
    }

    .notes-block h2 {
      margin: 0 0 10px;
      color: #a9813f;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-size: 11px;
    }

    .notes-block p {
      margin: 0;
      color: #68706d;
      line-height: 1.7;
    }

    .footer {
      margin-top: 48px;
      display: flex;
      justify-content: space-between;
      gap: 22px;
      color: #a9813f;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-size: 10px;
      font-weight: 800;
      border-top: 1px solid #d8c7a6;
      padding-top: 22px;
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }

      .page {
        border: 0;
      }
    }
  </style>
</head>

<body>
  <main class="page">
    <header class="top">
      <div>
        <div class="brand">One Address Riviera</div>
        <h1>Quote</h1>
      </div>

      <div class="meta">
        <div>${escapeQuoteHtml(quoteReference)}</div>
        <div>${escapeQuoteHtml(issuedAt)}</div>
      </div>
    </header>

    <p class="intro">
      Quote prepared for <span class="client-name">${escapeQuoteHtml(quote.clientName)}</span>.
      ${quote.title ? `<br />${escapeQuoteHtml(quote.title)}` : ""}
    </p>

    <table>
      <tr><th>Client</th><td>${escapeQuoteHtml(quote.clientName)}</td></tr>
      <tr><th>Location</th><td>${escapeQuoteHtml(quote.location || "Not specified")}</td></tr>
      <tr><th>Guests</th><td>${escapeQuoteHtml(quote.guestCount || "Not specified")}</td></tr>
      <tr><th>Service(s)</th><td>${escapeQuoteHtml(categories)}</td></tr>
      <tr><th>Requested dates</th><td>From ${formatQuoteDate(quote.startDate)} to ${formatQuoteDate(quote.endDate)}</td></tr>
      <tr><th>Actual duration</th><td>${durationDays} day${durationDays > 1 ? "s" : ""}</td></tr>
      <tr><th>Quote validity</th><td>${quote.validityDate ? formatQuoteLongDate(quote.validityDate) : "To be confirmed"}</td></tr>
    </table>

    <h2 class="section-title">Service details</h2>

    <table>
      <thead>
        <tr>
          <th>Service</th>
          <th>Price</th>
          <th>Quantity</th>
          <th>Subtotal</th>
          <th>Security deposit</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml}
      </tbody>
    </table>

    <section class="total-card">
      <span>Services total</span>
      <strong>${formatQuotePrice(subtotal)}</strong>
      <small>
        Total security deposit to be expected: ${depositTotal > 0 ? formatQuotePrice(depositTotal) : "no security deposit specified"}.
        Security deposits are shown separately and are not included in the service total.
      </small>
    </section>

    ${includedHtml}
    ${excludedHtml}

    <section class="notes-block">
      <h2>Payment terms</h2>
      <p>${formatQuoteText(quote.paymentTerms || "Deposit due upon confirmation, balance due before the beginning of the service.")}</p>
    </section>

    <section class="notes-block">
      <h2>Cancellation terms</h2>
      <p>${formatQuoteText(quote.cancellationTerms || "Terms to be confirmed according to availability, season and service providers.")}</p>
    </section>

    ${notesHtml}

    <footer class="footer">
      <span>Private Riviera Experiences</span>
      <span>contact@oneaddressriviera.com</span>
    </footer>
  

</main>

  <script>
    window.onload = () => {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`));
  popup.document.close();
}


function normalizeQuoteRequest(value: unknown): QuoteRequest | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;

  return {
    ...raw,
    id: String(raw.id || createQuoteId()),
    leadId: raw.leadId ? String(raw.leadId) : undefined,
    clientName: String(raw.clientName || ""),
    categories: Array.isArray(raw.categories) ? raw.categories.map(String) : [],
    startDate: String(raw.startDate || ""),
    endDate: String(raw.endDate || ""),
    unitPrice: Number.isFinite(Number(raw.unitPrice)) ? Number(raw.unitPrice) : 0,
    notes: String(raw.notes || ""),
    status: getQuoteStatus(raw.status),
    statusUpdatedAt: String(raw.statusUpdatedAt || raw.createdAt || new Date().toISOString()),
    paymentStatus: String(raw.paymentStatus || "Non payé") as QuoteRequest["paymentStatus"],
    expectedDeposit: Number(raw.expectedDeposit || 0),
    paymentDueDate: String(raw.paymentDueDate || ""),
    bookingStatus: String(raw.bookingStatus || "À préparer") as QuoteRequest["bookingStatus"],
    clientConfirmed: Boolean(raw.clientConfirmed),
    depositConfirmed: Boolean(raw.depositConfirmed),
    supplierConfirmed: Boolean(raw.supplierConfirmed),
    balanceConfirmed: Boolean(raw.balanceConfirmed),
    detailsSent: Boolean(raw.detailsSent),
    serviceCompleted: Boolean(raw.serviceCompleted),
    operationNotes: String(raw.operationNotes || ""),
    assignedContactId: String(raw.assignedContactId || ""),
    createdBy: raw.createdBy ? String(raw.createdBy) : undefined,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    createdAt: String(raw.createdAt || new Date().toISOString())
  } as QuoteRequest;
}


function mergeQuoteRequests(sharedQuotes: QuoteRequest[], localQuotes: QuoteRequest[]) {
  const byId = new Map<string, QuoteRequest>();

  sharedQuotes.forEach((quote) => byId.set(quote.id, quote));
  localQuotes.forEach((quote) => byId.set(quote.id, quote));

  return Array.from(byId.values()).sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function loadSavedQuotes() {
  if (typeof window === "undefined") return [] as QuoteRequest[];

  try {
    const raw = crmCache.getItem(QUOTES_STORAGE_KEY);
    if (!raw) return [] as QuoteRequest[];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as QuoteRequest[];

    return parsed
      .map(normalizeQuoteRequest)
      .filter((quote): quote is QuoteRequest => Boolean(quote));
  } catch {
    return [] as QuoteRequest[];
  }
}

function saveQuotesToBrowser(quotes: QuoteRequest[]) {
  if (typeof window === "undefined") return;

  crmCache.setItem(QUOTES_STORAGE_KEY, JSON.stringify(quotes));
}




function getQuoteCategoryFromLead(lead: Lead) {
  if (lead.assetType === "Boat") return "Bateau";
  if (lead.assetType === "Vehicle") return "Voiture";

  return lead.category || "Villa";
}

function createDraftQuoteFromLead(lead: Lead): QuoteRequest {
  const category = getQuoteCategoryFromLead(lead);
  const value = Number(lead.value || 0);
  const title = `${category} · ${lead.contactName}`;

  return {
    id: createQuoteId(),
    leadId: lead.id,
    clientName: lead.contactName,
    title,
    location: "",
    guestCount: "",
    categories: [category],
    items: [
      {
        id: createQuoteId(),
        category,
        description: title,
        unitPrice: value,
        billingUnit: "fixed",
        deposit: 0
      }
    ],
    startDate: lead.rentalStartDate || "",
    endDate: lead.rentalEndDate || "",
    unitPrice: value,
    validityDate: "",
    paymentTerms: "",
    cancellationTerms: "",
    included: "",
    excluded: "",
    notes: lead.notes || "",
    status: "Draft",
    createdAt: new Date().toISOString()
  };
}

function addQuoteDownloadToolbar(html: string) {
  const toolbar = `
    <style>
      .quote-actions-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 99999;
        display: flex;
        justify-content: center;
        gap: 12px;
        padding: 14px 18px;
        background: #071f27;
        border-bottom: 1px solid rgba(201, 161, 86, 0.35);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
      }

      .quote-actions-bar button {
        appearance: none;
        border: 1px solid #c9a156;
        background: transparent;
        color: #f7f1e8;
        padding: 12px 18px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .quote-actions-bar button:first-child {
        background: #c9a156;
        color: #071f27;
      }

      body {
        padding-top: 72px;
      }

      @media print {
        .quote-actions-bar {
          display: none !important;
        }

        body {
          padding-top: 0 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    </style>

    <div class="quote-actions-bar">
      <button type="button" onclick="window.print()">Télécharger / imprimer le devis</button>
      <button type="button" onclick="window.close()">Fermer</button>
    </div>
  `;

  if (html.includes("quote-actions-bar")) return html;

  if (html.includes("<body")) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${toolbar}`);
  }

  return toolbar + html;
}

const quoteCategories = ["Villa", "Bateau", "Voiture", "Conciergerie"];

function writeQuoteFormFields(quote: QuoteRequest) {
  const foundForm = document.querySelector<HTMLFormElement>('form[data-quote-form="true"]');

  if (foundForm === null) {
    return false;
  }

  const quoteForm: HTMLFormElement = foundForm;

  quoteForm.reset();

  function setField(name: string, value: string | number | undefined) {
    const field = quoteForm.elements.namedItem(name);

    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    ) {
      field.value = String(value ?? "");
    }
  }

  setField("leadId", quote.leadId || "");
  setField("clientName", quote.clientName);
  setField("title", quote.title);
  setField("location", quote.location);
  setField("guestCount", quote.guestCount);
  setField("startDate", quote.startDate);
  setField("endDate", quote.endDate);
  setField("validityDate", quote.validityDate);
  setField("included", quote.included);
  setField("excluded", quote.excluded);
  setField("paymentTerms", quote.paymentTerms);
  setField("cancellationTerms", quote.cancellationTerms);
  setField("notes", quote.notes);
  setField("status", getQuoteStatus(quote.status));

  const quoteItems = getQuoteItems(quote);

  quoteForm.querySelectorAll<HTMLInputElement>('input[name="categories"]').forEach((checkbox) => {
    const item = quoteItems.find((quoteItem) => quoteItem.category === checkbox.value);
    checkbox.checked = Boolean(item);

    if (item) {
      setField(`description${item.category}`, item.description);
      setField(`price${item.category}`, item.unitPrice);
      setField(`unit${item.category}`, item.billingUnit);
      setField(`deposit${item.category}`, item.deposit);
    }
  });

  window.setTimeout(() => {
    quoteForm.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 80);
  return true;
}

function QuotesView({
  contacts,
  prefilledLead,
  quotes,
  activeActor,
  onChange,
  onQuoteChange
}: {
  contacts: Contact[];
  prefilledLead?: QuoteLeadDraft | null;
  quotes: QuoteRequest[];
  activeActor: string;
  onChange: (quotes: QuoteRequest[]) => FormSave;
  onQuoteChange?: (quote: QuoteRequest) => void;
}) {
  const { t, label, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const confirmation = useConfirmedForm(business?.markDirty);
  function setQuotes(update: QuoteRequest[] | ((current: QuoteRequest[]) => QuoteRequest[])) {
    const nextQuotes = typeof update === "function" ? update(quotes) : update;

    const result = onChange(nextQuotes);
    if (!business) saveQuotesToBrowser(nextQuotes);
    return result;
  }

  function updateQuoteStatus(id: string, status: QuoteStatus) {
    const currentQuote = quotes.find((quote) => quote.id === id);
    const updatedQuote = currentQuote
      ? stampUpdated({
          ...currentQuote,
          status,
          statusUpdatedAt: currentQuote.status === status
            ? currentQuote.statusUpdatedAt || currentQuote.createdAt
            : new Date().toISOString()
        }, activeActor) as QuoteRequest
      : null;

    setQuotes((current) =>
      current.map((quote) => (quote.id === id && updatedQuote ? updatedQuote : quote))
    );

    if (updatedQuote) {
      onQuoteChange?.(updatedQuote);
    }
  }

  const [prefill, setPrefill] = useState(() => ({
    lead: prefilledLead,
    quote: quotes.find(quote => quote.id === prefilledLead?.quoteId)
  }));
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(prefill.quote?.id || null);
  if (prefill.lead !== prefilledLead) {
    const quote = quotes.find(item => item.id === prefilledLead?.quoteId);
    setPrefill({ lead: prefilledLead, quote });
    if (prefilledLead) setEditingQuoteId(quote?.id || null);
  }
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "Tous">("Tous");

  // Synchronize the form only for a new, snapshotted prefill request.
  useEffect(() => {
    const prefilledLead = prefill.lead;
    if (!prefilledLead) return;

    const foundForm = document.querySelector<HTMLFormElement>('form[data-quote-form="true"]');

    if (foundForm === null) {
      return;
    }

    const quoteForm: HTMLFormElement = foundForm;

    if (prefill.quote) {
      writeQuoteFormFields(prefill.quote);
      return;
    }

    quoteForm.reset();

    function setField(name: string, value: string | number | undefined) {
      const field = quoteForm.elements.namedItem(name);

      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.value = String(value ?? "");
      }
    }

    const selectedCategory = quoteCategories.includes(prefilledLead.category)
      ? prefilledLead.category
      : "Villa";

    setField("leadId", prefilledLead.leadId || "");
    setField("clientName", prefilledLead.clientName);
    setField("title", prefilledLead.title);
    setField("location", prefilledLead.location);
    setField("startDate", prefilledLead.startDate);
    setField("endDate", prefilledLead.endDate);
    setField("notes", prefilledLead.notes);
    setField("status", "Draft");

    quoteForm.querySelectorAll<HTMLInputElement>('input[name="categories"]').forEach((checkbox) => {
      checkbox.checked = checkbox.value === selectedCategory;
    });

    setField(`description${selectedCategory}`, prefilledLead.title);
    setField(`price${selectedCategory}`, prefilledLead.unitPrice);
    setField(`unit${selectedCategory}`, "day");

    window.setTimeout(() => {
      quoteForm.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 80);
  }, [prefill]);

  function fillQuoteForm(quote: QuoteRequest) {
    confirmation.changed();
    if (writeQuoteFormFields(quote)) setEditingQuoteId(quote.id);
  }

  function addQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const selectedCategories = form.getAll("categories").map(String);
    const clientName = String(form.get("clientName") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const location = String(form.get("location") ?? "").trim();
    const guestCount = String(form.get("guestCount") ?? "").trim();
    const startDate = String(form.get("startDate") ?? "");
    const endDate = String(form.get("endDate") ?? "");
    const validityDate = String(form.get("validityDate") ?? "");
    const paymentTerms = String(form.get("paymentTerms") ?? "").trim();
    const cancellationTerms = String(form.get("cancellationTerms") ?? "").trim();
    const included = String(form.get("included") ?? "").trim();
    const excluded = String(form.get("excluded") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const status = getQuoteStatus(form.get("status"));
    const leadId = String(form.get("leadId") ?? "").trim();

    const quoteItems: QuoteLine[] = selectedCategories.map((category) => ({
      id: createQuoteId(),
      category,
      description: String(form.get(`description${category}`) ?? "").trim(),
      unitPrice: readQuoteNumber(form.get(`price${category}`)),
      billingUnit: getQuoteBillingUnit(form.get(`unit${category}`)),
      deposit: readQuoteNumber(form.get(`deposit${category}`))
    }));

    const unitPrice = quoteItems.reduce((sum, item) => sum + item.unitPrice, 0);
    const previousQuote = editingQuoteId ? quotes.find((item) => item.id === editingQuoteId) : undefined;

    if (!clientName && (!business || business.read("contacts") || !editingQuoteId)) {
      window.alert(dialogT("crm.quotes.6ba4d09b21"));
      return;
    }

    if (selectedCategories.length === 0) {
      window.alert(dialogT("crm.quotes.61895a9dbb"));
      return;
    }

    if (quoteItems.some((item) => item.unitPrice <= 0)) {
      window.alert(dialogT("crm.quotes.ddd5a36d4b"));
      return;
    }

    if (!startDate || !endDate) {
      window.alert(dialogT("crm.quotes.65ee26a365"));
      return;
    }

    const quotePayload: QuoteRequest = {
      ...(previousQuote ?? {}),
      id: editingQuoteId ?? createQuoteId(),
      leadId: leadId || undefined,
      clientName,
      title,
      location,
      guestCount,
      categories: selectedCategories,
      items: quoteItems,
      startDate,
      endDate,
      unitPrice,
      validityDate,
      paymentTerms,
      cancellationTerms,
      included,
      excluded,
      notes,
      status,
      statusUpdatedAt: previousQuote?.status === status
        ? previousQuote.statusUpdatedAt || previousQuote.createdAt
        : new Date().toISOString(),
      createdAt: editingQuoteId
        ? previousQuote?.createdAt ?? new Date().toISOString()
        : new Date().toISOString()
    };

    const quote: QuoteRequest = editingQuoteId
      ? stampUpdated(quotePayload, activeActor) as QuoteRequest
      : stampCreated(quotePayload, activeActor) as QuoteRequest;

    void confirmation.submit(formElement, () => setQuotes((current) => editingQuoteId
      ? current.map(item => item.id === editingQuoteId ? quote : item)
      : [quote, ...current]), newerDraft => {
      if(newerDraft){setEditingQuoteId(quote.id);return;}
      setEditingQuoteId(null);
      onQuoteChange?.(quote);
      formElement.reset();
      window.setTimeout(() => {
        if(formElement.isConnected)document.getElementById("quotes-list-panel")?.scrollIntoView({behavior:"smooth",block:"start"});
      }, 80);
    });
  }

  const visibleQuotes =
    statusFilter === "Tous"
      ? quotes
      : quotes.filter((quote) => getQuoteStatus(quote.status) === statusFilter);


  return (
    <div className="two-columns wide-left">
      <section id="quotes-list-panel" className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Devis clients"}>{t("crm.quotes.c53919a65c")}</p>
            <h3>{t("crm.counts.quotesShown", { count: visibleQuotes.length })}{statusFilter !== "Tous" ? t("crm.quotes.f5300ab745", { value1: displayValue(quotes.length) }) : ""}</h3>
          </div>
        </div>

        <div className="list-stack oar-contact-list-stack">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
          {(["Tous", ...quoteStatuses] as Array<QuoteStatus | "Tous">).map((status) => (
            <BusinessButton
              key={status}
              type="button"
              className={statusFilter === status ? "primary-button" : "secondary-button"}
              onClick={() => setStatusFilter(status)}
            >
              {status === "Tous" ? t("crm.quotes.2ff5998143") : label(getQuoteStatusFrenchLabel(status), "crm")}
            </BusinessButton>
          ))}
        </div>

        {visibleQuotes.length === 0 ? (<p className="muted-line">{t("crm.quotes.5cbb140b1b")}</p>) : (visibleQuotes.map((quote) => (
              <article className="quote-card" key={quote.id} data-notification-target={`quote-${quote.id}`}>
                <div>
                  <p className="eyebrow">{getQuoteItems(quote).map((item) => label(getQuoteCategoryFrenchLabel(item.category), "crm")).join(" · ")}</p>
                  <h3>{quote.title || quote.clientName}</h3>
                  <p>{quote.clientName}</p>
                  <p>{t("crm.quotes.0b6722a8ad")}{" "}{screen.quoteDate(quote.startDate)}{" "}{t("crm.quotes.632cd2fea7")}{" "}{screen.quoteDate(quote.endDate)}</p>
                  <strong>{screen.money(getQuoteSubtotal(quote))}</strong>

                  {getQuoteDepositTotal(quote) > 0 && (
                    <small>{t("crm.quotes.78edb987eb")}{" "}{screen.money(getQuoteDepositTotal(quote))}</small>
                  )}

                  <ul className="quote-line-preview">
                    {getQuoteItems(quote).map((item) => (
                      <li key={item.id}>
                        <span>{label(getQuoteCategoryFrenchLabel(item.category), "crm")}</span>
                        <strong>{screen.money(item.unitPrice)} {t(item.billingUnit === "week" ? "crm.screen.perWeek" : item.billingUnit === "fixed" ? "crm.screen.fixedFee" : "crm.screen.perDay")}</strong>
                      </li>
                    ))}
                  </ul>

                  {quote.location && <p>{quote.location}</p>}
                  <ActionMeta item={quote} />
                </div>

                <div className="quote-actions">
                  <BusinessSelect
                    value={getQuoteStatus(quote.status)}
                    onChange={(event) => updateQuoteStatus(quote.id, getQuoteStatus(event.target.value))}
                    aria-label={t("crm.quotes.183ca7a2cf")}
                  >
                    {quoteStatuses.map((status) => (
                      <option key={status} value={status}>{label(getQuoteStatusFrenchLabel(status), "crm")}</option>
                    ))}
                  </BusinessSelect>

                  <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => fillQuoteForm(quote)} data-crm-auto-scroll="true">{t("crm.quotes.42e37604b6")}</BusinessButton>

                  <BusinessButton permission="export" className="primary-button" type="button" onClick={async() => { if(business){try{await business.check();}catch{return;}} openQuotePdf(quote); }}>{t("crm.quotes.1ead755294")}</BusinessButton>

                  <BusinessButton permission="remove"
                    className="danger-link"
                    type="button"
                    onClick={() => {
                      const confirmed = window.confirm(dialogT("crm.quotes.20d8c825b2"));
                      if (!confirmed) return;
                      setQuotes((current) => current.filter((item) => item.id !== quote.id));
                    }}
                  >{t("crm.quotes.5e5d0216ce")}</BusinessButton>
                </div>
              </article>
            )))}
        </div>
      </section>

      <section className="card form-card">
        <p className="eyebrow" data-semantic-text={"Modification Nouveau"}>{editingQuoteId ? t("crm.quotes.46889b43bc") : t("crm.quotes.c3634f2ede")}</p>
        <h3>{editingQuoteId ? t("crm.quotes.709da97046") : t("crm.quotes.c144056867")}</h3>

        <BusinessForm className="form-grid" data-quote-form="true" onSubmit={addQuote} onChangeCapture={confirmation.changed} pending={confirmation.saving}>
          <ConfirmedFormMessage message={confirmation.message} />
          <input type="hidden" name="leadId" />
          <BusinessLabel>{t("crm.quotes.0c77fe09ab")}<input
              name="clientName"
              list="quote-client-options"
              required
              placeholder={t("crm.quotes.11ab79048c")}
              autoComplete="off"
            />
            <datalist id="quote-client-options">
              {contacts.filter((contact) => !isSupplierContact(contact)).map((contact) => (
                <option
                  key={contact.id}
                  value={getContactLabel(contact, "Client sans nom")}
                >
                  {[contact.companyName, contact.email, contact.phone, contact.city].filter(Boolean).join(" · ")}
                </option>
              ))}
            </datalist>
            <small className="quote-client-helper">{t("crm.quotes.96ba956293")}</small>
          </BusinessLabel>

          <BusinessLabel>{t("crm.quotes.57257d8471")}<input name="title" placeholder={t("crm.quotes.eeb96f67e2")} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.quotes.c964b7d6ac")}<input name="location" placeholder={t("crm.quotes.3e00389e0f")} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.quotes.927df2deda")}<input name="guestCount" placeholder={t("crm.quotes.48ebdf394a")} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.quotes.c6b03962c5")}<input name="startDate" type="date" required />
          </BusinessLabel>

          <BusinessLabel>{t("crm.quotes.fc1c8c3a1f")}<input name="endDate" type="date" required />
          </BusinessLabel>

          <BusinessLabel>{t("crm.quotes.760d52c497")}<input name="validityDate" type="date" />
          </BusinessLabel>

          <fieldset className="full quote-category-box quote-lines-box">
            <legend>{t("crm.quotes.dbd73be781")}</legend>

            {quoteCategories.map((category) => (
              <div className="quote-line-input" key={category}>
                <BusinessLabel>
                  <input type="checkbox" name="categories" value={category} />
                  {label(getQuoteCategoryFrenchLabel(category), "crm")}
                </BusinessLabel>

                <input name={`description${category}`} placeholder={t("crm.quotes.8ae68422f6")} />

                <input name={`price${category}`} type="number" min="0" placeholder={t("crm.quotes.54c324f6c1")} />

                <select name={`unit${category}`} defaultValue="day">
                  <option value="day">{t("crm.quotes.6e55aff773")}</option>
                  <option value="week">{t("crm.quotes.4cafd308a0")}</option>
                  <option value="fixed">{t("crm.quotes.c1d3af5242")}</option>
                </select>

                <input name={`deposit${category}`} type="number" min="0" placeholder={t("crm.quotes.2e178e6c65")} />
              </div>
            ))}
          </fieldset>

          <BusinessLabel className="full">{t("crm.quotes.f5ecc07b09")}<textarea name="included" placeholder={t("crm.quotes.88da7e8a81")} />
          </BusinessLabel>

          <BusinessLabel className="full">{t("crm.quotes.345794b198")}<textarea name="excluded" placeholder={t("crm.quotes.30ed0f214a")} />
          </BusinessLabel>

          <BusinessLabel className="full">{t("crm.quotes.676a9f4578")}<textarea name="paymentTerms" placeholder={t("crm.quotes.0845661111")} />
          </BusinessLabel>

          <BusinessLabel className="full">{t("crm.quotes.b26789ecf9")}<textarea name="cancellationTerms" placeholder={t("crm.quotes.23dcf0de36")} />
          </BusinessLabel>

          <BusinessLabel className="full">{t("crm.quotes.09b8df2f9b")}<textarea name="notes" placeholder={t("crm.quotes.ce6bda37a6")} />
          </BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit" data-crm-auto-scroll="true">
            {editingQuoteId ? t("crm.quotes.45951f6ac1") : t("crm.quotes.7ca9fcd1d9")}
          </BusinessButton>

          {editingQuoteId && (
            <BusinessButton permission="write"
              className="ghost-button"
              type="button"
              onClick={() => {
                confirmation.changed();
                setEditingQuoteId(null);
                const form = document.querySelector<HTMLFormElement>('form[data-quote-form="true"]');
                form?.reset();
              }}
            >{t("crm.quotes.c138318dfd")}</BusinessButton>
          )}
        </BusinessForm>
      </section>
    </div>
  );
}




function SuppliersView({
  suppliers,
  onAdd,
  onUpdate,
  onDelete
}: {
  suppliers: Supplier[];
  onAdd: (supplier: Supplier) => void;
  onUpdate: (supplier: Supplier) => void;
  onDelete: (id: string) => void;
}) {
  const { t, label, screen, dialogT } = useCRMDisplay();

  const [categoryFilter, setCategoryFilter] = useState("Tous");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const categories = ["Tous", "Chauffeur", "Chef", "Sécurité", "Conciergerie", "Paysagiste", "Gestion nuisibles", "Pisciniste", "Femme de ménage", "Nounou", "Artisan rénovation", "Technicien volets", "Lavage voiture", "Garage / mécanicien", "Jardinier", "Autre"];

  const visibleSuppliers =
    categoryFilter === "Tous"
      ? suppliers
      : suppliers.filter((supplier) => supplier.category === categoryFilter);

  function submitSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const supplier: Supplier = {
      id: editingSupplier?.id ?? makeId("supplier"),
      name: String(form.get("name") ?? "").trim(),
      category: String(form.get("category") ?? "Autre") as Supplier["category"],
      contactName: String(form.get("contactName") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      zone: String(form.get("zone") ?? "").trim(),
      quality: String(form.get("quality") ?? "Standard") as Supplier["quality"],
      reliability: String(form.get("reliability") ?? "À tester") as Supplier["reliability"],
      priceNotes: String(form.get("priceNotes") ?? "").trim(),
      commissionNotes: String(form.get("commissionNotes") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      status: String(form.get("status") ?? "Actif") as Supplier["status"],
      createdAt: editingSupplier?.createdAt ?? new Date().toISOString()
    };

    if (!supplier.name) {
      window.alert(dialogT("crm.suppliers.c48375c50c"));
      return;
    }

    if (editingSupplier) {
      onUpdate(supplier);
      setEditingSupplier(null);
    } else {
      onAdd(supplier);
    }

    event.currentTarget.reset();
  }

  return (
    <div className="split-layout">
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Réseau privé"}>{t("crm.suppliers.e45be43991")}</p>
            <h3>{t("crm.counts.suppliers", { count: visibleSuppliers.length })}</h3>
          </div>
          <p className="muted-line">{t("crm.suppliers.69a5cb2881")}</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={categoryFilter === category ? "primary-button" : "secondary-button"}
              onClick={() => setCategoryFilter(category)}
            >
              {screen.category(category)}
            </button>
          ))}
        </div>

        {visibleSuppliers.length === 0 ? (<p className="muted-line">{t("crm.suppliers.86ff6ee587")}</p>) : (<div className="list-stack oar-contact-list-stack">
            {visibleSuppliers.map((supplier) => (
              <article className="item-card" key={supplier.id}>
                <div>
                  <p className="eyebrow" data-semantic-text={supplier.status}>{screen.category(supplier.category)} · {label(supplier.status, "crm")}</p>
                  <h3>{supplier.name}</h3>
                  <p>{supplier.contactName || t("crm.suppliers.7229369329")}</p>
                  <p className="muted-line">{supplier.zone || t("crm.suppliers.40aa5057e1")}</p>
                  <p className="muted-line">{t("crm.suppliers.4bb8de619a")}{" "}{label(supplier.quality, "crm")}{" "}{t("crm.suppliers.6e3b46603b")}{" "}{label(supplier.reliability, "crm")}
                  </p>
                  {supplier.priceNotes && <p className="muted-line">{t("crm.suppliers.df951f9d86")}{" "}{supplier.priceNotes}</p>}
                  {supplier.commissionNotes && <p className="muted-line">{t("crm.suppliers.1cdb57d4c1")}{" "}{supplier.commissionNotes}</p>}
                  {supplier.notes && <p>{supplier.notes}</p>}
                </div>

                <div className="item-actions contact-row-actions oar-contact-actions">
                  {supplier.phone && (
                    <a className="secondary-button" href={`tel:${supplier.phone}`}>{t("crm.suppliers.16d93e3764")}</a>
                  )}
                  {supplier.email && (
                    <a className="secondary-button" href={`mailto:${supplier.email}`}>{t("crm.suppliers.969ccbd3cf")}</a>
                  )}
                  <button className="secondary-button" type="button" onClick={() => setEditingSupplier(supplier)} data-crm-auto-scroll="true">{t("crm.suppliers.42e37604b6")}</button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      if (window.confirm(dialogT("crm.suppliers.9b33bd119a"))) {
                        onDelete(supplier.id);
                      }
                    }}
                  >{t("crm.suppliers.5e5d0216ce")}</button>
                </div>
              </article>
            ))}
          </div>)}
      </section>

      <section className="card">
        <p className="eyebrow" data-semantic-text={"Modification Nouveau"}>{editingSupplier ? t("crm.suppliers.46889b43bc") : t("crm.suppliers.c3634f2ede")}</p>
        <h3>{editingSupplier ? t("crm.suppliers.df72949a43") : t("crm.suppliers.ac115b83bb")}</h3>

        <form className="form-grid" onSubmit={submitSupplier}>
          <label>{t("crm.suppliers.4e41070c90")}<input name="name" defaultValue={editingSupplier?.name ?? ""} placeholder={t("crm.suppliers.b8ce4eb0fd")} />
          </label>

          <label>{t("crm.suppliers.68a5341fc6")}<select name="category" defaultValue={editingSupplier?.category ?? "Autre"}>
              {categories.filter((category) => category !== "Tous").map((category) => (
                <option key={category} value={category}>{screen.category(category)}</option>
              ))}
            </select>
          </label>

          <label>{t("crm.suppliers.2b5c3d2672")}<input name="contactName" defaultValue={editingSupplier?.contactName ?? ""} placeholder={t("crm.suppliers.67f8a52b44")} />
          </label>

          <label>{t("crm.suppliers.969ccbd3cf")}<input name="email" type="email" defaultValue={editingSupplier?.email ?? ""} placeholder={t("crm.suppliers.589eb9cdb5")} />
          </label>

          <label>{t("crm.suppliers.cc4c424b57")}<input name="phone" defaultValue={editingSupplier?.phone ?? ""} placeholder="+33..." />
          </label>

          <label>{t("crm.suppliers.a8a06e4a56")}<input name="zone" defaultValue={editingSupplier?.zone ?? ""} placeholder={t("crm.suppliers.acf73cc1ad")} />
          </label>

          <label>{t("crm.suppliers.8dce95eeb4")}<select name="quality" defaultValue={editingSupplier?.quality ?? "Standard"}>
              <option value="Standard">{t("crm.suppliers.ef6691545d")}</option>
              <option value="Premium">{t("crm.suppliers.de88c121a8")}</option>
              <option value="Très premium">{t("crm.suppliers.6e2c957724")}</option>
            </select>
          </label>

          <label>{t("crm.suppliers.10859b8dc3")}<select name="reliability" defaultValue={editingSupplier?.reliability ?? "À tester"}>
              <option value="À tester">{t("crm.suppliers.437f69fce9")}</option>
              <option value="Fiable">{t("crm.suppliers.26d5cdf018")}</option>
              <option value="Très fiable">{t("crm.suppliers.8508f22f87")}</option>
              <option value="À éviter">{t("crm.suppliers.9c5902593d")}</option>
            </select>
          </label>

          <label>{t("crm.suppliers.301b704907")}<textarea name="priceNotes" defaultValue={editingSupplier?.priceNotes ?? ""} placeholder={t("crm.suppliers.1b8f311310")} />
          </label>

          <label>{t("crm.suppliers.c5da356eca")}<textarea name="commissionNotes" defaultValue={editingSupplier?.commissionNotes ?? ""} placeholder={t("crm.suppliers.db3f8197bc")} />
          </label>

          <label>{t("crm.suppliers.d96ddd0984")}<textarea name="notes" defaultValue={editingSupplier?.notes ?? ""} placeholder={t("crm.suppliers.3aa92a526d")} />
          </label>

          <label>{t("crm.suppliers.dee377cfd8")}<select name="status" defaultValue={editingSupplier?.status ?? "Actif"}>
              <option value="Actif">{t("crm.suppliers.ad26287ab6")}</option>
              <option value="À vérifier">{t("crm.suppliers.03a088312d")}</option>
              <option value="Inactif">{t("crm.suppliers.cdcf2ea348")}</option>
            </select>
          </label>

          <button className="primary-button planning-entry-submit" type="submit">
            {editingSupplier ? t("crm.suppliers.71dc74873e") : t("crm.suppliers.7e25d1341d")}
          </button>

          {editingSupplier && (
            <button className="secondary-button" type="button" onClick={() => setEditingSupplier(null)}>{t("crm.suppliers.c068486998")}</button>
          )}
        </form>
      </section>
    </div>
  );
}

function BookingsView({
  quotes,
  contacts = [],
  activeActor,
  onChange
}: {
  quotes: QuoteRequest[];
  contacts?: Contact[];
  activeActor: string;
  onChange: (quotes: QuoteRequest[]) => void;
}) {
  const { t, label, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const confirmedQuotes = quotes.filter((quote) => getQuoteStatus(quote.status) === "Accepted");
  const providerContacts = contacts.filter(isSupplierContact);

  function getAssignedProvider(quote: QuoteRequest) {
    return providerContacts.find((contact) => contact.id === quote.assignedContactId);
  }

  function getPaymentRemaining(quote: QuoteRequest) {
    const total = getQuoteTotal(quote);
    const paid = Number(quote.depositReceived || 0) + Number(quote.balanceReceived || 0);

    return Math.max(total - paid, 0);
  }

  function getPaymentStatus(quote: QuoteRequest) {
    const total = getQuoteTotal(quote);
    const paid = Number(quote.depositReceived || 0) + Number(quote.balanceReceived || 0);

    if (quote.paymentStatus && quote.paymentStatus !== "Non payé") return quote.paymentStatus;
    if (total > 0 && paid >= total) return "Payé";
    if (Number(quote.depositReceived || 0) > 0) return "Acompte reçu";
    if (paid > 0) return "Partiel";

    return "Non payé";
  }

  function getMarginPercent(quote: QuoteRequest) {
    const total = getQuoteTotal(quote);
    const supplierCost = Number(quote.supplierCost || 0);

    if (total <= 0) return 0;

    return Math.round(((total - supplierCost) / total) * 100);
  }

  function updateBookingFinance(event: React.FormEvent<HTMLFormElement>, quote: QuoteRequest) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const updatedQuote: QuoteRequest = stampUpdated({
      ...quote,
      supplierCost: readQuoteNumber(form.get("supplierCost")),
      depositReceived: readQuoteNumber(form.get("depositReceived")),
      balanceReceived: readQuoteNumber(form.get("balanceReceived")),
      paymentNotes: String(form.get("paymentNotes") ?? "").trim(),
      paymentStatus: String(form.get("paymentStatus") ?? "Non payé") as QuoteRequest["paymentStatus"],
      expectedDeposit: readQuoteNumber(form.get("expectedDeposit")),
      paymentDueDate: String(form.get("paymentDueDate") ?? ""),
      bookingStatus: String(form.get("bookingStatus") ?? "À préparer") as QuoteRequest["bookingStatus"],
      clientConfirmed: form.get("clientConfirmed") === "on",
      depositConfirmed: form.get("depositConfirmed") === "on",
      supplierConfirmed: form.get("supplierConfirmed") === "on",
      balanceConfirmed: form.get("balanceConfirmed") === "on",
      detailsSent: form.get("detailsSent") === "on",
      serviceCompleted: form.get("serviceCompleted") === "on",
      operationNotes: String(form.get("operationNotes") ?? "").trim(),
      assignedContactId: String(form.get("assignedContactId") ?? "")
    }, activeActor) as QuoteRequest;

    const nextQuotes = quotes.map((item) => (item.id === quote.id ? updatedQuote : item));

    onChange(nextQuotes);
    if (!business) saveQuotesToBrowser(nextQuotes);
    if (!business) window.alert(dialogT("crm.bookings.504ef4f778"));
  }

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow" data-semantic-text={"Services confirmés"}>{t("crm.bookings.c385e4dc38")}</p>
          <h3>{t("crm.counts.bookings", { count: confirmedQuotes.length })}</h3>
        </div>
        <p className="muted-line">{t("crm.bookings.6367055e62")}</p>
      </div>

      {confirmedQuotes.length === 0 ? (<p className="muted-line">{t("crm.bookings.de6efe788b")}</p>) : (<div className="list-stack oar-contact-list-stack">
          {confirmedQuotes.map((quote) => {
            const services = getQuoteItems(quote)
              .map((item) => label(getQuoteCategoryFrenchLabel(item.category), "crm"))
              .join(" · ");

            const clientPrice = getQuoteTotal(quote);
            const supplierCost = Number(quote.supplierCost || 0);
            const depositReceived = Number(quote.depositReceived || 0);
            const balanceReceived = Number(quote.balanceReceived || 0);
            const margin = clientPrice - supplierCost;
            const remainingBalance = Math.max(clientPrice - depositReceived - balanceReceived, 0);
            const paymentStatus = getPaymentStatus(quote);
            const marginPercent = getMarginPercent(quote);
            const assignedProvider = getAssignedProvider(quote);

            return (
              <article className="item-card" key={quote.id} data-notification-target={`booking-${quote.id}`}>
                <div>
                  <p className="eyebrow" data-semantic-text={"Service confirmé"}>{services || t("crm.bookings.54cc57ed9f")}</p>
                  <h3>{quote.clientName}</h3>
                  <p>{quote.title || t("crm.bookings.7491ed9a17")}</p>
                  <p className="muted-line">{t("crm.bookings.0b6722a8ad")}{" "}{screen.quoteDate(quote.startDate)}{" "}{t("crm.bookings.632cd2fea7")}{" "}{screen.quoteDate(quote.endDate)}
                  </p>

                  <div className="stats-grid oar-contacts-stats" style={{ marginTop: 18 }}>
                    <div className="mini-stat" data-semantic-text={"Prix client"}>
                      <span>{t("crm.bookings.c1667fbad1")}</span>
                      <strong>{screen.money(clientPrice)}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Coût prestataire"}>
                      <span>{t("crm.bookings.7abd37537b")}</span>
                      <strong>{screen.money(supplierCost)}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Marge estimée"}>
                      <span>{t("crm.bookings.c46f57640a")}</span>
                      <strong>{screen.money(margin)}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Solde restant"}>
                      <span>{t("crm.bookings.d2b75aed36")}</span>
                      <strong>{screen.money(remainingBalance)}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Statut paiement"}>
                      <span>{t("crm.bookings.47f14cb075")}</span>
                      <strong>{label(paymentStatus, "crm")}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Acompte attendu"}>
                      <span>{t("crm.bookings.e8506477b3")}</span>
                      <strong>{screen.money(Number(quote.expectedDeposit || 0))}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Marge %"}>
                      <span>{t("crm.bookings.ccbdd6f467")}</span>
                      <strong>{marginPercent}%</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Limite paiement"}>
                      <span>{t("crm.bookings.5e18a708be")}</span>
                      <strong>{quote.paymentDueDate ? screen.quoteDate(quote.paymentDueDate) : "—"}</strong>
                    </div>
                  </div>

                  {assignedProvider && (
                    <div className="asset-detail-grid" style={{ marginTop: 18 }}>
                      <div>
                        <span>{t("crm.bookings.a4f049df6c")}</span>
                        <strong>{assignedProvider.name}</strong>
                      </div>
                      <div>
                        <span>{t("crm.bookings.13a150e3fd")}</span>
                        <strong>{screen.category(getContactSupplierCategory(assignedProvider))}</strong>
                      </div>
                      <div>
                        <span>{t("crm.bookings.cc4c424b57")}</span>
                        <strong>{assignedProvider.phone || "—"}</strong>
                      </div>
                      <div>
                        <span>{t("crm.bookings.969ccbd3cf")}</span>
                        <strong>{assignedProvider.email || "—"}</strong>
                      </div>
                    </div>
                  )}

                  <BusinessForm className="form-grid" onSubmit={(event) => updateBookingFinance(event, quote)} style={{ marginTop: 20 }}>
                    <BusinessLabel>{t("crm.bookings.47f14cb075")}<select name="paymentStatus" defaultValue={quote.paymentStatus || getPaymentStatus(quote)}>
                        <option value="Non payé">{t("crm.bookings.c972cef081")}</option>
                        <option value="Acompte reçu">{t("crm.bookings.cf412df173")}</option>
                        <option value="Partiel">{t("crm.bookings.e9d830119d")}</option>
                        <option value="Payé">{t("crm.bookings.2542792ee0")}</option>
                        <option value="Annulé / remboursé">{t("crm.bookings.75cae773d9")}</option>
                      </select>
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.e8506477b3")}<input name="expectedDeposit" type="number" min="0" step="1" defaultValue={quote.expectedDeposit || ""} placeholder={t("crm.bookings.9e4cfba30f")} />
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.8a2e068f9e")}<input name="paymentDueDate" type="date" defaultValue={quote.paymentDueDate || ""} />
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.7abd37537b")}<input name="supplierCost" type="number" min="0" step="1" defaultValue={quote.supplierCost || ""} placeholder={t("crm.bookings.8c5304d4c7")} />
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.cf412df173")}<input name="depositReceived" type="number" min="0" step="1" defaultValue={quote.depositReceived || ""} placeholder={t("crm.bookings.9e4cfba30f")} />
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.9241c861e7")}<input name="balanceReceived" type="number" min="0" step="1" defaultValue={quote.balanceReceived || ""} placeholder={t("crm.bookings.494387a2af")} />
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.0eb206a1fc")}<textarea name="paymentNotes" defaultValue={quote.paymentNotes || ""} placeholder={t("crm.bookings.7cc7fe9c1c")} />
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.a4f049df6c")}<select name="assignedContactId" defaultValue={quote.assignedContactId || ""}>
                        <option value="">{t("crm.bookings.a95639476f")}</option>
                        {providerContacts.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {getContactLabel(contact)} · {screen.category(getContactSupplierCategory(contact))}{getContactSupplierZone(contact) ? t("crm.bookings.f6b53f9c8a", { value1: displayValue(getContactSupplierZone(contact)) }) : ""}
                          </option>
                        ))}
                      </select>
                    </BusinessLabel>

                    <BusinessLabel>{t("crm.bookings.1cbd4b19c8")}<select name="bookingStatus" defaultValue={quote.bookingStatus || "À préparer"}>
                        <option value="À préparer">{t("crm.bookings.4e8718301a")}</option>
                        <option value="Prestataire à confirmer">{t("crm.bookings.392d3f43ee")}</option>
                        <option value="Confirmé">{t("crm.bookings.1278c77084")}</option>
                        <option value="En cours">{t("crm.bookings.797f5dcd02")}</option>
                        <option value="Terminé">{t("crm.bookings.f28acc85bf")}</option>
                        <option value="Annulé">{t("crm.bookings.58524ce81f")}</option>
                      </select>
                    </BusinessLabel>

                    <div className="card" style={{ boxShadow: "none", padding: 16 }}>
                      <p className="eyebrow" data-semantic-text={"Checklist opérationnelle"}>{t("crm.bookings.480255400c")}</p>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="clientConfirmed" type="checkbox" defaultChecked={Boolean(quote.clientConfirmed)} />{t("crm.bookings.94061b8ad9")}</BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="depositConfirmed" type="checkbox" defaultChecked={Boolean(quote.depositConfirmed)} />{t("crm.bookings.cf412df173")}</BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="supplierConfirmed" type="checkbox" defaultChecked={Boolean(quote.supplierConfirmed)} />{t("crm.bookings.0366c80ab8")}</BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="balanceConfirmed" type="checkbox" defaultChecked={Boolean(quote.balanceConfirmed)} />{t("crm.bookings.9241c861e7")}</BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="detailsSent" type="checkbox" defaultChecked={Boolean(quote.detailsSent)} />{t("crm.bookings.a4167be975")}</BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="serviceCompleted" type="checkbox" defaultChecked={Boolean(quote.serviceCompleted)} />{t("crm.bookings.9b392e9a8d")}</BusinessLabel>
                    </div>

                    <BusinessLabel>{t("crm.bookings.c035c76175")}<textarea name="operationNotes" defaultValue={quote.operationNotes || ""} placeholder={t("crm.bookings.350c22e505")} />
                    </BusinessLabel>

                    <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.bookings.4607c0a797")}</BusinessButton>
                  </BusinessForm>
                </div>

                <div className="item-actions contact-row-actions oar-contact-actions">
                  <span className="status-pill" data-semantic-text={"À préparer"}>{label(quote.bookingStatus, "crm") || t("crm.bookings.4e8718301a")}</span>
                  <BusinessButton permission="export" className="secondary-button" type="button" onClick={async() => { if(business){try{await business.check();}catch{return;}} openQuotePdf(quote); }} data-crm-auto-scroll="true">{t("crm.bookings.116e108ff7")}</BusinessButton>
                </div>
              </article>
            );
          })}
        </div>)}
    </section>
  );
}



function getDocumentDaysUntil(date: string) {
  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(`${date}T12:00:00`);
  target.setHours(0, 0, 0, 0);

  if (Number.isNaN(target.getTime())) return null;

  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function DocumentsView({
  documents,
  activeActor,
  onAdd,
  onUpdate,
  onTrash,
  canTrash,
  sessionUserId
}: {
  documents: CRMDocument[];
  activeActor: CRMActor;
  onAdd: (crmDocument: CRMDocument) => void;
  onUpdate: (crmDocument: CRMDocument) => void;
  onTrash: (crmDocument: CRMDocument, operationId: string) => Promise<void>;
  canTrash: boolean;
  sessionUserId: string;
}) {
  const { t, label, screen, screenText, dialogText, dialogT } = useCRMDisplay();

  const [currentFolderId, setCurrentFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [editingDocument, setEditingDocument] = useState<CRMDocument | null>(null);
  const [previewDocument, setPreviewDocument] = useState<CRMDocument | null>(null);
  const [previewDocumentUrl, setPreviewDocumentUrl] = useState("");
  const [previewingDocument, setPreviewingDocument] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState("");
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [trashingDocumentId, setTrashingDocumentId] = useState("");
  const trashInFlight = useRef(false);
  const [trashMessage, setTrashMessage] = useState<ScreenNotice>("");

  useEffect(() => {
    let cancelled = false;

    async function loadEmail() {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        setConnectedEmail(String(data.user?.email || "").toLowerCase());
      }
    }

    loadEmail();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewDocumentUrl) URL.revokeObjectURL(previewDocumentUrl);
    };
  }, [previewDocumentUrl]);

  const canManageDocuments =
    connectedEmail === "matteobuggianipro@gmail.com" ||
    connectedEmail === "vg@oneaddressriviera.com";

  const folders = documents.filter((crmDocument) => Boolean(crmDocument.isFolder));
  const files = documents.filter((crmDocument) => !crmDocument.isFolder);
  const currentFolder = currentFolderId ? folders.find((folder) => folder.id === currentFolderId) || null : null;
  const currentDriveFolderId = currentFolder?.driveFolderId || "";

  const folderPath = (() => {
    const path: CRMDocument[] = [];
    let cursor = currentFolder;
    let guard = 0;

    while (cursor && guard < 20) {
      path.unshift(cursor);
      const parentId = cursor.folderId || cursor.parentFolderId || "";
      cursor = parentId ? folders.find((folder) => folder.id === parentId) || null : null;
      guard += 1;
    }

    return path;
  })();

  const visibleFolders = folders
    .filter((folder) => (folder.folderId || folder.parentFolderId || "") === currentFolderId)
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));

  const visibleDocuments = files
    .filter((crmDocument) => (crmDocument.folderId || crmDocument.parentFolderId || "") === currentFolderId)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

  const documentsToCheck = files.filter((crmDocument) =>
    crmDocument.status === "Expiré" || crmDocument.status === "À vérifier"
  );

  function getDriveFileApiUrl(crmDocument: CRMDocument, download = false) {
    if (!crmDocument.driveFileId) return "";
    const suffix = download ? "&download=1" : "";
    return `/api/drive/file?fileId=${encodeURIComponent(crmDocument.driveFileId)}${suffix}`;
  }

  async function openDrivePreview(crmDocument: CRMDocument) {
    const url = getDriveFileApiUrl(crmDocument);
    if (!url) return;

    try {
      setPreviewingDocument(true);
      const response = await fetchDriveAPI(url);

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Aperçu Google Drive impossible.");
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      setPreviewDocument(crmDocument);
      setPreviewDocumentUrl(blobUrl);
    } catch (error) {
      window.alert(dialogText(safeCRMError(error)));
    } finally {
      setPreviewingDocument(false);
    }
  }

  function closeDrivePreview() {
    setPreviewDocument(null);
    setPreviewDocumentUrl("");
  }

  async function downloadDriveDocument(crmDocument: CRMDocument) {
    const url = getDriveFileApiUrl(crmDocument, true);
    if (!url) return;

    try {
      const response = await fetchDriveAPI(url);

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Téléchargement Google Drive impossible.");
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = crmDocument.fileName || crmDocument.title || "document";
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      window.alert(dialogText(safeCRMError(error)));
    }
  }

  function formatDocumentSize(size?: number) {
    const value = Number(size || 0);
    if (!value) return "";
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
    return `${(value / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
  }

  async function createDriveFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManageDocuments) {
      window.alert(dialogT("crm.documents.d72823e094"));
      return;
    }

    const name = folderName.trim();
    if (!name) {
      window.alert(dialogT("crm.documents.9f82fd88cd"));
      return;
    }

    try {
      setCreatingFolder(true);
      const response = await fetchDriveAPI("/api/drive/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, parentDriveFolderId: currentDriveFolderId })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.folder?.id) {
        throw new Error(payload.error || "Création du dossier Drive impossible.");
      }

      const now = new Date().toISOString();
      const folderDocument: CRMDocument = {
        id: makeId("folder"),
        title: name,
        category: "Documents",
        status: "À jour",
        url: payload.folder.webViewLink || "",
        storagePath: "",
        fileName: "",
        uploadedAt: now,
        location: folderPath.map((folder) => folder.title).concat(name).join(" / "),
        expiryDate: "",
        notes: "",
        addedAt: now,
        addedBy: activeActor,
        updatedAt: "",
        updatedBy: "",
        isFolder: true,
        folderId: currentFolderId,
        parentFolderId: currentFolderId,
        driveFolderId: payload.folder.id,
        driveParentFolderId: currentDriveFolderId,
        driveWebViewLink: payload.folder.webViewLink || "",
        mimeType: payload.folder.mimeType || "application/vnd.google-apps.folder",
        size: 0
      };

      onAdd(folderDocument);
      setFolderName("");
    } catch (error) {
      window.alert(dialogText(safeCRMError(error)));
    } finally {
      setCreatingFolder(false);
    }
  }

  async function uploadFilesToFolder(fileList: FileList | File[], targetFolderId = currentFolderId, targetDriveFolderId = currentDriveFolderId) {
    const selectedFiles = Array.from(fileList || []).filter((file) => file.size > 0);

    if (!selectedFiles.length) return;

    if (!canManageDocuments) {
      window.alert(dialogT("crm.documents.f54308358a"));
      return;
    }

    if (!targetDriveFolderId) {
      window.alert(dialogT("crm.documents.9e114598bf"));
      setDragActive(false);
      return;
    }

    try {
      setUploadingDocument(true);

      for (const file of selectedFiles) {
        const uploadForm = new FormData();
        uploadForm.append("file", file);
        uploadForm.append("title", file.name);
        uploadForm.append("parentDriveFolderId", targetDriveFolderId);

        const response = await fetchDriveAPI("/api/drive/upload", {
          method: "POST",
          body: uploadForm
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.file?.id) {
          throw new Error(payload.error || `Upload impossible pour ${file.name}`);
        }

        const now = new Date().toISOString();
        const crmDocument: CRMDocument = {
          id: makeId("doc"),
          title: file.name.replace(/\.[^.]+$/, "") || file.name,
          category: "Documents",
          status: "À jour",
          url: payload.file.webViewLink || "",
          storagePath: "",
          fileName: payload.file.name || file.name,
          uploadedAt: now,
          location: folderPath.map((folder) => folder.title).join(" / "),
          expiryDate: "",
          notes: "",
          addedAt: now,
          addedBy: activeActor,
          updatedAt: "",
          updatedBy: "",
          isFolder: false,
          folderId: targetFolderId,
          parentFolderId: targetFolderId,
          driveParentFolderId: targetDriveFolderId,
          driveFileId: payload.file.id,
          driveWebViewLink: payload.file.webViewLink || "",
          driveWebContentLink: payload.file.webContentLink || "",
          mimeType: payload.file.mimeType || file.type || "",
          size: Number(payload.file.size || file.size || 0)
        };

        onAdd(crmDocument);
      }
    } catch (error) {
      window.alert(dialogText(safeCRMError(error)));
    } finally {
      setUploadingDocument(false);
      setDragActive(false);
    }
  }

  async function trashDriveBackedDocument(crmDocument: CRMDocument) {
    if (!canTrash || !canManageDocuments || trashInFlight.current) return;
    const driveId = crmDocument.isFolder ? crmDocument.driveFolderId : crmDocument.driveFileId;
    if (!driveId) {
      setTrashMessage(screenNotice("crm.documents.dfcb2ae87e"));
      return;
    }
    if (editingDocument?.id === crmDocument.id) {
      setTrashMessage(screenNotice("crm.documents.a99135a915"));
      return;
    }
    if (crmDocument.isFolder) {
      const hasChildren = documents.some((item) => (item.folderId || item.parentFolderId || "") === crmDocument.id);
      if (hasChildren) {
        setTrashMessage(screenNotice("crm.documents.43289e5505"));
        return;
      }
    }
    const parentId = crmDocument.folderId || crmDocument.parentFolderId || "";
    const parent = folders.find((folder) => folder.id === parentId);
    const parentLabel = parent?.title || (parentId ? crmDocument.location || parentId : "CRM Documents");
    const name = crmDocument.fileName || crmDocument.title;
    const message = t("crm.screen.trashConfirm", { kind: t(crmDocument.isFolder ? "crm.screen.trashFolder" : "crm.screen.trashFile"), name, folder: parentLabel, check: crmDocument.isFolder ? t("crm.screen.trashFolderCheck") : "" });
    if (!window.confirm(message)) return;

    const storageKey = `oneaddress-documents-trash:${sessionUserId}:${crmDocument.id}`;
    const identity = { documentId: crmDocument.id, fileId: driveId, parentFolderId: parentId, parentDriveFolderId: crmDocument.driveParentFolderId || (!crmDocument.isFolder ? crmDocument.driveFolderId : "") || "" };
    trashInFlight.current = true;
    setTrashingDocumentId(crmDocument.id);
    setTrashMessage("");
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      const previous = raw ? JSON.parse(raw) : null;
      if (previous && (typeof previous.operationId !== "string" || Object.entries(identity).some(([key, value]) => previous[key] !== value))) {
        throw new Error("Une mise à la corbeille non confirmée concerne un autre rattachement. Rechargez les données et vérifiez ce document avant de reprendre.");
      }
      const operationId = previous?.operationId || crypto.randomUUID();
      // Persist the exact operation before the request so a lost response or a
      // reload resumes that operation with the same resource and attachment.
      window.sessionStorage.setItem(storageKey, JSON.stringify({ ...identity, operationId }));
      await onTrash(crmDocument, operationId);
      window.sessionStorage.removeItem(storageKey);
      if (previewDocument?.id === crmDocument.id) closeDrivePreview();
      setTrashMessage(screenNotice("crm.documents.6e5ca2905c", { value1: displayValue(crmDocument.isFolder ? t("crm.documents.2cdf175d11") : t("crm.enums.file")), value2: displayValue(name) }));
    } catch (error) {
      setTrashMessage(safeCRMError(error));
    } finally {
      trashInFlight.current = false;
      setTrashingDocumentId("");
    }
  }

  function submitDocumentMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDocument) return;

    const form = new FormData(event.currentTarget);
    const now = new Date().toISOString();

    onUpdate({
      ...editingDocument,
      title: String(form.get("title") || "").trim() || editingDocument.title,
      category: "Documents",
      status: String(form.get("status") || editingDocument.status) as CRMDocument["status"],
      location: String(form.get("location") || "").trim(),
      expiryDate: String(form.get("expiryDate") || ""),
      notes: String(form.get("notes") || "").trim(),
      updatedAt: now,
      updatedBy: activeActor
    });

    setEditingDocument(null);
  }

  return (
    <div className="two-columns wide-left documents-view drive-documents-view">
      <section className="card documents-list-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Drive CRM"}>{t("crm.documents.42094b5739")}</p>
            <h3>{folders.length}{" "}{t("crm.documents.c8ec03ed9c")}{folders.length > 1 ? t("crm.documents.043a718774") : ""} · {files.length}{" "}{t("crm.documents.43cc23fa52")}{files.length > 1 ? t("crm.documents.043a718774") : ""}</h3>
          </div>
          <div>
            <p className="eyebrow" data-semantic-text={"À vérifier"}>{t("crm.documents.03a088312d")}</p>
            <h3>{documentsToCheck.length}</h3>
          </div>
        </div>

        <div className="document-breadcrumbs">
          <button type="button" className={!currentFolderId ? "primary-button" : "secondary-button"} onClick={() => setCurrentFolderId("")}>{t("crm.documents.35c762079d")}</button>
          {folderPath.map((folder) => (
            <button key={folder.id} type="button" className="secondary-button" onClick={() => setCurrentFolderId(folder.id)}>
              {folder.title}
            </button>
          ))}
        </div>

        <div className="document-current-folder-note">
          {currentFolder ? (<span>{t("crm.documents.32df902c91")}{" "}<strong>{currentFolder.title}</strong></span>) : (<span>{t("crm.documents.4f1493fe26")}</span>)}
        </div>

        <div
          className={`document-drop-zone ${dragActive ? "drag-active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            void uploadFilesToFolder(event.dataTransfer.files);
          }}
        >
          <strong>{uploadingDocument ? t("crm.documents.b2d553dc1d") : currentFolder ? t("crm.documents.e00318edb5", { value1: displayValue(currentFolder.title) }) : t("crm.documents.b4460a6e9d")}</strong>
          <span>{currentFolder ? t("crm.documents.6916b2b143") : t("crm.documents.d19f61ef10")}</span>
          <label className={`secondary-button document-upload-button ${!currentFolder ? "is-disabled" : ""}`}>{t("crm.documents.477d07ee67")}<input type="file" multiple disabled={!currentFolder} onChange={(event) => event.currentTarget.files && void uploadFilesToFolder(event.currentTarget.files)} />
          </label>
        </div>

        {visibleFolders.length === 0 && visibleDocuments.length === 0 ? (<p className="muted-line">{currentFolder ? t("crm.documents.b584e70d08") : t("crm.documents.eeaa27d711")}</p>) : (<div className="documents-grid drive-documents-grid">
            {visibleFolders.map((folder) => (
              <article
                className="item-card document-card document-folder-card"
                key={folder.id}
                id={`document-${folder.id}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void uploadFilesToFolder(event.dataTransfer.files, folder.id, folder.driveFolderId || "");
                }}
              >
                <div>
                  <p className="eyebrow" data-semantic-text={"Dossier"}>{t("crm.documents.2cdf175d11")}</p>
                  <h3>📁 {folder.title}</h3>
                  <p className="muted-line">{t("crm.documents.f85f2ec2af")}</p>
                </div>
                <div className="item-actions contact-row-actions oar-contact-actions">
                  <button className="primary-button compact-button" type="button" onClick={() => setCurrentFolderId(folder.id)} data-crm-auto-scroll="true">{t("crm.documents.9fb440435a")}</button>
                  {folder.driveWebViewLink && <a className="secondary-button compact-button" href={folder.driveWebViewLink} target="_blank" rel="noreferrer">{t("crm.documents.6312b4b9ba")}</a>}
                  {canManageDocuments && canTrash && folder.driveFolderId && <button className="danger-link compact-danger" type="button" disabled={Boolean(trashingDocumentId)} onClick={() => void trashDriveBackedDocument(folder)}>{trashingDocumentId === folder.id ? t("crm.documents.647dc788e2") : t("crm.documents.a52f470c90")}</button>}
                </div>
              </article>
            ))}

            {visibleDocuments.map((crmDocument) => {
              const needsCheck = crmDocument.status !== "À jour";
              const hasDriveFile = Boolean(crmDocument.driveFileId);

              return (
                <article className={`item-card document-card document-file-card ${needsCheck ? "document-card-warning" : ""}`} key={crmDocument.id} id={`document-${crmDocument.id}`}>
                  <div>
                    <p className="eyebrow" data-semantic-text={crmDocument.status}>{t("crm.documents.d8027b2582")}{" "}{label(crmDocument.status, "crm")}</p>
                    <h3>{crmDocument.title}</h3>
                    <p className="muted-line">{t("crm.documents.2b276cb139")}{" "}{screen.date(crmDocument.addedAt)}{" "}{t("crm.documents.c9d9d2c4be")}{" "}{crmDocument.addedBy}
                    </p>
                    {crmDocument.expiryDate && (
                      <p className="muted-line">{t("crm.documents.8e73ccee8a")}{" "}{screen.date(crmDocument.expiryDate)}</p>
                    )}
                    {crmDocument.fileName && <p className="muted-line">{t("crm.documents.3d8f9f30fa")}{" "}{crmDocument.fileName}</p>}
                    {crmDocument.size ? <p className="muted-line">{t("crm.documents.5b8c03adde")}{" "}{formatDocumentSize(crmDocument.size)}</p> : null}
                    {crmDocument.location && <p>{crmDocument.location}</p>}
                    {crmDocument.notes && <p className="muted-line">{crmDocument.notes}</p>}
                  </div>

                  <div className="item-actions contact-row-actions document-file-actions">
                    {hasDriveFile && (
                      <button className="secondary-button compact-button" type="button" disabled={previewingDocument} onClick={() => void openDrivePreview(crmDocument)} data-crm-auto-scroll="true">
                        {previewingDocument ? t("crm.documents.2ccbf9cad2") : t("crm.documents.4a1e847ec4")}
                      </button>
                    )}

                    {hasDriveFile && (
                      <button className="secondary-button compact-button" type="button" onClick={() => void downloadDriveDocument(crmDocument)}>{t("crm.documents.cdaaab442d")}</button>
                    )}

                    {crmDocument.driveWebViewLink && (
                      <a className="secondary-button compact-button" href={crmDocument.driveWebViewLink} target="_blank" rel="noreferrer">{t("crm.documents.6312b4b9ba")}</a>
                    )}

                    {canManageDocuments && (
                      <>
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          disabled={trashingDocumentId === crmDocument.id}
                          onClick={() => {
                            setEditingDocument(crmDocument);
                            window.setTimeout(() => {
                              window.globalThis.document.querySelector(".documents-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 80);
                          }}
                         data-crm-auto-scroll="true">{t("crm.documents.42e37604b6")}</button>

                        {canTrash && hasDriveFile && <button className="danger-link compact-danger" type="button" disabled={Boolean(trashingDocumentId)} onClick={() => void trashDriveBackedDocument(crmDocument)}>
                          {trashingDocumentId === crmDocument.id ? t("crm.documents.647dc788e2") : t("crm.documents.a52f470c90")}
                        </button>}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>)}
        {trashMessage && <p role="status">{screenText(trashMessage)}</p>}
      </section>

      <section className="card form-card documents-form-card">
        <p className="eyebrow" data-semantic-text={"Gestion Drive"}>{t("crm.documents.fc3351e808")}</p>
        <h3>{editingDocument ? t("crm.documents.6dfd2b8596") : t("crm.documents.76cbaa6eff")}</h3>
        <p className="document-storage-note">{t("crm.documents.c3386d770d")}</p>

        {!canManageDocuments && <p className="muted-line">{t("crm.documents.06a03295ac")}</p>}

        {canManageDocuments && !editingDocument && (
          <>
            <form className="form-grid document-folder-form" onSubmit={createDriveFolder}>
              <label>{t("crm.documents.4c5f19aced")}{" "}{currentFolder?.title || t("crm.documents.35c762079d")}
                <input value={folderName} onChange={(event) => setFolderName(event.currentTarget.value)} placeholder={t("crm.documents.e3c40ec507")} />
              </label>
              <button className="primary-button" type="submit" disabled={creatingFolder} data-crm-auto-scroll="true">{creatingFolder ? t("crm.documents.460546519e") : t("crm.documents.98c788ec7d")}</button>
            </form>

            <div className="document-drive-rules">
              <strong>{t("crm.documents.534017a8c6")}</strong>
              <span>{t("crm.documents.0f24a3d760")}</span>
            </div>
          </>
        )}

        {canManageDocuments && editingDocument && (
          <form key={editingDocument.id} className="form-grid" onSubmit={submitDocumentMetadata}>
            <label>{t("crm.documents.e60d42974c")}<input name="title" defaultValue={editingDocument.title} placeholder={t("crm.documents.402383e86d")} />
            </label>

            <label>{t("crm.documents.dee377cfd8")}<select name="status" defaultValue={editingDocument.status || "À jour"}>
                <option value="À jour">{t("crm.documents.50db3d1ee2")}</option>
                <option value="À vérifier">{t("crm.documents.03a088312d")}</option>
                <option value="Expiré">{t("crm.documents.4479ef3179")}</option>
              </select>
            </label>

            <label>{t("crm.documents.b3f4d24da5")}<input name="location" defaultValue={editingDocument.location || ""} placeholder={t("crm.documents.fbfc57b311")} />
            </label>

            <label>{t("crm.documents.99c40ab405")}<input name="expiryDate" type="date" defaultValue={editingDocument.expiryDate || ""} />
            </label>

            <label>{t("crm.documents.8a7525b149")}<textarea name="notes" defaultValue={editingDocument.notes || ""} placeholder={t("crm.documents.75ccd23f1b")} />
            </label>

            <button className="primary-button" type="submit">{t("crm.documents.71dc74873e")}</button>
            <button className="secondary-button" type="button" onClick={() => setEditingDocument(null)} data-crm-dismiss="true">{t("crm.documents.46ad3916f6")}</button>
          </form>
        )}
      </section>

      {previewDocument && (
        <div className="document-preview-overlay" role="dialog" aria-modal="true">
          <div className="document-preview-modal">
            <div className="section-heading">
              <div>
                <p className="eyebrow" data-semantic-text={"Aperçu document"}>{t("crm.documents.58a4b83cc1")}</p>
                <h3>{previewDocument.title}</h3>
              </div>
              <button className="secondary-button" type="button" onClick={closeDrivePreview} data-crm-dismiss="true">{t("crm.documents.711e5f2e19")}</button>
            </div>
            {previewDocumentUrl ? (
              <iframe title={previewDocument.title} src={previewDocumentUrl} className="document-preview-frame" />
            ) : (
              <p className="muted-line">{t("crm.documents.b8c7ef59af")}</p>
            )}
            <div className="item-actions">
              {previewDocument.driveWebViewLink && <a className="secondary-button" href={previewDocument.driveWebViewLink} target="_blank" rel="noreferrer" data-crm-auto-scroll="true">{t("crm.documents.606271c7f0")}</a>}
              {previewDocument.driveFileId && <button className="primary-button" type="button" onClick={() => void downloadDriveDocument(previewDocument)}>{t("crm.documents.cdaaab442d")}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HouseTrackingView({
  access,
  onOpenContact,
  contacts,
  houses,
  workers,
  timeEntries,
  payments,
  onAddHouse,
  onDeleteHouse,
  onAddWorker,
  onUpdateWorker,
  onArchiveWorker,
  onReactivateWorker,
  onPermanentlyDeleteWorker,
  onAddTimeEntry,
  onDeleteTimeEntry,
  onAddPayment,
  onDeletePayment,
  focusEntryId
}: {
  access?: AccessSnapshot;
  onOpenContact?: (contactId: string) => void;
  contacts: Contact[];
  houses: HouseTrackingHouse[];
  workers: HouseTrackingWorker[];
  timeEntries: HouseTimeEntry[];
  payments: HousePayment[];
  onAddHouse: (house: HouseTrackingHouse) => void;
  onDeleteHouse: (id: string) => void;
  onAddWorker: (worker: HouseTrackingWorker) => void;
  onUpdateWorker?: (id: string, patch: HouseWorkerEdit) => Promise<FormSaveResult>;
  onArchiveWorker: (id: string) => void;
  onReactivateWorker: (id: string) => void;
  onPermanentlyDeleteWorker: (id: string) => void;
  onAddTimeEntry: (entry: HouseTimeEntry) => FormSave;
  onDeleteTimeEntry: (id: string) => void;
  onAddPayment: (payment: HousePayment) => void;
  onDeletePayment: (id: string) => void;
  focusEntryId?: string;
}) {
  const { t, label, screen, screenText, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const today = new Date().toISOString().slice(0, 10);
  const activeWorkers = useMemo(() => workers.filter(isHouseTrackingWorkerActive), [workers]);
  const archivedWorkers = useMemo(() => workers.filter((worker) => !isHouseTrackingWorkerActive(worker)), [workers]);
  const activeWorkerIds = useMemo(() => new Set(activeWorkers.map((worker) => worker.id)), [activeWorkers]);
  const initialActiveWorker = activeWorkers[0];
  const [dateRange, setDateRange] = useState(() => ({ start: `${today.slice(0, 8)}01`, end: today }));
  const [houseFilter, setHouseFilter] = useState("Tous");
  const [workerFilter, setWorkerFilter] = useState("Tous");
  const [hourDraft, setHourDraft] = useState({
    date: today,
    houseId: houses[0]?.id || "",
    workerId: initialActiveWorker?.id || "",
    startTime: "09:00",
    endTime: "13:00",
    breakMinutes: "0",
    hourlyRate: houseHourlyRateInput(initialActiveWorker),
    note: ""
  });
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [rateError, setRateError] = useState<ScreenNotice>("");
  const hourConfirmation = useConfirmedForm(business?.markDirty);
  const [showAllHoursHistory, setShowAllHoursHistory] = useState(false);
  const [showAllPaymentsHistory, setShowAllPaymentsHistory] = useState(false);
  const [houseSection, setHouseSection] = useState<"today" | "hours" | "payments" | "settings">("today");
  const [showArchivedWorkerPicker, setShowArchivedWorkerPicker] = useState(false);
  const [archivedWorkerSearch, setArchivedWorkerSearch] = useState("");
  const [focusedEntry, setFocusedEntry] = useState<string | undefined>();
  const sourceEntry = focusEntryId ? timeEntries.find(entry => entry.id === focusEntryId) : undefined;
  if (sourceEntry && focusedEntry !== focusEntryId) {
    setFocusedEntry(focusEntryId);
    setDateRange({ start: sourceEntry.date, end: sourceEntry.date });
    setHouseFilter("Tous");
    setWorkerFilter("Tous");
    setShowAllHoursHistory(true);
    setHouseSection("hours");
  }
  useEffect(() => {
    if (!focusedEntry) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`house-time-${focusedEntry}`)?.scrollIntoView({ block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusedEntry]);

  if (hourDraft.workerId && !activeWorkers.some(worker => worker.id === hourDraft.workerId)) {
    const firstActiveWorker = activeWorkers[0];
    const workerId = firstActiveWorker?.id || "";
    const hourlyRate = houseHourlyRateInput(firstActiveWorker);
    if (hourDraft.workerId !== workerId || hourDraft.hourlyRate !== hourlyRate) {
      setHourDraft({ ...hourDraft, workerId, hourlyRate });
    }
  }
  if (workerFilter !== "Tous") {
    const selectedFilterWorker = workers.find(worker => worker.id === workerFilter);
    if (!selectedFilterWorker || (houseSection === "today" && !isHouseTrackingWorkerActive(selectedFilterWorker))) {
      setWorkerFilter("Tous");
    }
  }

  useEffect(() => {
    if (!showArchivedWorkerPicker) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowArchivedWorkerPicker(false);
        setArchivedWorkerSearch("");
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showArchivedWorkerPicker]);

  function normalizeHouseDateValue(value: string) {
    if (!value) return "";

    const trimmed = value.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    const frenchMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (frenchMatch) {
      const day = frenchMatch[1].padStart(2, "0");
      const month = frenchMatch[2].padStart(2, "0");
      const year = frenchMatch[3];
      return `${year}-${month}-${day}`;
    }

    const parsed = new Date(trimmed);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return "";
  }

  function getHouseDateTime(value: string) {
    const normalized = normalizeHouseDateValue(value);

    if (!normalized) return null;

    const time = new Date(`${normalized}T12:00:00`).getTime();
    return Number.isNaN(time) ? null : time;
  }

  function isDateInSelectedRange(date: string) {
    const entryTime = getHouseDateTime(date);
    const startTime = dateRange.start ? getHouseDateTime(dateRange.start) : null;
    const endTime = dateRange.end ? getHouseDateTime(dateRange.end) : null;

    if (entryTime === null) return false;
    if (startTime !== null && entryTime < startTime) return false;
    if (endTime !== null && entryTime > endTime) return false;

    return true;
  }

  function normalizeContactSearchValue(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ");
  }

  function getHouseContactDisplayName(contact: Contact) {
    return contact.entityType === "company"
      ? getContactLabel(contact, "Contact")
      : [contact.civility, contact.firstName, contact.name].filter(Boolean).join(" ").trim() || contact.name || contact.companyName || "Contact";
  }

  function getHouseContactSearchLabel(contact: Contact) {
    const displayName = getHouseContactDisplayName(contact);
    const secondary = getContactSecondaryLabel(contact);
    const company = secondary ? ` · ${secondary}` : "";
    const email = contact.email ? ` · ${contact.email}` : "";

    return `${displayName}${company} · ${contact.kind}${email}`;
  }

  function getHouseTrackingContactSearchValues(contact: Contact) {
    return [
      contact.id,
      getHouseContactDisplayName(contact),
      getHouseContactSearchLabel(contact),
      contact.name,
      [contact.firstName, contact.name].filter(Boolean).join(" "),
      contact.companyName || "",
      contact.organizationFunction || "",
      contact.email || "",
      contact.phone || ""
    ].map((value) => normalizeContactSearchValue(String(value || "")));
  }

  function findHouseTrackingContact(input: string) {
    const normalizedInput = normalizeContactSearchValue(input);

    if (!normalizedInput) return undefined;

    const exactMatch = contacts.find((contact) => getHouseTrackingContactSearchValues(contact).some((value) => value === normalizedInput));

    if (exactMatch) return exactMatch;

    return contacts.find((contact) => getHouseTrackingContactSearchValues(contact).some((value) => value.includes(normalizedInput)));
  }

  const sortedHouseContacts = contacts
    .slice()
    .sort((a, b) => getHouseContactDisplayName(a).localeCompare(getHouseContactDisplayName(b), "fr", { sensitivity: "base" }));

  const filteredEntries = timeEntries.filter((entry) => {
    const matchesDate = isDateInSelectedRange(entry.date);
    const matchesHouse = houseFilter === "Tous" || entry.houseId === houseFilter;
    const matchesWorker = workerFilter === "Tous" || entry.workerId === workerFilter;

    return matchesDate && matchesHouse && matchesWorker;
  });

  const filteredPayments = payments.filter((payment) => {
    const matchesDate = isDateInSelectedRange(payment.date);
    const matchesHouse = houseFilter === "Tous" || payment.houseId === houseFilter;
    const matchesWorker = workerFilter === "Tous" || payment.workerId === workerFilter;

    return matchesDate && matchesHouse && matchesWorker;
  });

  const selectedArchivedWorker = archivedWorkers.find((worker) => worker.id === workerFilter);
  const selectedArchivedWorkerHistory = selectedArchivedWorker
    ? getHouseTrackingWorkerHistorySummary(selectedArchivedWorker.id, timeEntries, payments)
    : null;
  const normalizedArchivedWorkerSearch = normalizeContactSearchValue(archivedWorkerSearch);
  const visibleArchivedWorkers = archivedWorkers.filter((worker) => (
    !normalizedArchivedWorkerSearch
    || normalizeContactSearchValue(`${worker.contactName} ${worker.role}`).includes(normalizedArchivedWorkerSearch)
  ));

  function getAutoAllocatedPaidForSelectedEntries(targetEntries: typeof filteredEntries) {
    const selectedIds = new Set(targetEntries.map((entry) => entry.id));
    const selectedWorkerIds = Array.from(new Set(targetEntries.map((entry) => entry.workerId)));
    let selectedPaidTotal = 0;

    selectedWorkerIds.forEach((workerId) => {
      let availablePaid = payments
        .filter((payment) => payment.workerId === workerId)
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      const orderedDebts = timeEntries
        .filter((entry) => entry.workerId === workerId)
        .slice()
        .sort((a, b) => {
          const aDate = normalizeHouseDateValue(a.date);
          const bDate = normalizeHouseDateValue(b.date);

          if (aDate !== bDate) return aDate.localeCompare(bDate);

          const aStart = String(a.startTime || "");
          const bStart = String(b.startTime || "");

          if (aStart !== bStart) return aStart.localeCompare(bStart);

          return String(a.id).localeCompare(String(b.id));
        });

      orderedDebts.forEach((entry) => {
        const debt = Math.max(getHouseTimeAmount(entry), 0);
        const paidForThisDebt = Math.min(debt, Math.max(availablePaid, 0));

        if (selectedIds.has(entry.id)) {
          selectedPaidTotal += paidForThisDebt;
        }

        availablePaid -= paidForThisDebt;
      });
    });

    return selectedPaidTotal;
  }

  const visibleHourEntries = showAllHoursHistory ? filteredEntries : filteredEntries.slice(0, 7);
  const visiblePaymentEntries = showAllPaymentsHistory ? filteredPayments : filteredPayments.slice(0, 7);

  const totalHours = filteredEntries.reduce((sum, entry) => sum + getHouseTimeHours(entry), 0);
  const totalDue = filteredEntries.reduce((sum, entry) => sum + getHouseTimeAmount(entry), 0);
  const totalPaid = getAutoAllocatedPaidForSelectedEntries(filteredEntries);
  const totalBalance = totalDue - totalPaid;

  const currentRate = parseHouseHourlyRate(hourDraft.hourlyRate);
  const previewEntry = {
    startTime: hourDraft.startTime,
    endTime: hourDraft.endTime,
    breakMinutes: Number(hourDraft.breakMinutes || 0),
    hourlyRate: currentRate ?? 0
  };
  const previewHours = getHouseTimeHours(previewEntry);
  const previewAmount = getHouseTimeAmount(previewEntry);

  const balanceRows = workers
    .map((worker) => {
      const workerEntries = filteredEntries.filter((entry) => entry.workerId === worker.id);

      const hours = workerEntries.reduce((sum, entry) => sum + getHouseTimeHours(entry), 0);
      const due = workerEntries.reduce((sum, entry) => sum + getHouseTimeAmount(entry), 0);
      const paid = getAutoAllocatedPaidForSelectedEntries(workerEntries);
      const balance = due - paid;

      return {
        worker,
        hours,
        due,
        paid,
        balance
      };
    })
    .filter((row) => row.hours > 0 || row.paid > 0 || row.balance !== 0);

  function isArchivedWorker(workerId: string) {
    const worker = workers.find((item) => item.id === workerId);
    return Boolean(worker && !isHouseTrackingWorkerActive(worker));
  }

  function closeArchivedWorkerPicker() {
    setShowArchivedWorkerPicker(false);
    setArchivedWorkerSearch("");
  }

  function selectArchivedWorker(workerId: string) {
    setWorkerFilter(workerId);
    setShowAllHoursHistory(false);
    setShowAllPaymentsHistory(false);
    closeArchivedWorkerPicker();
  }

  function changeHouseSection(section: "today" | "hours" | "payments" | "settings") {
    if (section === "today" && isArchivedWorker(workerFilter)) {
      setWorkerFilter("Tous");
    }

    setHouseSection(section);
  }

  function submitHouse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();

    if (!name) return window.alert(dialogT("crm.house.8d89aeb6e6"));

    onAddHouse({
      id: makeId("house"),
      name,
      address: String(form.get("address") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      createdAt: new Date().toISOString()
    });

    event.currentTarget.reset();
  }

  async function submitWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const contactInput = String(form.get("contactSearch") ?? "").trim();
    const contact = findHouseTrackingContact(contactInput);

    if (!contact) return window.alert(dialogT("crm.house.596f0a21b5"));

    const rate = parseHouseHourlyRate(String(form.get("hourlyRate") ?? ""));
    if (rate === null) return window.alert(dialogT("crm.house.d09ba721d3"));

    const workerId = makeId("worker");
    onAddWorker({
      id: workerId,
      contactId: contact.id,
      contactName: getHouseContactDisplayName(contact),
      role: contact.kind === "Membre de l’organisation" ? contact.organizationFunction || contact.kind : contact.supplierCategory || contact.kind || "Prestataire",
      hourlyRate: rate,
      status: "Actif",
      notes: String(form.get("notes") ?? "").trim(),
      createdAt: new Date().toISOString()
    });

    formElement.reset();
  }

  function submitTimeEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isQuarterHourTime(hourDraft.startTime) || !isQuarterHourTime(hourDraft.endTime)) {
      return window.alert(dialogT("crm.house.b5727b642e"));
    }

    const house = houses.find((item) => item.id === hourDraft.houseId);
    const worker = activeWorkers.find((item) => item.id === hourDraft.workerId);

    if (!house) return window.alert(dialogT("crm.house.b480a1ac0e"));
    if (!worker) return window.alert(dialogT("crm.house.448f15e3f4"));
    if (previewHours <= 0) return window.alert(dialogT("crm.house.5e7f7eb62a"));
    if (currentRate === null) { setRateError(screenNotice("crm.house.d09ba721d3")); return; }
    setRateError("");

    const entry: HouseTimeEntry = {
      id: makeId("hours"),
      houseId: house.id,
      houseName: house.name,
      workerId: worker.id,
      workerName: worker.contactName,
      date: hourDraft.date,
      startTime: hourDraft.startTime,
      endTime: hourDraft.endTime,
      breakMinutes: Number(hourDraft.breakMinutes || 0),
      hourlyRate: currentRate,
      note: hourDraft.note.trim(),
      createdAt: new Date().toISOString()
    };
    void hourConfirmation.submit(event.currentTarget, () => onAddTimeEntry(entry), newerDraft => {
      if (!newerDraft) setHourDraft(current => ({ ...current, note: "", hourlyRate: houseHourlyRateInput(worker) }));
    });
  }

  function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const house = houses.find((item) => item.id === String(form.get("houseId") ?? ""));
    const worker = activeWorkers.find((item) => item.id === String(form.get("workerId") ?? ""));
    const amount = safeNumber(form.get("amount"));

    if (!house) return window.alert(dialogT("crm.house.b480a1ac0e"));
    if (!worker) return window.alert(dialogT("crm.house.448f15e3f4"));
    if (amount <= 0) return window.alert(dialogT("crm.house.5977ed8bd3"));

    onAddPayment({
      id: makeId("payment"),
      houseId: house.id,
      houseName: house.name,
      workerId: worker.id,
      workerName: worker.contactName,
      date: String(form.get("date") ?? today),
      amount,
      method: String(form.get("method") ?? "Virement") as HousePayment["method"],
      note: String(form.get("note") ?? "").trim(),
      createdAt: new Date().toISOString()
    });

    event.currentTarget.reset();
  }

  async function exportHouseCsv() {
    if(business){try{await business.check();}catch{return;}}
    const rows = [
      ["Type", "Date", "Maison", "Intervenant", "Role", "Debut", "Fin", "Pause", "Heures", "Taux", "Du", "Paye", "Moyen", "Note"],
      ...filteredEntries.map((entry) => {
        const worker = workers.find((item) => item.id === entry.workerId);
        return [
          "Heures",
          entry.date,
          entry.houseName,
          entry.workerName,
          worker?.role || "",
          entry.startTime,
          entry.endTime,
          String(entry.breakMinutes),
          String(getHouseTimeHours(entry)),
          String(entry.hourlyRate),
          String(getHouseTimeAmount(entry)),
          "",
          "",
          entry.note || ""
        ];
      }),
      ...filteredPayments.map((payment) => {
        const worker = workers.find((item) => item.id === payment.workerId);
        return [
          "Paiement",
          payment.date,
          payment.houseName,
          payment.workerName,
          worker?.role || "",
          "",
          "",
          "",
          "",
          "",
          "",
          String(payment.amount),
          payment.method,
          payment.note || ""
        ];
      })
    ];

    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `suivi-maison-${dateRange.start || "debut"}-${dateRange.end || "fin"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack house-tracking-view house-simple-tabs-view">
      <section className="card house-control-card">
        <div className="section-heading house-section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Personnel & interventions"}>{t("crm.house.d332e9d924")}</p>
            <h3>{t("crm.house.3202717277")}</h3>
          </div>
          <BusinessButton permission="export" className="secondary-button" type="button" onClick={exportHouseCsv}>{t("crm.house.91f71c14c8")}</BusinessButton>
        </div>

        <div className="stats-grid house-summary-grid">
          <StatCard label={t("crm.house.2aa022f972")} value={formatHours(totalHours)} caption={t("crm.house.7b4c244221")} />
          <StatCard label={t("crm.house.f86724b3a3")} value={screen.money(totalDue)} caption={t("crm.house.986f5333cf")} />
          <StatCard label={t("crm.house.2542792ee0")} value={screen.money(totalPaid)} caption={t("crm.house.a986ecc855")} />
          <StatCard label={t("crm.house.caa3596424")} value={screen.balance(totalBalance)} caption={t("crm.house.efd45db922")} />
        </div>

        <div className="house-filter-row">
          <BusinessLabel>{t("crm.house.f12d68908f")}<input
              type="date"
              value={dateRange.start}
              onChange={(event) => setDateRange((current) => ({ ...current, start: event.target.value }))}
            />
          </BusinessLabel>

          <BusinessLabel>{t("crm.house.2382a693af")}<input
              type="date"
              value={dateRange.end}
              onChange={(event) => setDateRange((current) => ({ ...current, end: event.target.value }))}
            />
          </BusinessLabel>

          <BusinessLabel>{t("crm.house.686e3f21c3")}<select value={houseFilter} onChange={(event) => setHouseFilter(event.target.value)}>
              <option value="Tous">{t("crm.house.0fd6f75852")}</option>
              {houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}
            </select>
          </BusinessLabel>

          <div className="house-worker-filter">
            <span className="house-worker-filter-label">{t("crm.house.d282bc2490")}</span>
            <div className="house-worker-filter-controls">
              <div className="house-worker-filter-scroll" role="group" aria-label={t("crm.house.4d1145f1f0")}>
                <BusinessButton
                  className={workerFilter === "Tous" ? "house-worker-filter-button active" : "house-worker-filter-button"}
                  type="button"
                  aria-pressed={workerFilter === "Tous"}
                  onClick={() => setWorkerFilter("Tous")}
                >{t("crm.house.2ff5998143")}</BusinessButton>
                {activeWorkers.map((worker) => (
                  <BusinessButton
                    className={workerFilter === worker.id ? "house-worker-filter-button active" : "house-worker-filter-button"}
                    key={worker.id}
                    type="button"
                    aria-pressed={workerFilter === worker.id}
                    onClick={() => setWorkerFilter(worker.id)}
                  >
                    {worker.contactName}
                  </BusinessButton>
                ))}
              </div>
              {houseSection !== "today" && (
                <BusinessButton
                  className="secondary-button house-archive-trigger"
                  type="button"
                  disabled={archivedWorkers.length === 0}
                  aria-haspopup="dialog"
                  onClick={() => setShowArchivedWorkerPicker(true)}
                >{t("crm.house.2d73aee861")}{archivedWorkers.length})
                </BusinessButton>
              )}
            </div>
          </div>
        </div>
      </section>

      <nav className="house-tabs" aria-label={t("crm.house.64e5dfc548")}>
        <BusinessButton className={houseSection === "today" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("today")}>{t("crm.house.f2de9e072a")}</BusinessButton>
        <BusinessButton className={houseSection === "hours" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("hours")}>{t("crm.house.2aa022f972")}</BusinessButton>
        <BusinessButton className={houseSection === "payments" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("payments")}>{t("crm.house.6983e27953")}</BusinessButton>
        <BusinessButton className={houseSection === "settings" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("settings")}>{t("crm.house.4ed117e09c")}</BusinessButton>
      </nav>

      {selectedArchivedWorker && selectedArchivedWorkerHistory && houseSection !== "today" && (
        <section className="house-archived-filter-banner" aria-label={t("crm.house.d18c07c8ea", { value1: displayValue(selectedArchivedWorker.contactName) })}>
          <div>
            <div className="house-archived-filter-title">
              <strong>{t("crm.house.04ad4211a1")}{" "}{selectedArchivedWorker.contactName}</strong>
              <span className="status-pill house-archived-badge" data-semantic-text={"Archivé"}>{t("crm.house.19dd658159")}</span>
            </div>
            <span>{t("crm.house.d401c40989")}{" "}{selectedArchivedWorker.role}</span>
            <small>
              {selectedArchivedWorkerHistory.timeEntries}{" "}{t("crm.house.a32a388110")}{" "}{formatHours(selectedArchivedWorkerHistory.hours)} · {selectedArchivedWorkerHistory.payments}{" "}{t("crm.house.46b89242b3")}{" "}{screen.money(selectedArchivedWorkerHistory.paid)}{" "}{t("crm.house.23cabccc65")}{" "}{screen.balance(selectedArchivedWorkerHistory.balance)}
            </small>
          </div>
          <div className="house-archived-filter-actions">
            {houseSection !== "settings" && (
              <BusinessButton className="secondary-button" type="button" onClick={() => changeHouseSection("settings")} data-crm-auto-scroll="true">{t("crm.house.f5e210e42d")}</BusinessButton>
            )}
            <BusinessButton className="secondary-button" type="button" onClick={() => setWorkerFilter("Tous")}>{t("crm.house.987860c426")}</BusinessButton>
          </div>
        </section>
      )}

      {houseSection === "today" && (
        <section className="card house-tab-panel">
          <div className="section-heading house-section-heading">
            <div>
              <p className="eyebrow" data-semantic-text={"Vue rapide"}>{t("crm.house.aa4b970347")}</p>
              <h3>{t("crm.house.f2de9e072a")}</h3>
            </div>
            <div className="house-quick-actions">
              <BusinessButton className="primary-button" type="button" onClick={() => changeHouseSection("hours")}>{t("crm.house.b2e71697c7")}</BusinessButton>
              <BusinessButton className="secondary-button" type="button" onClick={() => changeHouseSection("payments")}>{t("crm.house.5d28561b1f")}</BusinessButton>
              <BusinessButton className="secondary-button" type="button" onClick={() => changeHouseSection("settings")}>{t("crm.house.4ed117e09c")}</BusinessButton>
            </div>
          </div>

          <div className="house-today-grid">
            <div className="house-mini-panel">
              <p className="eyebrow" data-semantic-text={"À payer"}>{t("crm.house.f86724b3a3")}</p>
              {balanceRows.filter((row) => row.balance > 0 && activeWorkerIds.has(row.worker.id)).length === 0 ? (
                <p className="muted-line">{t("crm.house.ecd02a3c6a")}</p>
              ) : balanceRows.filter((row) => row.balance > 0 && activeWorkerIds.has(row.worker.id)).slice(0, 6).map((row) => (
                <article className="mini-row house-compact-row" key={row.worker.id} data-notification-target={`house-worker-${row.worker.id}`}>
                  <div>
                    <strong>{row.worker.contactName}</strong>
                    <span>{formatHours(row.hours)} · {screen.money(row.due)}{" "}{t("crm.house.8adbe51aa7")}{" "}{screen.money(row.paid)}{" "}{t("crm.house.36e0bcfd26")}</span>
                  </div>
                  <strong className="house-balance-positive">{screen.balance(row.balance)}</strong>
                </article>
              ))}
            </div>

            <div className="house-mini-panel">
              <p className="eyebrow" data-semantic-text={"Heures du jour"}>{t("crm.house.a6e16e3c64")}</p>
              {filteredEntries.filter((entry) => normalizeHouseDateValue(entry.date) === today && activeWorkerIds.has(entry.workerId)).length === 0 ? (
                <p className="muted-line">{t("crm.house.4491cee4c7")}</p>
              ) : filteredEntries.filter((entry) => normalizeHouseDateValue(entry.date) === today && activeWorkerIds.has(entry.workerId)).slice(0, 6).map((entry) => (
                <article className="mini-row house-compact-row" key={entry.id} id={`house-time-${entry.id}`}>
                  <div>
                    <strong>{entry.workerName}</strong>
                    <span>{entry.houseName} · {entry.startTime}{" "}{t("crm.house.b3fc9de526")}{" "}{entry.endTime}</span>
                  </div>
                  <strong>{formatHours(getHouseTimeHours(entry))}</strong>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {houseSection === "hours" && (
        <div className="house-two-columns">
          <section className="card house-tab-panel">
            <p className="eyebrow" data-semantic-text={"Saisie"}>{t("crm.house.611d0882f8")}</p>
            <h3>{t("crm.house.256880175c")}</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitTimeEntry} pending={hourConfirmation.saving} onChange={hourConfirmation.changed}>
              <BusinessLabel>{t("crm.house.99c40ab405")}<input type="date" value={hourDraft.date} onChange={(event) => setHourDraft((current) => ({ ...current, date: event.target.value }))} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.686e3f21c3")}<select value={hourDraft.houseId} onChange={(event) => setHourDraft((current) => ({ ...current, houseId: event.target.value }))}>
                  <option value="">{t("crm.house.3f2aaae201")}</option>
                  {houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.d282bc2490")}<select value={hourDraft.workerId} onChange={(event) => {
                  const worker = activeWorkers.find((item) => item.id === event.target.value);
                  setHourDraft((current) => ({ ...current, workerId: event.target.value, hourlyRate: houseHourlyRateInput(worker) }));
                }}>
                  <option value="">{t("crm.house.3f2aaae201")}</option>
                  {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.contactName}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.3c48aa2bdf")}<select value={hourDraft.startTime} onChange={(event) => setHourDraft((current) => ({ ...current, startTime: event.target.value }))}>
                  {QUARTER_HOUR_TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.5a2af601e7")}<select value={hourDraft.endTime} onChange={(event) => setHourDraft((current) => ({ ...current, endTime: event.target.value }))}>
                  {QUARTER_HOUR_TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.286518b073")}<input type="number" min="0" value={hourDraft.breakMinutes} onChange={(event) => setHourDraft((current) => ({ ...current, breakMinutes: event.target.value }))} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.18e4968684")}<input type="text" inputMode="decimal" value={hourDraft.hourlyRate} onChange={(event) => setHourDraft((current) => ({ ...current, hourlyRate: event.target.value }))} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.d8da2c49df")}<input value={hourDraft.note} onChange={(event) => setHourDraft((current) => ({ ...current, note: event.target.value }))} placeholder={t("crm.house.3189d156a1")} />
              </BusinessLabel>
              <div className="full house-calculation-line">
                {rateError ? <span role="alert">{screenText(rateError)}</span> : <ConfirmedFormMessage message={hourConfirmation.message} inline />} {t("crm.house.0c61feeeed")}{" "}<strong>{formatHours(previewHours)}</strong> — <strong>{currentRate === null ? t("crm.house.8fbded43f0") : screen.money(previewAmount)}</strong>
              </div>
              <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.house.36b6df45c3")}</BusinessButton>
            </BusinessForm>
          </section>

          <section className="card house-tab-panel">
            <p className="eyebrow" data-semantic-text={"Historique"}>{t("crm.house.865df3324a")}</p>
            <h3>{t("crm.house.a950998f6e")}</h3>
            <div className="list-stack house-history-list">
              {filteredEntries.length === 0 ? <p className="muted-line">{t("crm.house.88613b70e0")}</p> : visibleHourEntries.map((entry) => (
                <article className="mini-row house-compact-row" key={entry.id} id={`house-time-${entry.id}`}>
                  <div>
                    <strong>{entry.workerName}</strong>
                    {isArchivedWorker(entry.workerId) && <span className="status-pill house-archived-badge" data-semantic-text={"Archivé"}>{t("crm.house.19dd658159")}</span>}
                    <span>{entry.date} · {entry.houseName} · {entry.startTime}{" "}{t("crm.house.b3fc9de526")}{" "}{entry.endTime} · {formatHours(getHouseTimeHours(entry))} · {screen.money(getHouseTimeAmount(entry))}</span>
                  </div>
                  <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => window.confirm(dialogT("crm.house.09ecd9edc3")) && onDeleteTimeEntry(entry.id)}>{t("crm.house.41e12b1333")}</BusinessButton>
                </article>
              ))}
            </div>
            {filteredEntries.length > 7 && (
              <BusinessButton className="secondary-button" type="button" onClick={() => setShowAllHoursHistory((current) => !current)}>
                {showAllHoursHistory ? t("crm.house.77f77c351c") : t("crm.house.471a4acb30", { value1: displayValue(filteredEntries.length) })}
              </BusinessButton>
            )}
          </section>
        </div>
      )}

      {houseSection === "payments" && (
        <div className="house-two-columns">
          <section className="card house-tab-panel">
            <p className="eyebrow" data-semantic-text={"Paiements"}>{t("crm.house.6983e27953")}</p>
            <h3>{t("crm.house.3eb015cda0")}</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitPayment}>
              <BusinessLabel>{t("crm.house.99c40ab405")}<input name="date" type="date" defaultValue={today} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.686e3f21c3")}<select name="houseId" defaultValue={houses[0]?.id || ""}>
                  <option value="">{t("crm.house.3f2aaae201")}</option>
                  {houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.d282bc2490")}<select name="workerId" defaultValue={initialActiveWorker?.id || ""}>
                  <option value="">{t("crm.house.3f2aaae201")}</option>
                  {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.contactName}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.947cc07e2b")}<input name="amount" type="text" inputMode="decimal" min="0" step="1" placeholder={t("crm.house.3b23fa9915")} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.28eca2c0e2")}<select name="method" defaultValue="Virement">
                  <option value="Virement">{t("crm.house.e58f0ffa0e")}</option>
                  <option value="Espèces">{t("crm.house.351f789647")}</option>
                  <option value="CB">{t("crm.house.bf7b0ead27")}</option>
                  <option value="Chèque">{t("crm.house.723a0b78dd")}</option>
                  <option value="Autre">{t("crm.house.eb72e1683b")}</option>
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.d8da2c49df")}<input name="note" placeholder={t("crm.house.13a71e2ca2")} />
              </BusinessLabel>
              <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.house.f85aef82b7")}</BusinessButton>
            </BusinessForm>
          </section>

          <section className="card house-tab-panel">
            <p className="eyebrow" data-semantic-text={"Historique"}>{t("crm.house.865df3324a")}</p>
            <h3>{t("crm.house.f96547f753")}</h3>
            <div className="list-stack house-history-list">
              {filteredPayments.length === 0 ? <p className="muted-line">{t("crm.house.9b8270818a")}</p> : visiblePaymentEntries.map((payment) => (
                <article className="mini-row house-compact-row" key={payment.id}>
                  <div>
                    <strong>{payment.workerName}</strong>
                    {isArchivedWorker(payment.workerId) && <span className="status-pill house-archived-badge" data-semantic-text={"Archivé"}>{t("crm.house.19dd658159")}</span>}
                    <span>{payment.date} · {payment.houseName} · {screen.money(payment.amount)} · {label(payment.method, "crm")}</span>
                  </div>
                  <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => window.confirm(dialogT("crm.house.5bcaf17712")) && onDeletePayment(payment.id)}>{t("crm.house.41e12b1333")}</BusinessButton>
                </article>
              ))}
            </div>
            {filteredPayments.length > 7 && (
              <BusinessButton className="secondary-button" type="button" onClick={() => setShowAllPaymentsHistory((current) => !current)}>
                {showAllPaymentsHistory ? t("crm.house.77f77c351c") : t("crm.house.471a4acb30", { value1: displayValue(filteredPayments.length) })}
              </BusinessButton>
            )}
          </section>
        </div>
      )}

      {houseSection === "settings" && (
        <div className="house-two-columns">
          <section className="card house-tab-panel">
            <p className="eyebrow" data-semantic-text={"Réglages"}>{t("crm.house.4ed117e09c")}</p>
            <h3>{t("crm.house.58d07cab4d")}</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitHouse}>
              <BusinessLabel>{t("crm.house.b2c124536d")}<input name="name" placeholder={t("crm.house.3a4d1efc3f")} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.79e5cf20de")}<input name="address" placeholder={t("crm.house.79e5cf20de")} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.8a7525b149")}<textarea name="notes" placeholder={t("crm.house.725032bb63")} />
              </BusinessLabel>
              <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.house.e43ab9e9e4")}</BusinessButton>
            </BusinessForm>
            <div className="list-stack house-history-list">
              {houses.length === 0 ? <p className="muted-line">{t("crm.house.153fc60415")}</p> : houses.map((house) => (
                <article className="mini-row house-compact-row" key={house.id}>
                  <div>
                    <strong>{house.name}</strong>
                    <span>{house.address || t("crm.house.a8293fde8d")}</span>
                  </div>
                  <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => window.confirm(dialogT("crm.house.efa472048f")) && onDeleteHouse(house.id)}>{t("crm.house.41e12b1333")}</BusinessButton>
                </article>
              ))}
            </div>
          </section>

          <section className="card house-tab-panel">
            <p className="eyebrow" data-semantic-text={"Réglages"}>{t("crm.house.4ed117e09c")}</p>
            <h3>{t("crm.house.8e72b6ff33")}</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitWorker}>
              <BusinessLabel>{t("crm.house.424439cbf0")}<input name="contactSearch" list="house-contact-options" placeholder={t("crm.house.2c2872e46b")} autoComplete="off" />
                <datalist id="house-contact-options">
                  {sortedHouseContacts.map((contact) => <option key={contact.id} value={getHouseContactSearchLabel(contact)} />)}
                </datalist>
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.18e4968684")}<input name="hourlyRate" type="text" inputMode="decimal" required placeholder={t("crm.house.b9e2dc644a")} />
              </BusinessLabel>
              <BusinessLabel>{t("crm.house.8a7525b149")}<textarea name="notes" placeholder={t("crm.house.159f72a01a")} />
              </BusinessLabel>
              <BusinessButton permission="write" className="primary-button" type="submit">{t("crm.house.95b1bf7262")}</BusinessButton>
            </BusinessForm>

            {editingWorkerId && onUpdateWorker && (() => {
              const worker = activeWorkers.find(item => item.id === editingWorkerId);
              return worker ? <HouseWorkerEditor key={worker.id} worker={worker} onSave={onUpdateWorker}
                onCancel={() => setEditingWorkerId(null)}
                onConfirmed={rate => {
                  setHourDraft(current => current.workerId === worker.id ? { ...current, hourlyRate: String(rate) } : current);
                  setEditingWorkerId(null);
                }} /> : null;
            })()}

            <div className="list-stack house-history-list">
              {activeWorkers.length === 0 ? <p className="muted-line">{t("crm.house.af13fc6bb4")}</p> : activeWorkers.map((worker) => {
                const hasHistory = houseTrackingWorkerHasHistory(worker.id, timeEntries, payments);

                return (
                  <article className="mini-row house-compact-row" key={worker.id} data-notification-target={`house-worker-${worker.id}`}>
                    <div>
                      <strong>{worker.contactName}</strong>
                      <span>{worker.role} · {worker.hourlyRate == null ? t("crm.house.7765db4922") : t("crm.house.eafcadd06b", { value1: displayValue(screen.money(worker.hourlyRate)) })}</span>
                      {onOpenContact && access && readable(access, "contacts") && contacts.some(contact => contact.id === worker.contactId) && (
                        <button className="secondary-link" type="button" onClick={() => onOpenContact(worker.contactId)} data-crm-auto-scroll="true">{t("crm.house.39bb8b1625")}</button>
                      )}
                    </div>
                    <div className="house-worker-actions">
                      {onUpdateWorker && <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => setEditingWorkerId(worker.id)} data-crm-auto-scroll="true">{t("crm.house.42e37604b6")}</BusinessButton>}
                      <BusinessButton permission="write"
                        className="secondary-button"
                        type="button"
                        onClick={() => window.confirm(dialogT("crm.house.f87e5f353a", { value1: displayValue(worker.contactName) })) && onArchiveWorker(worker.id)}
                      >{t("crm.house.8614cf0058")}</BusinessButton>
                      {!hasHistory && (
                        <BusinessButton permission="remove"
                          className="danger-link"
                          type="button"
                          onClick={() => window.confirm(dialogT("crm.house.b832306a3e", { value1: displayValue(worker.contactName) })) && onPermanentlyDeleteWorker(worker.id)}
                        >{t("crm.house.1a797b980d")}</BusinessButton>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <details className="house-archived-workers">
              <summary>{t("crm.house.1d455b99eb")}{archivedWorkers.length})</summary>
              <div className="list-stack house-history-list">
                {archivedWorkers.length === 0 ? <p className="muted-line">{t("crm.house.2a9b5e967e")}</p> : archivedWorkers.map((worker) => {
                  const history = getHouseTrackingWorkerHistorySummary(worker.id, timeEntries, payments);
                  const hasHistory = history.timeEntries > 0 || history.payments > 0;

                  return (
                    <article className="mini-row house-compact-row house-archived-worker-row" key={worker.id} data-notification-target={`house-worker-${worker.id}`}>
                      <div>
                        <strong>{worker.contactName} <span className="status-pill house-archived-badge" data-semantic-text={"Archivé"}>{t("crm.house.19dd658159")}</span></strong>
                        <span>{worker.role} · {worker.hourlyRate == null ? t("crm.house.7765db4922") : t("crm.house.eafcadd06b", { value1: displayValue(screen.money(worker.hourlyRate)) })}</span>
                        <span>{history.timeEntries}{" "}{t("crm.house.a32a388110")}{" "}{formatHours(history.hours)} · {history.payments}{" "}{t("crm.house.46b89242b3")}{" "}{screen.money(history.paid)}{" "}{t("crm.house.36e0bcfd26")}</span>
                        <span>{t("crm.house.385da126a8")}{" "}{screen.money(history.due)}{" "}{t("crm.house.8580f17f02")}{" "}{screen.balance(history.balance)}</span>
                        {onOpenContact && access && readable(access, "contacts") && contacts.some(contact => contact.id === worker.contactId) && (
                          <button className="secondary-link" type="button" onClick={() => onOpenContact(worker.contactId)} data-crm-auto-scroll="true">{t("crm.house.39bb8b1625")}</button>
                        )}
                      </div>
                      <div className="house-worker-actions">
                        <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => onReactivateWorker(worker.id)}>{t("crm.house.0efc2e864f")}</BusinessButton>
                        {!hasHistory && (
                          <BusinessButton permission="remove"
                            className="danger-link"
                            type="button"
                            onClick={() => window.confirm(dialogT("crm.house.b832306a3e", { value1: displayValue(worker.contactName) })) && onPermanentlyDeleteWorker(worker.id)}
                          >{t("crm.house.1a797b980d")}</BusinessButton>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </details>
          </section>

          <section className="card house-tab-panel full">
            <p className="eyebrow" data-semantic-text={"Soldes"}>{t("crm.house.6804a53c7a")}</p>
            <h3>{t("crm.house.2e8b9c7bfa")}</h3>
            {balanceRows.length === 0 ? (
              <p className="muted-line">{t("crm.house.bc7e97eb9c")}</p>
            ) : (
              <div className="table-wrapper">
                <table className="mobile-card-table house-balance-table">
                  <thead>
                    <tr>
                      <th>{t("crm.house.d282bc2490")}</th>
                      <th>{t("crm.house.2aa022f972")}</th>
                      <th>{t("crm.house.986f5333cf")}</th>
                      <th>{t("crm.house.2542792ee0")}</th>
                      <th>{t("crm.house.18833da39f")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balanceRows.map((row) => (
                      <tr key={row.worker.id}>
                        <td data-label={t("crm.house.d282bc2490")}>
                          <strong>{row.worker.contactName}</strong>{!isHouseTrackingWorkerActive(row.worker) && <span className="status-pill house-archived-badge" data-semantic-text={"Archivé"}>{t("crm.house.19dd658159")}</span>}
                          <br /><span className="muted-line">{row.worker.role}</span>
                        </td>
                        <td data-label={t("crm.house.2aa022f972")}>{formatHours(row.hours)}</td>
                        <td data-label={t("crm.house.986f5333cf")}>{screen.money(row.due)}</td>
                        <td data-label={t("crm.house.2542792ee0")}>{screen.money(row.paid)}</td>
                        <td data-label={t("crm.house.18833da39f")}><strong className={row.balance > 0 ? "house-balance-positive" : row.balance < 0 ? "house-balance-negative" : "house-balance-zero"}>{screen.balance(row.balance)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {showArchivedWorkerPicker && (
        <div className="house-archive-picker-overlay" role="presentation" onClick={closeArchivedWorkerPicker}>
          <section
            className="house-archive-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="house-archive-picker-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="house-archive-picker-heading">
              <div>
                <p className="eyebrow" data-semantic-text={"Archives"}>{t("crm.house.e404aa80d8")}</p>
                <h3 id="house-archive-picker-title">{t("crm.house.7fdb14b092")}</h3>
              </div>
              <BusinessButton className="secondary-button house-archive-picker-close" type="button" aria-label={t("crm.house.711e5f2e19")} onClick={closeArchivedWorkerPicker}>{t("crm.house.8db71ed28b")}</BusinessButton>
            </div>

            {archivedWorkers.length > 1 && (
              <BusinessLabel className="house-archive-search">{t("crm.house.733d1c7426")}<input
                  autoFocus
                  type="search"
                  value={archivedWorkerSearch}
                  placeholder={t("crm.house.249e844308")}
                  onChange={(event) => setArchivedWorkerSearch(event.target.value)}
                />
              </BusinessLabel>
            )}

            <div className="house-archive-picker-list">
              {visibleArchivedWorkers.length === 0 ? (
                <p className="muted-line">{t("crm.house.ddd5df2fdb")}</p>
              ) : visibleArchivedWorkers.map((worker) => {
                const history = getHouseTrackingWorkerHistorySummary(worker.id, timeEntries, payments);

                return (
                  <BusinessButton className="house-archive-worker-button" key={worker.id} type="button" onClick={() => selectArchivedWorker(worker.id)}>
                    <span className="house-archive-worker-name">
                      <strong>{worker.contactName}</strong>
                      <span className="status-pill house-archived-badge" data-semantic-text={"Archivé"}>{t("crm.house.19dd658159")}</span>
                    </span>
                    <span>{worker.role} · {formatHours(history.hours)} · {screen.money(history.paid)}{" "}{t("crm.house.36e0bcfd26")}</span>
                    <small>{history.timeEntries}{" "}{t("crm.house.c9bf8fc5fb")}{" "}{history.payments}{" "}{t("crm.house.63a6b30eb7")}{" "}{screen.balance(history.balance)}</small>
                  </BusinessButton>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function VendorInvoicesView({
  actor,
  onUpdateContact,
  contacts,
  documents,
  invoices,
  quotes,
  onDeleteOrphan,
  onAdd,
  onUpdate,
  onDelete,
  onOpenQuote,
  focusInvoiceId
}: {
  actor: string;
  onUpdateContact: (contact: Contact) => FormSave;
  contacts: Contact[];
  documents: CRMDocument[];
  invoices: VendorInvoice[];
  quotes: VendorQuote[];
  onDeleteOrphan: (id: string) => void;
  onAdd: (invoice: VendorInvoice) => void;
  onUpdate: (invoice: VendorInvoice) => void;
  onDelete: (id: string) => void;
  onOpenQuote: (quoteId: string) => void;
  focusInvoiceId?: string;
}) {
  const { t, label, screen, screenText, dialogText, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const [bankContactId, setBankContactId] = useState("");
  const bankContact = contacts.find(c => c.id === bankContactId);
  const [statusFilter, setStatusFilter] = useState<VendorInvoice["status"] | "Tous">("Tous");
  const [editingInvoice, setEditingInvoice] = useState<VendorInvoice | null>(null);
  const [uploadingInvoiceDocument, setUploadingInvoiceDocument] = useState(false);
  const [duplicateDecision, setDuplicateDecision] = useState<{
    duplicates: VendorInvoiceDuplicate[]; reference?: string; form: HTMLFormElement;
  } | null>(null);
  const [previewingInvoiceDocument, setPreviewingInvoiceDocument] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<{
    invoice: VendorInvoice;
    url: string;
    fileName: string;
    mimeType: string;
    external: boolean;
  } | null>(null);
  useEffect(() => {
    if (!focusInvoiceId || !invoices.some(invoice => invoice.id === focusInvoiceId)) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`vendor-invoice-${focusInvoiceId}`)?.scrollIntoView({ block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusInvoiceId, invoices]);

  useEffect(() => {
    return () => {
      if (invoicePreview?.url?.startsWith("blob:")) {
        URL.revokeObjectURL(invoicePreview.url);
      }
    };
  }, [invoicePreview?.url]);

  function closeVendorInvoicePreview() {
    if (invoicePreview?.url?.startsWith("blob:")) {
      URL.revokeObjectURL(invoicePreview.url);
    }

    setInvoicePreview(null);
  }

  const selectableContacts = useMemo(
    () =>
      contacts
        .filter(
          (contact) =>
            isEligibleVendorContact(contact) &&
            getVendorBusinessName(contact) !== "Contact sans nom"
        )
        .sort((a, b) =>
          getVendorBusinessName(a).localeCompare(getVendorBusinessName(b), "fr")
        ),
    [contacts]
  );

  function findContactForVendorInvoice(invoice?: VendorInvoice | null) {
    if (!invoice) return null;

    const byId = contacts.find((contact) => contact.id === invoice.contactId);
    if (byId) return byId;
    if (invoice.contactId) return null;

    const wanted = normalizeVendorContactSearch(invoice.contactName);
    if (!wanted) return null;

    const wantedWords = wanted.split(" ").filter((word) => word.length > 1);

    return contacts.find((contact) => {
      const labels = [
        contact.name,
        getVendorBusinessName(contact),
        contact.companyName,
        contact.email,
        contact.phone,
        getVendorContactPersonName(contact),
        [contact.firstName, contact.name].filter(Boolean).join(" "),
        [contact.companyName, contact.name].filter(Boolean).join(" ")
      ]
        .map((value) => normalizeVendorContactSearch(value))
        .filter(Boolean);

      if (labels.includes(wanted)) return true;

      // Exemple : facture "Gardens Jardinier" et contact "Gardens Jardinier"
      // ou ancienne donnée légèrement différente.
      if (labels.some((label) => label.includes(wanted) || wanted.includes(label))) return true;

      const identity = normalizeVendorContactSearch(
        [contact.firstName, contact.name, contact.companyName].filter(Boolean).join(" ")
      );

      return wantedWords.length >= 2 && wantedWords.every((word) => identity.includes(word));
    }) || null;
  }

  // CRM_VENDOR_INVOICE_AUTO_LINK_EXISTING_CONTACT_20260620
  function getResolvedVendorInvoiceContactId(invoice?: VendorInvoice | null) {
    return findContactForVendorInvoice(invoice)?.id || invoice?.contactId || "";
  }

  // CRM_VENDOR_INVOICE_HISTORICAL_CONTACT_FIX_20260620
  function getHistoricalVendorInvoiceContactName(invoice?: VendorInvoice | null) {
    const resolvedContact = findContactForVendorInvoice(invoice);
    return resolvedContact
      ? getVendorBusinessName(resolvedContact)
      : String(invoice?.contactName || "").trim();
  }

  function startEditInvoice(invoice: VendorInvoice) {
    const resolvedContact = findContactForVendorInvoice(invoice);
    const resolvedContactId = resolvedContact?.id || invoice.contactId || "";

    setEditingInvoice({
      ...invoice,
      contactId: resolvedContactId,
      contactName: invoice.contactName,
      contactPersonName: resolvedContact
        ? getVendorContactPersonName(resolvedContact)
        : String(invoice.contactPersonName || "").trim(),
      category: resolvedContactId
        ? getContactProfessionForInvoice(resolvedContactId) || invoice.category || "Prestataire"
        : invoice.category || "Prestataire"
    });

    window.setTimeout(() => {
      document.querySelector(".vendor-invoices-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  // CRM_VENDOR_INVOICE_AUTO_CATEGORY_20260620
  // La catégorie d'une facture prestataire vient du contact CRM lié.
  // Ne pas remettre un champ manuel "Catégorie" dans le formulaire : double saisie = erreurs.
  function getContactProfessionForInvoice(contactId: string) {
    const contact = contacts.find((item) => item.id === contactId);

    if (!contact) return "";
    return getVendorContactProfession(contact);
  }

  // CRM_VENDOR_INVOICE_DIRECT_UPLOAD_20260622
  function sanitizeVendorInvoiceFileName(fileName: string) {
    return fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "facture";
  }

  async function uploadVendorInvoiceDocument(file: File, invoiceId: string) {
    if (business) return {invoiceDocumentStoragePath:await business.upload("vendorInvoices",invoiceId,file),invoiceDocumentName:file.name};
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw new Error("Utilisateur Supabase non connecté.");
    }

    const safeName = sanitizeVendorInvoiceFileName(file.name);
    const storagePath = `${SHARED_WORKSPACE_ID}/vendor-invoices/${invoiceId}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
      .from(CRM_DOCUMENTS_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: true
      });

    if (error) {
      throw new Error(error.message);
    }

    return {
      invoiceDocumentStoragePath: storagePath,
      invoiceDocumentName: file.name
    };
  }

  function getVendorInvoiceDocumentSource(invoice: VendorInvoice) {
    const linkedDocument = documents.find((crmDocument) => crmDocument.id === invoice.linkedDocumentId);

    return {
      storagePath: invoice.invoiceDocumentStoragePath || linkedDocument?.storagePath || "",
      externalUrl: invoice.invoiceDocumentUrl || linkedDocument?.url || "",
      fileName: invoice.invoiceDocumentName || linkedDocument?.fileName || linkedDocument?.title || invoice.title || "facture"
    };
  }

  function isVendorInvoicePreviewable(fileName: string, mimeType: string) {
    const extension = fileName.toLowerCase().split(".").pop() || "";

    return (
      mimeType === "application/pdf" ||
      mimeType.startsWith("image/") ||
      ["pdf", "png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension)
    );
  }

  async function openVendorInvoicePreview(invoice: VendorInvoice) {
    if(business)return business.download(invoice.invoiceDocumentStoragePath||"",invoice.invoiceDocumentName||"facture.pdf");
    const { storagePath, externalUrl, fileName } = getVendorInvoiceDocumentSource(invoice);

    if (invoicePreview?.url?.startsWith("blob:")) {
      URL.revokeObjectURL(invoicePreview.url);
    }

    if (storagePath) {
      try {
        setPreviewingInvoiceDocument(true);

        const { data: fileData, error } = await supabase.storage
          .from(CRM_DOCUMENTS_BUCKET)
          .download(storagePath);

        if (error || !fileData) {
          window.alert(dialogText(safeCRMError(error)));
          return;
        }

        const url = URL.createObjectURL(fileData);

        setInvoicePreview({
          invoice,
          url,
          fileName,
          mimeType: fileData.type || "",
          external: false
        });
      } finally {
        setPreviewingInvoiceDocument(false);
      }

      return;
    }

    if (externalUrl) {
      setInvoicePreview({
        invoice,
        url: externalUrl,
        fileName,
        mimeType: "",
        external: true
      });
      return;
    }

    window.alert(dialogT("crm.vendorInvoices.de17b50139"));
  }

  async function downloadVendorInvoiceDocument(invoice: VendorInvoice) {
    if (business) return business.download(invoice.invoiceDocumentStoragePath || "",invoice.invoiceDocumentName || "facture.pdf");
    const { storagePath, externalUrl, fileName } = getVendorInvoiceDocumentSource(invoice);

    if (storagePath) {
      const { data: fileData, error } = await supabase.storage
        .from(CRM_DOCUMENTS_BUCKET)
        .download(storagePath);

      if (error || !fileData) {
        window.alert(dialogText(safeCRMError(error)));
        return;
      }

      const url = URL.createObjectURL(fileData);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (externalUrl) {
      window.open(externalUrl, "_blank", "noopener,noreferrer");
      return;
    }

    window.alert(dialogT("crm.vendorInvoices.de17b50139"));
  }

  const visibleInvoices = statusFilter === "Tous"
    ? invoices
    : invoices.filter((invoice) => invoice.status === statusFilter);

  const totalToPay = getVendorInvoiceTotalRemaining(
    invoices.filter((invoice) =>
      invoice.status !== "En attente de facture" &&
      invoice.status !== "Payé" &&
      invoice.status !== "Annulé"
    )
  );

  async function submitInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await submitInvoiceForm(event.currentTarget);
  }

  async function submitInvoiceForm(formElement: HTMLFormElement, overrideDuplicate = false) {
    const form = new FormData(formElement);
    const contactId = String(form.get("contactId") ?? "");
    const contact = contacts.find((item) => item.id === contactId);
    const preserveLegacyContact = form.get("preserveLegacyContact") === "true";
    const amount = parseEuroAmount(form.get("amount"));
    const paidAmount = parseEuroAmount(form.get("paidAmount"));
    const dueDate = String(form.get("dueDate") ?? "");
    const automaticCategory = getContactProfessionForInvoice(contactId) || editingInvoice?.category || "Prestataire";
    const invoiceId = editingInvoice?.id || makeId("invoice");
    const invoiceFile = form.get("invoiceFile");
    const existingInvoiceDocument = Boolean(
      editingInvoice?.invoiceDocumentStoragePath ||
      editingInvoice?.invoiceDocumentUrl ||
      editingInvoice?.linkedDocumentId
    );

    const candidate = {
      ...editingInvoice, id: invoiceId, contactId,
      invoiceReference: String(form.get("invoiceReference") || "").trim()
    } as VendorInvoice;
    const duplicates = findVendorInvoiceDuplicates(candidate, invoices);
    if (!canSaveVendorInvoice(candidate, invoices, overrideDuplicate)) {
      setDuplicateDecision({ duplicates, reference: candidate.invoiceReference, form: formElement });
      return;
    }

    let uploadedInvoiceDocument: Partial<VendorInvoice> = {};

    if (invoiceFile instanceof File && invoiceFile.size > 0) {
      try {
        setUploadingInvoiceDocument(true);
        uploadedInvoiceDocument = await uploadVendorInvoiceDocument(invoiceFile, invoiceId);
        if (business) await business.check();
      } catch (error) {
        window.alert(dialogText(safeCRMError(error)));
        setUploadingInvoiceDocument(false);
        return;
      } finally {
        setUploadingInvoiceDocument(false);
      }
    }

    const hasInvoiceDocument = Boolean(
      uploadedInvoiceDocument.invoiceDocumentStoragePath ||
      uploadedInvoiceDocument.invoiceDocumentUrl ||
      existingInvoiceDocument
    );

    if (paidAmount > 0 && !hasInvoiceDocument) {
      window.alert(dialogT("crm.vendorInvoices.aad644a6d6"));
      return;
    }

    const invoice: VendorInvoice = {
      ...editingInvoice,
      id: invoiceId,
      contactId,
      contactName: editingInvoice && contactId === (editingInvoice.contactId || "")
        ? editingInvoice.contactName
        : contact
          ? getVendorBusinessName(contact)
          : preserveLegacyContact
            ? getHistoricalVendorInvoiceContactName(editingInvoice)
            : "",
      contactPersonName: contact
        ? getVendorContactPersonName(contact)
        : preserveLegacyContact
          ? String(editingInvoice?.contactPersonName || "").trim()
          : "",
      category: automaticCategory,
      invoiceReference: String(form.get("invoiceReference") || "").trim(),
      paymentBankAccountId: editingInvoice?.paymentBankAccountId,
      title: String(form.get("title") ?? "").trim() || "Facture prestataire",
      invoiceDate: String(form.get("invoiceDate") ?? ""),
      dueDate,
      amount,
      paidAmount,
      sourceQuoteId: editingInvoice?.sourceQuoteId || "",
      sourceQuoteReference: editingInvoice?.sourceQuoteReference || "",
      invoiceReceivedAt: hasInvoiceDocument ? editingInvoice?.invoiceReceivedAt || new Date().toISOString() : "",
      linkedDocumentId: editingInvoice?.linkedDocumentId || "",
      invoiceDocumentUrl: editingInvoice?.invoiceDocumentUrl || "",
      invoiceDocumentStoragePath: uploadedInvoiceDocument.invoiceDocumentStoragePath || editingInvoice?.invoiceDocumentStoragePath || "",
      invoiceDocumentName: uploadedInvoiceDocument.invoiceDocumentName || editingInvoice?.invoiceDocumentName || "",
      status: hasInvoiceDocument
        ? getVendorInvoiceStatus(amount, paidAmount, dueDate)
        : editingInvoice?.sourceQuoteId
          ? "En attente de facture"
          : getVendorInvoiceStatus(amount, paidAmount, dueDate),
      paymentMethod: String(form.get("paymentMethod") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      createdAt: editingInvoice?.createdAt || new Date().toISOString()
    };

    if (editingInvoice?.paymentBankAccountId && editingInvoice.contactId !== contactId) {
      window.alert(dialogT("crm.vendorInvoices.22e9a5602c")); return;
    }
    if (!invoice.contactName && (!business || business.read("contacts") || !editingInvoice)) return window.alert(dialogT("crm.vendorInvoices.75e5407945"));
    if (!invoice.amount || invoice.amount <= 0) return window.alert(dialogT("crm.vendorInvoices.4fdd295172"));

    if (editingInvoice) {
      onUpdate(invoice);
      setEditingInvoice(null);
    } else {
      onAdd(invoice);
    }

    formElement.reset();
  }

  return (
    <div className="two-columns wide-left vendor-invoices-view">
      {duplicateDecision && <VendorInvoiceDuplicateDialog duplicates={duplicateDecision.duplicates}
        reference={duplicateDecision.reference} editing={Boolean(editingInvoice)}
        onCancel={() => setDuplicateDecision(null)}
        onOpen={id => {
          const existing = invoices.find(invoice => invoice.id === id);
          setDuplicateDecision(null);
          if (existing) { setStatusFilter("Tous"); startEditInvoice(existing); }
        }} onConfirm={() => {
          const form = duplicateDecision.form;
          setDuplicateDecision(null);
          void submitInvoiceForm(form, true);
        }} />}
      {!business && bankContact && <VendorBankContactDialog contact={bankContact} actor={actor} onUpdate={onUpdateContact} onClose={() => setBankContactId("")} />}
      <section className="card vendor-invoices-list-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Factures prestataires"}>{t("crm.vendorInvoices.e3ba7d2e9c")}</p>
            <h3>{visibleInvoices.length}{" "}{t("crm.vendorInvoices.7007054154")}{visibleInvoices.length > 1 ? t("crm.vendorInvoices.043a718774") : ""}</h3>
          </div>
          <div>
            <p className="eyebrow" data-semantic-text={"Reste à payer"}>{t("crm.vendorInvoices.7d60750d7e")}</p>
            <h3>{screen.euro(totalToPay)}</h3>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          {(["Tous", "En attente de facture", "À payer", "Partiellement payé", "En retard", "Payé"] as Array<VendorInvoice["status"] | "Tous">).map((status) => (
            <BusinessButton
              key={status}
              type="button"
              className={`${statusFilter === status ? "primary-button" : "secondary-button"} ${status === "Payé" ? "invoice-filter-paid" : status === "Tous" ? "" : "invoice-filter-danger"}`}
              onClick={() => setStatusFilter(status)}
            >
              {label(status, "crm")}
            </BusinessButton>
          ))}
        </div>

        {visibleInvoices.length === 0 ? (<p className="muted-line">{t("crm.vendorInvoices.6a606c5248")}</p>) : (<div className="list-stack oar-contact-list-stack">
            {visibleInvoices.map((invoice) => {
              const orphan = isOrphanAutomaticVendorInvoice(invoice, quotes);
              const linkedContact = findContactForVendorInvoice(invoice);
              const businessName = linkedContact
                ? getVendorBusinessName(linkedContact)
                : invoice.contactName || "Prestataire non défini";
              const contactPersonName = linkedContact
                ? getVendorContactPersonName(linkedContact)
                : invoice.contactPersonName || "";
              const profession = linkedContact
                ? getVendorContactProfession(linkedContact) || invoice.category
                : invoice.category;

              return (
              <article className="item-card vendor-invoice-card" key={invoice.id} id={`vendor-invoice-${invoice.id}`} data-notification-target={`vendor-invoice-${invoice.id}`}>
                <div>
                  <p className={`eyebrow ${invoice.status === "Payé" ? "invoice-eyebrow-paid" : invoice.status === "En attente de facture" ? "" : "invoice-eyebrow-danger"}`} data-semantic-text={invoice.status}>{screen.category(profession)} · {label(invoice.status, "crm")}</p>
                  <h3>{businessName}</h3>
                  {contactPersonName && contactPersonName !== businessName ? (
                    <p className="muted-line">{t("crm.vendorInvoices.365b32021c")}{" "}{contactPersonName}</p>
                  ) : null}
                  <p>{invoice.title}</p>
                  {orphan && <p className={`status-pill semantic-danger ${vendorFinanceStyles.orphanNotice}`} data-semantic-text={"Facture automatique orpheline · Devis d’origine introuvable"}>{t("crm.vendorInvoices.85a96b984f")}</p>}
                  <p className="muted-line">{t("crm.vendorInvoices.220e95eaf2")}{" "}{invoice.invoiceReference || t("crm.vendorInvoices.831460cb02")}</p>
                  <p className="muted-line">{t("crm.vendorInvoices.9c176bef48")}{" "}{invoice.invoiceDate || t("crm.vendorInvoices.3160128ee8")}{" "}{t("crm.vendorInvoices.c38799bca4")}{" "}{invoice.createdAt ? screen.date(invoice.createdAt) : t("crm.vendorInvoices.831460cb02")}</p>
                  <p className="muted-line">
                    {invoice.status === "En attente de facture" ? t("crm.vendorInvoices.cd9c6754a4") : t("crm.vendorInvoices.9606bfc819", { value1: displayValue(invoice.dueDate || t("crm.vendorInvoices.3160128ee8")) })}
                  </p>
                  <p className="muted-line">{t("crm.vendorInvoices.1f3bf0aac1")}{" "}{invoice.sourceQuoteReference || invoice.sourceQuoteId || t("crm.vendorInvoices.cb6c1fb76c")}</p>

                  {!business && <VendorInvoicePayment invoice={invoice} contact={contacts.find(c => c.id === invoice.contactId)} onUpdate={onUpdate} onOpenContact={() => setBankContactId(invoice.contactId)} />}
                  <div className="stats-grid vendor-invoice-stats">
                    <div className="mini-stat" data-semantic-text={"Montant"}>
                      <span>{t("crm.vendorInvoices.947cc07e2b")}</span>
                      <strong>{screen.euro(invoice.amount)}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Payé"}>
                      <span>{t("crm.vendorInvoices.2542792ee0")}</span>
                      <strong>{screen.euro(invoice.paidAmount)}</strong>
                    </div>
                    <div className="mini-stat" data-semantic-text={"Reste"}>
                      <span>{t("crm.vendorInvoices.eb3bd48127")}</span>
                      <strong>{screen.euro(getVendorInvoiceRemaining(invoice))}</strong>
                    </div>
                  </div>
                </div>

                <div className="item-actions contact-row-actions oar-contact-actions">
                  <span className={`status-pill vendor-invoice-status ${invoice.status === "Payé" ? "semantic-success invoice-status-paid" : invoice.status === "En attente de facture" ? "semantic-pending" : "semantic-danger invoice-status-danger"}`} data-semantic-text={invoice.status}>{label(invoice.status, "crm")}</span>
                  {invoice.sourceQuoteId && (
                    <BusinessButton className="secondary-button" type="button" onClick={() => onOpenQuote(invoice.sourceQuoteId || "")} data-crm-auto-scroll="true">{t("crm.vendorInvoices.fd65b6021a")}</BusinessButton>
                  )}
                  {(invoice.invoiceDocumentStoragePath || invoice.invoiceDocumentUrl || documents.find((crmDocument) => crmDocument.id === invoice.linkedDocumentId)?.storagePath || documents.find((crmDocument) => crmDocument.id === invoice.linkedDocumentId)?.url) && (
                    <>
                      <BusinessButton
                        className="secondary-button vendor-invoice-document-button"
                        type="button"
                        disabled={previewingInvoiceDocument}
                        onClick={() => void openVendorInvoicePreview(invoice)}
                       data-crm-auto-scroll="true">
                        {previewingInvoiceDocument ? t("crm.vendorInvoices.2ccbf9cad2") : t("crm.vendorInvoices.d97023a911")}
                      </BusinessButton>
                      <BusinessButton permission="export"
                        className="secondary-button vendor-invoice-document-button"
                        type="button"
                        onClick={() => void downloadVendorInvoiceDocument(invoice)}
                      >{t("crm.vendorInvoices.a1b7982562")}</BusinessButton>
                    </>
                  )}
                  <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => startEditInvoice(invoice)} data-crm-auto-scroll="true">{t("crm.vendorInvoices.42e37604b6")}</BusinessButton>
                  {orphan ? <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => {
                    if (window.confirm(dialogT("crm.vendorInvoices.3fa1844022"))) onDeleteOrphan(invoice.id);
                  }}>{t("crm.vendorInvoices.2822bf3afd")}</BusinessButton> : !isAutomaticVendorInvoice(invoice) && <BusinessButton permission="remove"
                    className="danger-link" type="button" onClick={() => {
                      if (window.confirm(dialogT("crm.vendorInvoices.a96392b731"))) onDelete(invoice.id);
                    }}>{t("crm.vendorInvoices.5e5d0216ce")}</BusinessButton>}
                </div>
              </article>
              );
            })}
          </div>)}
      </section>

      <section className="card form-card vendor-invoices-form-card">
        <p className="eyebrow" data-semantic-text={"Modification Nouvelle"}>{editingInvoice ? t("crm.vendorInvoices.46889b43bc") : t("crm.vendorInvoices.85aea9c936")}</p>
        <h3>{editingInvoice ? t("crm.vendorInvoices.c5abbbc37f") : t("crm.vendorInvoices.09b3a11f11")}</h3>
        {editingInvoice?.sourceQuoteReference && (
          <div className="card" style={{ boxShadow: "none", marginBottom: 16, padding: 14 }}>
            <p className="eyebrow" data-semantic-text={"Créée depuis le devis"}>{t("crm.vendorInvoices.318a8f96a9")}</p>
            <strong>{editingInvoice.sourceQuoteReference}</strong>
            <p className="muted-line">{t("crm.vendorInvoices.81bea8889c")}</p>
          </div>
        )}

        <BusinessForm key={editingInvoice?.id || "new-vendor-invoice"} className="form-grid" onSubmit={submitInvoice}>
          <SearchableBusinessContactPicker
            contacts={selectableContacts}
            defaultContact={findContactForVendorInvoice(editingInvoice)}
            defaultContactId={getResolvedVendorInvoiceContactId(editingInvoice)}
            fallbackContactName={getHistoricalVendorInvoiceContactName(editingInvoice)}
            fallbackContactPersonName={editingInvoice?.contactPersonName || ""}
            fallbackProfession={editingInvoice?.category || ""}
          />

          <BusinessLabel>{t("crm.vendorInvoices.3a6c989c2b")}<input name="title" defaultValue={editingInvoice?.title || ""} placeholder={t("crm.vendorInvoices.3b302c9d37")} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.vendorInvoices.5da0462657")}<input name="invoiceReference" defaultValue={editingInvoice?.invoiceReference || ""} placeholder={t("crm.vendorInvoices.7badde962e")} /></BusinessLabel>

          <BusinessLabel>{t("crm.vendorInvoices.9da5fd07c5")}<input name="invoiceDate" type="date" defaultValue={editingInvoice?.invoiceDate || ""} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.vendorInvoices.5ed5c98430")}<input name="dueDate" type="date" defaultValue={editingInvoice?.dueDate || ""} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.vendorInvoices.31aca8c4e3")}<input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={editingInvoice ? formatEuroInput(editingInvoice.amount) : ""}
              placeholder={t("crm.vendorInvoices.addb26f9f6")}
              required
            />
          </BusinessLabel>

          <BusinessLabel>{t("crm.vendorInvoices.78d6b0498a")}<input
              name="paidAmount"
              type="text"
              inputMode="decimal"
              defaultValue={editingInvoice ? formatEuroInput(editingInvoice.paidAmount) : ""}
              placeholder={t("crm.vendorInvoices.06919cbdbd")}
            />
            <span className="field-help">{t("crm.vendorInvoices.694d6ac668")}</span>
          </BusinessLabel>

          <BusinessLabel>{t("crm.vendorInvoices.ad4f2ff061")}<input name="paymentMethod" defaultValue={editingInvoice?.paymentMethod || ""} placeholder={t("crm.vendorInvoices.147cb66d23")} />
          </BusinessLabel>

          <BusinessLabel className="vendor-invoice-file-field">{t("crm.vendorInvoices.fe5023315e")}<input name="invoiceFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx" />
            <span className="field-help">
              {editingInvoice?.invoiceDocumentName ? t("crm.vendorInvoices.c1ecf9edf2", { value1: displayValue(editingInvoice.invoiceDocumentName) }) : t("crm.vendorInvoices.103087fc58")}
            </span>
          </BusinessLabel>

          <BusinessLabel className="planning-entry-notes">{t("crm.vendorInvoices.8a7525b149")}<textarea name="notes" defaultValue={editingInvoice?.notes || ""} placeholder={t("crm.vendorInvoices.02946ebc26")} />
          </BusinessLabel>

          <div className="mobile-form-actions">
            <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit" disabled={uploadingInvoiceDocument}>
              {uploadingInvoiceDocument ? t("crm.vendorInvoices.b2d553dc1d") : editingInvoice ? t("crm.vendorInvoices.71dc74873e") : t("crm.vendorInvoices.2877a9000d")}
            </BusinessButton>
            {editingInvoice && (
              <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => setEditingInvoice(null)} data-crm-dismiss="true">{t("crm.vendorInvoices.46ad3916f6")}</BusinessButton>
            )}
          </div>
        </BusinessForm>
      </section>

      {invoicePreview && (
        <div className="confirm-backdrop vendor-invoice-preview-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-dialog vendor-invoice-preview-dialog">
            <div className="section-heading vendor-invoice-preview-heading">
              <div>
                <p className="eyebrow" data-semantic-text={"Aperçu facture"}>{t("crm.vendorInvoices.11157f98e9")}</p>
                <h3>{invoicePreview.fileName}</h3>
                <p className="muted-line">{invoicePreview.invoice.contactName} · {invoicePreview.invoice.title}</p>
              </div>
              <BusinessButton className="secondary-button" type="button" onClick={closeVendorInvoicePreview} data-crm-dismiss="true">{t("crm.vendorInvoices.711e5f2e19")}</BusinessButton>
            </div>

            {isVendorInvoicePreviewable(invoicePreview.fileName, invoicePreview.mimeType) ? (
              invoicePreview.mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(invoicePreview.fileName) ? (
                <div className="vendor-invoice-preview-frame vendor-invoice-preview-image-frame">
                  <img src={invoicePreview.url} alt={t("crm.vendorInvoices.2dfbb299fc", { value1: displayValue(invoicePreview.fileName) })} />
                </div>
              ) : (
                <iframe
                  className="vendor-invoice-preview-frame"
                  src={invoicePreview.url}
                  title={t("crm.vendorInvoices.2dfbb299fc", { value1: displayValue(invoicePreview.fileName) })}
                />
              )
            ) : (
              <div className="vendor-invoice-preview-frame vendor-invoice-preview-unavailable">
                <h4>{t("crm.vendorInvoices.eeb665c336")}</h4>
                <p>{t("crm.vendorInvoices.81e14d688d")}</p>
              </div>
            )}

            <div className="form-actions vendor-invoice-preview-actions">
              <BusinessButton className="secondary-button" type="button" onClick={() => window.open(invoicePreview.url, "_blank", "noopener,noreferrer")} data-crm-auto-scroll="true">{t("crm.vendorInvoices.072cf7baa0")}</BusinessButton>
              <BusinessButton permission="export" className="primary-button" type="button" onClick={() => void downloadVendorInvoiceDocument(invoicePreview.invoice)}>{t("crm.vendorInvoices.cdaaab442d")}</BusinessButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function getSemanticToneFromText(text: string) {
  const value = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // CRM_PROVIDER_INVOICE_DANGER_WORDS_20260614
  if (
    value.includes("en retard") ||
    value.includes("retard") ||
    value.includes("partiellement") ||
    value.includes("partiel") ||
    value.includes("a payer") ||
    value.includes("reste a payer") ||
    value.includes("non paye") ||
    value.includes("a payer") ||
    value.includes("reste a payer") ||
    value.includes("perdu") ||
    value.includes("erreur") ||
    value.includes("annule") ||
    value.includes("impossible")
  ) {
    return "danger";
  }

  if (
    value.includes("en retard") ||
    value.includes("retard") ||
    value.includes("relance") ||
    value.includes("echeance depassee") ||
    value.includes("a relancer")
  ) {
    return "warning";
  }

  if (
    value.includes("paye") ||
    value.includes("confirme") ||
    value.includes("gagne") ||
    value.includes("termine") ||
    value.includes("connectee") ||
    value.includes("synchronise")
  ) {
    return "success";
  }

  if (
    value.includes("partiel") ||
    value.includes("negociation") ||
    value.includes("en cours") ||
    value.includes("a preparer") ||
    value.includes("prestataire a confirmer") ||
    value.includes("devis") ||
    value.includes("brouillon")
  ) {
    return "pending";
  }

  if (
    value.includes("nouveau") ||
    value.includes("standard") ||
    value.includes("local") ||
    value.includes("prospect")
  ) {
    return "neutral";
  }

  return "";
}

function DashboardCommandCard({
  moduleIds,
  eyebrow,
  title,
  summary,
  children,
  tone = "neutral"
}: {
  moduleIds: import("@/lib/access/modules").ModuleId[];
  eyebrow: string;
  title: string;
  summary?: string;
  children: any;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  const access=useBusinessPermissions();
  if (access && moduleIds.length > 0 && !moduleIds.some(access.read)) return null;
  return (
    <section className={`card dashboard-command-card tone-${tone}`}>
      <div className="dashboard-command-card-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        {summary ? <span>{summary}</span> : null}
      </div>
      {children}
    </section>
  );
}

function DashboardQuickTile({
  moduleId,
  label,
  value,
  caption,
  onClick
}: {
  moduleId: import("@/lib/access/modules").ModuleId;
  label: string;
  value: string;
  caption: string;
  onClick: () => void;
}) {
  const { t } = useCRMDisplay();

  const access=useBusinessPermissions();
  if (access && !access.read(moduleId)) return null;
  return (
    <button className="stat-card dashboard-command-kpi-tile" type="button" onClick={onClick} title={t("crm.dashboard.5f7c434e7c")}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{caption}</span>
    </button>
  );
}

  function normalizeDuplicateKey(value?: string | number | null) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function confirmDuplicateContactIn(contacts: Contact[], contact: Contact, t: UITranslate = defaultCRMTranslate) {
    const candidateName = normalizeDuplicateKey(contact.name);
    const candidateEmail = normalizeDuplicateKey(contact.email);

    const duplicate = contacts.find((existing) => {
      const sameName = candidateName && normalizeDuplicateKey(existing.name) === candidateName;
      const sameEmail = candidateEmail && normalizeDuplicateKey(existing.email) === candidateEmail;

      return sameName || sameEmail;
    });

    if (!duplicate) return true;

    return window.confirm(
      t("crm.quickEntry.0dd2c1f888", { value1: displayValue(getContactLabel(duplicate)), value2: displayValue(duplicate.email ? ` (${duplicate.email})` : ""), value3: displayValue(getContactLabel(contact)), value4: displayValue(contact.email ? ` (${contact.email})` : "") })
    );
  }

  function confirmDuplicateLeadIn(leads: Lead[], lead: Lead, t: UITranslate = defaultCRMTranslate) {
    const candidateContact = normalizeDuplicateKey(lead.contactName);
    const candidateCategory = normalizeDuplicateKey(lead.category);
    const candidateStart = normalizeDuplicateKey(lead.rentalStartDate);
    const candidateEnd = normalizeDuplicateKey(lead.rentalEndDate);

    const duplicate = leads.find((existing) => {
      const sameContact = normalizeDuplicateKey(existing.contactName) === candidateContact;
      const sameCategory = normalizeDuplicateKey(existing.category) === candidateCategory;
      const sameAsset = Boolean(lead.assetId && existing.assetId && existing.assetId === lead.assetId);
      const sameDates =
        Boolean(candidateStart || candidateEnd) &&
        normalizeDuplicateKey(existing.rentalStartDate) === candidateStart &&
        normalizeDuplicateKey(existing.rentalEndDate) === candidateEnd;

      return sameContact && sameCategory && (sameAsset || sameDates);
    });

    if (!duplicate) return true;

    return window.confirm(
      t("crm.quickEntry.13f3192d0d", { value1: displayValue(duplicate.contactName), value2: displayValue(duplicate.category), value3: displayValue(duplicate.rentalStartDate || "?"), value4: displayValue(duplicate.rentalEndDate || "?") })
    );
  }

  function normalizeQuickEntryDate(value: string) {
    const match = value.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (!match) return "";

    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const rawYear = match[3];
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;

    return `${year}-${month}-${day}`;
  }

  function parseQuickEntryText(text: string) {
    const raw = text.trim();
    const lower = raw.toLowerCase();

    const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
    const phone = raw.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? "";

    const budgetMatch = raw.match(/(?:budget|prix|valeur|montant)\s*[:\-]?\s*([\d\s.,]+)\s*€?/i)
      ?? raw.match(/([\d\s]{4,})\s*€/);

    const budget = budgetMatch
      ? Number(String(budgetMatch[1]).replace(/[^\d]/g, ""))
      : 0;

    const explicitName = raw.match(/(?:client|nom|contact)\s*[:\-]\s*([^\n]+)/i)?.[1]?.trim();

    const fallbackName = raw
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) =>
        line.length > 2 &&
        line.length < 60 &&
        !line.includes("@") &&
        !/budget|prix|date|villa|bateau|voiture|conciergerie|message|note/i.test(line)
      );

    const contactName = explicitName || fallbackName || "Contact à qualifier";

    const destination =
      raw.match(/(?:ville|lieu|destination|secteur)\s*[:\-]\s*([^\n]+)/i)?.[1]?.trim()
      || (lower.includes("super cannes") ? "Super Cannes" : "")
      || (lower.includes("cannes") ? "Cannes" : "");

    const category =
      lower.includes("bateau") || lower.includes("yacht") ? "Yacht"
      : lower.includes("voiture") || lower.includes("car") ? "Voiture"
      : lower.includes("conciergerie") ? "Conciergerie"
      : "Villa";

    const dateMatches = [...raw.matchAll(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/g)].map((m) => m[0]);
    const rentalStartDate = dateMatches[0] ? normalizeQuickEntryDate(dateMatches[0]) : "";
    const rentalEndDate = dateMatches[1] ? normalizeQuickEntryDate(dateMatches[1]) : "";

    const bedroomsMatch = raw.match(/(\d+)\s*(?:chambres|chambre|beds|bedrooms)/i);
    const peopleMatch = raw.match(/(\d+)\s*(?:personnes|pax|guests|adultes|adults)/i);

    const nextAction =
      category === "Villa"
        ? "Qualifier dates, destination, nombre de personnes, chambres, budget réel et critères prioritaires."
        : category === "Yacht"
          ? "Qualifier dates, port, nombre de personnes, durée, budget et type de bateau."
          : category === "Voiture"
            ? "Qualifier dates, lieu de livraison, modèle souhaité, budget et assurance."
            : "Qualifier besoin conciergerie, dates, lieu, urgence et budget.";

    const notes = [
      raw,
      bedroomsMatch ? `Chambres détectées : ${bedroomsMatch[1]}` : "",
      peopleMatch ? `Personnes détectées : ${peopleMatch[1]}` : ""
    ].filter(Boolean).join("\\n\\n");

    return {
      contactName,
      email,
      phone,
      budget,
      destination,
      category,
      rentalStartDate,
      rentalEndDate,
      nextAction,
      notes
    };
  }
  function createQuickEntryRecords(rawText: string, contacts: Contact[], leads: Lead[], t: UITranslate = defaultCRMTranslate) {
    const cleanedText = rawText.trim();

    if (!cleanedText) {
      window.alert(t("crm.quickEntry.c6a6745777"));
      return;
    }

    const forbiddenPatterns = [
      /git\s+(add|commit|push|checkout|status)/i,
      /npm\s+(run|install|build)/i,
      /components\/CRMApp\.tsx/i,
      /function\s+\w+/i,
      /const\s+\w+\s*=/i,
      /<button|<div|<section/i
    ];

    if (forbiddenPatterns.some((pattern) => pattern.test(cleanedText))) {
      window.alert(t("crm.quickEntry.9b2cf6054f"));
      return;
    }

    const draft = parseQuickEntryText(cleanedText);

    const weakNames = [
      "client",
      "hello",
      "bonjour",
      "one address riviera",
      "oneaddress riviera",
      "à compléter",
      "a completer",
      "git add",
      "npm run"
    ];

    const currentName = String(draft.contactName || "").trim();
    const nameLooksWeak =
      !currentName ||
      currentName.length < 3 ||
      weakNames.some((weakName) => currentName.toLowerCase().includes(weakName));

    if (nameLooksWeak) {
      const manualName = window.prompt(
        t("crm.quickEntry.808a32920a"),
        draft.email ? draft.email.split("@")[0] : ""
      );

      if (!manualName?.trim()) {
        window.alert(t("crm.quickEntry.4473f5d996"));
        return;
      }

      draft.contactName = manualName.trim();
    }

    const confirmed = window.confirm(
      t("crm.quickEntry.2ff6db7093", { value1: displayValue(draft.contactName), value2: displayValue(draft.email || t("crm.vendorInvoices.3160128ee8")), value3: displayValue(draft.category || t("crm.vendorInvoices.3160128ee8")), value4: displayValue(draft.destination || t("crm.vendorInvoices.3160128ee8")), value5: displayValue(draft.rentalStartDate || t("crm.vendorInvoices.3160128ee8")), value6: displayValue(draft.rentalEndDate || t("crm.vendorInvoices.3160128ee8")), value7: displayValue(draft.budget ? draft.budget.toLocaleString("fr-FR") + " €" : t("crm.vendorInvoices.3160128ee8")), value8: displayValue(draft.nextAction || t("crm.vendorInvoices.3160128ee8")) })
    );

    if (!confirmed) return;

    const today = new Date().toISOString().slice(0, 10);
    const contactId = crypto.randomUUID();
    const leadId = crypto.randomUUID();

    const newContact = {
      id: contactId,
      name: draft.contactName,
      kind: "Client",
      email: draft.email,
      phone: draft.phone,
      city: draft.destination,
      postalAddress: "",
      budget: draft.budget,
      source: "Saisie rapide",
      notes: draft.notes,
      clientLevel: "Standard",
      preferredLanguage: "Français",
      relationshipStatus: "Prospect",
      preferences: "",
      importantNotes: "",
      createdAt: today
    } as any;

    const newLead = {
      id: leadId,
      category: draft.category,
      contactName: draft.contactName,
      assetType: "",
      assetId: "",
      status: "Nouveau",
      value: draft.budget,
      priority: "Moyenne",
      nextAction: draft.nextAction,
      notes: draft.notes,
      dueDate: today,
      rentalStartDate: draft.rentalStartDate,
      rentalEndDate: draft.rentalEndDate
    } as any;

    if (!confirmDuplicateContactIn(contacts, newContact as Contact, t)) return;
    if (!confirmDuplicateLeadIn(leads, newLead as Lead, t)) return;

    return {newContact, newLead};
  }
  function promptQuickEntryText(savedText = "", t: UITranslate = defaultCRMTranslate) {
    const choice = window.prompt(
      t("crm.quickEntry.c150d23f82"),
      "1"
    );

    if (!choice) return;

    const templates: Record<string, string> = {
      "1": "Client : \nRecherche villa à \nDates : \nBudget : \nPersonnes : \nChambres : \nBesoin : villa, secteur, style, contraintes, services souhaités\nNote : ",
      "2": "Client : \nRecherche yacht / bateau\nPort / départ : \nDates : \nDurée : \nBudget : \nPersonnes : \nBesoin : taille, équipage, journée ou plusieurs jours, restauration, itinéraire\nNote : ",
      "3": "Client : \nRecherche voiture\nLieu de livraison : \nDates : \nBudget : \nModèle souhaité : \nBesoin : chauffeur ou sans chauffeur, assurance, livraison, restitution\nNote : ",
      "4": "Client : \nDemande conciergerie\nLieu : \nDates : \nBudget : \nBesoin : réservation, service maison, transport, événement, personnel, urgence\nNote : ",
      "5": "Client : \nRecherche : \nDates : \nBudget : \nBesoin : \nNote : "
    };

    const selectedTemplate = templates[choice.trim()] || templates["5"];

    const text = window.prompt(
      t("crm.quickEntry.489458e7d3"),
      savedText || selectedTemplate
    );

    if (!text) return;

    return text;
  }


export {createQuickEntryRecords, promptQuickEntryText};

export default function CRMApp({ access, initialTab = "dashboard", sourceFocus, onExternalNavigate, sessionUserId, sessionAccessToken, sessionEmail, onLogout, onUnsavedChange }: { access: AccessSnapshot; initialTab?: Tab; sourceFocus?: { module: "vendorInvoices" | "houseTracking"; id: string }; onExternalNavigate: (tab: UnifiedTab) => boolean | void; sessionUserId: string; sessionAccessToken: string; sessionEmail: string; onLogout: () => void; onUnsavedChange?: (dirty: boolean) => void }) {
  const { t, label, locale, screen, screenText, dialogText, dialogT } = useCRMDisplay();

  const beginHouseOperation = useScopedOperations("houseTracking");
  const beginContactOperation = useScopedOperations("contacts");
  const unconfirmedContact = useRef<{ id: string; fingerprint: string; revision: string } | null>(null);
  const taskApi = useTaskApi();
  const taskStatusRequests = useRef(new TaskRequestLedger());
  const pendingTaskStatus = useRef(new Set<string>());
  const taskSessionKey = sessionUserId + ":" + access.revision;
  const taskRights = taskPermissions(access);
  const taskProjection = useTaskProjection(taskApi, taskSessionKey, taskRights.read);
  const visibleTasks = useMemo(() => taskProjection.tasks.map(taskForBusinessView), [taskProjection.tasks]);
  const currentAccessToken = useCommittedValue(sessionAccessToken);
  const currentDisplay = useCommittedValue({ t, screenText });
  const identityLifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    identityLifetime.current = controller;
    return () => controller.abort();
  }, []);

  const [formDirty, setFormDirty] = useState(false);
  const [activeActor, setActiveActor] = useState<CRMActor>(() => {
    const savedActor = crmCache.getItem(ACTOR_STORAGE_KEY);
    return isCRMActor(savedActor) ? savedActor : "";
  });

  const [activeTab, setActiveTabState] = useState<Tab>(initialTab);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [focusContactId, setFocusContactId] = useState<string | undefined>();
  const [, setMobileMoreOpen] = useState(false);


  const [quickEntryText, setQuickEntryText] = useState("");
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);

  // AUTO_SCROLL_LEAD_DETAILS
  useEffect(() => {
    if (activeTab !== "leads") return;

    function handleLeadDetailsClick(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const button = target.closest("button");

      if (!button) return;

      if (button.dataset.crmAction !== "details") return;

      window.setTimeout(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth"
        });
      }, 120);
    }

    document.addEventListener("click", handleLeadDetailsClick);

    return () => {
      document.removeEventListener("click", handleLeadDetailsClick);
    };
  }, [activeTab]);
  // AUTO_SCROLL_ASSET_DETAILS
  useEffect(() => {
    if (activeTab !== "properties" && activeTab !== "vehicles" && activeTab !== "boats") return;

    function handleAssetDetailsClick(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const button = target.closest("button");

      if (!button) return;

      if (button.dataset.crmAction !== "details") return;

      window.setTimeout(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth"
        });
      }, 120);
    }

    document.addEventListener("click", handleAssetDetailsClick);

    return () => {
      document.removeEventListener("click", handleAssetDetailsClick);
    };
  }, [activeTab]);

  const [leadDraftContactName, setLeadDraftContactName] = useState("");
  const [taskDraftLeadId, setTaskDraftLeadId] = useState("");
  const [taskDraftTitle, setTaskDraftTitle] = useState("");
  const [taskDraftContactId, setTaskDraftContactId] = useState("");
  const [quoteDraftFromLead, setQuoteDraftFromLead] = useState<QuoteLeadDraft | null>(null);
  const [query, setQuery] = useState("");
  const [initialLocalState] = useState(() => {
    try {
      const raw = crmCache.getItem(STORAGE_KEY);
      const payload = raw ? normalizeSharedCRMData(JSON.parse(raw)) : emptyData;
      return { data: { ...payload, tasks: [] }, unreadable: false };
    } catch {
      return { data: emptyData, unreadable: true };
    }
  });
  const [data, setDataState] = useState<CRMData>(initialLocalState.data);
  const setData = useCallback((update: SetStateAction<CRMData>) => {
    setDataState(current => {
      const next = typeof update === "function" ? update(current) : update;
      return next.tasks.length ? { ...next, tasks: [] } : next;
    });
  }, []);
  const currentBusinessData = useCommittedValue(data);
  const [sharedWorkspaceReady, setSharedWorkspaceReady] = useState(false);
  const [sharedWorkspaceStatus, setSharedWorkspaceStatus] = useState<"loading" | "connected" | "local" | "error">("loading");
  const [sharedWorkspaceMessage, setSharedWorkspaceMessage] = useState<ScreenNotice>(screenNotice("crm.screen.databaseLoading"));
  const [sharedWorkspaceUpdatedAt, setSharedWorkspaceUpdatedAt] = useState("");
  const [toast, setToast] = useState<Toast | null>(() => initialLocalState.unreadable
    ? { message: screenNotice("crm.screen.localBackupUnreadable"), tone: "warning" } : null);
  const workspaceSync = useRef(new WorkspaceSyncGuard());
  const workspaceBusy = useRef(false);
  const failedSaveFingerprint = useRef<string | null>(null);
  const [workspaceSyncEpoch, setWorkspaceSyncEpoch] = useState(0);
  const [acceptedWorkspaceFingerprint, setAcceptedWorkspaceFingerprint] = useState<string | null>(null);
  const hasUnsavedChanges = sharedWorkspaceReady && acceptedWorkspaceFingerprint !== null
    && workspaceFingerprint(data) !== acceptedWorkspaceFingerprint;

  useEffect(() => { onUnsavedChange?.(hasUnsavedChanges || formDirty); }, [hasUnsavedChanges, formDirty, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange]);
  useEffect(() => {
    if (!hasUnsavedChanges && !formDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges, formDirty]);

  const acceptSharedWorkspace = useCallback((payload: CRMData, revision: string) => {
    workspaceSync.current.load(payload, revision);
    setAcceptedWorkspaceFingerprint(workspaceFingerprint(payload));
    failedSaveFingerprint.current = null;
    saveQuotesToBrowser(payload.quotes as QuoteRequest[]);
    setData(payload);
    setSharedWorkspaceUpdatedAt(revision);
    setWorkspaceSyncEpoch(value => value + 1);
  }, [setData]);

  const showWorkspaceConflict = useCallback(() => {
    workspaceSync.current.conflict();
    setSharedWorkspaceStatus("error");
    setSharedWorkspaceMessage(screenNotice("crm.shell.c056becf03"));
  }, []);

  // Every caller uses the same atomic revision check, including manual sync,
  // backups and the explicitly confirmed seed of an empty shared workspace.
  const writeSharedWorkspace = useCallback(async (payload: CRMData, signal: AbortSignal, token: string) => {
    if (signal.aborted || workspaceBusy.current) return false;
    const write = workspaceSync.current.prepare(payload);
    if (!write) { showWorkspaceConflict(); return false; }
    workspaceBusy.current = true;
    let saved = false;
    try {
      const { data: verified, error: authError } = await supabase.auth.getUser(token);
      if (signal.aborted) return false;
      if (authError || !verified.user || verified.user.id !== sessionUserId) {
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage(screenNotice("crm.shell.8a52595800"));
        return false;
      }
      const { data: row, error } = await supabase.from("crm_workspace_state")
        .update({ payload, updated_by: verified.user.id })
        .eq("workspace_id", SHARED_WORKSPACE_ID)
        .eq("updated_at", write.revision)
        .select("updated_at")
        .abortSignal(signal)
        .maybeSingle()
        .setHeader("Authorization", `Bearer ${token}`);
      if (signal.aborted) return false;
      if (error) {
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage(safeCRMError(error));
        return false;
      }
      if (!row?.updated_at || !workspaceSync.current.saved(write, String(row.updated_at))) {
        showWorkspaceConflict();
        return false;
      }
      saved = true;
      // Acknowledge exactly the payload sent; newer edits must remain dirty.
      setAcceptedWorkspaceFingerprint(write.fingerprint);
      failedSaveFingerprint.current = null;
      setSharedWorkspaceStatus("connected");
      setSharedWorkspaceMessage(screenNotice("crm.shell.6159f4160c"));
      setSharedWorkspaceUpdatedAt(String(row.updated_at));
      return true;
    } finally {
      workspaceBusy.current = false;
      if (!saved && !signal.aborted) failedSaveFingerprint.current = write.fingerprint;
      if (!identityLifetime.current.signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
    }
  }, [sessionUserId, showWorkspaceConflict]);


  function setActiveTab(tab: Tab) {
    if ((hasUnsavedChanges || formDirty) && tab !== activeTab && !window.confirm(dialogT("crm.shell.63f11792a5"))) return false;
    setFormDirty(false);
    setFocusContactId(undefined);
    setQuery("");
    setActiveTabState(tab);
    setNavigationRevision(value => value + 1);
    return true;
  }

  useEffect(() => {
    const overlaySelector = [
      ".confirm-backdrop",
      ".document-preview-overlay",
      ".vendor-invoice-preview-backdrop"
    ].join(",");

    function dismissTopDialog() {
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(overlaySelector))
        .filter((overlay) => overlay.getClientRects().length > 0);
      const overlay = overlays.at(-1);
      if (!overlay) return false;

      const dismissButton = Array.from(overlay.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.dataset.crmDismiss === "true");

      dismissButton?.click();
      return Boolean(dismissButton);
    }

    function handleDialogEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissTopDialog()) {
        event.preventDefault();
      }
    }

    function handleDialogBackdrop(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(overlaySelector)) return;
      dismissTopDialog();
    }

    document.addEventListener("keydown", handleDialogEscape);
    document.addEventListener("mousedown", handleDialogBackdrop);

    return () => {
      document.removeEventListener("keydown", handleDialogEscape);
      document.removeEventListener("mousedown", handleDialogBackdrop);
    };
  }, []);

  useEffect(() => {
    let cleanupInterval: number | null = null;

    async function lockActionActorSelect() {
      const { data } = await supabase.auth.getUser();
      const email = (data.user?.email || "").trim().toLowerCase();

      const lockedActor =
        email === "matteobuggianipro@gmail.com"
          ? "Matteo"
          : email === "vg@oneaddressriviera.com"
            ? "Vincent"
            : null;

      // Keep the existing account binding, but never restore a retired actor.
      if (!isCRMActor(lockedActor)) return;

      setActiveActor(lockedActor);
      crmCache.setItem(ACTOR_STORAGE_KEY, lockedActor);

      const enforce = () => {
        const selects = Array.from(document.querySelectorAll<HTMLSelectElement>(".crm-actor-select-label select, .mobile-actor-field select"));

        selects.forEach((select) => {
          select.value = lockedActor;
          select.disabled = true;
          select.setAttribute("aria-disabled", "true");
          select.classList.add("actor-select-hard-locked");
          select.style.pointerEvents = "none";
        });
      };

      enforce();
      cleanupInterval = window.setInterval(enforce, 300);
    }

    lockActionActorSelect();

    return () => {
      if (cleanupInterval) window.clearInterval(cleanupInterval);
    };
  }, []);



  useEffect(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".status-pill, .notification-card, .mini-stat, .item-card .eyebrow, .shared-db-status-panel, .lead-status, .quote-status"
      )
    );

    targets.forEach((element) => {
      element.classList.remove(
        "semantic-success",
        "semantic-warning",
        "semantic-danger",
        "semantic-pending",
        "semantic-neutral"
      );

      const tone = getSemanticToneFromText(element.dataset.semanticText || "");

      if (tone) {
        element.classList.add(`semantic-${tone}`);
      }
    });
  }, [activeTab, data, sharedWorkspaceStatus, sharedWorkspaceMessage]);



  useEffect(() => {
    function isVisibleCrmTarget(element: HTMLElement) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 60 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }

    function scrollToCrmTarget(target: HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("crm-auto-scroll-focus");
      window.setTimeout(() => target.classList.remove("crm-auto-scroll-focus"), 1200);
    }

    function findCrmActionTarget(button: HTMLElement) {
      const clickedCard = button.closest("article, section, .card, .item-card, .lead-card");
      const selectors = [
        ".form-card",
        ".detail-card",
        ".details-card",
        ".quote-preview",
        ".quote-card",
        ".two-columns > section:last-child",
        ".two-columns > .card:last-child",
        "form"
      ];

      const candidates = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")))
        .map((candidate) => candidate.closest<HTMLElement>(".form-card, .card, section") || candidate)
        .filter((candidate, index, list) => list.indexOf(candidate) === index)
        .filter((candidate) => isVisibleCrmTarget(candidate))
        .filter((candidate) => !clickedCard || !clickedCard.contains(candidate));

      return candidates[0] || document.querySelector<HTMLElement>("main") || document.body;
    }

    function shouldAutoScroll(button: HTMLElement) {
      if (button.closest("aside, nav, .sidebar")) return false;

      return button.dataset.crmAutoScroll === "true" && button.getAttribute("type") !== "submit";
    }

    function handleCrmButtonClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest<HTMLElement>("button, a, [role='button']");
      if (!button || !shouldAutoScroll(button)) return;

      window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          const scrollTarget = findCrmActionTarget(button);
          scrollToCrmTarget(scrollTarget);
        });
      }, 120);
    }

    document.addEventListener("click", handleCrmButtonClick, true);

    return () => {
      document.removeEventListener("click", handleCrmButtonClick, true);
    };
  }, []);


  useEffect(() => {
    crmCache.setItem(ACTOR_STORAGE_KEY, activeActor);
  }, [activeActor]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeTab]);


  useEffect(() => {
    crmCache.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);
  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);


  // Load once per mounted identity; refreshing a token must preserve unsaved edits.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadSharedWorkspaceState() {
      const token = currentAccessToken.current;
      const { data: userData, error: userError } = await supabase.auth.getUser(token);

      if (cancelled) return;

      if (userError || !userData.user || userData.user.id !== sessionUserId) {
        window.alert(currentDisplay.current.t("crm.shell.e7bc4467bc"));
        setSharedWorkspaceReady(false);
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage(screenNotice("crm.shell.62974d33f4"));
        return;
      }

      const { data: row, error } = await supabase
        .from("crm_workspace_state")
        .select("payload, updated_at")
        .eq("workspace_id", SHARED_WORKSPACE_ID)
        .abortSignal(controller.signal)
        .single()
        .setHeader("Authorization", `Bearer ${token}`);

      if (cancelled) return;

      if (error) {
        window.alert(currentDisplay.current.screenText(safeCRMError(error)));
        setSharedWorkspaceReady(false);
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage(safeCRMError(error));
        return;
      }

      const sharedData = normalizeSharedCRMData(row?.payload);
      const sharedUpdatedAt = String(row?.updated_at || "");

      if (crmDataHasContent(sharedData)) {
        acceptSharedWorkspace(sharedData, sharedUpdatedAt);
        setSharedWorkspaceReady(true);
        setSharedWorkspaceStatus("connected");
        setSharedWorkspaceMessage(screenNotice("crm.shell.430443db9d"));
        setSharedWorkspaceUpdatedAt(sharedUpdatedAt);
        return;
      }

      const localData = readLocalCRMDataSafely();

      if (!crmDataHasContent(localData)) {
        acceptSharedWorkspace(emptyData, sharedUpdatedAt);
        setSharedWorkspaceReady(true);
        setSharedWorkspaceStatus("connected");
        setSharedWorkspaceMessage(screenNotice("crm.shell.8c19e82429"));
        setSharedWorkspaceUpdatedAt(sharedUpdatedAt);
        return;
      }

      const shouldSeedSharedWorkspace = window.confirm(
        currentDisplay.current.t("crm.shell.f1c24575bf")
      );

      if (!shouldSeedSharedWorkspace) {
        acceptSharedWorkspace(emptyData, sharedUpdatedAt);
        setSharedWorkspaceReady(true);
        setSharedWorkspaceStatus("local");
        setSharedWorkspaceMessage(screenNotice("crm.shell.5c1b82b4c4"));
        setSharedWorkspaceUpdatedAt(sharedUpdatedAt);
        return;
      }

      if (cancelled) return;

      workspaceSync.current.load(sharedData, sharedUpdatedAt);
      setAcceptedWorkspaceFingerprint(workspaceFingerprint(sharedData));
      const seeded = await writeSharedWorkspace(localData, controller.signal, token);
      if (cancelled) return;
      if (!seeded) {
        // Keep the recoverable local version; a competing initializer wins safely.
        setData(localData);
        setSharedWorkspaceReady(true);
        return;
      }
      setData(localData);
      saveQuotesToBrowser(localData.quotes as QuoteRequest[]);
      setSharedWorkspaceReady(true);
      setSharedWorkspaceStatus("connected");
      setSharedWorkspaceMessage(screenNotice("crm.shell.f051a46717"));

    }

    const timer = window.setTimeout(() => {
      void loadSharedWorkspaceState();
    }, 700);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [sessionUserId, acceptSharedWorkspace, writeSharedWorkspace, currentAccessToken, currentDisplay, setData]);

  useEffect(() => {
    // A queued local edit may conflict when a trash completion is rebased.
    // Keep that draft visible and make the stopped autosave explicit.
    if (workspaceSync.current.conflicted) {
      showWorkspaceConflict();
      return;
    }
    if (!sharedWorkspaceReady || !workspaceSync.current.dirty(data) || workspaceSync.current.conflicted) return;
    if (failedSaveFingerprint.current === workspaceFingerprint(data)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // Token rotation updates this ref without scheduling a save or reloading data.
      // Once started, verification and the request keep the same captured token.
      const token = currentAccessToken.current;
      void writeSharedWorkspace(data, controller.signal, token);
    }, 900);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [data, sharedWorkspaceReady, sessionUserId, workspaceSyncEpoch, writeSharedWorkspace, currentAccessToken, showWorkspaceConflict]);

  const stats = useMemo(() => {
    const pipeline = data.leads
      .filter((lead) => lead.status !== "Perdu")
      .reduce((sum, lead) => sum + lead.value, 0);
    const won = data.leads.filter((lead) => lead.status === "Gagné").reduce((sum, lead) => sum + lead.value, 0);
    const openTasks = visibleTasks.filter((task) => task.status !== "Terminé").length;
    const availableProperties = data.properties.filter((property) => property.status === "Disponible").length;
    return { pipeline, won, openTasks, availableProperties };
  }, [data, visibleTasks]);


  const actionNotifications = useMemo(() => {
    const items: ActionNotification[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    function daysUntil(dateText?: string) {
      if (!dateText) return null;

      const date = new Date(`${dateText}T00:00:00`);
      if (Number.isNaN(date.getTime())) return null;

      date.setHours(0, 0, 0, 0);
      return Math.round((date.getTime() - today.getTime()) / 86400000);
    }

    function paymentRemaining(quote: QuoteRequest) {
      const total = getQuoteTotal(quote);
      const paid = Number(quote.depositReceived || 0) + Number(quote.balanceReceived || 0);

      return Math.max(total - paid, 0);
    }

    visibleTasks
      .filter((task) => task.status !== "Terminé")
      .forEach((task) => {
        const days = task.dueDate && isCivilDate(task.dueDate)
          ? Math.round((Date.parse(task.dueDate + "T00:00:00Z") - Date.parse(parisCivilDate() + "T00:00:00Z")) / 86400000)
          : null;

        if (days === null) {
          items.push({
            id: `task-missing-date-${task.id}`,
            title: t("crm.shell.274d52d3e0"),
            detail: task.title || t("crm.shell.21c99ca24b"),
            tab: "tasks" as Tab,
            tone: "warning",
            targetId: `task-${task.id}`
          });
          return;
        }

        if (days < 0) {
          items.push({
            id: `task-late-${task.id}`,
            title: t("crm.shell.38893c6207"),
            detail: t("crm.shell.7c639bc99b", { value1: displayValue(task.title), value2: displayValue(task.dueDate) }),
            tab: "tasks" as Tab,
            tone: "danger",
            targetId: `task-${task.id}`
          });
          return;
        }

        if (days === 0) {
          items.push({
            id: `task-today-${task.id}`,
            title: t("crm.shell.67ff76d02e"),
            detail: task.title,
            tab: "tasks" as Tab,
            tone: "warning",
            targetId: `task-${task.id}`
          });
          return;
        }

        if (days <= 2) {
          items.push({
            id: `task-soon-${task.id}`,
            title: t("crm.shell.0c89ee78e8"),
            detail: t("crm.shell.aebee2197d", { value1: displayValue(task.title), value2: displayValue(days), value3: displayValue(days > 1 ? "s" : "") }),
            tab: "tasks" as Tab,
            tone: "info",
            targetId: `task-${task.id}`
          });
        }
      });

    data.leads
      .filter((lead) => lead.status !== "Gagné" && lead.status !== "Perdu")
      .forEach((lead) => {
        if (!lead.nextAction || !lead.dueDate) {
          items.push({
            id: `lead-incomplete-${lead.id}`,
            title: t("crm.shell.1290ae149e"),
            detail: t("crm.shell.dda985d570", { value1: displayValue(lead.contactName) }),
            tab: "leads" as Tab,
            tone: "warning",
            targetId: `lead-${lead.id}`
          });
        }

        const days = daysUntil(lead.dueDate);

        if (days !== null && days < 0) {
          items.push({
            id: `lead-late-${lead.id}`,
            title: t("crm.shell.df2948d79f"),
            detail: t("crm.shell.7c639bc99b", { value1: displayValue(lead.contactName), value2: displayValue(lead.nextAction || t("crm.enums.actionToDo")) }),
            tab: "leads" as Tab,
            tone: "danger",
            targetId: `lead-${lead.id}`
          });
        }
      });

    const quotes = mergeQuoteRequests((((data as any).quotes ?? []) as QuoteRequest[]), loadSavedQuotes());

    quotes.forEach((quote) => {
      const status = getQuoteStatus(quote.status);
      const ageDays = getQuoteAgeDays(quote.statusUpdatedAt || quote.createdAt);

      if (status === "Sent" && ageDays >= 1) {
        items.push({
          id: `quote-follow-${quote.id}`,
          title: ageDays >= 3 ? t("crm.shell.f614709c0d") : t("crm.shell.db5fefb763"),
          detail: t("crm.shell.7c639bc99b", { value1: displayValue(quote.clientName), value2: displayValue(screen.money(getQuoteTotal(quote))) }),
          tab: "quotes" as Tab,
          tone: ageDays >= 3 ? "danger" : "warning",
          targetId: `quote-${quote.id}`
        });
      }

      if (status === "Negotiation") {
        items.push({
          id: `quote-negotiation-${quote.id}`,
          title: t("crm.shell.74c441cb39"),
          detail: t("crm.shell.44dc4b22d2", { value1: displayValue(quote.clientName) }),
          tab: "quotes" as Tab,
          tone: "warning",
          targetId: `quote-${quote.id}`
        });
      }

      if (status === "Accepted") {
        const bookingStatus = quote.bookingStatus || "À préparer";

        if (bookingStatus !== "Terminé" && bookingStatus !== "Annulé") {
          if (!quote.supplierConfirmed) {
            items.push({
              id: `booking-supplier-${quote.id}`,
              title: t("crm.shell.392d3f43ee"),
              detail: t("crm.shell.7c639bc99b", { value1: displayValue(quote.clientName), value2: displayValue(quote.title || t("crm.enums.booking")) }),
              tab: "bookings" as Tab,
              tone: "warning",
              targetId: `booking-${quote.id}`
            });
          }

          if (!quote.detailsSent) {
            items.push({
              id: `booking-details-${quote.id}`,
              title: t("crm.shell.9fc5859e9a"),
              detail: t("crm.shell.3fa0e9ba72", { value1: displayValue(quote.clientName) }),
              tab: "bookings" as Tab,
              tone: "info",
              targetId: `booking-${quote.id}`
            });
          }
        }

        const remaining = paymentRemaining(quote);
        const paymentStatus = quote.paymentStatus || "Non payé";

        if (remaining > 0 && paymentStatus !== "Payé" && paymentStatus !== "Annulé / remboursé") {
          const days = daysUntil(quote.paymentDueDate);

          items.push({
            id: `payment-${quote.id}`,
            title: days !== null && days < 0 ? t("crm.shell.fe294d352d") : t("crm.shell.4b993c9d0e"),
            detail: t("crm.shell.7b80e99c68", { value1: displayValue(quote.clientName), value2: displayValue(screen.money(remaining)) }),
            tab: "bookings" as Tab,
            tone: days !== null && days < 0 ? "danger" : "warning",
            targetId: `booking-${quote.id}`
          });
        }
      }
    });


    const houseEntries = (((data as any).houseTimeEntries ?? []) as HouseTimeEntry[]);
    const housePayments = (((data as any).housePayments ?? []) as HousePayment[]);
    const houseWorkers = (((data as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]);

    houseWorkers.filter(isHouseTrackingWorkerActive).forEach((worker) => {
      const due = houseEntries
        .filter((entry) => entry.workerId === worker.id)
        .reduce((sum, entry) => sum + getHouseTimeAmount(entry), 0);
      const paid = housePayments
        .filter((payment) => payment.workerId === worker.id)
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const balance = due - paid;

      if (balance > 0) {
        items.push({
          id: `house-balance-${worker.id}`,
          title: t("crm.shell.d84793b512"),
          detail: t("crm.shell.ac9bef87ec", { value1: displayValue(worker.contactName), value2: displayValue(screen.money(balance)) }),
          tab: "houseTracking" as Tab,
          tone: "warning",
          targetId: `house-worker-${worker.id}`
        });
      }
    });

    

    const vendorQuotes = (((data as any).vendorQuotes ?? []) as VendorQuote[]);

    vendorQuotes
      .filter((quote) => quote.status === "À valider")
      .forEach((quote) => {
        items.push({
          id: `vendor-quote-validation-${quote.id}`,
          title: t("crm.shell.a24b02b85b"),
          detail: t("crm.shell.7c639bc99b", { value1: displayValue(quote.contactName), value2: displayValue(screen.euro(quote.amount)) }),
          tab: "vendorQuotes" as Tab,
          tone: "warning",
          targetId: `vendor-quote-${quote.id}`
        });
      });


    const vendorInvoices = (((data as any).vendorInvoices ?? []) as VendorInvoice[]);

    vendorInvoices.forEach((invoice) => {
      const remaining = getVendorInvoiceRemaining(invoice);

      if (invoice.status === "Payé" || invoice.status === "Annulé" || remaining <= 0) {
        return;
      }

      if (invoice.status === "En attente de facture") {
        items.push({
          id: `vendor-invoice-awaiting-document-${invoice.id}`,
          title: t("crm.shell.d5804f74d8"),
          detail: t("crm.shell.7c639bc99b", { value1: displayValue(invoice.contactName), value2: displayValue(invoice.sourceQuoteReference || invoice.title) }),
          tab: "vendorInvoices" as Tab,
          tone: "warning",
          targetId: `vendor-invoice-${invoice.id}`
        });
        return;
      }

      const days = daysUntil(invoice.dueDate);

      items.push({
        id: `vendor-invoice-payment-${invoice.id}`,
        title: days !== null && days < 0 ? t("crm.shell.3dd08c5734") : t("crm.shell.cbd8f228ea"),
        detail: t("crm.shell.7b80e99c68", { value1: displayValue(invoice.contactName), value2: displayValue(screen.euro(remaining)) }),
        tab: "vendorInvoices" as Tab,
        tone: days !== null && days < 0 ? "danger" : "warning",
        targetId: `vendor-invoice-${invoice.id}`
      });
    });


    const crmDocuments = (((data as any).documents ?? []) as CRMDocument[]);

    crmDocuments.forEach((crmDocument) => {
      if ((crmDocument as any).isFolder) return;
      const isExpired = crmDocument.status === "Expiré";
      const shouldCheck = crmDocument.status === "À vérifier";

      if (!isExpired && !shouldCheck) return;

      items.push({
        id: `document-check-${crmDocument.id}`,
        title: isExpired ? t("crm.shell.61985e5da2") : t("crm.shell.4fd90f220c"),
        detail: t("crm.shell.7c639bc99b", { value1: displayValue(crmDocument.title), value2: displayValue(crmDocument.category) }),
        tab: "documents" as Tab,
        tone: isExpired ? "danger" : "warning",
        targetId: `document-${crmDocument.id}`
      });
    });

const toneRank: Record<ActionNotification["tone"], number> = {
      danger: 0,
      warning: 1,
      info: 2
    };

    return items
      .sort((first, second) => toneRank[first.tone] - toneRank[second.tone])
      .slice(0, 20);
  }, [data, visibleTasks, t, screen]);

  const filteredLeads = useMemo(() => {
    return data.leads.filter((lead) => searchMatch(query, [lead.category, lead.contactName, lead.status, lead.nextAction, lead.rentalStartDate, lead.rentalEndDate]));
  }, [data.leads, query]);

  const filteredProperties = useMemo(() => {
    return data.properties.filter((property) => searchMatch(query, [property.name, property.city, property.type, property.owner, property.status]));
  }, [data.properties, query]);

  const filteredVehicles = useMemo(() => {
    return (data.vehicles ?? []).filter((vehicle) => searchMatch(query, [vehicle.name, vehicle.brand, vehicle.model, vehicle.city, vehicle.owner, vehicle.status]));
  }, [data.vehicles, query]);

  const filteredBoats = useMemo(() => {
    return (data.boats ?? []).filter((boat) => searchMatch(query, [boat.name, boat.port, boat.type, boat.owner, boat.status]));
  }, [data.boats, query]);

  function handleNotificationAction(notification?: ActionNotification) {
    const target = notification ?? actionNotifications[0];

    if (!target) return;

    const targetTab = target.tab;
    const targetId = target.targetId;

    const findTargetElement = () => {
      if (!targetId) return null;

      return Array.from(document.querySelectorAll<HTMLElement>("[data-notification-target]")).find((element) =>
        element.dataset.notificationTarget === targetId
      ) || document.getElementById(targetId);
    };

    const scrollToElement = (element: HTMLElement | null) => {
      const previousScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";

      if (element) {
        const headerOffset = 118;
        const nextTop = Math.max(element.getBoundingClientRect().top + window.scrollY - headerOffset, 0);
        window.scrollTo({ top: nextTop, behavior: "auto" });
        element.classList.add("notification-focus");

        window.setTimeout(() => {
          element.classList.remove("notification-focus");
        }, 2400);
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }

      window.setTimeout(() => {
        document.documentElement.style.scrollBehavior = previousScrollBehavior;
      }, 80);
    };

    const runScroll = (attempt = 0) => {
      window.requestAnimationFrame(() => {
        const element = findTargetElement();

        if (targetId && !element && attempt < 14) {
          window.setTimeout(() => runScroll(attempt + 1), 90);
          return;
        }

        scrollToElement(element);
      });
    };

    if (!setActiveTab(targetTab)) return;
    window.setTimeout(() => runScroll(), activeTab === targetTab ? 80 : 180);
  }

  function notify(message: ScreenNotice, tone: Toast["tone"] = "success") {
    setToast({ message, tone });
  }

  function confirmDuplicateContact(contact: Contact) { return confirmDuplicateContactIn(data.contacts, contact, t); }
  function confirmDuplicateLead(lead: Lead) { return confirmDuplicateLeadIn(data.leads, lead, t); }

  function confirmDuplicateAsset(kind: "bien" | "voiture" | "bateau", item: { name?: string; city?: string; port?: string }) {
    const candidateName = normalizeDuplicateKey(item.name);
    const candidateLocation = normalizeDuplicateKey(item.city || item.port);

    const source =
      kind === "bien"
        ? data.properties
        : kind === "voiture"
          ? (data.vehicles ?? [])
          : (data.boats ?? []);

    const duplicate = source.find((existing: any) => {
      const sameName = normalizeDuplicateKey(existing.name) === candidateName;
      const existingLocation = normalizeDuplicateKey(existing.city || existing.port);
      const sameLocation = !candidateLocation || !existingLocation || existingLocation === candidateLocation;

      return sameName && sameLocation;
    });

    if (!duplicate) return true;

    return window.confirm(
      dialogT("crm.shell.4d65d6cfaa", { value1: displayValue(kind.charAt(0).toUpperCase() + kind.slice(1)), value2: displayValue(duplicate.name), value3: displayValue(item.name) })
    );
  }






  function saveQuickEntryText(rawText: string) {
    const records = createQuickEntryRecords(rawText, data.contacts, data.leads, t);
    if (!records) return;
    const {newContact, newLead} = records;
    setData((current: any) => ({
      ...current,
      contacts: [newContact, ...(current.contacts ?? [])],
      leads: [newLead, ...(current.leads ?? [])]
    }));

    setQuickEntryText("");
    setQuickEntryOpen(false);

    notify(screenNotice("crm.shell.ba41058750"));
  }


  function parseInventoryLine(line: string) {
    return line
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
  }


  function parseExpressNumber(value?: string) {
    const cleaned = String(value ?? "").trim();

    if (!cleaned || /à compléter|a completer|n\/a|na/i.test(cleaned)) return 0;

    return Number(cleaned.replace(/[^\d]/g, "")) || 0;
  }

  function parseExpressDateRange(value?: string) {
    const raw = String(value ?? "");
    const matches = [...raw.matchAll(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/g)].map((m) => m[0]);

    return {
      start: matches[0] ? normalizeQuickEntryDate(matches[0]) : "",
      end: matches[1] ? normalizeQuickEntryDate(matches[1]) : ""
    };
  }


  function openSafeCsvImportPrompt() {
    const choice = window.prompt(
      dialogT("crm.shell.f601dca9d1"),
      "1"
    );

    if (!choice) return;

    const type = choice.trim();

    const examples: Record<string, string> = {
      "1": "Nom | Type | Niveau client | Langue préférée | Relation | Email | Téléphone | Ville | Adresse postale | Budget | Source | Préférences | Notes importantes | Notes | Fonction (facultative)",
      "2": "Catégorie | Contact | Actif proposé | Début réservation | Fin réservation | Valeur | Statut | Priorité | Date réponse | Prochaine action | Notes internes",
      "3": "Nom | Type | Ville | Prix | Statut | Propriétaire | Notes",
      "4": "Nom | Marque | Modèle | Ville | Prix/jour | Statut | Propriétaire | Notes",
      "5": "Nom | Port | Type | Prix/jour | Statut | Propriétaire | Notes"
    };

    const raw = window.prompt(
      dialogT("crm.shell.63e4c1f657", { value1: displayValue(examples[type] || examples["1"]) }),
      ""
    );

    if (!raw) return;

    const lines = raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && line.includes("|"));

    if (lines.length === 0) {
      window.alert(dialogT("crm.shell.aef75894e5"));
      return;
    }

    function cleanImportValue(value?: string) {
      const cleaned = String(value ?? "").trim();

      if (!cleaned || /à compléter|a completer|n\/a|na/i.test(cleaned)) {
        return "";
      }

      return cleaned;
    }

    function numberImportValue(value?: string) {
      const cleaned = cleanImportValue(value);
      if (!cleaned) return 0;
      return Number(cleaned.replace(/[^\d]/g, "")) || 0;
    }

    function dateImportValue(value?: string) {
      const cleaned = cleanImportValue(value);
      if (!cleaned) return "";
      return normalizeQuickEntryDate(cleaned) || cleaned;
    }

    function findAsset(assetLabel?: string) {
      const wantedAsset = cleanImportValue(assetLabel).toLowerCase();

      if (!wantedAsset) {
        return { assetType: "", assetId: "", unresolvedAsset: "" };
      }

      const property = data.properties.find((property: any) => {
        const label = String(property.name ?? property.title ?? "").toLowerCase();
        return label && (label === wantedAsset || label.includes(wantedAsset) || wantedAsset.includes(label));
      });

      if (property) {
        return { assetType: "Property", assetId: property.id, unresolvedAsset: "" };
      }

      const vehicle = (data.vehicles ?? []).find((vehicle: any) => {
        const label = String(vehicle.name ?? `${vehicle.brand ?? ""} ${vehicle.model ?? ""}`).toLowerCase();
        return label && (label === wantedAsset || label.includes(wantedAsset) || wantedAsset.includes(label));
      });

      if (vehicle) {
        return { assetType: "Vehicle", assetId: vehicle.id, unresolvedAsset: "" };
      }

      const boat = (data.boats ?? []).find((boat: any) => {
        const label = String(boat.name ?? "").toLowerCase();
        return label && (label === wantedAsset || label.includes(wantedAsset) || wantedAsset.includes(label));
      });

      if (boat) {
        return { assetType: "Boat", assetId: boat.id, unresolvedAsset: "" };
      }

      return { assetType: "", assetId: "", unresolvedAsset: cleanImportValue(assetLabel) };
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = lines.map((line) => line.split("|").map((part) => part.trim()));

    let preview = "";
    let payload: any[] = [];

    if (type === "1") {
      payload = rows.map((parts) => {
        const [
          name,
          kind,
          clientLevel,
          preferredLanguage,
          relationshipStatus,
          email,
          phone,
          city,
          postalAddress,
          budget,
          source,
          preferences,
          importantNotes,
          notes,
          organizationFunction
        ] = parts;

        return {
          id: crypto.randomUUID(),
          name: cleanImportValue(name),
          kind: cleanImportValue(kind) || "Client",
          organizationFunction: cleanImportValue(organizationFunction),
          clientLevel: cleanImportValue(clientLevel) || "Standard",
          preferredLanguage: cleanImportValue(preferredLanguage) || "Français",
          relationshipStatus: cleanImportValue(relationshipStatus) || "Prospect",
          email: cleanImportValue(email),
          phone: cleanImportValue(phone),
          city: cleanImportValue(city),
          postalAddress: cleanImportValue(postalAddress),
          budget: numberImportValue(budget),
          source: cleanImportValue(source) || "Import sécurisé",
          preferences: cleanImportValue(preferences),
          importantNotes: cleanImportValue(importantNotes),
          notes: cleanImportValue(notes),
          createdAt: today
        };
      }).filter((contact) => contact.name);

      preview = payload.slice(0, 5).map((item) => `- ${item.name} / ${item.email || "email à compléter"} / ${item.city || "ville à compléter"}`).join("\n");
    }

    if (type === "2") {
      payload = rows.map((parts) => {
        const [
          category,
          contactName,
          assetLabel,
          rentalStartDate,
          rentalEndDate,
          value,
          status,
          priority,
          dueDate,
          nextAction,
          notes
        ] = parts;

        const asset = findAsset(assetLabel);

        return {
          id: crypto.randomUUID(),
          category: cleanImportValue(category) || "Villa",
          contactName: cleanImportValue(contactName),
          assetType: asset.assetType,
          assetId: asset.assetId,
          status: cleanImportValue(status) || "Nouveau",
          value: numberImportValue(value),
          priority: cleanImportValue(priority) || "Moyenne",
          dueDate: dateImportValue(dueDate),
          nextAction: cleanImportValue(nextAction) || "Qualifier la demande.",
          notes: [asset.unresolvedAsset ? `Actif proposé : ${asset.unresolvedAsset}` : "", cleanImportValue(notes)].filter(Boolean).join("\n\n"),
          rentalStartDate: dateImportValue(rentalStartDate),
          rentalEndDate: dateImportValue(rentalEndDate)
        };
      }).filter((lead) => lead.contactName);

      preview = payload.slice(0, 5).map((item) => `- ${item.contactName} / ${item.category} / ${item.status}`).join("\n");
    }

    if (type === "3") {
      payload = rows.map((parts) => {
        const [name, propertyType, city, price, status, owner, notes] = parts;

        return {
          id: crypto.randomUUID(),
          name: cleanImportValue(name),
          type: cleanImportValue(propertyType) || "Villa",
          city: cleanImportValue(city),
          price: numberImportValue(price),
          status: cleanImportValue(status) || "Disponible",
          owner: cleanImportValue(owner),
          bedrooms: cleanImportValue(notes)?.match(/(\d+)\s*ch/i)?.[1] ? Number(cleanImportValue(notes).match(/(\d+)\s*ch/i)?.[1]) : 0,
          surface: 0,
          notes: cleanImportValue(notes),
          createdAt: today
        };
      }).filter((property) => property.name);

      preview = payload.slice(0, 5).map((item) => `- ${item.name} / ${item.city || "ville à compléter"} / ${item.status}`).join("\n");
    }

    if (type === "4") {
      payload = rows.map((parts) => {
        const [name, brand, model, city, price, status, owner, notes] = parts;

        return {
          id: crypto.randomUUID(),
          name: cleanImportValue(name),
          brand: cleanImportValue(brand),
          model: cleanImportValue(model),
          city: cleanImportValue(city),
          price: numberImportValue(price),
          status: cleanImportValue(status) || "Disponible",
          owner: cleanImportValue(owner),
          year: "",
          mileage: "",
          notes: cleanImportValue(notes),
          createdAt: today
        };
      }).filter((vehicle) => vehicle.name);

      preview = payload.slice(0, 5).map((item) => `- ${item.name} / ${item.city || "ville à compléter"} / ${item.status}`).join("\n");
    }

    if (type === "5") {
      payload = rows.map((parts) => {
        const [name, port, boatType, price, status, owner, notes] = parts;

        return {
          id: crypto.randomUUID(),
          name: cleanImportValue(name),
          port: cleanImportValue(port),
          type: cleanImportValue(boatType) || "Yacht",
          price: numberImportValue(price),
          status: cleanImportValue(status) || "Disponible",
          owner: cleanImportValue(owner),
          year: "",
          length: "",
          notes: cleanImportValue(notes),
          createdAt: today
        };
      }).filter((boat) => boat.name);

      preview = payload.slice(0, 5).map((item) => `- ${item.name} / ${item.port || "port à compléter"} / ${item.status}`).join("\n");
    }

    if (payload.length === 0) {
      window.alert(dialogT("crm.shell.5aeb7446fa"));
      return;
    }

    const normalizeSafeImportDuplicate = (value?: string | number | null) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");

    const safeImportDuplicateCount =
      type === "1"
        ? payload.filter((item) => {
            const name = normalizeSafeImportDuplicate(item.name);
            const email = normalizeSafeImportDuplicate(item.email);

            return data.contacts.some((existing) => {
              const sameName = name && normalizeSafeImportDuplicate(existing.name) === name;
              const sameEmail = email && normalizeSafeImportDuplicate(existing.email) === email;

              return sameName || sameEmail;
            });
          }).length
        : type === "2"
          ? payload.filter((item) => {
              const contactName = normalizeSafeImportDuplicate(item.contactName);
              const category = normalizeSafeImportDuplicate(item.category);
              const rentalStartDate = normalizeSafeImportDuplicate(item.rentalStartDate);
              const rentalEndDate = normalizeSafeImportDuplicate(item.rentalEndDate);

              return data.leads.some((existing) => {
                const sameContact = normalizeSafeImportDuplicate(existing.contactName) === contactName;
                const sameCategory = normalizeSafeImportDuplicate(existing.category) === category;
                const sameAsset = Boolean(item.assetId && existing.assetId && existing.assetId === item.assetId);
                const sameDates =
                  Boolean(rentalStartDate || rentalEndDate) &&
                  normalizeSafeImportDuplicate(existing.rentalStartDate) === rentalStartDate &&
                  normalizeSafeImportDuplicate(existing.rentalEndDate) === rentalEndDate;

                return sameContact && sameCategory && (sameAsset || sameDates);
              });
            }).length
          : type === "3"
            ? payload.filter((item) => {
                const name = normalizeSafeImportDuplicate(item.name);
                const city = normalizeSafeImportDuplicate(item.city);

                return data.properties.some((existing) => {
                  const sameName = normalizeSafeImportDuplicate(existing.name) === name;
                  const sameCity = !city || !existing.city || normalizeSafeImportDuplicate(existing.city) === city;

                  return sameName && sameCity;
                });
              }).length
            : type === "4"
              ? payload.filter((item) => {
                  const name = normalizeSafeImportDuplicate(item.name);
                  const city = normalizeSafeImportDuplicate(item.city);

                  return (data.vehicles ?? []).some((existing) => {
                    const sameName = normalizeSafeImportDuplicate(existing.name) === name;
                    const sameCity = !city || !existing.city || normalizeSafeImportDuplicate(existing.city) === city;

                    return sameName && sameCity;
                  });
                }).length
              : type === "5"
                ? payload.filter((item) => {
                    const name = normalizeSafeImportDuplicate(item.name);
                    const port = normalizeSafeImportDuplicate(item.port);

                    return (data.boats ?? []).some((existing) => {
                      const sameName = normalizeSafeImportDuplicate(existing.name) === name;
                      const samePort = !port || !existing.port || normalizeSafeImportDuplicate(existing.port) === port;

                      return sameName && samePort;
                    });
                  }).length
                : 0;

    if (safeImportDuplicateCount > 0) {
      const continueWithDuplicates = window.confirm(
        dialogT("crm.shell.70274af775", { value1: displayValue(safeImportDuplicateCount) })
      );

      if (!continueWithDuplicates) return;
    }

    const confirmed = window.confirm(
      dialogT("crm.shell.91e7d10d20", { value1: displayValue(payload.length), value2: displayValue(preview) })
    );

    if (!confirmed) return;

    setData((current: any) => {
      if (type === "1") {
        return { ...current, contacts: [...payload, ...(current.contacts ?? [])] };
      }

      if (type === "2") {
        return { ...current, leads: [...payload, ...(current.leads ?? [])] };
      }

      if (type === "3") {
        return { ...current, properties: [...payload, ...(current.properties ?? [])] };
      }

      if (type === "4") {
        return { ...current, vehicles: [...payload, ...(current.vehicles ?? [])] };
      }

      if (type === "5") {
        return { ...current, boats: [...payload, ...(current.boats ?? [])] };
      }

      return current;
    });

    notify(screenNotice("crm.shell.24d8b2b3db", { value1: displayValue(payload.length) }));
  }

  function openQuickContactLeadPrompt() {
    const choice = window.prompt(
      dialogT("crm.shell.1594f7c67f"),
      "1"
    );

    if (!choice) return;

    const type = choice.trim();

    const contactExample =
      "Heily Aavik | Client | Standard | Français | Prospect | À compléter | À compléter | Super Cannes | À compléter | À compléter | Ancienne donnée récupérée | Villa Kanupi | Disponibilité Villa Kanupi à vérifier | Vérifier disponibilité du 11/07/2026 au 19/07/2026";

    const leadExample =
      "Villa | Heily Aavik | Villa Kanupi | 11/07/2026 | 19/07/2026 | À compléter | Nouveau | Moyenne | À compléter | Vérifier disponibilité Villa Kanupi et envoyer proposition privée | Budget, nombre de personnes et critères à compléter";

    const raw = window.prompt(
      type === "2"
        ? dialogT("crm.shell.7d404b001c")
        : dialogT("crm.shell.ba223c937e"),
      type === "2" ? leadExample : contactExample
    );

    if (!raw) return;

    const parts = raw.split("|").map((part) => part.trim());

    function cleanExpressValue(value?: string) {
      const cleaned = String(value ?? "").trim();

      if (!cleaned || /à compléter|a completer|n\/a|na/i.test(cleaned)) {
        return "";
      }

      return cleaned;
    }

    function cleanExpressDate(value?: string) {
      const cleaned = cleanExpressValue(value);

      if (!cleaned) return "";

      return normalizeQuickEntryDate(cleaned) || cleaned;
    }

    if (type === "1") {
      const [
        name,
        kind,
        clientLevel,
        preferredLanguage,
        relationshipStatus,
        email,
        phone,
        city,
        postalAddress,
        budget,
        source,
        preferences,
        importantNotes,
        notes
      ] = parts;

      if (!cleanExpressValue(name)) {
        window.alert(dialogT("crm.shell.1cd0583961"));
        return;
      }

      const contact = {
        id: crypto.randomUUID(),
        name: cleanExpressValue(name),
        kind: cleanExpressValue(kind) || "Client",
        clientLevel: cleanExpressValue(clientLevel) || "Standard",
        preferredLanguage: cleanExpressValue(preferredLanguage) || "Français",
        relationshipStatus: cleanExpressValue(relationshipStatus) || "Prospect",
        email: cleanExpressValue(email),
        phone: cleanExpressValue(phone),
        city: cleanExpressValue(city),
        postalAddress: cleanExpressValue(postalAddress),
        budget: parseExpressNumber(budget),
        source: cleanExpressValue(source) || "Ajout contact express",
        preferences: cleanExpressValue(preferences),
        importantNotes: cleanExpressValue(importantNotes),
        notes: cleanExpressValue(notes),
        createdAt: new Date().toISOString().slice(0, 10)
      } as any;

      if (!confirmDuplicateContact(contact as Contact)) return;

      setData((current: any) => ({
        ...current,
        contacts: [contact, ...(current.contacts ?? [])]
      }));

      notify(screenNotice("crm.shell.f96f13465b"));
      return;
    }

    if (type === "2") {
      const [
        category,
        contactName,
        assetLabel,
        rentalStartDate,
        rentalEndDate,
        value,
        status,
        priority,
        dueDate,
        nextAction,
        notes
      ] = parts;

      if (!cleanExpressValue(contactName)) {
        window.alert(dialogT("crm.shell.1cd0583961"));
        return;
      }

      const wantedAsset = cleanExpressValue(assetLabel).toLowerCase();
      let assetType = "";
      let assetId = "";

      if (wantedAsset) {
        const property = data.properties.find((property: any) => {
          const label = String(property.name ?? property.title ?? "").toLowerCase();
          return label && (label === wantedAsset || label.includes(wantedAsset) || wantedAsset.includes(label));
        });

        const vehicle = !property ? (data.vehicles ?? []).find((vehicle: any) => {
          const label = String(vehicle.name ?? `${vehicle.brand ?? ""} ${vehicle.model ?? ""}`).toLowerCase();
          return label && (label === wantedAsset || label.includes(wantedAsset) || wantedAsset.includes(label));
        }) : null;

        const boat = !property && !vehicle ? (data.boats ?? []).find((boat: any) => {
          const label = String(boat.name ?? "").toLowerCase();
          return label && (label === wantedAsset || label.includes(wantedAsset) || wantedAsset.includes(label));
        }) : null;

        if (property) {
          assetType = "Property";
          assetId = property.id;
        } else if (vehicle) {
          assetType = "Vehicle";
          assetId = vehicle.id;
        } else if (boat) {
          assetType = "Boat";
          assetId = boat.id;
        }
      }

      const leadNotes = [
        cleanExpressValue(assetLabel) && !assetId ? `Actif proposé : ${cleanExpressValue(assetLabel)}` : "",
        cleanExpressValue(notes)
      ].filter(Boolean).join("\n\n");

      const lead = {
        id: crypto.randomUUID(),
        category: cleanExpressValue(category) || "Villa",
        contactName: cleanExpressValue(contactName),
        assetType,
        assetId,
        status: cleanExpressValue(status) || "Nouveau",
        value: parseExpressNumber(value),
        priority: cleanExpressValue(priority) || "Moyenne",
        dueDate: cleanExpressDate(dueDate),
        nextAction: cleanExpressValue(nextAction) || "Qualifier la demande.",
        notes: leadNotes,
        rentalStartDate: cleanExpressDate(rentalStartDate),
        rentalEndDate: cleanExpressDate(rentalEndDate)
      } as any;

      if (!confirmDuplicateLead(lead as Lead)) return;

      setData((current: any) => ({
        ...current,
        leads: [lead, ...(current.leads ?? [])]
      }));

      notify(screenNotice("crm.shell.873a345451"));
      return;
    }

    window.alert(dialogT("crm.shell.fff9a694a9"));
  }

  function openQuickInventoryPrompt() {
    const choice = window.prompt(
      dialogT("crm.shell.83ce5bce6d"),
      "1"
    );

    if (!choice) return;

    const type = choice.trim();

    const examples: Record<string, string> = {
      "1": "Villa Kanupi | Villa | Super Cannes | 18000 | Disponible | Propriétaire à compléter | 5 chambres, piscine, vue mer",
      "2": "Range Rover Sport | Range Rover | Sport | Cannes | 450 | Disponible | Propriétaire à compléter | livraison possible",
      "3": "Yacht Princess 60 | Port Canto | Yacht | 3500 | Disponible | Propriétaire à compléter | journée charter"
    };

    const labels: Record<string, string> = {
      "1": "Format bien : Nom | Type | Ville | Prix | Statut | Propriétaire | Notes",
      "2": "Format voiture : Nom | Marque | Modèle | Ville | Prix/jour | Statut | Propriétaire | Notes",
      "3": "Format bateau : Nom | Port | Type | Prix/jour | Statut | Propriétaire | Notes"
    };

    const raw = window.prompt(
      dialogT("crm.shell.64fb2bf7b7", { value1: displayValue(labels[type] || labels["1"]) }),
      examples[type] || examples["1"]
    );

    if (!raw) return;

    const parts = parseInventoryLine(raw);

    if (parts.length < 3) {
      window.alert(dialogT("crm.shell.4d44c504a9"));
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const priceFrom = (value?: string) => Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;

    if (type === "1") {
      const [name, propertyType, city, price, status, owner, notes] = parts;

      const property = {
        id: crypto.randomUUID(),
        name,
        type: propertyType || "Villa",
        city: city || "",
        price: priceFrom(price),
        status: status || "Disponible",
        owner: owner || "",
        bedrooms: notes?.match(/(\d+)\s*ch/i)?.[1] ? Number(notes.match(/(\d+)\s*ch/i)?.[1]) : 0,
        surface: 0,
        notes: notes || "",
        createdAt: today
      } as any;

      if (!property.name) {
        window.alert(dialogT("crm.shell.5d51b56a6d"));
        return;
      }

      if (!confirmDuplicateAsset("bien", property)) return;

      setData((current: any) => ({
        ...current,
        properties: [property, ...(current.properties ?? [])]
      }));

      notify(screenNotice("crm.shell.b86f17a7eb"));
      return;
    }

    if (type === "2") {
      const [name, brand, model, city, price, status, owner, notes] = parts;

      const vehicle = {
        id: crypto.randomUUID(),
        name,
        brand: brand || "",
        model: model || "",
        city: city || "",
        price: priceFrom(price),
        status: status || "Disponible",
        owner: owner || "",
        year: "",
        mileage: "",
        notes: notes || "",
        createdAt: today
      } as any;

      if (!vehicle.name) {
        window.alert(dialogT("crm.shell.110bc581c5"));
        return;
      }

      if (!confirmDuplicateAsset("voiture", vehicle)) return;

      setData((current: any) => ({
        ...current,
        vehicles: [vehicle, ...(current.vehicles ?? [])]
      }));

      notify(screenNotice("crm.shell.924bdfa8af"));
      return;
    }

    if (type === "3") {
      const [name, port, boatType, price, status, owner, notes] = parts;

      const boat = {
        id: crypto.randomUUID(),
        name,
        port: port || "",
        type: boatType || "Yacht",
        price: priceFrom(price),
        status: status || "Disponible",
        owner: owner || "",
        year: "",
        length: "",
        notes: notes || "",
        createdAt: today
      } as any;

      if (!boat.name) {
        window.alert(dialogT("crm.shell.044ad2b20c"));
        return;
      }

      if (!confirmDuplicateAsset("bateau", boat)) return;

      setData((current: any) => ({
        ...current,
        boats: [boat, ...(current.boats ?? [])]
      }));

      notify(screenNotice("crm.shell.c961505050"));
      return;
    }

    window.alert(dialogT("crm.shell.9a8b944c69"));
  }

  function openQuickEntryPrompt() {
    const text = promptQuickEntryText(quickEntryText, t);
    if (text) saveQuickEntryText(text);
  }

  function createQuickEntry() {
    saveQuickEntryText(quickEntryText);
  }


  async function getCurrentCrmUserId() {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      notify(screenNotice("crm.shell.fbca9a8251"), "warning");
      return "";
    }

    return userData.user.id;
  }

  async function upsertContactToSupabase(contact: Contact) {
    const userId = await getCurrentCrmUserId();

    if (!userId) return false;

    const { error } = await supabase
      .from("crm_contacts")
      .upsert(contactToSupabaseRow(contact, userId), { onConflict: "id" });

    if (error) {
      notify(safeCRMError(error), "warning");
      return false;
    }

    return true;
  }

  async function deleteContactFromSupabase(id: string) {
    const userId = await getCurrentCrmUserId();

    if (!userId) return false;

    const { error } = await supabase
      .from("crm_contacts")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      notify(safeCRMError(error), "warning");
      return false;
    }

    return true;
  }

  async function loadContactsFromSupabaseOnce(isCancelled: () => boolean) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user || isCancelled()) return;

    const { data: rows, error } = await supabase
      .from("crm_contacts")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      notify(safeCRMError(error), "warning");
      return;
    }

    const cloudContacts = Array.isArray(rows) ? rows.map(contactFromSupabaseRow).filter((contact) => contact.id) : [];

    if (cloudContacts.length > 0) {
      setData((current) => ({
        ...current,
        contacts: cloudContacts
      }));

      notify(screenNotice("crm.shell.3200baf2a4"));
      return;
    }

    const raw = crmCache.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const localContacts = Array.isArray(parsed?.contacts) ? parsed.contacts as Contact[] : [];

    if (localContacts.length === 0) return;

    const confirmed = window.confirm(
      dialogT("crm.shell.9ce40b2ca4", { value1: displayValue(localContacts.length) })
    );

    if (!confirmed) return;

    const payload = localContacts
      .filter((contact) => contact?.id && contact?.name)
      .map((contact) => contactToSupabaseRow(contact, userData.user.id));

    if (payload.length === 0) return;

    const { error: upsertError } = await supabase
      .from("crm_contacts")
      .upsert(payload, { onConflict: "id" });

    if (upsertError) {
      notify(safeCRMError(upsertError), "warning");
      return;
    }

    notify(screenNotice("crm.shell.1d389c7ebf", { value1: displayValue(payload.length) }));
  }

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void Promise.resolve(); // crm_contacts désactivé : crm_workspace_state est la base partagée
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);


  async function reloadSharedWorkspaceFromCloud() {
    if (workspaceBusy.current) return;
    if (hasUnsavedChanges && !window.confirm(dialogT("crm.shell.f919eb38df"))) return;
    const requestedFingerprint = workspaceFingerprint(data);
    const signal = identityLifetime.current.signal;
    const token = currentAccessToken.current;
    workspaceBusy.current = true;
    try {
      setSharedWorkspaceStatus("loading");
      setSharedWorkspaceMessage(screenNotice("crm.shell.60f2549518"));

      const { data: userData, error: userError } = await supabase.auth.getUser(token);

      if (signal.aborted) return;
      if (userError || !userData.user || userData.user.id !== sessionUserId) {
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage(screenNotice("crm.shell.a9faa96fae"));
        notify(screenNotice("crm.shell.d90c3b85e7"), "warning");
        return;
      }

      const { data: row, error } = await supabase
        .from("crm_workspace_state")
        .select("payload, updated_at")
        .eq("workspace_id", SHARED_WORKSPACE_ID)
        .abortSignal(signal)
        .single()
        .setHeader("Authorization", `Bearer ${token}`);

      if (signal.aborted) return;
      if (error) {
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage(safeCRMError(error));
        notify(screenNotice("crm.shell.12b384f221"), "warning");
        return;
      }

      if (workspaceFingerprint(currentBusinessData.current) !== requestedFingerprint) {
        setSharedWorkspaceStatus("local");
        setSharedWorkspaceMessage(screenNotice("crm.shell.5283fef9d3"));
        return;
      }
      const sharedData = normalizeSharedCRMData(row?.payload);

      acceptSharedWorkspace(sharedData, String(row?.updated_at || ""));
      setSharedWorkspaceReady(true);
      setSharedWorkspaceStatus("connected");
      setSharedWorkspaceMessage(screenNotice("crm.shell.ca2cb8e133"));

      notify(screenNotice("crm.shell.885b7bd716"));
    } finally {
      workspaceBusy.current = false;
      if (!signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
    }
  }

  async function forceSaveSharedWorkspaceNow() {
    const signal = identityLifetime.current.signal;
    const token = currentAccessToken.current;
    if (await writeSharedWorkspace(data, signal, token)) notify(screenNotice("crm.shell.6159f4160c"));
  }

  async function saveCrmBackupToSupabase() {
    const signal = identityLifetime.current.signal;
    const token = currentAccessToken.current;
    const currentData = data as any;

    const contactsCount = Array.isArray(currentData.contacts) ? currentData.contacts.length : 0;
    const leadsCount = Array.isArray(currentData.leads) ? currentData.leads.length : 0;
    const propertiesCount = Array.isArray(currentData.properties) ? currentData.properties.length : 0;
    const vehiclesCount = Array.isArray(currentData.vehicles) ? currentData.vehicles.length : 0;
    const boatsCount = Array.isArray(currentData.boats) ? currentData.boats.length : 0;
    const tasksCount = Array.isArray(currentData.tasks) ? currentData.tasks.length : 0;
    const visibleQuotes = (currentData.quotes ?? []) as QuoteRequest[];
    const currentDataWithVisibleQuotes: CRMData = {
      ...currentData,
      quotes: visibleQuotes
    };
    const quotesCount = visibleQuotes.length;

    const total =
      contactsCount +
      leadsCount +
      propertiesCount +
      vehiclesCount +
      boatsCount +
      tasksCount +
      quotesCount;

    if (total === 0) {
      window.alert(dialogT("crm.shell.149a9c1914"));
      return;
    }

    const confirmed = window.confirm(
      dialogT("crm.shell.78b89480fe", { value1: displayValue(contactsCount), value2: displayValue(leadsCount), value3: displayValue(propertiesCount), value4: displayValue(vehiclesCount), value5: displayValue(boatsCount), value6: displayValue(tasksCount), value7: displayValue(quotesCount) })
    );

    if (!confirmed || signal.aborted) return;

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (signal.aborted) return;
    if (userError || !userData.user || userData.user.id !== sessionUserId) {
      window.alert(dialogT("crm.shell.8a52595800"));
      return;
    }

    if (!await writeSharedWorkspace(currentDataWithVisibleQuotes, signal, token) || signal.aborted) return;

    const payload = {
      version: "oneaddress-riviera-crm-v1",
      savedAt: new Date().toISOString(),
      data: currentDataWithVisibleQuotes
    };

    const { error } = await supabase.from("crm_backups").insert({
      user_id: userData.user.id,
      payload,
      contacts_count: contactsCount,
      leads_count: leadsCount,
      properties_count: propertiesCount,
      vehicles_count: vehiclesCount,
      boats_count: boatsCount,
      tasks_count: tasksCount,
      quotes_count: quotesCount
    })
      .setHeader("Authorization", `Bearer ${token}`)
      .abortSignal(signal);

    if (signal.aborted) return;
    if (error) {
      window.alert(dialogText(safeCRMError(error)));
      return;
    }

    window.alert(dialogT("crm.shell.ea1c9c32f9"));
  }

  async function exportCsv() {
    try {
      const exportedTasks = taskRights.export ? (await taskApi.export!()).map(taskForBusinessView) : [];
      exportCRMAsCsv({ ...data, tasks: exportedTasks });
      notify(screenNotice("crm.shell.648d809709"));
    } catch { notify(screenNotice("crm.shell.8f945a54e3"), "warning"); }
  }

  async function exportJson() {
    let exportedTasks: Task[] = [];
    try {
      if (taskRights.export) exportedTasks = (await taskApi.export!()).map(taskForBusinessView);
    } catch { notify(screenNotice("crm.shell.8f945a54e3"), "warning"); return; }
    const exportPayload = {
      ...data,
      tasks: exportedTasks,
      quotes: mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `oneaddress-riviera-crm-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify(screenNotice("crm.shell.83274934aa"));
  }

  

  function addHouseTrackingHouse(house: HouseTrackingHouse) {
    setData((current) => ({
      ...current,
      houseTrackingHouses: [stampCreated(house, activeActor), ...(((current as any).houseTrackingHouses ?? []) as HouseTrackingHouse[])]
    }));

    notify(screenNotice("crm.shell.76a6654637"));
  }

  function deleteHouseTrackingHouse(id: string) {
    setData((current) => ({
      ...current,
      houseTrackingHouses: (((current as any).houseTrackingHouses ?? []) as HouseTrackingHouse[]).filter((house) => house.id !== id),
      houseTimeEntries: (((current as any).houseTimeEntries ?? []) as HouseTimeEntry[]).filter((entry) => entry.houseId !== id),
      housePayments: (((current as any).housePayments ?? []) as HousePayment[]).filter((payment) => payment.houseId !== id)
    }));

    notify(screenNotice("crm.shell.7f98a469fc"));
  }

  function addHouseTrackingWorker(worker: HouseTrackingWorker) {
    setData((current) => ({
      ...current,
      houseTrackingWorkers: [stampCreated(worker, activeActor), ...(((current as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[])]
    }));

    notify(screenNotice("crm.shell.e9e7a14924"));
  }

  async function persistHouseRecord(kind: "worker" | "hours", id: string, patch: HouseWorkerEdit | HouseTimeEntry): Promise<FormSaveResult> {
    const before = currentBusinessData.current;
    if (!sharedWorkspaceReady || workspaceBusy.current || workspaceSync.current.dirty(before)) {
      return { ok: false, message: "Attendez la synchronisation des modifications en cours, puis réessayez. Votre saisie est conservée." };
    }
    const write = workspaceSync.current.prepare(before);
    if (!write) return { ok: false, message: "Conflit de révision. Votre saisie est conservée ; rechargez les données avant de reprendre." };
    workspaceBusy.current = true;
    try {
      const op = await beginHouseOperation();
      const result = await op.run(() => op.client.rpc(kind === "worker" ? "crm_update_house_worker" : "crm_create_house_time_entry", {
        p_id: id, p_patch: patch, p_revision: write.revision
      }));
      if (result.error) throw new Error(result.error.message);
      const merge = (value: CRMData): CRMData => kind === "worker" ? { ...value,
        houseTrackingWorkers: (value.houseTrackingWorkers ?? []).map(worker => worker.id === id ? { ...worker, ...result.data.worker } : worker)
      } : { ...value, houseTimeEntries: [result.data.entry as HouseTimeEntry, ...(value.houseTimeEntries ?? [])] };
      const acknowledged = merge(before);
      workspaceSync.current.load(acknowledged, result.data.workspaceRevision);
      setAcceptedWorkspaceFingerprint(workspaceFingerprint(acknowledged));
      setSharedWorkspaceUpdatedAt(result.data.workspaceRevision);
      failedSaveFingerprint.current = null;
      setData(current => merge(current));
      setFormDirty(false);
      return { ok: true, recordId: id };
    } catch (error) {
      const cancelled = isCancelled(error);
      return { ok: false, cancelled, message: cancelled
        ? "Enregistrement interrompu : le compte ou les droits ont changé."
        : error instanceof Error && error.message.includes("revision_conflict")
          ? "Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre."
          : "Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits." };
    } finally {
      workspaceBusy.current = false;
      if (!identityLifetime.current.signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
    }
  }

  function updateHouseTrackingWorker(id: string, patch: HouseWorkerEdit) {
    return persistHouseRecord("worker", id, patch);
  }

  function archiveHouseTrackingWorker(id: string) {
    setData((current) => ({
      ...current,
      houseTrackingWorkers: setHouseTrackingWorkerStatus(
        (((current as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]),
        id,
        "Inactif"
      ).map((worker) => worker.id === id ? stampUpdated(worker, activeActor) : worker)
    }));

    notify(screenNotice("crm.shell.7dd139cf62"));
  }

  function reactivateHouseTrackingWorker(id: string) {
    setData((current) => ({
      ...current,
      houseTrackingWorkers: setHouseTrackingWorkerStatus(
        (((current as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]),
        id,
        "Actif"
      ).map((worker) => worker.id === id ? stampUpdated(worker, activeActor) : worker)
    }));

    notify(screenNotice("crm.shell.0cc815edac"));
  }

  function permanentlyDeleteHouseTrackingWorkerSafely(id: string) {
    const currentWorkers = (((data as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]);
    const currentEntries = (((data as any).houseTimeEntries ?? []) as HouseTimeEntry[]);
    const currentPayments = (((data as any).housePayments ?? []) as HousePayment[]);
    const initialCheck = permanentlyDeleteHouseTrackingWorker(currentWorkers, currentEntries, currentPayments, id);

    if (initialCheck.blocked) {
      notify(screenNotice("crm.shell.a69eb6c676"), "warning");
      return;
    }

    setData((current) => {
      const workers = (((current as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]);
      const timeEntries = (((current as any).houseTimeEntries ?? []) as HouseTimeEntry[]);
      const payments = (((current as any).housePayments ?? []) as HousePayment[]);
      const result = permanentlyDeleteHouseTrackingWorker(workers, timeEntries, payments, id);

      if (result.blocked) return current;

      return {
        ...current,
        houseTrackingWorkers: result.workers
      };
    });

    notify(screenNotice("crm.shell.e75a73d1eb"));
  }

  function addHouseTimeEntry(entry: HouseTimeEntry) {
    return persistHouseRecord("hours", entry.id, entry);
  }

  function deleteHouseTimeEntry(id: string) {
    setData((current) => ({
      ...current,
      houseTimeEntries: (((current as any).houseTimeEntries ?? []) as HouseTimeEntry[]).filter((entry) => entry.id !== id)
    }));

    notify(screenNotice("crm.shell.a4c11b2089"));
  }

  function addHousePayment(payment: HousePayment) {
    setData((current) => ({
      ...current,
      housePayments: [stampCreated(payment, activeActor), ...(((current as any).housePayments ?? []) as HousePayment[])]
    }));

    notify(screenNotice("crm.shell.e4daf0a6a9"));
  }

  function deleteHousePayment(id: string) {
    setData((current) => ({
      ...current,
      housePayments: (((current as any).housePayments ?? []) as HousePayment[]).filter((payment) => payment.id !== id)
    }));

    notify(screenNotice("crm.shell.cdd34809de"));
  }

  function addCRMDocument(crmDocument: CRMDocument) {
    setData((current) => ({
      ...current,
      documents: [crmDocument, ...(((current as any).documents ?? []) as CRMDocument[])]
    }));

    notify(screenNotice("crm.shell.5826801d6d"));
  }

  function updateCRMDocument(updatedDocument: CRMDocument) {
    setData((current) => ({
      ...current,
      documents: (((current as any).documents ?? []) as CRMDocument[]).map((crmDocument) =>
        crmDocument.id === updatedDocument.id ? updatedDocument : crmDocument
      )
    }));

    notify(screenNotice("crm.shell.1dba010cf5"));
  }

  async function trashCRMDocument(crmDocument: CRMDocument, operationId: string) {
    const before = currentBusinessData.current;
    if (!sharedWorkspaceReady || workspaceBusy.current || workspaceSync.current.dirty(before)) {
      throw new Error("Attendez la synchronisation des modifications en cours, puis réessayez. Votre saisie est conservée.");
    }
    const write = workspaceSync.current.prepare(before);
    if (!write) throw new Error("Conflit de révision. Votre saisie est conservée ; rechargez les données avant de reprendre.");
    const fileId = crmDocument.isFolder ? crmDocument.driveFolderId : crmDocument.driveFileId;
    const parentFolderId = crmDocument.folderId || crmDocument.parentFolderId || "";
    const parentDriveFolderId = crmDocument.driveParentFolderId || (!crmDocument.isFolder ? crmDocument.driveFolderId : "") || "";
    workspaceBusy.current = true;
    try {
      const response = await fetchDriveAPI("/api/drive/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: identityLifetime.current.signal,
        body: JSON.stringify({ operationId, documentId: crmDocument.id, fileId, parentFolderId, parentDriveFolderId, revision: write.revision })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Mise à la corbeille non confirmée.");
      if (identityLifetime.current.signal.aborted) throw new Error("La session a changé ; reprenez depuis le compte initial.");
      // The durable server journal may adopt an earlier operation for these
      // exact identifiers after a lost response in another tab or session.
      const validOperationId = typeof result.operation_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.operation_id);
      if (result.completed !== true || result.status !== "completed" || !validOperationId || result.record_id !== crmDocument.id || result.resource_id !== fileId || result.parent_record_id !== parentFolderId || result.parent_resource_id !== parentDriveFolderId || !result.workspace_revision || !result.workspace_payload || !Array.isArray(result.workspace_payload.documents) || result.workspace_payload.documents.some((item: { id?: string }) => item.id === crmDocument.id)) {
        throw new Error("La confirmation complète de cette ressource est absente. Aucune fiche locale n’a été retirée.");
      }
      const acknowledged = normalizeSharedCRMData(result.workspace_payload);
      const latest = currentBusinessData.current;
      const merged = mergeDocumentTrashCompletion(before, latest, acknowledged, crmDocument.id);
      workspaceSync.current.load(acknowledged, result.workspace_revision);
      setAcceptedWorkspaceFingerprint(workspaceFingerprint(acknowledged));
      failedSaveFingerprint.current = null;
      setSharedWorkspaceUpdatedAt(result.workspace_revision);
      setData(current => {
        const completion = mergeDocumentTrashCompletion(before, current, acknowledged, crmDocument.id);
        if (completion.conflicted) workspaceSync.current.conflict();
        return completion.data;
      });
      if (merged.conflicted) showWorkspaceConflict();
      else {
        setSharedWorkspaceStatus("connected");
        setSharedWorkspaceMessage(screenNotice("crm.shell.1266602c1d"));
      }
      // Form drafts are independent from the committed workspace and stay intact.
      notify(screenNotice("crm.shell.5106beba5c", { value1: displayValue(crmDocument.isFolder ? t("crm.documents.2cdf175d11") : t("crm.enums.file")) }));
    } finally {
      workspaceBusy.current = false;
      if (!identityLifetime.current.signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
    }
  }


  function addVendorQuote(quote: VendorQuote) {
    const createdQuote = normalizeVendorQuoteFinancials(
      stampCreated(quote, activeActor) as VendorQuote
    );

    setData((current) => ({
      ...current,
      vendorQuotes: [createdQuote, ...(((current as any).vendorQuotes ?? []) as VendorQuote[])]
    }));

    notify(screenNotice("crm.shell.e730183f39"));
  }

  function updateVendorQuote(updatedQuote: VendorQuote) {
    setData((current) => {
      const quotes = (((current as any).vendorQuotes ?? []) as VendorQuote[]);
      const invoices = (((current as any).vendorInvoices ?? []) as VendorInvoice[]);
      const originalQuote = quotes.find(quote => quote.id === updatedQuote.id);
      if (!originalQuote) return current;
      const savedQuote = normalizeVendorQuoteFinancials(
        stampUpdated(preserveVendorQuoteIdentity(originalQuote, updatedQuote), activeActor) as VendorQuote
      );

      const nextInvoices = invoices.map((invoice) => {
        const isLinked = invoice.id === savedQuote.linkedInvoiceId || invoice.sourceQuoteId === savedQuote.id;
        const canStillFollowQuote =
          invoice.status === "En attente de facture" && isEmptyAutomaticVendorInvoice(invoice);

        if (!isLinked || !canStillFollowQuote) return invoice;

        return {
          ...invoice,
          contactId: savedQuote.contactId,
          contactName: savedQuote.contactName,
          contactPersonName: savedQuote.contactPersonName,
          category: savedQuote.category,
          title: `Facture attendue · ${savedQuote.title}`,
          amount: normalizeEuroAmount(savedQuote.amount),
          sourceQuoteReference: savedQuote.quoteReference,
          notes: `Créée automatiquement depuis le devis ${savedQuote.quoteReference}.${savedQuote.notes ? `\n\n${savedQuote.notes}` : ""}`
        };
      });

      return {
        ...current,
        vendorQuotes: quotes.map((quote) => quote.id === savedQuote.id ? savedQuote : quote),
        vendorInvoices: nextInvoices
      };
    });

    notify(screenNotice("crm.shell.adce916a6a"));
  }

  function validateVendorQuote(id: string) {
    const invoiceId = makeId("invoice");
    try { validateVendorQuoteIdempotently(data, id, invoiceId); }
    catch (error) { notify(safeCRMError(error)); return; }
    setData(current => {
      try {
        const next = validateVendorQuoteIdempotently(current, id, invoiceId);
        return { ...next, vendorQuotes: next.vendorQuotes?.map(quote => quote.id === id
          ? stampUpdated(quote, activeActor) as VendorQuote : quote) };
      } catch { return current; }
    });
    notify(screenNotice("crm.shell.e88c7d9a28"));
  }

  function rejectVendorQuote(id: string) {
    setData((current) => {
      const quotes = (((current as any).vendorQuotes ?? []) as VendorQuote[]);
      const invoices = (((current as any).vendorInvoices ?? []) as VendorInvoice[]);
      const quote = quotes.find((item) => item.id === id);

      if (!quote) return current;

      const rejectedQuote = stampUpdated({
        ...quote,
        status: "Refusé"
      }, activeActor) as VendorQuote;

      const nextInvoices = invoices.map((invoice) => {
        const isLinked = invoice.id === quote.linkedInvoiceId || invoice.sourceQuoteId === quote.id;
        const isUntouchedPending =
          invoice.status === "En attente de facture" && isEmptyAutomaticVendorInvoice(invoice);

        return isLinked && isUntouchedPending
          ? { ...invoice, status: "Annulé" as VendorInvoice["status"] }
          : invoice;
      });

      return {
        ...current,
        vendorQuotes: quotes.map((item) => item.id === id ? rejectedQuote : item),
        vendorInvoices: nextInvoices
      };
    });

    notify(screenNotice("crm.shell.0af6e9a03d"));
  }

  function deleteVendorQuote(id: string, choice?: VendorQuoteDeletionChoice) {
    try { deleteVendorQuoteWithDecision(data, id, choice); }
    catch (error) { window.alert(dialogText(safeCRMError(error))); return; }
    setData(current => {
      try { return deleteVendorQuoteWithDecision(current, id, choice); }
      catch { return current; }
    });
    notify(choice === "delete-both" ? screenNotice("crm.shell.cef28f46d8") : screenNotice("crm.shell.b542d17dcf"));
  }

  function deleteOrphanVendorInvoice(id: string) {
    try { deleteOrphanAutomaticVendorInvoice(data, id); }
    catch (error) { window.alert(dialogText(safeCRMError(error))); return; }
    setData(current => {
      try { return deleteOrphanAutomaticVendorInvoice(current, id); }
      catch { return current; }
    });
    notify(screenNotice("crm.shell.92d424bf96"));
  }

  function addVendorInvoice(invoice: VendorInvoice) {
    const normalizedInvoice = normalizeVendorInvoiceFinancials(invoice);

    setData((current) => ({
      ...current,
      vendorInvoices: [normalizedInvoice, ...(((current as any).vendorInvoices ?? []) as VendorInvoice[])]
    }));

    notify(screenNotice("crm.shell.cba8c3dda7"));
  }

  function updateVendorInvoice(updatedInvoice: VendorInvoice) {
    const existing = (data.vendorInvoices || []).find(invoice => invoice.id === updatedInvoice.id);
    if (existing?.paymentBankAccountId && existing.contactId !== updatedInvoice.contactId) {
      notify(screenNotice("crm.shell.22e9a5602c")); return;
    }
    const normalizedInvoice = normalizeVendorInvoiceFinancials({
      ...updatedInvoice,
      paymentBankAccountId: existing?.paidAmount && existing.paymentBankAccountId
        ? existing.paymentBankAccountId
        : updatedInvoice.paymentBankAccountId || existing?.paymentBankAccountId
    });

    setData((current) => ({
      ...current,
      vendorInvoices: (((current as any).vendorInvoices ?? []) as VendorInvoice[]).map((invoice) =>
        invoice.id === normalizedInvoice.id ? normalizedInvoice : invoice
      )
    }));

    notify(screenNotice("crm.shell.69423a79f5"));
  }

  function deleteVendorInvoice(id: string) {
    setData((current) => ({
      ...current,
      vendorInvoices: (((current as any).vendorInvoices ?? []) as VendorInvoice[]).filter((invoice) => invoice.id !== id)
    }));

    notify(screenNotice("crm.shell.685710ccd4"));
  }

  function addSupplier(supplier: Supplier) {
    setData((current) => ({
      ...current,
      suppliers: [supplier, ...(((current as any).suppliers ?? []) as Supplier[])]
    }));
    notify(screenNotice("crm.shell.084af8f5bb"));
  }

  function updateSupplier(updatedSupplier: Supplier) {
    setData((current) => ({
      ...current,
      suppliers: (((current as any).suppliers ?? []) as Supplier[]).map((supplier) =>
        supplier.id === updatedSupplier.id ? updatedSupplier : supplier
      )
    }));
    notify(screenNotice("crm.shell.b739b9c6ba"));
  }

  function deleteSupplier(id: string) {
    setData((current) => ({
      ...current,
      suppliers: (((current as any).suppliers ?? []) as Supplier[]).filter((supplier) => supplier.id !== id)
    }));
    notify(screenNotice("crm.shell.b800b54958"));
  }

async function addContact(event: React.FormEvent<HTMLFormElement>): Promise<FormSaveResult> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const contactKind = String(form.get("kind") ?? "Client") as ContactKind;
    const isPrestataire = contactKind === "Prestataire";
    const contact: Contact = stampCreated({
      id: formElement.dataset.contactDraftId || formElement.dataset.savedRecordId || makeId("c"),
      entityType: String(form.get("entityType") ?? "person") as Contact["entityType"],
      name: String(form.get("name") ?? "").trim(),
      firstName: String(form.get("firstName") ?? "").trim(),
      civility: String(form.get("civility") ?? "") as Contact["civility"],
      companyName: String(form.get("companyName") ?? "").trim(),
      kind: contactKind,
      organizationFunction: contactKind === "Membre de l’organisation" ? String(form.get("organizationFunction") ?? "").trim() : "",
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      postalAddress: readPostalAddress(form),
      budget: safeNumber(form.get("budget")),
      source: String(form.get("source") ?? "").trim() || "Direct",
      notes: String(form.get("notes") ?? "").trim(),
      clientLevel: String(form.get("clientLevel") ?? "Standard") as NonNullable<Contact["clientLevel"]>,
      preferredLanguage: String(form.get("preferredLanguage") ?? "Français") as NonNullable<Contact["preferredLanguage"]>,
      relationshipStatus: (isPrestataire ? "Prestataire" : String(form.get("relationshipStatus") ?? "Prospect")) as NonNullable<Contact["relationshipStatus"]>,
      preferences: String(form.get("preferences") ?? "").trim(),
      importantNotes: String(form.get("importantNotes") ?? "").trim(),
      supplierCategory: (isPrestataire ? getSupplierCategoryFromForm(form) : "") as Contact["supplierCategory"],
      supplierContactName: isPrestataire ? String(form.get("supplierContactName") ?? "").trim() : "",
      supplierZone: isPrestataire ? String(form.get("supplierZone") ?? "").trim() : "",
      supplierQuality: (isPrestataire ? String(form.get("supplierQuality") ?? "Standard") : "Standard") as Contact["supplierQuality"],
      supplierReliability: (isPrestataire ? String(form.get("supplierReliability") ?? "À tester") : "") as Contact["supplierReliability"],
      supplierPriceNotes: isPrestataire ? String(form.get("supplierPriceNotes") ?? "").trim() : "",
      supplierCommissionNotes: isPrestataire ? String(form.get("supplierCommissionNotes") ?? "").trim() : "",
      supplierStatus: (isPrestataire ? String(form.get("supplierStatus") ?? "Actif") : "") as Contact["supplierStatus"],
      createdAt: new Date().toISOString().slice(0, 10)
    }, activeActor) as Contact;
    const identityError = validateContactIdentity(contact);
    if (identityError) return { ok: false, message: identityError.code };
    // One ID for the lifetime of this draft, including an ambiguous response.
    formElement.dataset.contactDraftId = contact.id;
    if (!currentBusinessData.current.contacts.some(existing => existing.id === contact.id) && !confirmDuplicateContact(contact)) {
      return { ok: false, cancelled: true, message: "Enregistrement non confirmé. Votre saisie est conservée ; vérifiez les données avant de réessayer." };
    }
    const result = await persistContactRecord(contact.id, contact);
    if (result.ok) notify(screenNotice("crm.shell.670cd3e9c6"));
    return result;
  }

  function addLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assetSelection = parseAssetKey(form.get("assetKey"));

    const lead: Lead = stampCreated({
      id: makeId("l"),
      category: String(form.get("category") ?? "Villa") as Lead["category"],
      contactName: String(form.get("contactName") ?? "").trim(),
      assetType: assetSelection.assetType,
      assetId: assetSelection.assetId,
      status: String(form.get("status") ?? "Nouveau") as LeadStatus,
      value: safeNumber(form.get("value")),
      priority: String(form.get("priority") ?? "Moyenne") as Lead["priority"],
      nextAction: String(form.get("nextAction") ?? "").trim(),
      dueDate: String(form.get("dueDate") ?? ""),
      rentalStartDate: String(form.get("rentalStartDate") ?? ""),
      rentalEndDate: String(form.get("rentalEndDate") ?? ""),
      notes: String(form.get("notes") ?? "").trim()
    }, activeActor) as Lead;

    if (!lead.contactName) return notify(screenNotice("crm.shell.0f8a9705d1"), "warning");

    if (isOpenLead(lead) && (!lead.nextAction.trim() || !lead.dueDate)) {
      return notify(screenNotice("crm.shell.49ed09dfc6"), "warning");
    }

    if (!confirmDuplicateLead(lead)) return;

    const draftQuote = stampCreated(createDraftQuoteFromLead(lead), activeActor) as QuoteRequest;
    const nextLocalQuotes = mergeQuoteRequests(loadSavedQuotes(), [draftQuote]);

    saveQuotesToBrowser(nextLocalQuotes);

    setData((current) => ({
      ...current,
      leads: [lead, ...current.leads],
      quotes: mergeQuoteRequests((((current as any).quotes ?? []) as QuoteRequest[]), [draftQuote])
    }));
    event.currentTarget.reset();
    setLeadDraftContactName("");
    notify(screenNotice("crm.shell.fed386ea33"));
  }

  function addProperty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const property: Property = stampCreated({
      id: makeId("p"),
      name: String(form.get("name") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      type: String(form.get("type") ?? "Villa").trim(),
      price: safeNumber(form.get("price")),
      status: String(form.get("status") ?? "Disponible") as PropertyStatus,
      owner: String(form.get("owner") ?? "").trim(),
      bedrooms: safeNumber(form.get("bedrooms")),
      surface: safeNumber(form.get("surface"))
    }, activeActor) as Property;
    if (!property.name) return notify(screenNotice("crm.shell.a88394ebb1"), "warning");
    if (!confirmDuplicateAsset("bien", property)) return;
    setData((current) => ({ ...current, properties: [property, ...current.properties] }));
    event.currentTarget.reset();
    notify(screenNotice("crm.shell.28b3ab4b6f"));
  }

  function addVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicle: Vehicle = stampCreated({
      id: makeId("v"),
      name: String(form.get("name") ?? "").trim(),
      brand: String(form.get("brand") ?? "").trim(),
      model: String(form.get("model") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      price: safeNumber(form.get("price")),
      status: String(form.get("status") ?? "Disponible") as VehicleStatus,
      owner: String(form.get("owner") ?? "").trim(),
      year: safeNumber(form.get("year")),
      mileage: safeNumber(form.get("mileage"))
    }, activeActor) as Vehicle;
    if (!vehicle.name) return notify(screenNotice("crm.shell.dfb5977de3"), "warning");
    if (!confirmDuplicateAsset("voiture", vehicle)) return;
    setData((current) => ({ ...current, vehicles: [vehicle, ...(current.vehicles ?? [])] }));
    event.currentTarget.reset();
    notify(screenNotice("crm.shell.4735c46154"));
  }

  function addBoat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const boat: Boat = stampCreated({
      id: makeId("b"),
      name: String(form.get("name") ?? "").trim(),
      port: String(form.get("port") ?? "").trim(),
      type: String(form.get("type") ?? "Yacht").trim(),
      price: safeNumber(form.get("price")),
      status: String(form.get("status") ?? "Disponible") as BoatStatus,
      owner: String(form.get("owner") ?? "").trim(),
      year: safeNumber(form.get("year")),
      length: safeNumber(form.get("length"))
    }, activeActor) as Boat;
    if (!boat.name) return notify(screenNotice("crm.shell.b2bd5ae387"), "warning");
    if (!confirmDuplicateAsset("bateau", boat)) return;
    setData((current) => ({ ...current, boats: [boat, ...(current.boats ?? [])] }));
    event.currentTarget.reset();
    notify(screenNotice("crm.shell.c5694babb6"));
  }

  function updateProperty(updatedProperty: Property) {
    setData((current) => ({
      ...current,
      properties: current.properties.map((property) =>
        property.id === updatedProperty.id ? stampUpdated(updatedProperty, activeActor) as Property : property
      )
    }));

    notify(screenNotice("crm.shell.bd01a53a9b"));
  }

  function updateVehicle(updatedVehicle: Vehicle) {
    setData((current) => ({
      ...current,
      vehicles: (current.vehicles ?? []).map((vehicle) =>
        vehicle.id === updatedVehicle.id ? stampUpdated(updatedVehicle, activeActor) as Vehicle : vehicle
      )
    }));

    notify(screenNotice("crm.shell.b375846206"));
  }

  function updateBoat(updatedBoat: Boat) {
    setData((current) => ({
      ...current,
      boats: (current.boats ?? []).map((boat) =>
        boat.id === updatedBoat.id ? stampUpdated(updatedBoat, activeActor) as Boat : boat
      )
    }));

    notify(screenNotice("crm.shell.aa416c5fb5"));
  }

  function addPlanningEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const assetSelection = parseAssetKey(form.get("assetKey"));
    const planningCategory = normalizePlanningCategory(String(form.get("planningCategory") ?? ""))
      || getPlanningCategoryFromAssetType(assetSelection.assetType)
      || "Villa";
    const start = String(form.get("startDate") ?? "");
    const end = String(form.get("endDate") ?? "") || start;

    const entry = stampCreated({
      id: makeId("planning"),
      title: String(form.get("title") ?? "").trim(),
      type: String(form.get("type") ?? "Intervention prestataire") as PlanningEntryType,
      planningCategory,
      status: String(form.get("status") ?? "Prévu") as PlanningEntryStatus,
      priority: String(form.get("priority") ?? "Normal") as PlanningPriority,
      contactName: String(form.get("contactName") ?? "").trim(),
      assetType: assetSelection.assetType,
      assetId: assetSelection.assetId,
      startDate: start,
      startTime: String(form.get("startTime") ?? "").trim(),
      endDate: end,
      endTime: String(form.get("endTime") ?? "").trim(),
      blocksAvailability: String(form.get("blocksAvailability") ?? "false") === "true",
      notes: String(form.get("notes") ?? "").trim()
    }, activeActor) as PlanningEntry;

    if (!entry.title) return notify(screenNotice("crm.shell.9040a5a768"), "warning");
    if (!isValidPlanningDate(entry.startDate)) return notify(screenNotice("crm.shell.a1dc8b902b"), "warning");
    if (!isValidPlanningDate(entry.endDate)) return notify(screenNotice("crm.shell.aeec806c05"), "warning");
    if (planningDateValue(entry.endDate) < planningDateValue(entry.startDate)) {
      return notify(screenNotice("crm.shell.936b845199"), "warning");
    }

    setData((current) => ({
      ...current,
      planningEntries: [entry, ...(((current as any).planningEntries ?? []) as PlanningEntry[])]
    }));

    event.currentTarget.reset();
    notify(screenNotice("crm.shell.02b9b39f14"));
  }

  function deletePlanningEntry(id: string) {
    const confirmed = window.confirm(dialogT("crm.shell.c2ecdd08e2"));

    if (!confirmed) return;

    setData((current) => ({
      ...current,
      planningEntries: (((current as any).planningEntries ?? []) as PlanningEntry[]).filter((entry) => entry.id !== id)
    }));

    notify(screenNotice("crm.shell.20b59dd455"));
  }

  function patchPlanningEntry(id: string, patch: Partial<PlanningEntry>) {
    setData((current) => ({
      ...current,
      planningEntries: (((current as any).planningEntries ?? []) as PlanningEntry[]).map((entry) =>
        entry.id === id ? stampUpdated({ ...entry, ...patch }, activeActor) as PlanningEntry : entry
      )
    }));

    notify(screenNotice("crm.shell.4ce4c056a5"));
  }


  function patchLeadReservationDates(id: string, startDate: string, endDate: string) {
    if (!isValidPlanningDate(startDate) || !isValidPlanningDate(endDate)) {
      notify(screenNotice("crm.shell.d29fe884d5"), "warning");
      return;
    }

    if (planningDateValue(endDate) < planningDateValue(startDate)) {
      notify(screenNotice("crm.shell.936b845199"), "warning");
      return;
    }

    setData((current) => ({
      ...current,
      leads: current.leads.map((lead) =>
        lead.id === id
          ? stampUpdated({ ...lead, rentalStartDate: startDate, rentalEndDate: endDate }, activeActor) as Lead
          : lead
      )
    }));

    notify(screenNotice("crm.shell.001dc764ce"));
  }

  function updatePlanningEntry(id: string, event: React.FormEvent<HTMLFormElement>): boolean {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const assetSelection = parseAssetKey(form.get("assetKey"));
    const planningCategory = normalizePlanningCategory(String(form.get("planningCategory") ?? ""))
      || getPlanningCategoryFromAssetType(assetSelection.assetType)
      || "Villa";
    const start = String(form.get("startDate") ?? "");
    const end = String(form.get("endDate") ?? "") || start;

    const nextEntry = {
      title: String(form.get("title") ?? "").trim(),
      type: String(form.get("type") ?? "Intervention prestataire") as PlanningEntryType,
      planningCategory,
      status: String(form.get("status") ?? "Prévu") as PlanningEntryStatus,
      priority: String(form.get("priority") ?? "Normal") as PlanningPriority,
      contactName: String(form.get("contactName") ?? "").trim(),
      assetType: assetSelection.assetType,
      assetId: assetSelection.assetId,
      startDate: start,
      startTime: String(form.get("startTime") ?? "").trim(),
      endDate: end,
      endTime: String(form.get("endTime") ?? "").trim(),
      blocksAvailability: String(form.get("blocksAvailability") ?? "false") === "true",
      notes: String(form.get("notes") ?? "").trim()
    };

    if (!nextEntry.title) {
      notify(screenNotice("crm.shell.9040a5a768"), "warning");
      return false;
    }

    if (!isValidPlanningDate(nextEntry.startDate)) {
      notify(screenNotice("crm.shell.a1dc8b902b"), "warning");
      return false;
    }

    if (!isValidPlanningDate(nextEntry.endDate)) {
      notify(screenNotice("crm.shell.aeec806c05"), "warning");
      return false;
    }

    if (planningDateValue(nextEntry.endDate) < planningDateValue(nextEntry.startDate)) {
      notify(screenNotice("crm.shell.936b845199"), "warning");
      return false;
    }

    setData((current) => ({
      ...current,
      planningEntries: (((current as any).planningEntries ?? []) as PlanningEntry[]).map((entry) =>
        entry.id === id ? stampUpdated({ ...entry, ...nextEntry }, activeActor) as PlanningEntry : entry
      )
    }));

    notify(screenNotice("crm.shell.6a9ff2f202"));
    return true;
  }

  function updateLead(updatedLead: Lead) {
    setData((current) => ({
      ...current,
      leads: current.leads.map((lead) =>
        lead.id === updatedLead.id ? stampUpdated(updatedLead, activeActor) as Lead : lead
      )
    }));

    notify(screenNotice("crm.shell.0f2616d6c3"));
  }

  function updateLeadStatus(id: string, status: LeadStatus) {
    setData((current) => ({
      ...current,
      leads: current.leads.map((lead) => (lead.id === id ? stampUpdated({ ...lead, status }, activeActor) as Lead : lead))
    }));
  }

  
  function syncLeadFromQuote(quote: QuoteRequest) {
    if (!quote.leadId) return;

    const quoteItems = getQuoteItems(quote);
    const mainCategory = quoteItems[0]?.category || quote.categories?.[0] || "";
    const quoteValue = getQuoteTotal(quote);
    const leadStatus = getLeadStatusFromQuoteStatus(quote.status);

    setData((current) => ({
      ...current,
      quotes: mergeQuoteRequests((((current as any).quotes ?? []) as QuoteRequest[]), [stampUpdated(quote, activeActor) as QuoteRequest]),
      leads: current.leads.map((lead) =>
        lead.id === quote.leadId
          ? stampUpdated({
              ...lead,
              category: (mainCategory || lead.category) as Lead["category"],
              rentalStartDate: quote.startDate || lead.rentalStartDate,
              rentalEndDate: quote.endDate || lead.rentalEndDate,
              value: quoteValue,
              status: leadStatus
            }, activeActor) as Lead
          : lead
      )
    }));

    saveQuotesToBrowser(mergeQuoteRequests(loadSavedQuotes(), [quote]));
  }

function createQuoteDraftFromLead(lead: Lead) {
    const property = lead.assetType === "Property"
      ? data.properties.find((item) => item.id === lead.assetId)
      : undefined;

    const vehicle = lead.assetType === "Vehicle"
      ? (data.vehicles ?? []).find((item) => item.id === lead.assetId)
      : undefined;

    const boat = lead.assetType === "Boat"
      ? (data.boats ?? []).find((item) => item.id === lead.assetId)
      : undefined;

    const vehicleLabel = vehicle
      ? vehicle.name || `${vehicle.brand} ${vehicle.model}`.trim()
      : "";

    const assetLabel = property
      ? getPropertyDisplayName(property)
      : vehicleLabel || boat?.name || "";

    const location = property?.city || vehicle?.city || boat?.port || "";

    const category =
      lead.assetType === "Boat"
        ? "Bateau"
        : lead.assetType === "Vehicle"
          ? "Voiture"
          : lead.category || "Villa";

    const title = assetLabel
      ? `${category} · ${assetLabel}`
      : `${category} · ${lead.contactName}`;

    const notes = [
      lead.nextAction ? `Next action: ${lead.nextAction}` : "",
      lead.notes ? `Client request / internal notes: ${lead.notes}` : ""
    ].filter(Boolean).join("\n\n");

    const existingQuote = mergeQuoteRequests((((data as any).quotes ?? []) as QuoteRequest[]), loadSavedQuotes())
      .find((quote) => quote.leadId === lead.id);

    if (existingQuote) {
      setQuoteDraftFromLead({
        key: `${lead.id}-${existingQuote.id}-${Date.now()}`,
        leadId: lead.id,
        quoteId: existingQuote.id,
        clientName: lead.contactName,
        category,
        title,
        location,
        startDate: lead.rentalStartDate || "",
        endDate: lead.rentalEndDate || "",
        unitPrice: lead.value || 0,
        notes
      });

      setActiveTab("quotes");

      window.setTimeout(() => {
        document.querySelector<HTMLFormElement>('form[data-quote-form="true"]')?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }, 160);

      notify(screenNotice("crm.shell.bb76c9f8d0", { value1: displayValue(lead.contactName) }));
      return;
    }

    setQuoteDraftFromLead({
      key: `${lead.id}-${Date.now()}`,
      leadId: lead.id,
      clientName: lead.contactName,
      category,
      title,
      location,
      startDate: lead.rentalStartDate || "",
      endDate: lead.rentalEndDate || "",
      unitPrice: lead.value || 0,
      notes
    });

    setActiveTab("quotes");

    window.setTimeout(() => {
      document.querySelector<HTMLFormElement>('form[data-quote-form="true"]')?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 160);

    notify(screenNotice("crm.shell.8c53af4519", { value1: displayValue(lead.contactName) }));
  }


  function createTaskDraftFromFollowUp(recommendation: FollowUpRecommendation) {
    setTaskDraftContactId("");
    setTaskDraftLeadId(recommendation.leadId ?? "");
    setTaskDraftTitle(recommendation.title);
    setActiveTab("tasks");

    window.setTimeout(() => {
      document.getElementById("task-create-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 120);

    notify(screenNotice("crm.shell.fe212fbaa1"));
  }


  async function updateTaskStatus(id: string, status: TaskStatus) {
    const task = taskProjection.tasks.find(row => row.id === id);
    if (!task || pendingTaskStatus.current.has(id)) return;
    pendingTaskStatus.current.add(id);
    try {
      await taskApi.mutate(taskStatusRequests.current.prepare(id, task.revision, { status }));
      taskStatusRequests.current.confirmed(id);
      await taskProjection.refresh();
      notify(screenNotice("crm.shell.6e69a977bc"));
    } catch (error) {
      await taskProjection.refresh();
      notify(safeCRMError(error), "warning");
    } finally { pendingTaskStatus.current.delete(id); }
  }

  /** Contacts use the same authorised RPC for owners and limited contributors. */
  async function persistContactRecord(id: string, value: Partial<Contact>, remove = false): Promise<FormSaveResult> {
    const before = currentBusinessData.current;
    const fingerprint = workspaceFingerprint(before);
    if (!sharedWorkspaceReady || workspaceBusy.current || workspaceSync.current.dirty(before)) {
      return { ok: false, message: "Attendez la synchronisation des modifications en cours, puis réessayez. Votre saisie est conservée." };
    }
    const recovery = unconfirmedContact.current;
    const write = workspaceSync.current.prepare(before);
    const expectedRevision = write?.revision || (recovery?.id === id && recovery.fingerprint === fingerprint ? recovery.revision : "");
    if (!expectedRevision) {
      return { ok: false, message: "Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre." };
    }
    workspaceBusy.current = true;
    let sent = false;
    try {
      const op = await beginContactOperation();
      const projection = await op.run(() => op.client.rpc("crm_read_module", { p_module: "contacts" }));
      if (projection.error) throw projection.error;
      if (!projection.data?.revision || !Array.isArray(projection.data.collections?.contacts)) throw new Error("contact_confirmation_missing");
      // A fresh module revision must not silently authorise an obsolete owner
      // form. Keep the acknowledged global CAS expectation before admitting it.
      const expected = await op.run(() => op.client.from("crm_workspace_state")
        .select("updated_at").eq("workspace_id", SHARED_WORKSPACE_ID).single());
      if (expected.error) throw expected.error;
      if (String(expected.data?.updated_at || "") !== expectedRevision) throw { code: "40001", message: "revision_conflict" };
      const patch = Object.fromEntries(Object.entries(value).filter(([field, entry]) => contactMutationFields.has(field) && entry !== undefined));
      sent = true;
      const mutation = await op.run(() => op.client.rpc("crm_mutate_record", {
        p_module: "contacts", p_collection: "contacts", p_id: id, p_patch: patch,
        p_revision: projection.data.revision, p_delete: remove
      }));
      if (mutation.error) throw mutation.error;
      const returnedContacts = mutation.data?.collections?.contacts;
      if (!mutation.data?.revision || !Array.isArray(returnedContacts) ||
        (remove ? returnedContacts.some((contact: Contact) => contact.id === id) : !returnedContacts.some((contact: Contact) => contact.id === id))) {
        throw new Error("contact_confirmation_missing");
      }
      // The RPC revision is a module MD5. Only an owner workspace reread can
      // acknowledge the global CAS timestamp used by unrelated autosaves.
      const shared = await op.run(() => op.client.from("crm_workspace_state")
        .select("payload, updated_at").eq("workspace_id", SHARED_WORKSPACE_ID).single());
      if (shared.error) throw shared.error;
      if (!shared.data?.updated_at || !Array.isArray(shared.data.payload?.contacts) ||
        (remove ? shared.data.payload.contacts.some((contact: Contact) => contact.id === id) : !shared.data.payload.contacts.some((contact: Contact) => contact.id === id))) {
        throw new Error("contact_confirmation_missing");
      }
      const acknowledged = normalizeSharedCRMData(shared.data.payload);
      workspaceSync.current.load(acknowledged, String(shared.data.updated_at));
      setAcceptedWorkspaceFingerprint(workspaceFingerprint(acknowledged));
      setSharedWorkspaceUpdatedAt(String(shared.data.updated_at));
      failedSaveFingerprint.current = null;
      unconfirmedContact.current = null;
      setData(current => {
        const merged = { ...acknowledged } as CRMData;
        // Preserve any other business edit made while the request was pending.
        for (const key of Object.keys(current) as (keyof CRMData)[]) {
          if (workspaceFingerprint(current[key]) !== workspaceFingerprint(before[key])) {
            (merged as any)[key] = current[key];
            if (key === "contacts") workspaceSync.current.conflict();
          }
        }
        return merged;
      });
      setSharedWorkspaceStatus("connected");
      setSharedWorkspaceMessage(screenNotice("crm.shell.6159f4160c"));
      return { ok: true, recordId: id };
    } catch (error) {
      if (isCancelled(error)) return { ok: false, cancelled: true, message: "Enregistrement interrompu : le compte ou les droits ont changé." };
      const identityError = getContactIdentityValidationError(error);
      if (identityError) return { ok: false, message: identityError.code };
      const code = error && typeof error === "object" && "message" in error ? String(error.message) : "";
      const sqlState = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (sqlState === "40001" || code === "revision_conflict" || code === "contact_company_legacy_client_unsafe") {
        unconfirmedContact.current = null;
        showWorkspaceConflict();
        return { ok: false, message: "Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre." };
      }
      if (["22023", "42501", "23503"].includes(sqlState)) {
        return { ok: false, message: "Enregistrement refusé. Vérifiez les champs et vos droits ; votre saisie est conservée." };
      }
      if (sent) {
        // A lost response may follow a committed RPC. Freeze global autosave;
        // a retry reuses its ID and original CAS expectation; an already
        // committed response safely conflicts until the workspace is reloaded.
        unconfirmedContact.current = { id, fingerprint, revision: expectedRevision };
        showWorkspaceConflict();
      }
      return { ok: false, message: "Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits." };
    } finally {
      workspaceBusy.current = false;
      if (!identityLifetime.current.signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
    }
  }

  /** Preserve the existing owner-only banking CAS path and its private payload. */
  async function persistOwnerContactBankAccounts(id: string, accounts: Contact["supplierBankAccounts"]): Promise<FormSaveResult> {
    const before = currentBusinessData.current;
    if (!sharedWorkspaceReady || workspaceBusy.current || workspaceSync.current.dirty(before)) {
      return { ok: false, message: "Attendez la synchronisation des modifications en cours, puis réessayez. Votre saisie est conservée." };
    }
    const originalWrite = workspaceSync.current.prepare(before);
    if (!originalWrite) return { ok: false, message: "Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre." };
    let acknowledging = false;
    try {
      const op = await beginContactOperation();
      const latest = currentBusinessData.current;
      const currentWrite = workspaceSync.current.prepare(latest);
      // The identity check may await the network. Never let a newer revision
      // authorise the older payload captured before that wait.
      if (workspaceBusy.current || workspaceSync.current.dirty(latest) ||
        workspaceFingerprint(latest) !== originalWrite.fingerprint || currentWrite?.revision !== originalWrite.revision) {
        return { ok: false, message: "Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre." };
      }
      const payload = { ...before, contacts: before.contacts.map(contact => contact.id === id
        ? stampUpdated(mergeContactUpdate(contact, { supplierBankAccounts: accounts }), activeActor) as Contact : contact) };
      if (!await writeSharedWorkspace(payload, op.signal, op.token)) {
        return { ok: false, message: "Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits." };
      }
      // writeSharedWorkspace releases its own lock. Keep autosave paused until
      // this exact bank confirmation has also reached the local workspace.
      workspaceBusy.current = true;
      acknowledging = true;
      await op.check();
      const saved = payload.contacts.find(contact => contact.id === id)!;
      setData(current => ({ ...current, contacts: current.contacts.map(contact => contact.id === id
        ? mergeContactUpdate(contact, { supplierBankAccounts: saved.supplierBankAccounts, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy }) : contact) }));
      return { ok: true, recordId: id };
    } catch (error) {
      if (acknowledging && !identityLifetime.current.signal.aborted) showWorkspaceConflict();
      return { ok: false, cancelled: isCancelled(error), message: isCancelled(error)
        ? "Enregistrement interrompu : le compte ou les droits ont changé."
        : "Enregistrement non confirmé. Votre saisie est conservée ; vérifiez la connexion et vos droits." };
    } finally {
      if (acknowledging) {
        workspaceBusy.current = false;
        if (!identityLifetime.current.signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
      }
    }
  }

  async function updateContact(updatedContact: Pick<Contact, "id"> & Partial<Contact>): Promise<FormSaveResult> {
    const original = currentBusinessData.current.contacts.find(contact => contact.id === updatedContact.id);
    if (!original) return { ok: false, message: "Conflit : les données ont changé. Votre saisie est conservée ; rechargez avant de reprendre." };
    if (Object.prototype.hasOwnProperty.call(updatedContact, "supplierBankAccounts") &&
      workspaceFingerprint(updatedContact.supplierBankAccounts) !== workspaceFingerprint(original.supplierBankAccounts)) {
      const result = await persistOwnerContactBankAccounts(updatedContact.id, updatedContact.supplierBankAccounts);
      if (result.ok) notify(screenNotice("crm.shell.f7577d535d"));
      else notify(screenNotice(confirmedFormNotice(result.message).key), "warning");
      return result;
    }
    const identityFields = ["entityType", "name", "firstName", "civility", "companyName"];
    const identityError = validateContactIdentity(mergeContactUpdate(original, updatedContact), {
      allowUnqualifiedLegacy: original.entityType === undefined && !identityFields.some(field => Object.prototype.hasOwnProperty.call(updatedContact, field))
    });
    if (identityError) return { ok: false, message: identityError.code };
    const result = await persistContactRecord(updatedContact.id, updatedContact);
    if (result.ok) notify(screenNotice("crm.shell.f7577d535d"));
    return result;
  }

  async function deleteContact(id: string) {
    if (currentBusinessData.current.contacts.find(contact => contact.id === id)?.supplierBankAccounts?.length) {
      notify(screenNotice("crm.shell.44b47ac1d6")); return;
    }
    const result = await persistContactRecord(id, {}, true);
    if (result.ok) notify(screenNotice("crm.shell.3a5b1d6ee1"));
    else notify(screenNotice(confirmedFormNotice(result.message).key), "warning");
  }

  function deleteLead(id: string) {
    setData((current) => ({ ...current, leads: current.leads.filter((lead) => lead.id !== id) }));
    notify(screenNotice("crm.shell.77d27eba0b"));
  }

  function deleteProperty(id: string) {
    const property = data.properties.find((item) => item.id === id);
    const label = property ? getPropertyDisplayName(property) : "ce bien";
    const confirmed = window.confirm(dialogT("crm.shell.0220a49224", { value1: displayValue(label) }));

    if (!confirmed) return;

    setData((current) => ({ ...current, properties: current.properties.filter((property) => property.id !== id) }));
    notify(screenNotice("crm.shell.54d2ace2f5"));
  }

  function deleteVehicle(id: string) {
    const vehicle = (data.vehicles ?? []).find((item) => item.id === id);
    const label = vehicle?.name || "cette voiture";
    const confirmed = window.confirm(dialogT("crm.shell.0220a49224", { value1: displayValue(label) }));

    if (!confirmed) return;

    setData((current) => ({ ...current, vehicles: (current.vehicles ?? []).filter((vehicle) => vehicle.id !== id) }));
    notify(screenNotice("crm.shell.b8174d2288"));
  }

  function deleteBoat(id: string) {
    const boat = (data.boats ?? []).find((item) => item.id === id);
    const label = boat?.name || "ce bateau";
    const confirmed = window.confirm(dialogT("crm.shell.0220a49224", { value1: displayValue(label) }));

    if (!confirmed) return;

    setData((current) => ({ ...current, boats: (current.boats ?? []).filter((boat) => boat.id !== id) }));
    notify(screenNotice("crm.shell.c09369e8d9"));
  }

  function handleImportJson(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) return;

    const confirmed = window.confirm(
      dialogT("crm.shell.edcee7b3be")
    );

    if (!confirmed) {
      input.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Format JSON invalide.");
        }

        const knownKeys = ["contacts", "leads", "properties", "vehicles", "boats", "suppliers", "quotes", "vendorQuotes", "vendorInvoices", "houseTrackingHouses", "houseTrackingWorkers", "houseTimeEntries", "housePayments"];
        const hasKnownData = knownKeys.some((key) => Array.isArray((parsed as Record<string, unknown>)[key]));

        if (!hasKnownData) {
          throw new Error("Ce fichier ne ressemble pas à une sauvegarde CRM.");
        }

        const nextData = {
          ...data,
          ...(parsed as Partial<CRMData>),
          tasks: []
        } as CRMData;

        setData(nextData);

        if (Array.isArray((parsed as { quotes?: unknown }).quotes)) {
          const importedDeviss = ((parsed as { quotes?: unknown }).quotes as unknown[])
            .map(normalizeQuoteRequest)
            .filter((quote): quote is QuoteRequest => Boolean(quote));

          saveQuotesToBrowser(importedDeviss);
        }

        window.alert(dialogT("crm.shell.b42697cee3"));
      } catch (error) {
        window.alert(dialogT("crm.shell.ca98709cbc"));
      } finally {
        input.value = "";
      }
    };

    reader.readAsText(file);
  }

  // === SMART SIDEBAR BADGES START ===
  const sidebarTodayIso = new Date().toISOString().slice(0, 10);

  const sidebarLeadCount = (data.leads ?? []).filter((lead) => {
    const status = String(lead.status || "");
    return status !== "Gagné" && status !== "Perdu";
  }).length;

  const sidebarTaskCount = (visibleTasks ?? []).filter((task) => {
    return !isCompletedTaskStatus(task.status);
  }).length;

  const sidebarBookingCount = ((((data as any).quotes ?? []) as Array<{ status?: string; bookingStatus?: string }>)).filter((quote) => {
    const quoteStatus = String(quote.status || "");
    const bookingStatus = String(quote.bookingStatus || "À préparer");
    const isConfirmed = quoteStatus === "Accepted" || quoteStatus === "Gagné" || quoteStatus === "Confirmé";
    const isClosed = bookingStatus === "Terminé" || bookingStatus === "Annulé" || bookingStatus === "Perdu";
    return isConfirmed && !isClosed;
  }).length;

  const sidebarVendorQuoteCount = ((((data as any).vendorQuotes ?? []) as VendorQuote[])).filter((quote) => {
    return quote.status === "À valider";
  }).length;

  const sidebarVendorInvoiceCount = ((((data as any).vendorInvoices ?? []) as VendorInvoice[])).filter((invoice) => {
    const status = String(invoice.status || "");
    return status !== "Payé" && status !== "Annulé";
  }).length;

  const sidebarPlanningCount = ((((data as any).planningEntries ?? []) as PlanningEntry[])).filter((entry) => {
    const status = String(entry.status || "Prévu");
    if (status === "Terminé" || status === "Annulé") return false;

    const startDate = String(entry.startDate || "");
    const endDate = String(entry.endDate || startDate);

    if (!startDate) return false;

    return startDate <= sidebarTodayIso && sidebarTodayIso <= endDate;
  }).length;

  const sidebarDocumentCount = ((((data as any).documents ?? []) as Array<{ status?: string; isFolder?: boolean }>)).filter((document) => {
    if (document.isFolder) return false;
    return String(document.status || "À jour") !== "À jour";
  }).length;

  const sidebarBadgeCounts: Partial<Record<Tab, number>> = {
    leads: sidebarLeadCount,
    tasks: sidebarTaskCount,
    bookings: sidebarBookingCount,
    vendorQuotes: sidebarVendorQuoteCount,
    vendorInvoices: sidebarVendorInvoiceCount,
    planning: sidebarPlanningCount,
    documents: sidebarDocumentCount
  };

  const mobileSecondaryActions: MobileSecondaryAction[] = [
    { id: "importCsv", label: t("crm.shell.b57e44a28b"), onClick: openSafeCsvImportPrompt },
    { id: "exportJson", label: t("crm.shell.da0182a80d"), onClick: exportJson },
    { id: "cloudBackup", label: t("crm.shell.4e41bd5973"), onClick: saveCrmBackupToSupabase },
    { id: "reloadCloud", label: t("crm.shell.e5f7d1e898"), onClick: reloadSharedWorkspaceFromCloud },
    { id: "forceSync", label: t("crm.shell.0302574182"), onClick: forceSaveSharedWorkspaceNow },
    {
      id: "exportCsv",
      label: t("crm.shell.91f71c14c8"),
      onClick: () => {
        void exportCsv();
      }
    },
    { id: "logout", label: t("crm.shell.fb5f9e92c1"), onClick: onLogout, tone: "danger" }
  ];

  function navigateToTab(tab: Tab) {
    setActiveTab(tab);
    setMobileMoreOpen(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }
  // === SMART SIDEBAR BADGES END ===



  return (
    <main className="crm-shell crm-readable-redesign" onChangeCapture={event=>{if((event.target as HTMLElement).closest("form"))setFormDirty(true);}} onSubmitCapture={()=>setFormDirty(false)}>
      <UnifiedNavigation access={access} accountId={sessionUserId} navigationRevision={navigationRevision} active={activeTab} badges={sidebarBadgeCounts} onLogout={onLogout} onNavigate={tab => {
        if (tab === "monthlyCharges" || tab === "izord" || tab === "publisher" || tab === "admin") return onExternalNavigate(tab); else return setActiveTab(tab);
      }} />

      <section className="content-panel">
        <MobileCRMHeader
          activeActor={activeActor}
          activeTab={activeTab}
          actors={crmActors}
          query={query}
          sessionEmail={sessionEmail}
          actions={mobileSecondaryActions}
          onActorChange={(actor) => setActiveActor(actor as CRMActor)}
          onQueryChange={setQuery}
        />

        <header className="topbar crm-topbar-compact">
          <div className="crm-topbar-title">
            <p className="eyebrow" data-semantic-text={"CRM interne"}>{t("crm.shell.f33f4472c1")}</p>
            <h2>{t(`navigation.module.${activeTab}`)}</h2>
          </div>
          <div className="topbar-actions crm-topbar-actions-compact">
            {isCRMTabSearchable(activeTab) ? (<input
                className="search-input crm-topbar-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(`navigation.search.${activeTab}`)}
                aria-label={t("crm.shell.a12b73cf58")}
              />) : null}
            <span className="muted-line crm-session-email">{t("crm.shell.1fb8710935")}{" "}{sessionEmail}</span>
            <label className="actor-select-label crm-actor-select-label">
              <span>{t("crm.shell.3db254bfcf")}</span>
              <select value={activeActor} onChange={(event) => setActiveActor(event.target.value as CRMActor)}>
                <option value="">{t("crm.shell.cb6c1fb76c")}</option>
                {crmActors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
              </select>
            </label>
            <details className="crm-topbar-menu">
              <summary className="secondary-button crm-topbar-menu-button">{t("crm.shell.ff8059dc67")}</summary>
              <div className="crm-topbar-menu-panel">
                <button type="button" onClick={onLogout}>{t("crm.shell.fb5f9e92c1")}</button>
                <button type="button" onClick={openSafeCsvImportPrompt}>{t("crm.shell.b57e44a28b")}</button>
                <button type="button" onClick={exportJson}>{t("crm.shell.da0182a80d")}</button>
                <button type="button" onClick={saveCrmBackupToSupabase}>{t("crm.shell.4e41bd5973")}</button>
                <button type="button" onClick={reloadSharedWorkspaceFromCloud}>{t("crm.shell.e5f7d1e898")}</button>
                <button type="button" onClick={forceSaveSharedWorkspaceNow}>{t("crm.shell.0302574182")}</button>
                <button type="button" onClick={() => {
                  void exportCsv();
                }}>{t("crm.shell.91f71c14c8")}</button>
              </div>
            </details>
          </div>
        </header>

        <section className={`shared-db-status-panel shared-db-status-desktop ${sharedWorkspaceStatus}`} data-semantic-text={sharedWorkspaceStatus === "connected" ? "Connectée" : sharedWorkspaceStatus === "error" ? "Erreur" : "Nouveau"}>
          <div>
            <p className="eyebrow" data-semantic-text={"Base partagée"}>{t("crm.shell.dc3ad769e0")}</p>
            <strong>
              {sharedWorkspaceStatus === "connected" ? t("crm.shell.b996430dbb") : sharedWorkspaceStatus === "loading" ? t("crm.shell.7d4545eb86") : sharedWorkspaceStatus === "local" ? t("crm.shell.e816efeace") : t("crm.shell.46148e250e")}
            </strong>
            <span>{screenText(sharedWorkspaceMessage)}</span>
            {sharedWorkspaceUpdatedAt && (
              <small>{t("crm.shell.86335dd6bd")}{" "}{screen.dateTime(sharedWorkspaceUpdatedAt)}</small>
            )}
          </div>

          <div>
            <button className="secondary-button" type="button" onClick={reloadSharedWorkspaceFromCloud}>{t("crm.shell.e5f7d1e898")}</button>
            <button className="primary-button" type="button" onClick={forceSaveSharedWorkspaceNow}>{t("crm.shell.0302574182")}</button>
          </div>
        </section>

        <details className={`mobile-shared-db-status ${sharedWorkspaceStatus}`}>
          <summary>
            <span className="mobile-status-dot" aria-hidden="true" />
            <span>{t("crm.shell.dc3ad769e0")}</span>
            <strong>
              {sharedWorkspaceStatus === "connected" ? t("crm.shell.b996430dbb") : sharedWorkspaceStatus === "loading" ? t("crm.shell.51bd82a2ef") : sharedWorkspaceStatus === "local" ? t("crm.shell.85eb6e2c32") : t("crm.shell.46148e250e")}
            </strong>
            <span className="mobile-status-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="mobile-shared-db-details">
            <p>{screenText(sharedWorkspaceMessage)}</p>
            {sharedWorkspaceUpdatedAt ? (<small>{t("crm.shell.86335dd6bd")}{" "}{screen.dateTime(sharedWorkspaceUpdatedAt)}</small>) : null}
            <div>
              <button className="secondary-button" type="button" onClick={reloadSharedWorkspaceFromCloud}>{t("crm.shell.e5f7d1e898")}</button>
              <button className="primary-button" type="button" onClick={forceSaveSharedWorkspaceNow}>{t("crm.shell.0302574182")}</button>
            </div>
          </div>
        </details>

        {activeTab === "dashboard" && actionNotifications.length > 0 && (
          <section className="crm-notification-panel">
            <div className="crm-notification-heading">
              <div>
                <p className="eyebrow" data-semantic-text={"Notifications"}>{t("crm.shell.788011833a")}</p>
                <h3>{t("crm.counts.actions", { count: actionNotifications.length })}</h3>
              </div>

              <button
                className="secondary-button"
                type="button"
                onClick={() => handleNotificationAction()}
               data-crm-auto-scroll="true">{t("crm.shell.8bff1588f1")}</button>
            </div>

            <div className="crm-notification-list">
              {actionNotifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`crm-notification-item ${item.tone}`}
                  onClick={() => handleNotificationAction(item)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {activeTab === "dashboard" && (
          <>
            <Dashboard
              stats={stats}
              data={{ ...data, tasks: visibleTasks }}
              onLeadStatusChange={updateLeadStatus}
              onTaskStatusChange={updateTaskStatus}
              onStartMessage={openQuickEntryPrompt}
              onStartContactLead={openQuickContactLeadPrompt}
              onStartInventory={openQuickInventoryPrompt}
              onShowLeads={() => setActiveTab("leads")}
              onCloudBackup={saveCrmBackupToSupabase}
              onDashboardAction={(tab, targetId) => handleNotificationAction({
                id: `dashboard-action-${tab}-${targetId || "top"}`,
                title: "Ouvrir",
                detail: "Action Dashboard",
                tone: "info",
                tab,
                targetId
              })}
            />

            <FollowUpsPanel
              leads={data.leads}
              tasks={visibleTasks}
              quotes={mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())}
              onCreateTask={createTaskDraftFromFollowUp}
            />
          </>
        )}

        {activeTab === "contacts" && (
          <ContactsView onDraftStateChange={setFormDirty} access={access} focusContactId={focusContactId} actor={activeActor} contacts={data.contacts} query={query} leads={data.leads} tasks={visibleTasks} onAdd={addContact} onUpdate={updateContact} onDelete={deleteContact} onCreateLead={(contactName) => {
                  setLeadDraftContactName(contactName);
                  setActiveTab("leads");

                  window.setTimeout(() => {
                    document.getElementById("lead-create-form")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 120);

                  notify(screenNotice("crm.shell.7219043fd9", { value1: displayValue(contactName) }));
                }} onCreateTask={(contactName, contactId) => {
                  setTaskDraftContactId(contactId || "");
                  setTaskDraftLeadId("");
                  setTaskDraftTitle(`Relancer ${contactName}`);
                  setActiveTab("tasks");

                  window.setTimeout(() => {
                    document.getElementById("task-create-form")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 120);

                  notify(screenNotice("crm.shell.4c02a620d5", { value1: displayValue(contactName) }));
                }} />
        )}

        {activeTab === "documents" && (
          <><DocumentsView
            documents={(((data as any).documents ?? []) as CRMDocument[])}
            activeActor={activeActor}
            onAdd={addCRMDocument}
            onUpdate={updateCRMDocument}
            onTrash={trashCRMDocument}
            canTrash={access.fullAccess || (access.modules.documents?.level === "contribute" && Boolean(access.modules.documents.sensitive.delete))}
            sessionUserId={sessionUserId}
          /><ContactDocumentLibrary access={access}/></>
        )}
{activeTab === "quotes" && (
          <QuotesView
            contacts={data.contacts}
            prefilledLead={quoteDraftFromLead}
            quotes={mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())}
            activeActor={activeActor}
            onChange={(nextQuotes) => setData((current) => ({ ...current, quotes: nextQuotes }))}
            onQuoteChange={syncLeadFromQuote}
          />
        )}

        {activeTab === "bookings" && (
          <BookingsView
            quotes={mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())}
            contacts={data.contacts}
            activeActor={activeActor}
            onChange={(nextQuotes) => setData((current) => ({ ...current, quotes: nextQuotes }))}
          />
        )}


        {activeTab === "vendorQuotes" && (
          <VendorQuotesView
            contacts={data.contacts}
            quotes={(((data as any).vendorQuotes ?? []) as VendorQuote[])}
            invoices={(((data as any).vendorInvoices ?? []) as VendorInvoice[])}
            onAdd={addVendorQuote}
            onUpdate={updateVendorQuote}
            onDelete={deleteVendorQuote}
            onValidate={validateVendorQuote}
            onReject={rejectVendorQuote}
            onOpenInvoice={() => setActiveTab("vendorInvoices")}
          />
        )}

        {activeTab === "vendorInvoices" && (
          <VendorInvoicesView
            focusInvoiceId={sourceFocus?.module === "vendorInvoices" ? sourceFocus.id : undefined}
            quotes={data.vendorQuotes || []}
            onDeleteOrphan={deleteOrphanVendorInvoice}
            actor={activeActor}
            onUpdateContact={updateContact}
            contacts={data.contacts}
            documents={(((data as any).documents ?? []) as CRMDocument[])}
            invoices={(((data as any).vendorInvoices ?? []) as VendorInvoice[])}
            onAdd={addVendorInvoice}
            onUpdate={updateVendorInvoice}
            onDelete={deleteVendorInvoice}
            onOpenQuote={() => setActiveTab("vendorQuotes")}
          />
        )}

        {activeTab === "houseTracking" && (
          <HouseTrackingView
            access={access}
            onOpenContact={contactId => {
              if (readable(access, "contacts") && setActiveTab("contacts")) setFocusContactId(contactId);
            }}
            focusEntryId={sourceFocus?.module === "houseTracking" ? sourceFocus.id : undefined}
            contacts={data.contacts}
            houses={(((data as any).houseTrackingHouses ?? []) as HouseTrackingHouse[])}
            workers={(((data as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[])}
            timeEntries={(((data as any).houseTimeEntries ?? []) as HouseTimeEntry[])}
            payments={(((data as any).housePayments ?? []) as HousePayment[])}
            onAddHouse={addHouseTrackingHouse}
            onDeleteHouse={deleteHouseTrackingHouse}
            onAddWorker={addHouseTrackingWorker}
            onUpdateWorker={updateHouseTrackingWorker}
            onArchiveWorker={archiveHouseTrackingWorker}
            onReactivateWorker={reactivateHouseTrackingWorker}
            onPermanentlyDeleteWorker={permanentlyDeleteHouseTrackingWorkerSafely}
            onAddTimeEntry={addHouseTimeEntry}
            onDeleteTimeEntry={deleteHouseTimeEntry}
            onAddPayment={addHousePayment}
            onDeletePayment={deleteHousePayment}
          />
        )}

        {activeTab === "planning" && (
          <PlanningView
            leads={data.leads}
            properties={data.properties}
            vehicles={data.vehicles ?? []}
            boats={data.boats ?? []}
            contacts={data.contacts}
            planningEntries={(((data as any).planningEntries ?? []) as PlanningEntry[])}
            onAddPlanningEntry={addPlanningEntry}
            onUpdatePlanningEntry={updatePlanningEntry}
            onDeletePlanningEntry={deletePlanningEntry}
            onPatchPlanningEntry={patchPlanningEntry}
            onPatchLeadReservationDates={patchLeadReservationDates}
          />
        )}

        {activeTab === "leads" && (
          <LeadsView leads={filteredLeads} contacts={data.contacts} tasks={visibleTasks} quotes={mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())} properties={data.properties} vehicles={data.vehicles ?? []} boats={data.boats ?? []} preselectedContactName={leadDraftContactName} onAdd={addLead} onUpdate={updateLead} onStatusChange={updateLeadStatus} onDelete={deleteLead} onCreateQuote={createQuoteDraftFromLead} onCreateTask={(lead: Lead) => {
                  setTaskDraftContactId("");
                  setTaskDraftLeadId(lead.id);
                  setTaskDraftTitle(lead.nextAction || `Relancer ${lead.contactName}`);
                  setActiveTab("tasks");

                  window.setTimeout(() => {
                    document.getElementById("task-create-form")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 120);

                  notify(screenNotice("crm.shell.4c02a620d5", { value1: displayValue(lead.contactName) }));
                }} />
        )}

        {activeTab === "properties" && (
          <PropertiesView properties={filteredProperties} leads={data.leads} onAdd={addProperty} onUpdate={updateProperty} onDelete={deleteProperty} />
        )}

        {activeTab === "vehicles" && (
          <VehiclesView vehicles={filteredVehicles} leads={data.leads} onAdd={addVehicle} onUpdate={updateVehicle} onDelete={deleteVehicle} />
        )}

        {activeTab === "boats" && (
          <BoatsView boats={filteredBoats} leads={data.leads} onAdd={addBoat} onUpdate={updateBoat} onDelete={deleteBoat} />
        )}

        {activeTab === "tasks" && (
          <TasksWorkspace query={query} onQueryChange={setQuery} sessionKey={taskSessionKey} userId={sessionUserId} api={taskApi} permissions={taskRights} onTasksChange={taskProjection.accept} onDirty={setFormDirty} onDraftConsumed={()=>{setTaskDraftTitle("");setTaskDraftLeadId("");setTaskDraftContactId("");}} draft={taskDraftTitle || taskDraftLeadId || taskDraftContactId ? { title: taskDraftTitle, leadId: taskDraftLeadId, contactId: taskDraftContactId } : undefined} links={{ leads: data.leads.map(lead => ({ id: lead.id, label: `${lead.category} · ${lead.contactName}` })), contacts: taskContactOptions(readable(access, "contacts") ? data.contacts : []) }} />
        )}
      </section>

      {toast && <div className={`toast ${toast.tone}`}>{screenText(toast.message)}</div>}
    </main>
  );
}

function searchMatch(query: string, fields: Array<string | number>) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => String(field).toLowerCase().includes(needle));
}


type PlanningAsset = {
  id: string;
  type: "Property" | "Vehicle" | "Boat";
  label: string;
  category: string;
  location: string;
};

const planningEntryTypes: PlanningEntryType[] = [
  "Intervention prestataire",
  "Maintenance",
  "Tâche interne",
  "Réservation",
  "Autre"
];

const planningEntryStatuses: PlanningEntryStatus[] = ["Prévu", "À confirmer", "En cours", "Terminé", "Annulé"];
const planningEntryPriorities: PlanningPriority[] = ["Normal", "Important", "Critique"];

// CRM_PLANNING_SEPARATE_SCOPES_20260622
const planningCategoryOptions: PlanningCategory[] = ["Villa", "Bateau", "Voiture", "Conciergerie"];

function normalizePlanningCategory(value?: string | null): PlanningCategory | "" {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  if (["bateau", "boat", "yacht", "charter"].includes(normalized)) return "Bateau";
  if (["voiture", "car", "vehicle", "vehicule", "chauffeur", "driver"].includes(normalized)) return "Voiture";
  if (["conciergerie", "concierge", "service", "services"].includes(normalized)) return "Conciergerie";
  if (["villa", "villas", "property", "properties", "bien", "biens", "maison", "maisons", "appartement"].includes(normalized)) return "Villa";

  return "";
}

function getPlanningCategoryFromAssetType(assetType?: string | null): PlanningCategory | "" {
  if (assetType === "Boat") return "Bateau";
  if (assetType === "Vehicle") return "Voiture";
  if (assetType === "Property") return "Villa";
  return "";
}


function isValidPlanningDate(value?: string) {
  if (!value) return false;

  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function planningDateValue(value: string) {
  return new Date(`${value}T00:00:00`).getTime();
}

function addPlanningDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function planningRangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  if (!isValidPlanningDate(startA) || !isValidPlanningDate(endA) || !isValidPlanningDate(startB) || !isValidPlanningDate(endB)) {
    return false;
  }

  return planningDateValue(startA) <= planningDateValue(endB) && planningDateValue(startB) <= planningDateValue(endA);
}

function formatPlanningDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatPlanningMonthValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function getPlanningMonthTitle(monthValue: string) {
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return "Mois invalide";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
}


function normalizePlanningTimeForDate(value?: string | null, fallback = "00:00") {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace("h", ":")
    .replace(/[^0-9:]/g, "");

  if (!raw) return fallback;

  const [hourText = "", minuteText = "0"] = raw.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText || "0");

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getPlanningDateTimeValue(dateValue?: string, timeValue?: string, fallbackTime = "00:00") {
  if (!dateValue || !isValidPlanningDate(dateValue)) return Number.NaN;

  const time = normalizePlanningTimeForDate(timeValue, fallbackTime);
  const date = new Date(`${dateValue}T${time}:00`);

  return date.getTime();
}

function formatPlanningTimeRange(startTime?: string, endTime?: string) {
  const start = String(startTime || "").trim();
  const end = String(endTime || "").trim();

  if (start && end) return `${start} → ${end}`;
  if (start) return start;
  if (end) return `Jusqu’à ${end}`;

  return "";
}


function getPlanningEntryStatus(entry: Pick<PlanningEntry, "status" | "startDate" | "endDate" | "startTime" | "endTime">): PlanningEntryStatus {
  const storedStatus = entry.status || "Prévu";

  // Statut automatique opérationnel :
  // - Annulé et Terminé restent des statuts fermés.
  // - Si une heure de fin existe et qu'elle est dépassée, l'intervention passe en Terminé.
  // - Si l'heure actuelle est entre le début et la fin, elle s'affiche En cours.
  // - Sans heure de fin, on garde un comportement journée entière pour éviter de fermer à tort.
  // La donnée n'est pas écrite automatiquement en base : le statut est calculé à l'affichage.
  if (storedStatus === "Annulé" || storedStatus === "Terminé") return storedStatus;

  const effectiveEndDate = entry.endDate || entry.startDate;
  const startValue = getPlanningDateTimeValue(entry.startDate, entry.startTime, "00:00");
  const endValue = getPlanningDateTimeValue(effectiveEndDate, entry.endTime, "23:59");

  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
    return storedStatus;
  }

  const nowValue = Date.now();

  if (nowValue > endValue) return "Terminé";
  if (nowValue >= startValue && nowValue <= endValue) return "En cours";

  return storedStatus;
}

function getPlanningStatusClass(status?: string) {
  const normalized = String(status || "Prévu")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .trim();

  return normalized || "prevu";
}

// CRM_PLANNING_STATUS_COLORS_20260622

function getPlanningEventOperationalStatus(event: any): PlanningEntryStatus {
  const rawStatus = String(event?.status || "Prévu");
  const normalizedStatus = getPlanningStatusClass(rawStatus);

  if (normalizedStatus === "annule") return "Annulé";
  if (normalizedStatus === "termine") return "Terminé";

  const startDate = String(event?.startDate || "");
  const endDate = String(event?.endDate || event?.startDate || "");
  const startTime = String(event?.startTime || "");
  const endTime = String(event?.endTime || "");

  if (isValidPlanningDate(startDate) && isValidPlanningDate(endDate)) {
    const startValue = getPlanningDateTimeValue(startDate, startTime, "00:00");
    const endValue = getPlanningDateTimeValue(endDate, endTime, "23:59");
    const nowValue = Date.now();

    if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
      if (nowValue > endValue) return "Terminé";
      if (nowValue >= startValue && nowValue <= endValue) return "En cours";
    }
  }

  if (normalizedStatus === "en-cours") return "En cours";
  if (normalizedStatus === "a-confirmer") return "À confirmer";

  // Une option / demande non confirmée à venir doit rester jaune : action à suivre.
  if (event?.source === "lead" && !event?.blocksAvailability) return "À confirmer";

  return "Prévu";
}

function getPlanningDayStatusClass(events: any[], dayIso?: string) {
  const statuses = events.map((event) => dayIso
    ? getPlanningCalendarDaySegmentStatus(event, dayIso).status
    : getPlanningEventOperationalStatus(event));

  if (statuses.includes("En cours")) return "planning-day-status-en-cours";
  if (statuses.includes("À confirmer")) return "planning-day-status-a-confirmer";
  if (statuses.includes("Prévu")) return "planning-day-status-prevu";
  if (statuses.length > 0 && statuses.every((status) => status === "Terminé")) return "planning-day-status-termine";
  if (statuses.length > 0 && statuses.every((status) => status === "Annulé")) return "planning-day-status-annule";

  return "";
}

function formatPlanningDateTimeRange(entry: Pick<PlanningEntry, "startDate" | "endDate" | "startTime" | "endTime">) {
  const startDateLabel = formatDateFR(entry.startDate);
  const endDateLabel = entry.endDate && entry.endDate !== entry.startDate ? formatDateFR(entry.endDate) : "";
  const startTime = String(entry.startTime || "").trim();
  const endTime = String(entry.endTime || "").trim();

  if (endDateLabel) {
    const startPart = [startDateLabel, startTime].filter(Boolean).join(" · ");
    const endPart = [endDateLabel, endTime].filter(Boolean).join(" · ");
    return `${startPart} → ${endPart}`;
  }

  const timeRange = formatPlanningTimeRange(startTime, endTime);
  return timeRange ? `${startDateLabel} · ${timeRange}` : startDateLabel;
}





/* === PLANNING DAY SEGMENT STATUS HELPERS START === */
function getPlanningInclusiveDayCount(startDate?: string, endDate?: string) {
  const start = String(startDate || "");
  const end = String(endDate || start || "");

  if (!isValidPlanningDate(start) || !isValidPlanningDate(end)) return 1;

  const diff = Math.floor((planningDateValue(end) - planningDateValue(start)) / 86400000) + 1;
  return Math.max(1, diff);
}

function getPlanningDayNumberInRange(startDate?: string, dayIso?: string) {
  const start = String(startDate || "");
  const day = String(dayIso || start || "");

  if (!isValidPlanningDate(start) || !isValidPlanningDate(day)) return 1;

  return Math.max(1, Math.floor((planningDateValue(day) - planningDateValue(start)) / 86400000) + 1);
}

function parsePlanningTimeToMinutes(value?: string) {
  const time = String(value || "").trim();
  const match = time.match(/^(\d{1,2}):(\d{2})/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function getPlanningNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function formatPlanningShortDate(value?: string) {
  const dateValue = String(value || "");

  if (!isValidPlanningDate(dateValue)) return "date non renseignée";

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(`${dateValue}T00:00:00`));
}

function getPlanningCalendarDaySegmentStatus(event: any, dayIso?: string, display?: PlanningDisplay): { status: PlanningEntryStatus; label: string; explanation: string } {
  const t = display?.t || defaultCRMTranslate;
  const enumLabel = display?.enum || ((value: string) => value);
  const rawStatus = String(event?.status || "Prévu");
  const normalizedStatus = getPlanningStatusClass(rawStatus);

  if (normalizedStatus === "annule") {
    return { status: "Annulé", label: enumLabel("Annulé"), explanation: t("crm.screen.cancelledVisit") };
  }

  if (normalizedStatus === "termine") {
    return { status: "Terminé", label: enumLabel("Terminé"), explanation: t("crm.screen.completedVisit") };
  }

  const startDate = String(event?.startDate || "");
  const endDate = String(event?.endDate || event?.startDate || "");
  const day = String(dayIso || startDate || "");

  if (!isValidPlanningDate(startDate) || !isValidPlanningDate(endDate) || !isValidPlanningDate(day)) {
    return { status: getPlanningEventOperationalStatus(event), label: enumLabel(getPlanningEventOperationalStatus(event)), explanation: t("crm.enums.dateRequired") };
  }

  // Les leads / réservations restent gérés comme des plages de séjour continues.
  if (event?.source !== "planning") {
    const status = getPlanningEventOperationalStatus(event);
    return { status, label: enumLabel(status), explanation: status === "À confirmer" ? t("crm.screen.optionConfirm") : t("crm.screen.bookingStatus", { status: enumLabel(status) }) };
  }

  const todayIso = formatPlanningDateValue(new Date());
  const dayValue = planningDateValue(day);
  const todayValue = planningDateValue(todayIso);
  const dayCount = getPlanningInclusiveDayCount(startDate, endDate);
  const dayNumber = getPlanningDayNumberInRange(startDate, day);
  const startMinutes = parsePlanningTimeToMinutes(event?.startTime);
  const endMinutes = parsePlanningTimeToMinutes(event?.endTime);
  const rangeLabel = event?.startTime || event?.endTime
    ? (display?.timeRange || formatPlanningTimeRange)(event?.startTime, event?.endTime)
    : t("crm.enums.day");
  const dayPrefix = dayCount > 1 ? t("crm.screen.dayPrefix", { day: dayNumber, count: dayCount }) : t("crm.enums.serviceVisit");

  if (dayValue < todayValue) {
    return {
      status: "Terminé",
      label: enumLabel("Terminé"),
      explanation: t("crm.screen.segmentPast", { prefix: dayPrefix })
    };
  }

  if (dayValue > todayValue) {
    return {
      status: "Prévu",
      label: enumLabel("À faire"),
      explanation: t("crm.screen.segmentFuture", { prefix: dayPrefix })
    };
  }

  const nowMinutes = getPlanningNowMinutes();

  if (startMinutes !== null && nowMinutes < startMinutes) {
    return {
      status: "Prévu",
      label: enumLabel("À faire"),
      explanation: t("crm.screen.segmentStart", { prefix: dayPrefix, time: event.startTime })
    };
  }

  if (endMinutes !== null && nowMinutes > endMinutes) {
    return {
      status: "Terminé",
      label: enumLabel("Terminé"),
      explanation: t("crm.screen.segmentEnd", { prefix: dayPrefix, time: event.endTime })
    };
  }

  if (startMinutes !== null || endMinutes !== null) {
    return {
      status: "En cours",
      label: enumLabel("En cours"),
      explanation: t("crm.screen.segmentNow", { prefix: dayPrefix, range: rangeLabel })
    };
  }

  return {
    status: "En cours",
    label: enumLabel("En cours"),
    explanation: t("crm.screen.segmentToday", { prefix: dayPrefix })
  };
}

function getPlanningTimingExplanation(item: any, display?: PlanningDisplay) {
  const t = display?.t || defaultCRMTranslate;
  const shortDate = display?.shortDate || formatPlanningShortDate;
  const startDate = String(item?.startDate || "");
  const endDate = String(item?.endDate || item?.startDate || "");
  const dayCount = getPlanningInclusiveDayCount(startDate, endDate);

  if (!isValidPlanningDate(startDate)) return t("crm.screen.dateRequired");

  if (dayCount > 1) {
    const todayIso = formatPlanningDateValue(new Date());
    const todayInsideRange = planningRangesOverlap(todayIso, todayIso, startDate, endDate);
    const todaySegment = todayInsideRange ? getPlanningCalendarDaySegmentStatus(item, todayIso, display) : null;
    const endLabel = `${shortDate(endDate)}${item?.endTime ? t("crm.screen.atTime", { time: item.endTime }) : ""}`;

    if (todaySegment) {
      return t("crm.screen.totalTiming", { explanation: todaySegment.explanation, count: dayCount, end: endLabel });
    }

    return t("crm.screen.rangeTiming", { count: dayCount, start: shortDate(startDate), end: endLabel });
  }

  return getPlanningCalendarDaySegmentStatus(item, startDate, display).explanation;
}

function getPlanningCalendarEventLabel(event: any, dayIso?: string, display?: PlanningDisplay) {
  const t = display?.t || defaultCRMTranslate;
  const startDate = String(event?.startDate || "");
  const endDate = String(event?.endDate || event?.startDate || "");
  const dayCount = getPlanningInclusiveDayCount(startDate, endDate);
  const dayNumber = getPlanningDayNumberInRange(startDate, dayIso || startDate);
  const segment = getPlanningCalendarDaySegmentStatus(event, dayIso || startDate, display);
  const title = event?.source === "planning" ? event?.title : event?.contactName;
  const owner = event?.source === "planning" ? event?.contactName : event?.assetLabel;
  const asset = event?.source === "planning" ? event?.assetLabel : "";
  const timeLabel = (display?.timeRange || formatPlanningTimeRange)(event?.startTime, event?.endTime) || t("crm.enums.day");
  const dayPrefix = event?.source === "planning" && dayCount > 1 ? t("crm.screen.dayPrefix", { day: dayNumber, count: dayCount }) : "";

  const firstLine = [dayPrefix, timeLabel].filter(Boolean).join(" · ");
  const secondLine = [title, owner, asset].filter(Boolean).join(" · ");

  return [firstLine, secondLine].filter(Boolean).join("\\n");
}
/* === PLANNING DAY SEGMENT STATUS HELPERS END === */

function getPlanningCalendarWeeks(monthValue: string) {
  const [yearText, monthText] = monthValue.split("-");
  const today = new Date();

  const year = Number.isFinite(Number(yearText)) ? Number(yearText) : today.getFullYear();
  const monthIndex = Number.isFinite(Number(monthText)) ? Number(monthText) - 1 : today.getMonth();

  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);

  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const cells: Array<{ iso: string; day: number } | null> = Array.from({ length: leadingEmptyDays }, () => null);

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, monthIndex, day);
    cells.push({
      iso: formatPlanningDateValue(date),
      day
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: Array<Array<{ iso: string; day: number } | null>> = [];

  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return weeks;
}


function cleanPlanningCalendarVisibleLabel(value: string) {
  return value
    .replace(/\\n/g, " · ")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[·•-]\s*/, "")
    .replace(/\s*[·•-]\s*$/, "")
    .trim();
}

function PlanningView({
  leads,
  properties,
  vehicles,
  boats,
  contacts,
  planningEntries,
  onAddPlanningEntry,
  onUpdatePlanningEntry,
  onDeletePlanningEntry,
  onPatchPlanningEntry,
  onPatchLeadReservationDates
}: {
  leads: Lead[];
  properties: Property[];
  vehicles: Vehicle[];
  boats: Boat[];
  contacts: Contact[];
  planningEntries: PlanningEntry[];
  onAddPlanningEntry: (event: React.FormEvent<HTMLFormElement>) => void;
  onUpdatePlanningEntry: (id: string, event: React.FormEvent<HTMLFormElement>) => boolean;
  onDeletePlanningEntry: (id: string) => void;
  onPatchPlanningEntry: (id: string, patch: Partial<PlanningEntry>) => void;
  onPatchLeadReservationDates: (id: string, startDate: string, endDate: string) => void;
}) {
  const { t, label, locale, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const [categoryFilter, setCategoryFilter] = useState("Tous");
  const [assetFilter, setAssetFilter] = useState("Tous");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => formatPlanningMonthValue(new Date()));
  const [editingPlanningEntry, setEditingPlanningEntry] = useState<PlanningEntry | null>(null);
  const [planningViewMode, setPlanningViewMode] = useState<"month" | "week">("month");
  const [planningWeekStart, setPlanningWeekStart] = useState(() => formatPlanningDateValue(new Date()));
  const [showAllUpcomingPlanningEntries, setShowAllUpcomingPlanningEntries] = useState(false);
  const [showCompletedPlanningEntries, setShowCompletedPlanningEntries] = useState(false);
  const [quickPlanningDate, setQuickPlanningDate] = useState("");

  const planningDragDataType = "application/x-oar-planning-event";

  function getPlanningDragDurationDays(event: any) {
    const start = String(event?.startDate || "");
    const end = String(event?.endDate || event?.startDate || "");

    if (!isValidPlanningDate(start) || !isValidPlanningDate(end)) return 1;

    const diff = Math.floor((planningDateValue(end) - planningDateValue(start)) / 86400000) + 1;
    return Math.max(1, diff);
  }

  function getPlanningDraggedNewDates(event: any, targetDayIso: string) {
    const durationDays = getPlanningDragDurationDays(event);
    const startDate = targetDayIso;
    const endDate = formatPlanningDateValue(addPlanningDays(new Date(`${targetDayIso}T00:00:00`), durationDays - 1));

    return { startDate, endDate };
  }

  function handlePlanningCalendarDragStart(dragEvent: React.DragEvent<HTMLElement>, event: any) {
    dragEvent.dataTransfer.effectAllowed = "move";
    dragEvent.dataTransfer.setData(planningDragDataType, JSON.stringify({
      id: event.id,
      source: event.source,
      startDate: event.startDate,
      endDate: event.endDate || event.startDate
    }));
  }

  function handlePlanningCalendarDragOver(dragEvent: React.DragEvent<HTMLElement>) {
    dragEvent.preventDefault();
    dragEvent.dataTransfer.dropEffect = "move";
  }

  function handlePlanningCalendarDrop(dropEvent: React.DragEvent<HTMLElement>, targetDayIso: string) {
    dropEvent.preventDefault();

    if (!isValidPlanningDate(targetDayIso)) return;

    const raw = dropEvent.dataTransfer.getData(planningDragDataType);
    if (!raw) return;

    let payload: any = null;

    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    const matchingEvent = calendarEvents.find((item: any) =>
      String(item.source) === String(payload?.source) && String(item.id) === String(payload?.id)
    ) || payload;

    if (!matchingEvent?.id || !matchingEvent?.source) return;

    const { startDate, endDate } = getPlanningDraggedNewDates(matchingEvent, targetDayIso);

    if (matchingEvent.source === "planning") {
      onPatchPlanningEntry(String(matchingEvent.id), { startDate, endDate });
      return;
    }

    if (matchingEvent.source === "lead") {
      onPatchLeadReservationDates(String(matchingEvent.id), startDate, endDate);
    }
  }

  const [planningClockTick, setPlanningClockTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setPlanningClockTick(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const assets = useMemo<PlanningAsset[]>(() => {
    return [
      ...properties.map((property) => ({
        id: property.id,
        type: "Property" as const,
        label: getPropertyDisplayName(property),
        category: property.type || "Bien",
        location: property.city || "Lieu non renseigné"
      })),
      ...vehicles.map((vehicle) => ({
        id: vehicle.id,
        type: "Vehicle" as const,
        label: vehicle.name || `${vehicle.brand} ${vehicle.model}`.trim() || "Voiture sans nom",
        category: "Voiture",
        location: vehicle.city || "Lieu non renseigné"
      })),
      ...boats.map((boat) => ({
        id: boat.id,
        type: "Boat" as const,
        label: boat.name || "Bateau sans nom",
        category: "Bateau",
        location: boat.port || "Port non renseigné"
      }))
    ];
  }, [properties, vehicles, boats]);

  function getAssetPlanningCategory(asset?: PlanningAsset | null): PlanningCategory | "" {
    if (!asset) return "";
    return getPlanningCategoryFromAssetType(asset.type) || normalizePlanningCategory(asset.category) || "Villa";
  }

  function getPlanningEntryCategory(entry: PlanningEntry): PlanningCategory {
    const storedCategory = normalizePlanningCategory(entry.planningCategory);
    if (storedCategory) return storedCategory;

    const linkedAsset = assets.find((asset) => asset.type === entry.assetType && asset.id === entry.assetId);
    const assetCategory = getAssetPlanningCategory(linkedAsset);
    if (assetCategory) return assetCategory;

    const typeCategory = getPlanningCategoryFromAssetType(entry.assetType);
    if (typeCategory) return typeCategory;

    // Anciennes interventions sans actif : elles restent dans le planning Villa pour ne pas disparaître.
    return "Villa";
  }

  const assetOptions = useMemo(() => {
    return assets.map((asset) => ({
      key: `${asset.type}:${asset.id}`,
      label: `${asset.label} · ${label(getAssetPlanningCategory(asset) || asset.category, "crm")}`,
      planningCategory: getAssetPlanningCategory(asset)
    }));
  }, [assets, label]);


  function getPlanningContactDisplayName(contact: Contact) {
    return getContactLabel(contact);
  }

  const planningContactOptions = useMemo(() => {
    return contacts
      .map((contact) => {
        const displayName = getPlanningContactDisplayName(contact);
        const meta = [
          label(contact.kind, "crm"),
          contact.supplierCategory ? screen.category(contact.supplierCategory) : "",
          contact.companyName && contact.companyName !== displayName ? contact.companyName : "",
          contact.email,
          contact.phone
        ].filter(Boolean).join(" · ");

        return {
          id: contact.id,
          value: displayName,
          label: meta ? `${displayName} · ${meta}` : displayName
        };
      })
      .sort((a, b) => a.value.localeCompare(b.value, "fr"));
  }, [contacts, label, screen]);

  const confirmedBookings = useMemo(() => {
    return leads
      .filter((lead) =>
        lead.status === "Gagné" &&
        Boolean(lead.assetType) &&
        Boolean(lead.assetId) &&
        isValidPlanningDate(lead.rentalStartDate) &&
        isValidPlanningDate(lead.rentalEndDate)
      )
      .map((lead) => {
        const asset = assets.find((item) => item.type === lead.assetType && item.id === lead.assetId);

        return {
          id: lead.id,
          assetType: lead.assetType,
          assetId: lead.assetId,
          assetLabel: asset?.label ?? String(lead.assetId ?? "Actif non renseigné"),
          assetCategory: getAssetPlanningCategory(asset) || normalizePlanningCategory(lead.category) || "Villa",
          contactName: lead.contactName,
          startDate: lead.rentalStartDate,
          startTime: "",
          endDate: lead.rentalEndDate,
          endTime: "",
          value: lead.value,
          nextAction: lead.nextAction
        };
      })
      .sort((a, b) => {
        const dateDiff = planningDateValue(a.startDate) - planningDateValue(b.startDate);
        if (dateDiff !== 0) return dateDiff;
        return String(a.startTime || "").localeCompare(String(b.startTime || ""));
      });
  }, [leads, assets]);

  const pendingBookings = useMemo(() => {
    return leads
      .filter((lead) =>
        lead.status !== "Gagné" &&
        lead.status !== "Perdu" &&
        Boolean(lead.assetType) &&
        Boolean(lead.assetId) &&
        isValidPlanningDate(lead.rentalStartDate) &&
        isValidPlanningDate(lead.rentalEndDate)
      )
      .map((lead) => {
        const asset = assets.find((item) => item.type === lead.assetType && item.id === lead.assetId);

        return {
          id: lead.id,
          status: lead.status,
          assetType: lead.assetType,
          assetId: lead.assetId,
          assetLabel: asset?.label ?? String(lead.assetId ?? "Actif non renseigné"),
          assetCategory: getAssetPlanningCategory(asset) || normalizePlanningCategory(lead.category) || "Villa",
          contactName: lead.contactName,
          startDate: lead.rentalStartDate,
          startTime: "",
          endDate: lead.rentalEndDate,
          endTime: "",
          value: lead.value,
          nextAction: lead.nextAction
        };
      })
      .sort((a, b) => {
        const dateDiff = planningDateValue(a.startDate) - planningDateValue(b.startDate);
        if (dateDiff !== 0) return dateDiff;
        return String(a.startTime || "").localeCompare(String(b.startTime || ""));
      });
  }, [leads, assets]);

  const activePlanningCategory = categoryFilter === "Tous" ? "Tous" : normalizePlanningCategory(categoryFilter);
  const defaultPlanningCategory: PlanningCategory = activePlanningCategory && activePlanningCategory !== "Tous"
    ? activePlanningCategory
    : "Villa";

  const assetFilterOptions = useMemo(() => {
    return assetOptions.filter((asset) => categoryFilter === "Tous" || asset.planningCategory === activePlanningCategory);
  }, [assetOptions, categoryFilter, activePlanningCategory]);

  function planningItemMatchesAsset(item: { assetType?: string; assetId?: string }) {
    if (assetFilter === "Tous") return true;
    const selected = parseAssetKey(assetFilter);
    return item.assetType === selected.assetType && item.assetId === selected.assetId;
  }

  const visibleAssets = assets.filter((asset) => {
    if (categoryFilter !== "Tous" && getAssetPlanningCategory(asset) !== activePlanningCategory) return false;
    if (assetFilter === "Tous") return true;
    const selected = parseAssetKey(assetFilter);
    return asset.type === selected.assetType && asset.id === selected.assetId;
  });

  const selectedStartDate = startDate;
  const selectedEndDate = endDate || startDate;
  const hasSelectedPeriod = isValidPlanningDate(selectedStartDate) && isValidPlanningDate(selectedEndDate);

  function getBookingsForAsset(asset: PlanningAsset) {
    return confirmedBookings.filter((booking) => booking.assetType === asset.type && booking.assetId === asset.id);
  }

  function getOptionsForAsset(asset: PlanningAsset) {
    return pendingBookings.filter((booking) => booking.assetType === asset.type && booking.assetId === asset.id);
  }

  function getAvailabilityLabel(asset: PlanningAsset) {
    if (!hasSelectedPeriod) return "Choisissez des dates";

    const hasConfirmedOverlap = getBookingsForAsset(asset).some((booking) =>
      planningRangesOverlap(selectedStartDate, selectedEndDate, booking.startDate, booking.endDate)
    );

    if (hasConfirmedOverlap) return "Occupé";

    const hasOptionOverlap = getOptionsForAsset(asset).some((booking) =>
      planningRangesOverlap(selectedStartDate, selectedEndDate, booking.startDate, booking.endDate)
    );

    return hasOptionOverlap ? "Option" : "Disponible";
  }

  const categories = ["Tous", ...planningCategoryOptions];

  function planningItemMatchesCategory(item: { planningCategory?: string; assetCategory?: string; assetType?: string; assetId?: string }) {
    if (categoryFilter === "Tous") return true;

    const itemPlanningCategory = normalizePlanningCategory(item.planningCategory);
    if (itemPlanningCategory && itemPlanningCategory === activePlanningCategory) return true;

    const linkedAsset = assets.find((asset) => asset.type === item.assetType && asset.id === item.assetId);
    if (getAssetPlanningCategory(linkedAsset) === activePlanningCategory) return true;

    const assetTypeCategory = getPlanningCategoryFromAssetType(item.assetType);
    if (assetTypeCategory && assetTypeCategory === activePlanningCategory) return true;

    const rawAssetCategory = normalizePlanningCategory(item.assetCategory);
    return Boolean(rawAssetCategory && rawAssetCategory === activePlanningCategory);
  }

  const visiblePlanningEntries = planningEntries.filter((entry) =>
    (categoryFilter === "Tous" || getPlanningEntryCategory(entry) === activePlanningCategory) && planningItemMatchesAsset(entry)
  );

  const todayIso = formatPlanningDateValue(new Date(planningClockTick));
  const tomorrowIso = formatPlanningDateValue(addPlanningDays(new Date(planningClockTick), 1));
  const nextSevenDaysIso = formatPlanningDateValue(addPlanningDays(new Date(planningClockTick), 7));

  // CRM_PLANNING_COLLAPSED_PRIORITY_LIST_20260622
  // La liste opérationnelle affiche d'abord ce qui arrive / ce qui est en cours.
  // Les interventions terminées ou annulées restent disponibles, mais elles ne doivent pas polluer la vue principale.
  const sortedVisiblePlanningEntries = [...visiblePlanningEntries].sort((a, b) => {
    const dateDiff = planningDateValue(a.startDate || "9999-12-31") - planningDateValue(b.startDate || "9999-12-31");
    if (dateDiff !== 0) return dateDiff;
    return String(a.startTime || "").localeCompare(String(b.startTime || ""));
  });

  const activePlanningEntries = sortedVisiblePlanningEntries.filter((entry) => {
    const status = getPlanningEntryStatus(entry);
    return status !== "Terminé" && status !== "Annulé";
  });

  const completedPlanningEntries = sortedVisiblePlanningEntries
    .filter((entry) => {
      const status = getPlanningEntryStatus(entry);
      return status === "Terminé" || status === "Annulé";
    })
    .sort((a, b) => planningDateValue(b.startDate || "0000-01-01") - planningDateValue(a.startDate || "0000-01-01"));

  const primaryPlanningEntries = showAllUpcomingPlanningEntries
    ? activePlanningEntries
    : activePlanningEntries.slice(0, 7);

  const planningEntriesToDisplay = showCompletedPlanningEntries
    ? [...primaryPlanningEntries, ...completedPlanningEntries]
    : primaryPlanningEntries;

  const hasHiddenUpcomingPlanningEntries = activePlanningEntries.length > primaryPlanningEntries.length;
  const hasHiddenCompletedPlanningEntries = completedPlanningEntries.length > 0 && !showCompletedPlanningEntries;

  function getPlanningPriorityScore(entry: PlanningEntry) {
    const priority = entry.priority || "Normal";
    if (priority === "Critique") return 3;
    if (priority === "Important") return 2;
    if (entry.blocksAvailability) return 1;
    return 0;
  }

  function getPlanningEntryMissingFields(entry: PlanningEntry) {
    const missing: string[] = [];
    if (!String(entry.contactName || "").trim()) missing.push("contact");
    if (!entry.assetId) missing.push("actif");
    if (!String(entry.startTime || "").trim()) missing.push("heure");
    return missing;
  }

  const importantPlanningEntries = [...activePlanningEntries]
    .filter((entry) => {
      const daysUntil = Math.ceil((planningDateValue(entry.startDate || todayIso) - planningDateValue(todayIso)) / 86400000);
      return getPlanningPriorityScore(entry) > 0 || daysUntil <= 3 || getPlanningEntryMissingFields(entry).length > 0;
    })
    .sort((a, b) => {
      const priorityDiff = getPlanningPriorityScore(b) - getPlanningPriorityScore(a);
      if (priorityDiff !== 0) return priorityDiff;
      const dateDiff = planningDateValue(a.startDate || "9999-12-31") - planningDateValue(b.startDate || "9999-12-31");
      if (dateDiff !== 0) return dateDiff;
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    })
    .slice(0, 5);

  const incompletePlanningEntries = activePlanningEntries
    .map((entry) => ({ entry, missing: getPlanningEntryMissingFields(entry) }))
    .filter((item) => item.missing.length > 0)
    .slice(0, 6);

  function patchPlanningEntryFromView(entry: PlanningEntry, patch: Partial<PlanningEntry>) {
    onPatchPlanningEntry(entry.id, patch);
    if (editingPlanningEntry?.id === entry.id) {
      setEditingPlanningEntry({ ...editingPlanningEntry, ...patch });
    }
  }

  function markPlanningEntryDone(entry: PlanningEntry) {
    patchPlanningEntryFromView(entry, { status: "Terminé" });
  }

  function cancelPlanningEntryOperationally(entry: PlanningEntry) {
    const confirmed = window.confirm(dialogT("crm.planning.3a1b65a246"));
    if (!confirmed) return;
    patchPlanningEntryFromView(entry, { status: "Annulé" });
  }

  function postponePlanningEntry(entry: PlanningEntry) {
    const nextStartDate = window.prompt(dialogT("crm.planning.fb0132e053"), entry.startDate || formatPlanningDateValue(new Date()));
    if (!nextStartDate) return;
    if (!isValidPlanningDate(nextStartDate)) {
      window.alert(dialogT("crm.planning.e7b1fe3d65"));
      return;
    }

    const oldStart = entry.startDate;
    const oldEnd = entry.endDate || entry.startDate;
    const durationDays = isValidPlanningDate(oldStart) && isValidPlanningDate(oldEnd)
      ? Math.max(0, Math.round((planningDateValue(oldEnd) - planningDateValue(oldStart)) / 86400000))
      : 0;
    const nextEndDate = formatPlanningDateValue(addPlanningDays(new Date(`${nextStartDate}T00:00:00`), durationDays));
    const reportNote = `Reporté du ${formatDateFR(oldStart)} au ${formatDateFR(nextStartDate)}`;
    const nextNotes = [entry.notes, reportNote].filter(Boolean).join(" · ");

    patchPlanningEntryFromView(entry, {
      startDate: nextStartDate,
      endDate: nextEndDate,
      status: "Prévu",
      notes: nextNotes
    });
  }

  function renderPlanningQuickActions(entry: PlanningEntry) {
    const status = getPlanningEntryStatus(entry);
    const isClosed = status === "Terminé" || status === "Annulé";

    return (
      <div className="planning-quick-actions planning-quick-actions-clean">
        <BusinessButton permission="write" className="asset-edit-button planning-edit-main" type="button" onClick={() => startPlanningEntryEdit(entry)} data-crm-auto-scroll="true">{t("crm.planning.42e37604b6")}</BusinessButton>
        <details className="planning-entry-more planning-entry-more-clean">
          <summary aria-label={t("crm.planning.e42e39629b")}>•••</summary>
          <div className="planning-entry-more-menu">
            {!isClosed ? (<>
                <BusinessButton type="button" onClick={() => markPlanningEntryDone(entry)}>{t("crm.planning.b4d92528f8")}</BusinessButton>
                <BusinessButton type="button" onClick={() => postponePlanningEntry(entry)}>{t("crm.planning.ed738fe883")}</BusinessButton>
                <BusinessButton type="button" onClick={() => cancelPlanningEntryOperationally(entry)} data-crm-dismiss="true">{t("crm.planning.46ad3916f6")}</BusinessButton>
              </>) : null}
            <BusinessButton permission="remove"
              className="planning-delete-button"
              type="button"
              onClick={() => {
                if (editingPlanningEntry?.id === entry.id) {
                  setEditingPlanningEntry(null);
                }
                onDeletePlanningEntry(entry.id);
              }}
            >{t("crm.planning.1a797b980d")}</BusinessButton>
          </div>
        </details>
      </div>
    );
  }

  const visiblePendingBookings = pendingBookings.filter((booking) => planningItemMatchesCategory(booking) && planningItemMatchesAsset(booking));
  const visibleConfirmedBookings = confirmedBookings.filter((booking) => planningItemMatchesCategory(booking) && planningItemMatchesAsset(booking));

  const calendarWeeks = useMemo(() => getPlanningCalendarWeeks(calendarMonth), [calendarMonth]);
  const calendarWeekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  const calendarEvents = (() => {
    const leadEvents = [
      ...visibleConfirmedBookings.map((booking) => ({
        ...booking,
        source: "lead" as const,
        planningLabel: "Confirmé",
        status: "Confirmé",
        startTime: "",
        endTime: "",
        blocksAvailability: true
      })),
      ...visiblePendingBookings.map((booking) => ({
        ...booking,
        source: "lead" as const,
        planningLabel: booking.status,
        startTime: "",
        endTime: "",
        blocksAvailability: false
      }))
    ];

    const planningEntryEvents = planningEntries
      .filter((entry) => isValidPlanningDate(entry.startDate) && isValidPlanningDate(entry.endDate || entry.startDate))
      .map((entry) => {
        const asset = assets.find((item) => item.type === entry.assetType && item.id === entry.assetId);

        return {
          id: entry.id,
          source: "planning" as const,
          assetType: entry.assetType || "",
          assetId: entry.assetId || "",
          assetLabel: asset?.label || entry.title,
          title: entry.title,
          status: getPlanningEntryStatus(entry),
          planningCategory: getPlanningEntryCategory(entry),
          assetCategory: getPlanningEntryCategory(entry),
          contactName: entry.contactName || entry.type,
          startDate: entry.startDate,
          startTime: entry.startTime || "",
          endDate: entry.endDate || entry.startDate,
          endTime: entry.endTime || "",
          value: 0,
          nextAction: entry.notes || "",
          planningLabel: entry.type,
          blocksAvailability: Boolean(entry.blocksAvailability)
        };
      });

    return [...leadEvents, ...planningEntryEvents]
      .filter((event) => planningItemMatchesCategory(event))
      .sort((a, b) => {
        const dateDiff = planningDateValue(a.startDate) - planningDateValue(b.startDate);
        if (dateDiff !== 0) return dateDiff;
        return String(a.startTime || "").localeCompare(String(b.startTime || ""));
      });
  })();

  const planningConflicts = useMemo(() => {
    const usableLeads = leads
      .filter((lead) =>
        lead.status !== "Perdu" &&
        Boolean(lead.assetType) &&
        Boolean(lead.assetId) &&
        isValidPlanningDate(lead.rentalStartDate) &&
        isValidPlanningDate(lead.rentalEndDate)
      )
      .map((lead) => {
        const asset = assets.find((item) => item.type === lead.assetType && item.id === lead.assetId);

        return {
          id: lead.id,
          status: lead.status,
          assetType: lead.assetType,
          assetId: lead.assetId,
          assetLabel: asset?.label ?? String(lead.assetId ?? "Actif non renseigné"),
          contactName: lead.contactName,
          startDate: lead.rentalStartDate,
          endDate: lead.rentalEndDate,
          value: lead.value
        };
      });

    const conflicts: Array<{
      key: string;
      assetLabel: string;
      firstContact: string;
      secondContact: string;
      firstStatus: LeadStatus;
      secondStatus: LeadStatus;
      firstDates: string;
      secondDates: string;
      severity: string;
    }> = [];

    for (let index = 0; index < usableLeads.length; index += 1) {
      const first = usableLeads[index];

      for (let nextIndex = index + 1; nextIndex < usableLeads.length; nextIndex += 1) {
        const second = usableLeads[nextIndex];

        if (first.assetType !== second.assetType || first.assetId !== second.assetId) {
          continue;
        }

        const overlaps = planningRangesOverlap(
          first.startDate,
          first.endDate,
          second.startDate,
          second.endDate
        );

        if (!overlaps) {
          continue;
        }

        const hasConfirmed = first.status === "Gagné" || second.status === "Gagné";

        conflicts.push({
          key: `${first.id}-${second.id}`,
          assetLabel: first.assetLabel,
          firstContact: first.contactName,
          secondContact: second.contactName,
          firstStatus: first.status,
          secondStatus: second.status,
          firstDates: `${screen.date(first.startDate)} → ${screen.date(first.endDate)}`,
          secondDates: `${screen.date(second.startDate)} → ${screen.date(second.endDate)}`,
          severity: hasConfirmed ? "Conflit confirmé" : "Conflit option"
        });
      }
    }

    return conflicts;
  }, [leads, assets, screen]);

  function getEventsForCalendarDay(dayIso: string) {
    return calendarEvents.filter((event) =>
      planningRangesOverlap(dayIso, dayIso, event.startDate, event.endDate)
    );
  }

  const planningWeekDays = (() => {
    const baseDate = isValidPlanningDate(planningWeekStart) ? new Date(`${planningWeekStart}T00:00:00`) : new Date();
    const mondayOffset = (baseDate.getDay() + 6) % 7;
    const monday = addPlanningDays(baseDate, -mondayOffset);

    return Array.from({ length: 7 }, (_, index) => {
      const date = addPlanningDays(monday, index);
      const iso = formatPlanningDateValue(date);

      return {
        iso,
        dayLabel: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "Europe/Paris" }).format(date),
        dateLabel: screen.date(iso),
        events: getEventsForCalendarDay(iso)
      };
    });
  })();

  function movePlanningWeek(offset: number) {
    const baseDate = isValidPlanningDate(planningWeekStart) ? new Date(`${planningWeekStart}T00:00:00`) : new Date();
    setPlanningWeekStart(formatPlanningDateValue(addPlanningDays(baseDate, offset * 7)));
  }

  const todayPlanningAgendaItems = (() => {
    return calendarEvents
      .filter((event) => planningRangesOverlap(todayIso, todayIso, event.startDate, event.endDate))
      .slice(0, 6);
  })();

  const nextPlanningAgendaItems = (() => {
    return calendarEvents
      .filter((event) => planningRangesOverlap(tomorrowIso, nextSevenDaysIso, event.startDate, event.endDate))
      .slice(0, 10);
  })();

  function getPlanningAgendaPrimary(event: any) {
    return String(event.contactName || event.assetLabel || event.title || t("crm.enums.serviceVisit")).trim();
  }

  function getPlanningAgendaSecondary(event: any) {
    return [
      event.source === "planning" ? event.title : event.assetLabel,
      event.source === "planning" ? event.assetLabel : event.contactName,
      label(event.planningLabel, "crm")
    ].filter(Boolean).join(" · ");
  }

  function renderPlanningAgendaItem(event: any) {
    const matchingPlanningEntry = event.source === "planning"
      ? planningEntries.find((entry) => entry.id === event.id)
      : null;

    return (
      <article className={`planning-agenda-item ${event.blocksAvailability ? "is-blocking" : "is-option"} status-${getPlanningStatusClass(getPlanningEventOperationalStatus(event))}`} key={`${event.source}-${event.id}-${event.startDate}`}>
        <div className="planning-agenda-time">
          <strong>{screen.date(event.startDate)}</strong>
          <span>{screen.timeRange(event.startTime, event.endTime) || t("crm.planning.a0c9ab274d")}</span>
        </div>

        <div className="planning-agenda-main">
          <strong>{getPlanningAgendaPrimary(event)}</strong>
          <span>{getPlanningAgendaSecondary(event)}</span>
          <span className="planning-agenda-explanation">{screen.planningExplanation(event)}</span>
        </div>

        <div className="planning-agenda-actions">
          <Badge>{label(getPlanningEventOperationalStatus(event), "crm")}</Badge>
          {matchingPlanningEntry ? (<BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => startPlanningEntryEdit(matchingPlanningEntry)} data-crm-auto-scroll="true">{t("crm.planning.42e37604b6")}</BusinessButton>) : null}
        </div>
      </article>
    );
  }

  function moveCalendarMonth(offset: number) {
    const [yearText, monthText] = calendarMonth.split("-");
    const year = Number(yearText);
    const month = Number(monthText);

    if (!Number.isFinite(year) || !Number.isFinite(month)) return;

    setCalendarMonth(formatPlanningMonthValue(new Date(year, month - 1 + offset, 1)));
  }


  function shouldIgnorePlanningQuickAddClick(clickEvent: React.MouseEvent<HTMLElement>) {
    const target = clickEvent.target as HTMLElement | null;

    if (!target) return false;

    return Boolean(target.closest([
      "button",
      "a",
      "input",
      "select",
      "textarea",
      "[draggable='true']",
      ".planning-event-pill",
      ".planning-week-event",
      ".planning-event-button"
    ].join(",")));
  }

  function scrollToPlanningEntryFormForQuickAdd() {
    const target = document.querySelector<HTMLElement>('[data-planning-entry-form="true"]');

    if (!target) return;

    target.scrollIntoView({ behavior: "auto", block: "start" });

    const scrollContainers = [
      document.querySelector<HTMLElement>(".content-panel"),
      document.querySelector<HTMLElement>(".crm-readable-redesign"),
      document.scrollingElement as HTMLElement | null
    ].filter(Boolean) as HTMLElement[];

    for (const container of scrollContainers) {
      const targetRect = target.getBoundingClientRect();
      const containerRect = container === document.scrollingElement
        ? { top: 0 }
        : container.getBoundingClientRect();
      const nextTop = container.scrollTop + targetRect.top - containerRect.top - 110;

      if (Number.isFinite(nextTop)) {
        container.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
      }
    }

    window.setTimeout(() => {
      const titleInput = target.querySelector<HTMLInputElement>('input[name="title"]');
      titleInput?.focus({ preventScroll: true });
      titleInput?.select();
    }, 80);
  }

  function openPlanningQuickAddFromDay(clickEvent: React.MouseEvent<HTMLElement>, dayIso: string) {
    if (!isValidPlanningDate(dayIso)) return;
    if (shouldIgnorePlanningQuickAddClick(clickEvent)) return;

    setEditingPlanningEntry(null);
    setQuickPlanningDate(dayIso);
    setCalendarMonth(formatPlanningMonthValue(new Date(`${dayIso}T00:00:00`)));
    setPlanningWeekStart(dayIso);

    window.setTimeout(scrollToPlanningEntryFormForQuickAdd, 30);
    window.setTimeout(scrollToPlanningEntryFormForQuickAdd, 120);
  }

  function startPlanningEntryEdit(entry: PlanningEntry) {
    setQuickPlanningDate("");
    setEditingPlanningEntry(entry);

    const scrollToPlanningForm = () => {
      const target = document.querySelector<HTMLElement>('[data-planning-entry-form="true"]');

      if (!target) return;

      target.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      const scrollContainers = [
        document.querySelector<HTMLElement>(".content-panel"),
        document.querySelector<HTMLElement>(".crm-readable-redesign"),
        document.scrollingElement as HTMLElement | null
      ].filter(Boolean) as HTMLElement[];

      for (const container of scrollContainers) {
        const targetRect = target.getBoundingClientRect();
        const containerRect = container === document.scrollingElement
          ? { top: 0 }
          : container.getBoundingClientRect();

        const nextTop = container.scrollTop + targetRect.top - containerRect.top - 110;

        if (Number.isFinite(nextTop)) {
          container.scrollTo({
            top: Math.max(0, nextTop),
            behavior: "smooth"
          });
        }
      }

      window.setTimeout(() => {
        const titleInput = target.querySelector<HTMLInputElement>('input[name="title"]');
        titleInput?.focus({ preventScroll: true });
      }, 260);
    };

    window.setTimeout(scrollToPlanningForm, 80);
    window.setTimeout(scrollToPlanningForm, 260);
  }

  function cancelPlanningEntryEdit() {
    setEditingPlanningEntry(null);
    setQuickPlanningDate("");
  }

  const editingPlanningAssetKey = editingPlanningEntry?.assetType && editingPlanningEntry?.assetId
    ? `${editingPlanningEntry.assetType}:${editingPlanningEntry.assetId}`
    : "";

  const editingPlanningCategory = editingPlanningEntry ? getPlanningEntryCategory(editingPlanningEntry) : defaultPlanningCategory;

  const visibleAssetOptions = assetOptions.filter((asset) =>
    categoryFilter === "Tous" || asset.planningCategory === activePlanningCategory || asset.key === editingPlanningAssetKey
  );

  return (
    <div className="stack planning-workspace">
      <section className="card planning-filter-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Planning"}>{t("crm.planning.21cc305095")}</p>
            <h3>{t("crm.planning.f00f4b2ad2")}</h3>
          </div>
        </div>

        <BusinessForm className="form-grid compact">
          <BusinessLabel>{t("crm.planning.21cc305095")}<select value={categoryFilter} onChange={(event) => {
              setCategoryFilter(event.target.value);
              setAssetFilter("Tous");
            }}>
              {categories.map((category) => (
                <option key={category} value={category}>{screen.category(category)}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.ed605ab50c")}<select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
              <option value="Tous">{t("crm.planning.204aa09406")}</option>
              {assetFilterOptions.map((asset) => (
                <option key={asset.key} value={asset.key}>{asset.label}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.f12d68908f")}<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.2382a693af")}<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </BusinessLabel>

          <BusinessButton
            className="ghost-button planning-filter-reset"
            type="button"
            onClick={() => {
              setCategoryFilter("Tous");
              setAssetFilter("Tous");
              setStartDate("");
              setEndDate("");
            }}
          >{t("crm.planning.442c7f653b")}</BusinessButton>
        </BusinessForm>

        <div className="planning-scope-notice">
          <strong>{t("crm.planning.358acd18da")}{" "}{categoryFilter === "Tous" ? t("crm.planning.5b98d2b868") : categoryFilter}</strong>
          <span>{categoryFilter === "Tous" ? t("crm.planning.11efb79ad5") : t("crm.planning.b6a85f0b7e", { value1: displayValue(categoryFilter) })}</span>
        </div>
      </section>

      <section className="card planning-agenda-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Vue opérationnelle"}>{t("crm.planning.90b0ae7795")}</p>
            <h3>{t("crm.planning.6ce09cd975")}</h3>
          </div>
        </div>

        <div className="planning-agenda-grid">
          <div className="planning-agenda-column">
            <div className="planning-agenda-column-heading">
              <span>{t("crm.planning.f2de9e072a")}</span>
              <strong>{todayPlanningAgendaItems.length}</strong>
            </div>

            <div className="planning-agenda-list">
              {todayPlanningAgendaItems.length === 0 ? (<p className="muted-line">{t("crm.planning.9cf48dd7d4")}</p>) : (todayPlanningAgendaItems.map((event) => renderPlanningAgendaItem(event)))}
            </div>
          </div>

          <div className="planning-agenda-column">
            <div className="planning-agenda-column-heading">
              <span>{t("crm.planning.ed29742d3f")}</span>
              <strong>{nextPlanningAgendaItems.length}</strong>
            </div>

            <div className="planning-agenda-list">
              {nextPlanningAgendaItems.length === 0 ? (<p className="muted-line">{t("crm.planning.0643b2381a")}</p>) : (nextPlanningAgendaItems.map((event) => renderPlanningAgendaItem(event)))}
            </div>
          </div>
        </div>
      </section>

      <section className="card planning-priority-cockpit-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Priorité planning"}>{t("crm.planning.a5a246c2f6")}</p>
            <h3>{t("crm.planning.ee0524fefb")}</h3>
          </div>
        </div>

        <div className="planning-priority-cockpit-list">
          {importantPlanningEntries.length === 0 ? (<p className="muted-line">{t("crm.planning.78e367ceb7")}</p>) : (importantPlanningEntries.map((entry) => {
              const asset = assets.find((item) => item.type === entry.assetType && item.id === entry.assetId);
              const missing = getPlanningEntryMissingFields(entry);

              return (
                <article className={`mini-row planning-priority-cockpit-row status-${getPlanningStatusClass(getPlanningEntryStatus(entry))}`} key={`priority-${entry.id}`}>
                  <div>
                    <strong>{entry.title}</strong>
                    <span>{screen.planningRange(entry)} · {entry.contactName || t("crm.planning.9fa7db0383")}{asset ? t("crm.planning.f6b53f9c8a", { value1: displayValue(asset.label) }) : ""}</span>
                    <span>{label(entry.priority, "crm") || t("crm.planning.a7248eeb45")}{missing.length ? t("crm.planning.f518cce630", { value1: displayValue(missing.map(field => label(field, "crm")).join(", ")) }) : ""}</span>
                  </div>
                  {renderPlanningQuickActions(entry)}
                </article>
              );
            }))}
        </div>
      </section>

      <section className="card planning-completion-alerts-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Qualité données"}>{t("crm.planning.37a898d966")}</p>
            <h3>{t("crm.counts.serviceVisits", { count: incompletePlanningEntries.length })}</h3>
          </div>
        </div>

        {incompletePlanningEntries.length === 0 ? (<p className="muted-line">{t("crm.planning.2d3fc7362b")}</p>) : (<div className="list-stack planning-alert-list">
            {incompletePlanningEntries.map(({ entry, missing }) => (
              <article className="mini-row planning-alert-row" key={`missing-${entry.id}`}>
                <div>
                  <strong>{entry.title}</strong>
                  <span>{screen.date(entry.startDate)}{" "}{t("crm.planning.59be1daf02")}{" "}{missing.map(field => label(field, "crm")).join(", ")}</span>
                </div>
                <BusinessButton className="asset-edit-button" type="button" onClick={() => startPlanningEntryEdit(entry)}>{t("crm.planning.6ef4b7a589")}</BusinessButton>
              </article>
            ))}
          </div>)}
      </section>

      <section id="planning-entry-form" className={`card planning-entry-form-card ${editingPlanningEntry ? "is-editing" : ""}`} data-planning-entry-form="true">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Planning interne"}>{t("crm.planning.a783ed5075")}</p>
            <h3>{editingPlanningEntry ? t("crm.planning.1087b87d57") : t("crm.planning.939931cc85")}</h3>
          </div>
        </div>

        {quickPlanningDate && !editingPlanningEntry && (
          <div className="planning-quick-add-banner">
            <strong>{t("crm.planning.7aab54dc35")}</strong>
            <span>{screen.date(quickPlanningDate)}{" "}{t("crm.planning.b74990988f")}</span>
          </div>
        )}

        <BusinessForm
          className="form-grid compact planning-entry-form"
          key={editingPlanningEntry?.id ?? `new-planning-entry-${quickPlanningDate || categoryFilter}`}
          onSubmit={(event) => {
            if (!editingPlanningEntry) {
              onAddPlanningEntry(event);
              setQuickPlanningDate("");
              return;
            }

            const updated = onUpdatePlanningEntry(editingPlanningEntry.id, event);

            if (updated) {
              setEditingPlanningEntry(null);
            }
          }}
        >
          <BusinessLabel>{t("crm.planning.78e7920010")}<input name="title" defaultValue={editingPlanningEntry?.title ?? (quickPlanningDate ? "Rendez-vous" : "")} placeholder={t("crm.planning.014fb4507d")} required />
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.baaddf70fb")}<select name="type" defaultValue={editingPlanningEntry?.type ?? (quickPlanningDate ? "Autre" : "Intervention prestataire")}>
              {planningEntryTypes.map((type) => (
                <option key={type} value={type}>{label(type, "crm")}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.21cc305095")}<select name="planningCategory" defaultValue={editingPlanningCategory}>
              {planningCategoryOptions.map((category) => (
                <option key={category} value={category}>{screen.category(category)}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.dee377cfd8")}<select name="status" defaultValue={editingPlanningEntry ? getPlanningEntryStatus(editingPlanningEntry) : "Prévu"}>
              {planningEntryStatuses.map((status) => (
                <option key={status} value={status}>{label(status, "crm")}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.16a7ec6358")}<input
              name="contactName"
              list="planning-contact-options"
              defaultValue={editingPlanningEntry?.contactName ?? ""}
              placeholder={t("crm.planning.c10669d9f2")}
              autoComplete="off"
            />
            <datalist id="planning-contact-options">
              {planningContactOptions.map((contact) => (
                <option key={contact.id} value={contact.value}>{contact.label}</option>
              ))}
            </datalist>
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.833fcb6f22")}<select name="assetKey" defaultValue={editingPlanningAssetKey}>
              <option value="">{t("crm.planning.1ceb66fe96")}</option>
              {visibleAssetOptions.map((asset) => (
                <option key={asset.key} value={asset.key}>{asset.label}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.f12d68908f")}<input type="date" name="startDate" defaultValue={editingPlanningEntry?.startDate ?? quickPlanningDate} required />
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.2382a693af")}<input type="date" name="endDate" defaultValue={editingPlanningEntry?.endDate ?? quickPlanningDate} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.717a6ee471")}<input type="time" name="startTime" defaultValue={editingPlanningEntry?.startTime ?? ""} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.28e11f988c")}<input type="time" name="endTime" defaultValue={editingPlanningEntry?.endTime ?? ""} />
          </BusinessLabel>

          <BusinessLabel>{t("crm.planning.1da985c0b1")}<select name="blocksAvailability" defaultValue={editingPlanningEntry?.blocksAvailability ? "true" : "false"}>
              <option value="false">{t("crm.planning.7f62496b0c")}</option>
              <option value="true">{t("crm.planning.0a90407639")}</option>
            </select>
          </BusinessLabel>

          <BusinessLabel className="planning-entry-notes">{t("crm.planning.8a7525b149")}<textarea name="notes" defaultValue={editingPlanningEntry?.notes ?? ""} placeholder={t("crm.planning.baf4fd9766")} />
          </BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">
            {editingPlanningEntry ? t("crm.planning.45951f6ac1") : t("crm.planning.6800f275a4")}
          </BusinessButton>

          {editingPlanningEntry && (
            <BusinessButton className="ghost-button" type="button" onClick={cancelPlanningEntryEdit} data-crm-dismiss="true">{t("crm.planning.46ad3916f6")}</BusinessButton>
          )}
        </BusinessForm>

        <div className="planning-legend">
          <span><i className="legend-dot status-finished" />{" "}{t("crm.planning.dea28c46fd")}</span>
          <span><i className="legend-dot status-active" />{" "}{t("crm.planning.140b715af5")}</span>
          <span><i className="legend-dot status-upcoming" />{" "}{t("crm.planning.2774f327bd")}</span>
        </div>

        <div className="planning-list-summary">
          <div>
            <strong>{activePlanningEntries.length}{" "}{t("crm.planning.77f4c0b60e")}{activePlanningEntries.length > 1 ? t("crm.planning.043a718774") : ""}{" "}{t("crm.planning.cce72bcc7c")}</strong>
            <span>{completedPlanningEntries.length}{" "}{t("crm.planning.bae4a7b343")}{completedPlanningEntries.length > 1 ? t("crm.planning.043a718774") : ""}{" "}{t("crm.planning.80f754d964")}{completedPlanningEntries.length > 1 ? t("crm.planning.043a718774") : ""}{" "}{t("crm.planning.6d26b50653")}{completedPlanningEntries.length > 1 ? t("crm.planning.043a718774") : ""}{" "}{t("crm.planning.c43f941a71")}</span>
          </div>

          <div className="planning-list-summary-actions">
            {activePlanningEntries.length > 7 ? (<BusinessButton className="ghost-button" type="button" onClick={() => setShowAllUpcomingPlanningEntries((value) => !value)}>
                {showAllUpcomingPlanningEntries ? t("crm.planning.478f8909b0") : t("crm.planning.3051041719", { value1: displayValue(activePlanningEntries.length) })}
              </BusinessButton>) : null}

            {completedPlanningEntries.length > 0 ? (<BusinessButton className="ghost-button muted-action-button" type="button" onClick={() => setShowCompletedPlanningEntries((value) => !value)}>
                {showCompletedPlanningEntries ? t("crm.planning.be042d51da") : t("crm.planning.b90ce6bb46", { value1: displayValue(completedPlanningEntries.length) })}
              </BusinessButton>) : null}
          </div>
        </div>

        <div className="list-stack planning-priority-list">
          {planningEntriesToDisplay.length === 0 ? (<p className="muted-line">{t("crm.planning.ab4f644dc0")}</p>) : (planningEntriesToDisplay
              .map((entry) => {
                const asset = assets.find((item) => item.type === entry.assetType && item.id === entry.assetId);

                return (
                  <article className={`mini-row planning-entry-compact-row planning-entry-line-clean status-${getPlanningStatusClass(getPlanningEntryStatus(entry))}`} key={entry.id} data-notification-target={`planning-${entry.id}`}>
                    <div className="planning-entry-info-clean">
                      <strong>{entry.title}</strong>
                      <span className="planning-entry-main-line">
                        {screen.planningRange(entry)} · {entry.contactName || t("crm.planning.9fa7db0383")}{asset ? t("crm.planning.f6b53f9c8a", { value1: displayValue(asset.label) }) : ""}
                      </span>
                      <span className="planning-entry-secondary-line">{entry.type}{entry.notes ? t("crm.planning.f6b53f9c8a", { value1: displayValue(entry.notes) }) : ""}</span>
                      <span className="planning-entry-timing-explanation">{screen.planningExplanation(entry)}</span>
                      <ActionMeta item={entry} />
                    </div>
                    <div className="planning-entry-side-clean">
                      <div className="planning-entry-badges-clean">
                        <Badge>{label(getPlanningEntryStatus(entry), "crm")}</Badge>
                        {getPlanningInclusiveDayCount(entry.startDate, entry.endDate || entry.startDate) > 1 ? (
                          <Badge>{t("crm.planning.bcc8462ba4", { value1: displayValue(getPlanningInclusiveDayCount(entry.startDate, entry.endDate || entry.startDate)) })}</Badge>
                        ) : null}
                        <Badge>{entry.blocksAvailability ? t("crm.planning.d95dc51829") : t("crm.planning.81e809b3b9")}</Badge>
                        {entry.priority && entry.priority !== "Normal" ? <Badge>{label(entry.priority, "crm")}</Badge> : null}
                      </div>
                      {renderPlanningQuickActions(entry)}
                    </div>
                  </article>
                );
              }))}
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Conflits planning"}>{t("crm.planning.2bcb054039")}</p>
            <h3>{planningConflicts.length}{" "}{t("crm.planning.ef6bb5ad81")}{planningConflicts.length > 1 ? t("crm.planning.043a718774") : ""}{" "}{t("crm.planning.413cf9ae9a")}{planningConflicts.length > 1 ? t("crm.planning.043a718774") : ""}</h3>
          </div>
        </div>

        <div className="list-stack oar-contact-list-stack">
          {planningConflicts.length === 0 ? (<p className="muted-line">{t("crm.planning.60dd946c2d")}</p>) : (planningConflicts.map((conflict) => (
              <article className="mini-row" key={conflict.key}>
                <div>
                  <strong>{conflict.assetLabel}</strong>
                  <span>{conflict.firstContact} · {conflict.firstDates} · {label(conflict.firstStatus, "crm")}</span>
                  <span>{conflict.secondContact} · {conflict.secondDates} · {label(conflict.secondStatus, "crm")}</span>
                </div>
                <Badge>{label(conflict.severity, "crm")}</Badge>
              </article>
            )))}
        </div>
      </section>

      <section className="card planning-calendar-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Calendrier mensuel"}>{t("crm.planning.e4a0656f45")}</p>
            <h3>{screen.monthTitle(calendarMonth)}</h3>
          </div>

          <div className="quote-actions">
            <BusinessButton className="ghost-button" type="button" onClick={() => moveCalendarMonth(-1)}>{t("crm.planning.ce294cc82b")}</BusinessButton>

            <BusinessButton className="ghost-button" type="button" onClick={() => moveCalendarMonth(1)}>{t("crm.planning.2e82fa5d91")}</BusinessButton>
          </div>
        </div>

        <BusinessForm className="form-grid compact planning-view-controls">
          <BusinessLabel>{t("crm.planning.b111a2a218")}<select value={planningViewMode} onChange={(event) => setPlanningViewMode(event.target.value as "month" | "week")}>
              <option value="month">{t("crm.planning.709ceef6d9")}</option>
              <option value="week">{t("crm.planning.0934d42938")}</option>
            </select>
          </BusinessLabel>

          {planningViewMode === "month" ? (<BusinessLabel>{t("crm.planning.709ceef6d9")}<input type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)} />
            </BusinessLabel>) : (<BusinessLabel>{t("crm.planning.e84c48c2b2")}<input type="date" value={planningWeekStart} onChange={(event) => setPlanningWeekStart(event.target.value)} />
            </BusinessLabel>)}
        </BusinessForm>

        {planningViewMode === "month" ? (<div className="table-wrap planning-month-table-wrap">
            <table className="planning-month-table">
            <thead>
              <tr>
                {calendarWeekDays.map((day) => (
                  <th key={day}>{label(day, "crm")}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {calendarWeeks.map((week, weekIndex) => (
                <tr key={`week-${weekIndex}`}>
                  {week.map((day, dayIndex) => {
                    const events = day ? getEventsForCalendarDay(day.iso) : [];

                    const hasBlockingEvent = events.some((event) => event.blocksAvailability);
                    const safeDayIso = day?.iso || "";
                  const dayStatusClass = safeDayIso ? getPlanningDayStatusClass(events, safeDayIso) : "";
                    const dayClassName = [
                      "planning-day",
                      events.length > 0 ? "planning-day-filled" : "",
                      dayStatusClass,
                      hasBlockingEvent ? "planning-day-blocked" : ""
                    ].filter(Boolean).join(" ");

                    return (
                      <td
                        key={`${weekIndex}-${dayIndex}`}
                        className={day ? dayClassName : "planning-day-empty"}
                        onDragOver={day ? handlePlanningCalendarDragOver : undefined}
                        onDrop={day ? (dragEvent) => handlePlanningCalendarDrop(dragEvent, day.iso) : undefined}
                        onClick={day ? (clickEvent) => openPlanningQuickAddFromDay(clickEvent, day.iso) : undefined}
                      >
                        {day ? (
                          <div>
                            <strong>{day.day}</strong>

                            {events.length > 0 && (
                              events.slice(0, 4).map((event) => {
                                const matchingPlanningEntry = event.source === "planning"
                                  ? planningEntries.find((entry) => entry.id === event.id)
                                  : null;
                                const eventLabel = screen.planningEventLabel(event, day.iso);
                                const eventSegment = screen.planningSegment(event, day.iso);
                                const eventExplanation = eventSegment.explanation;

                                return matchingPlanningEntry ? (
                                  <BusinessButton
                                    className={`planning-event-pill planning-event-button ${event.blocksAvailability ? "blocked" : "entry"} status-${getPlanningStatusClass(eventSegment.status)}`}
                                    key={`${event.source}-${event.id}`}
                                    type="button"
                                    draggable
                                    onDragStart={(dragEvent) => handlePlanningCalendarDragStart(dragEvent, event)}
                                    onClick={() => startPlanningEntryEdit(matchingPlanningEntry)}
                                    title={eventExplanation}
                                  >
                                    {cleanPlanningCalendarVisibleLabel(eventLabel)}
                                  </BusinessButton>
                                ) : (
                                  <span
                                    className={`planning-event-pill ${event.blocksAvailability ? "blocked" : "option"} status-${getPlanningStatusClass(eventSegment.status)}`}
                                    key={`${event.source}-${event.id}`}
                                    draggable
                                    data-planning-draggable-lead="true"
                                    onDragStart={(dragEvent) => handlePlanningCalendarDragStart(dragEvent, event)}
                                    title={eventExplanation}
                                  >
                                    {cleanPlanningCalendarVisibleLabel(eventLabel)}
                                  </span>
                                );
                              })
                            )}

                            {events.length > 4 && (
                              <small>+ {events.length - 4}{" "}{t("crm.planning.e996f29149")}{events.length - 4 > 1 ? t("crm.planning.043a718774") : ""}</small>
                            )}
                          </div>
                        ) : (
                          <span />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>) : (<div className="planning-week-view">
            <div className="planning-week-toolbar">
              <BusinessButton className="ghost-button" type="button" onClick={() => movePlanningWeek(-1)}>{t("crm.planning.514db0d416")}</BusinessButton>
              <strong>{screen.date(planningWeekDays[0]?.iso)} → {screen.date(planningWeekDays[6]?.iso)}</strong>
              <BusinessButton className="ghost-button" type="button" onClick={() => movePlanningWeek(1)}>{t("crm.planning.fa063d47c1")}</BusinessButton>
            </div>

            <div className="planning-week-grid">
              {planningWeekDays.map((day) => (
                <article
                  className="planning-week-day"
                  key={day.iso}
                  onDragOver={handlePlanningCalendarDragOver}
                  onDrop={(dropEvent) => handlePlanningCalendarDrop(dropEvent, day.iso)}
                  onClick={(clickEvent) => openPlanningQuickAddFromDay(clickEvent, day.iso)}
                >
                  <div className="planning-week-day-heading">
                    <span>{day.dayLabel}</span>
                    <strong>{day.dateLabel}</strong>
                  </div>

                  <div className="planning-week-events">
                    {day.events.length === 0 ? (
                      <span className="planning-week-empty">{t("crm.planning.162d92c98a")}</span>
                    ) : (
                      day.events.map((event) => {
                        const matchingPlanningEntry = event.source === "planning"
                          ? planningEntries.find((entry) => entry.id === event.id)
                          : null;
                        const eventLabel = screen.planningEventLabel(event, day.iso);
                        const eventSegment = screen.planningSegment(event, day.iso);
                        const eventExplanation = eventSegment.explanation;

                        return matchingPlanningEntry ? (
                          <BusinessButton
                            className={`planning-week-event ${event.blocksAvailability ? "blocked" : "entry"} status-${getPlanningStatusClass(eventSegment.status)}`}
                            key={`${event.source}-${event.id}-${day.iso}`}
                            type="button"
                            draggable
                            onDragStart={(dragEvent) => handlePlanningCalendarDragStart(dragEvent, event)}
                            onClick={() => startPlanningEntryEdit(matchingPlanningEntry)}
                            title={eventExplanation}
                          >
                            {cleanPlanningCalendarVisibleLabel(eventLabel)}
                          </BusinessButton>
                        ) : (
                          <span
                            className={`planning-week-event ${event.blocksAvailability ? "blocked" : "option"} status-${getPlanningStatusClass(eventSegment.status)}`}
                            key={`${event.source}-${event.id}-${day.iso}`}
                            draggable
                            data-planning-draggable-lead="true"
                            onDragStart={(dragEvent) => handlePlanningCalendarDragStart(dragEvent, event)}
                            title={eventExplanation}
                          >
                            {cleanPlanningCalendarVisibleLabel(eventLabel)}
                          </span>
                        );
                      })
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>)}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Disponibilités"}>{t("crm.planning.f13a7f6816")}</p>
            <h3>{visibleAssets.length}{" "}{t("crm.planning.92b2bce8d3")}{visibleAssets.length > 1 ? t("crm.planning.043a718774") : ""}</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="mobile-card-table planning-availability-table">
            <thead>
              <tr>
                <th>{t("crm.planning.ad26287ab6")}</th>
                <th>{t("crm.planning.68a5341fc6")}</th>
                <th>{t("crm.planning.49dd011dd8")}</th>
                <th>{t("crm.planning.53a0db54e4")}</th>
                <th>{t("crm.planning.b0d4321c23")}</th>
              </tr>
            </thead>

            <tbody>
              {visibleAssets.map((asset) => {
                const bookings = getBookingsForAsset(asset);
                const options = getOptionsForAsset(asset);

                return (
                  <tr key={`${asset.type}-${asset.id}`}>
                    <td data-label={t("crm.planning.ad26287ab6")}>
                      <strong>{asset.label}</strong>
                      <small>
                        {bookings.length}{" "}{t("crm.planning.2b21bab38e")}{bookings.length > 1 ? t("crm.planning.043a718774") : ""} · {options.length}{" "}{t("crm.planning.a11a75e0fe")}{options.length > 1 ? t("crm.planning.043a718774") : ""}
                      </small>
                    </td>
                    <td data-label={t("crm.planning.68a5341fc6")}>{label(asset.category, "crm")}</td>
                    <td data-label={t("crm.planning.49dd011dd8")}>{asset.location}</td>
                    <td data-label={t("crm.planning.53a0db54e4")}>
                      <Badge>{label(getAvailabilityLabel(asset), "crm")}</Badge>
                    </td>
                    <td data-label={t("crm.planning.b0d4321c23")}>
                      {bookings.length === 0 ? (
                        <span className="muted-line">{t("crm.planning.f48e7a7f72")}</span>
                      ) : (
                        bookings.slice(0, 3).map((booking) => (
                          <span className="muted-line" key={booking.id}>
                            {screen.date(booking.startDate)} → {screen.date(booking.endDate)} · {booking.contactName}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Options / demandes en cours"}>{t("crm.planning.58b471b978")}</p>
            <h3>{visiblePendingBookings.length}{" "}{t("crm.planning.d956eafa6f")}{visiblePendingBookings.length > 1 ? t("crm.planning.043a718774") : ""}</h3>
          </div>
        </div>

        <div className="list-stack oar-contact-list-stack">
          {visiblePendingBookings.length === 0 ? (<p className="muted-line">{t("crm.planning.c72143bfbd")}</p>) : (visiblePendingBookings.map((booking) => (
              <article className="mini-row" key={booking.id}>
                <div>
                  <strong>{booking.assetLabel}</strong>
                  <span>{booking.contactName} · {screen.date(booking.startDate)} → {screen.date(booking.endDate)}</span>
                  <span>{label(booking.assetCategory, "crm")} · {screen.money(booking.value)}</span>
                  {booking.nextAction && <span>{booking.nextAction}</span>}
                </div>
                <Badge>{label(booking.status, "crm")}</Badge>
              </article>
            )))}
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow" data-semantic-text={"Locations confirmées"}>{t("crm.planning.4202fd751d")}</p>
            <h3>{visibleConfirmedBookings.length}{" "}{t("crm.planning.836162ece7")}{visibleConfirmedBookings.length > 1 ? t("crm.planning.043a718774") : ""}</h3>
          </div>
        </div>

        <div className="list-stack oar-contact-list-stack">
          {visibleConfirmedBookings.length === 0 ? (<p className="muted-line">{t("crm.planning.e3ade5ce33")}</p>) : (visibleConfirmedBookings.map((booking) => (
              <article className="mini-row" key={booking.id}>
                <div>
                  <strong>{booking.assetLabel}</strong>
                  <span>{booking.contactName} · {screen.date(booking.startDate)} → {screen.date(booking.endDate)}</span>
                  <span>{label(booking.assetCategory, "crm")} · {screen.money(booking.value)}</span>
                </div>
                <Badge>{t("crm.planning.1278c77084")}</Badge>
              </article>
            )))}
        </div>
      </section>
    </div>
  );
}


type FollowUpRecommendation = {
  id: string;
  title: string;
  detail: string;
  priority: "Haute" | "Moyenne";
  leadId?: string;
};


function getQuoteStatusAgeDays(quote: QuoteRequest) {
  return getQuoteAgeDays(quote.statusUpdatedAt || quote.createdAt);
}

function getQuoteAgeDays(createdAt: string) {
  if (!createdAt) return 0;

  const createdDate = new Date(createdAt);

  if (Number.isNaN(createdDate.getTime())) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  createdDate.setHours(0, 0, 0, 0);

  return Math.max(0, Math.floor((today.getTime() - createdDate.getTime()) / 86400000));
}

function FollowUpsPanel({
  leads,
  tasks,
  quotes,
  onCreateTask
}: {
  leads: Lead[];
  tasks: Task[];
  quotes: QuoteRequest[];
  onCreateTask: (recommendation: FollowUpRecommendation) => void;
}) {
  const { t, label, screen } = useCRMDisplay();

  // The canonical recommendation still seeds the existing task title and notes.
  function displayRecommendation(recommendation: FollowUpRecommendation) {
    const lead = recommendation.leadId ? leads.find(item => item.id === recommendation.leadId) : undefined;
    if (lead && recommendation.id.startsWith("lead-due-")) return { title: t("crm.screen.followLead", { name: lead.contactName }), detail: [label(lead.category, "crm"), label(lead.status, "crm"), screen.due(lead.dueDate)].join(" · ") };
    if (lead && recommendation.id.startsWith("lead-action-")) return { title: t("crm.screen.defineAction", { name: lead.contactName }), detail: t("crm.screen.noAction", { category: label(lead.category, "crm"), status: label(label(lead.status, "crm"), "crm") }) };
    const quoteId = recommendation.id.replace(/^quote-(sent|accepted)-/, "");
    const quote = quotes.find(item => item.id === quoteId);
    if (quote && recommendation.id.startsWith("quote-sent-")) return { title: t("crm.screen.followQuote", { name: quote.clientName }), detail: t("crm.counts.daysSent", { title: quote.title || t("crm.enums.quote"), count: getQuoteStatusAgeDays(quote) }) };
    if (quote && recommendation.id.startsWith("quote-accepted-")) return { title: t("crm.screen.acceptedNext", { name: quote.clientName }), detail: t("crm.screen.acceptedDetail", { title: quote.title || t("crm.screen.acceptedQuote") }) };
    return recommendation;
  }

  const recommendations = useMemo<FollowUpRecommendation[]>(() => {
    const items: FollowUpRecommendation[] = [];

    const openTaskLeadIds = new Set(
      tasks
        .filter((task) => task.status !== "Terminé" && effectiveTaskLeadId(task))
        .map(effectiveTaskLeadId)
    );

    leads.forEach((lead) => {
      if (lead.status === "Gagné" || lead.status === "Perdu") return;

      const hasOpenTask = openTaskLeadIds.has(lead.id);
      const dueStatus = getDueStatus(lead.dueDate);

      if (!hasOpenTask && (dueStatus === "overdue" || dueStatus === "today")) {
        items.push({
          id: `lead-due-${lead.id}`,
          title: `Relancer ${lead.contactName}`,
          detail: `${lead.category} · ${lead.status} · ${getDueLabel(lead.dueDate)}`,
          priority: dueStatus === "overdue" ? "Haute" : "Moyenne",
          leadId: lead.id
        });
      }

      if (!hasOpenTask && !lead.nextAction?.trim()) {
        items.push({
          id: `lead-action-${lead.id}`,
          title: `Définir la prochaine action pour ${lead.contactName}`,
          detail: `${lead.category} · ${lead.status} · aucune prochaine action renseignée`,
          priority: "Moyenne",
          leadId: lead.id
        });
      }
    });

    quotes.forEach((quote) => {
      const status = getQuoteStatus(quote.status);
      const ageDays = getQuoteStatusAgeDays(quote);

      if (status === "Sent" && ageDays >= 2) {
        items.push({
          id: `quote-sent-${quote.id}`,
          title: `Relancer le devis de ${quote.clientName}`,
          detail: `${quote.title || "Devis"} · envoyé depuis ${ageDays} jour${ageDays > 1 ? "s" : ""}`,
          priority: "Haute"
        });
      }

      if (status === "Accepted") {
        items.push({
          id: `quote-accepted-${quote.id}`,
          title: `Organiser la suite pour ${quote.clientName}`,
          detail: `${quote.title || "Devis accepté"} · préparer confirmation, paiement et logistique`,
          priority: "Haute"
        });
      }
    });

    return items.slice(0, 20);
  }, [leads, tasks, quotes]);

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow" data-semantic-text={"Relances recommandées"}>{t("crm.followUps.b1971b8fa2")}</p>
          <h3>{t("crm.counts.actions", { count: recommendations.length })}</h3>
        </div>
      </div>

      <div className="list-stack oar-contact-list-stack">
        {recommendations.length === 0 ? (<p className="muted-line">{t("crm.followUps.a16b9a541c")}</p>) : (recommendations.map((recommendation) => (
            <article className="mini-row" key={recommendation.id}>
              <div>
                <strong>{displayRecommendation(recommendation).title}</strong>
                <span>{displayRecommendation(recommendation).detail}</span>
              </div>

              <div className="quote-actions">
                <Badge>{label(recommendation.priority, "crm")}</Badge>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onCreateTask(recommendation)}
                 data-crm-auto-scroll="true">{t("crm.followUps.4aff416a21")}</button>
              </div>
            </article>
          )))}
      </div>
    </section>
  );
}


function Dashboard({
  stats,
  data,
  onLeadStatusChange,
  onTaskStatusChange,
  onStartMessage,
  onStartContactLead,
  onStartInventory,
  onShowLeads,
  onCloudBackup,
  onDashboardAction
}: {
  stats: { pipeline: number; won: number; openTasks: number; availableProperties: number };
  data: CRMData;
  onLeadStatusChange: (id: string, status: LeadStatus) => void;
  onTaskStatusChange: (id: string, status: TaskStatus) => void;
  onStartMessage: () => void;
  onStartContactLead: () => void;
  onStartInventory: () => void;
  onShowLeads: () => void;
  onCloudBackup: () => void;
  onDashboardAction: (tab: Tab, targetId?: string) => void;
}) {
  const { t, label, screen } = useCRMDisplay();

  const business = useBusinessPermissions();
  type DashboardItem = {
    id: string;
    title: string;
    detail: string;
    badge?: string;
    tone?: "neutral" | "warning" | "danger" | "success";
    tab?: Tab;
    targetId?: string;
    action?: () => void;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = formatPlanningDateValue(today);

  function parseDashboardDate(dateText?: string) {
    if (!dateText) return null;
    const date = new Date(`${dateText}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function daysFromToday(dateText?: string) {
    const date = parseDashboardDate(dateText);
    if (!date) return null;
    return Math.round((date.getTime() - today.getTime()) / 86400000);
  }

  function isWithinNextDays(dateText: string | undefined, days: number) {
    const diff = daysFromToday(dateText);
    return diff !== null && diff >= 0 && diff <= days;
  }

  function paymentRemaining(quote: QuoteRequest) {
    const total = getQuoteTotal(quote);
    const paid = Number(quote.depositReceived || 0) + Number(quote.balanceReceived || 0);
    return Math.max(total - paid, 0);
  }

  function quoteMargin(quote: QuoteRequest) {
    return getQuoteTotal(quote) - Number(quote.supplierCost || 0);
  }

  function shortDate(dateText?: string) {
    if (!dateText) return "Date à compléter";
    return formatQuoteDate(dateText);
  }

  function renderDashboardList(items: DashboardItem[], emptyText: string, limit = 5) {
    const visibleItems = items.filter(item => !business || !item.tab || business.read(item.tab as import("@/lib/access/modules").ModuleId)).slice(0, limit);

    if (visibleItems.length === 0) {
      return <p className="muted-line dashboard-command-empty">{emptyText}</p>;
    }

    return (
      <div className="dashboard-command-list">
        {visibleItems.map((item) => {
          const isClickable = Boolean(item.action || item.tab);
          const rowClassName = `dashboard-command-row tone-${item.tone || "neutral"} ${isClickable ? "is-clickable" : ""}`;
          const rowContent = (
            <>
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
              {item.badge ? <Badge>{item.badge}</Badge> : null}
            </>
          );

          if (!isClickable) {
            return <article className={rowClassName} key={item.id}>{rowContent}</article>;
          }

          return (
            <BusinessButton
              className={rowClassName}
              key={item.id}
              type="button"
              onClick={() => item.action ? item.action() : item.tab ? onDashboardAction(item.tab, item.targetId) : undefined}
              title={t("crm.dashboard.5f7c434e7c")}
            >
              {rowContent}
            </BusinessButton>
          );
        })}
      </div>
    );
  }



  const quotes = mergeQuoteRequests((((data as any).quotes ?? []) as QuoteRequest[]), business ? [] : loadSavedQuotes());
  const confirmedBookings: QuoteRequest[] = business ? ((data as any).bookings ?? []) : quotes.filter((quote) => getQuoteStatus(quote.status) === "Accepted");
  const planningEntries = (((data as any).planningEntries ?? []) as PlanningEntry[]);
  const vendorInvoices = (((data as any).vendorInvoices ?? []) as VendorInvoice[]);
  const documents = (((data as any).documents ?? []) as CRMDocument[]);
  const houseTimeEntries = (((data as any).houseTimeEntries ?? []) as HouseTimeEntry[]);
  const housePayments = (((data as any).housePayments ?? []) as HousePayment[]);
  const houseTrackingWorkers = (((data as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]);
  const activeHouseWorkerIds = new Set(houseTrackingWorkers.filter(isHouseTrackingWorkerActive).map((worker) => worker.id));

  const unpaidVendorInvoices = vendorInvoices.filter((invoice) =>
    invoice.status !== "Payé" && invoice.status !== "Annulé" && getVendorInvoiceRemaining(invoice) > 0
  );
  const overdueVendorInvoices = unpaidVendorInvoices.filter((invoice) =>
    invoice.status === "En retard" || ((daysFromToday(invoice.dueDate) ?? 0) < 0)
  );
  const vendorAmountToPay = getVendorInvoiceTotalRemaining(unpaidVendorInvoices);

  const houseDueByWorker = new Map<string, { workerName: string; due: number }>();
  houseTimeEntries.filter((entry) => activeHouseWorkerIds.has(entry.workerId)).forEach((entry) => {
    const key = entry.workerId || entry.workerName || entry.id;
    const current = houseDueByWorker.get(key) || { workerName: entry.workerName || "Intervenant", due: 0 };
    current.due += getHouseTimeAmount(entry);
    houseDueByWorker.set(key, current);
  });
  housePayments.filter((payment) => activeHouseWorkerIds.has(payment.workerId)).forEach((payment) => {
    const key = payment.workerId || payment.workerName || payment.id;
    const current = houseDueByWorker.get(key) || { workerName: payment.workerName || "Intervenant", due: 0 };
    current.due -= Number(payment.amount || 0);
    houseDueByWorker.set(key, current);
  });
  const houseDueItems = Array.from(houseDueByWorker.values())
    .filter((item) => item.due > 0.5)
    .sort((a, b) => b.due - a.due);
  const houseAmountToPay = houseDueItems.reduce((sum, item) => sum + item.due, 0);

  const clientPaymentsToFollow = confirmedBookings.filter((quote) => {
    const status = quote.paymentStatus || "Non payé";
    return status !== "Payé" && status !== "Annulé / remboursé" && paymentRemaining(quote) > 0;
  });
  const clientPaymentsLate = clientPaymentsToFollow.filter((quote) => {
    const diff = daysFromToday(quote.paymentDueDate);
    return diff !== null && diff < 0;
  });
  const clientAmountToReceive = clientPaymentsToFollow.reduce((sum, quote) => sum + paymentRemaining(quote), 0);
  const supplierAmountToPay = sumEuroAmounts([vendorAmountToPay, houseAmountToPay]);
  const paymentsBalance = sumEuroAmounts([
    clientAmountToReceive,
    -vendorAmountToPay,
    -houseAmountToPay
  ]);

  const confirmedRevenue = confirmedBookings.reduce((sum, quote) => sum + getQuoteTotal(quote), 0);
  const estimatedMargin = confirmedBookings.reduce((sum, quote) => sum + quoteMargin(quote), 0);

  const todayPlanning = planningEntries
    .filter((entry) => {
      const status = getPlanningEntryStatus(entry);
      return status !== "Annulé" && planningRangesOverlap(todayIso, todayIso, entry.startDate, entry.endDate || entry.startDate);
    })
    .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));

  const activePlanning = planningEntries.filter((entry) => getPlanningEntryStatus(entry) === "En cours");
  const blockingPlanning = planningEntries.filter((entry) => {
    const status = getPlanningEntryStatus(entry);
    return entry.blocksAvailability && status !== "Terminé" && status !== "Annulé";
  });
  const planningWithoutContact = planningEntries.filter((entry) => {
    const status = getPlanningEntryStatus(entry);
    return status !== "Terminé" && status !== "Annulé" && !String(entry.contactName || "").trim();
  });

  const bookingsToPrepare = confirmedBookings
    .filter((quote) => {
      const bookingStatus = quote.bookingStatus || "À préparer";
      return bookingStatus !== "Terminé" && bookingStatus !== "Annulé";
    })
    .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));

  const upcomingBookings = bookingsToPrepare.filter((quote) => isWithinNextDays(quote.startDate, 14));

  const quotesToFollow = quotes
    .filter((quote) => {
      const status = getQuoteStatus(quote.status);
      const ageDays = getQuoteAgeDays(quote.statusUpdatedAt || quote.createdAt);
      return (status === "Sent" && ageDays >= 1) || status === "Negotiation";
    })
    .sort((a, b) => getQuoteAgeDays(b.statusUpdatedAt || b.createdAt) - getQuoteAgeDays(a.statusUpdatedAt || a.createdAt));

  const leadsToTreat = data.leads
    .filter((lead) => lead.status !== "Gagné" && lead.status !== "Perdu")
    .filter((lead) => !lead.nextAction || !lead.dueDate || ((daysFromToday(lead.dueDate) ?? 99) <= 1))
    .sort((a, b) => {
      const priorityScore = { Haute: 3, Moyenne: 2, Basse: 1 } as Record<string, number>;
      return (priorityScore[b.priority] || 0) - (priorityScore[a.priority] || 0);
    });

  const availableProperties = data.properties.filter((property) => property.status === "Disponible");
  const availableVehicles = data.vehicles.filter((vehicle) => vehicle.status === "Disponible");
  const availableBoats = data.boats.filter((boat) => boat.status === "Disponible");
  const assetsInMaintenance = [
    ...data.vehicles.filter((vehicle) => vehicle.status === "En maintenance").map((vehicle) => vehicle.name),
    ...data.boats.filter((boat) => boat.status === "En maintenance").map((boat) => boat.name)
  ];

  const contactsIncomplete = business ? [] : data.contacts.filter((contact) => !contact.email || !contact.phone);
  const leadsWithoutBudget = data.leads.filter((lead) => lead.status !== "Gagné" && lead.status !== "Perdu" && Number(lead.value || 0) <= 0);
  const documentsToCheck = documents.filter((document) => !document.isFolder && document.status !== "À jour");

  const urgentItems: DashboardItem[] = [
    ...overdueVendorInvoices.slice(0, 3).map((invoice) => ({
      id: `vendor-late-${invoice.id}`,
      title: t("crm.dashboard.3dd08c5734"),
      detail: t("crm.dashboard.7b80e99c68", { value1: displayValue(invoice.contactName || invoice.title), value2: displayValue(screen.euro(getVendorInvoiceRemaining(invoice))) }),
      badge: t("crm.dashboard.040413ac34"),
      tone: "danger" as const,
      tab: "vendorInvoices" as Tab,
      targetId: `vendor-invoice-${invoice.id}`
    })),
    ...clientPaymentsLate.slice(0, 2).map((quote) => ({
      id: `client-payment-late-${quote.id}`,
      title: t("crm.dashboard.d8e36b3a27"),
      detail: t("crm.dashboard.7b80e99c68", { value1: displayValue(quote.clientName), value2: displayValue(screen.money(paymentRemaining(quote))) }),
      badge: t("crm.dashboard.0c77fe09ab"),
      tone: "danger" as const,
      tab: "bookings" as Tab,
      targetId: `booking-${quote.id}`
    })),
    ...blockingPlanning.slice(0, 2).map((entry) => ({
      id: `planning-blocking-${entry.id}`,
      title: t("crm.dashboard.f3c18e799d"),
      detail: t("crm.dashboard.7c639bc99b", { value1: displayValue(entry.title), value2: displayValue(entry.startDate || t("crm.enums.dateRequired")) }),
      badge: getPlanningEntryStatus(entry),
      tone: "warning" as const,
      tab: "planning" as Tab,
      targetId: `planning-${entry.id}`
    })),
    ...houseDueItems.slice(0, 2).map((item, index) => ({
      id: `house-due-${index}-${item.workerName}`,
      title: t("crm.dashboard.d84793b512"),
      detail: t("crm.dashboard.7c639bc99b", { value1: displayValue(item.workerName), value2: displayValue(screen.money(item.due)) }),
      badge: t("crm.dashboard.f86724b3a3"),
      tone: "warning" as const,
      tab: "houseTracking" as Tab
    }))
  ];

  const vendorInvoiceAlertItems: DashboardItem[] = unpaidVendorInvoices
    .slice()
    .sort((a, b) => {
      const aLate = overdueVendorInvoices.some((invoice) => invoice.id === a.id) ? 1 : 0;
      const bLate = overdueVendorInvoices.some((invoice) => invoice.id === b.id) ? 1 : 0;

      if (aLate !== bLate) return bLate - aLate;
      return getVendorInvoiceRemaining(b) - getVendorInvoiceRemaining(a);
    })
    .map((invoice) => {
      const isLate = overdueVendorInvoices.some((lateInvoice) => lateInvoice.id === invoice.id);

      return {
        id: `vendor-alert-${invoice.id}`,
        title: isLate ? t("crm.dashboard.3dd08c5734") : t("crm.dashboard.cbd8f228ea"),
        detail: t("crm.dashboard.7b80e99c68", { value1: displayValue(invoice.contactName || invoice.title), value2: displayValue(screen.euro(getVendorInvoiceRemaining(invoice))) }),
        badge: isLate ? t("crm.dashboard.040413ac34") : t("crm.dashboard.f86724b3a3"),
        tone: isLate ? "danger" as const : "warning" as const,
        tab: "vendorInvoices" as Tab,
        targetId: `vendor-invoice-${invoice.id}`
      };
    });
const todayItems: DashboardItem[] = todayPlanning.map((entry) => ({
    id: `today-${entry.id}`,
    title: t("crm.dashboard.e34da93361", { value1: displayValue(entry.startTime || t("crm.enums.day")), value2: displayValue(entry.endTime ? ` → ${entry.endTime}` : ""), value3: displayValue(entry.title) }),
    detail: t("crm.dashboard.9989fa2d2c", { value1: displayValue(entry.contactName || t("crm.planning.9fa7db0383")), value2: displayValue(entry.notes ? ` · ${entry.notes}` : "") }),
    badge: getPlanningEntryStatus(entry),
    tone: getPlanningEntryStatus(entry) === "En cours" ? "warning" : getPlanningEntryStatus(entry) === "Terminé" ? "success" : "neutral",
    tab: "planning" as Tab,
    targetId: `planning-${entry.id}`
  }));

  const moneyItems: DashboardItem[] = [
    supplierAmountToPay > 0 ? {
      id: "money-supplier-payments",
      title: t("crm.dashboard.21bbf7e76d", { value1: displayValue(screen.euro(supplierAmountToPay)) }),
      detail: t("crm.dashboard.c235e2597b", { value1: displayValue(unpaidVendorInvoices.length), value2: displayValue(houseDueItems.length) }),
      badge: t("crm.dashboard.987ce358af"),
      tone: supplierAmountToPay > 0 ? "warning" as const : "neutral" as const,
      action: () => onDashboardAction(vendorAmountToPay > 0 ? "vendorInvoices" : "houseTracking")
    } : null,
    clientAmountToReceive > 0 ? {
      id: "money-client-payments",
      title: t("crm.dashboard.953022dd27", { value1: displayValue(screen.money(clientAmountToReceive)) }),
      detail: t("crm.dashboard.d050477aef", { value1: displayValue(clientPaymentsToFollow.length) }),
      badge: t("crm.dashboard.d9c7efe130"),
      tone: clientPaymentsLate.length > 0 ? "danger" as const : "warning" as const,
      tab: "bookings" as Tab
    } : null,
    {
      id: "money-confirmed-margin",
      title: t("crm.dashboard.d941051dd4", { value1: displayValue(screen.money(estimatedMargin)) }),
      detail: t("crm.dashboard.014516e1f9", { value1: displayValue(screen.money(confirmedRevenue)) }),
      badge: t("crm.dashboard.1278c77084"),
      tone: confirmedRevenue > 0 ? "success" as const : "neutral" as const,
      tab: "bookings" as Tab
    }
  ].filter(Boolean) as DashboardItem[];

  const bookingItems: DashboardItem[] = upcomingBookings.map((quote) => ({
    id: `booking-upcoming-${quote.id}`,
    title: t("crm.dashboard.7c639bc99b", { value1: displayValue(quote.clientName), value2: displayValue(quote.title || t("crm.enums.booking")) }),
    detail: t("crm.dashboard.cf0b450d49", { value1: displayValue(shortDate(quote.startDate)), value2: displayValue(shortDate(quote.endDate)), value3: displayValue(label(quote.bookingStatus, "crm") || "À préparer") }),
    badge: paymentRemaining(quote) > 0 ? t("crm.dashboard.5d9e9e44e1") : t("crm.dashboard.565339bc4d"),
    tone: paymentRemaining(quote) > 0 ? "warning" as const : "success" as const,
    tab: "bookings" as Tab,
    targetId: `booking-${quote.id}`
  }));

  const commercialItems: DashboardItem[] = [
    ...leadsToTreat.slice(0, 3).map((lead) => ({
      id: `lead-treat-${lead.id}`,
      title: t("crm.dashboard.7c639bc99b", { value1: displayValue(lead.contactName || t("crm.enums.noContact")), value2: displayValue(lead.category) }),
      detail: t("crm.dashboard.7c639bc99b", { value1: displayValue(lead.nextAction || t("crm.enums.actionRequired")), value2: displayValue(screen.money(Number(lead.value || 0))) }),
      badge: lead.priority,
      tone: lead.priority === "Haute" ? "danger" as const : "warning" as const,
      tab: "leads" as Tab,
      targetId: `lead-${lead.id}`
    })),
    ...quotesToFollow.slice(0, 3).map((quote) => ({
      id: `quote-follow-${quote.id}`,
      title: t("crm.dashboard.f313f37238", { value1: displayValue(quote.clientName) }),
      detail: t("crm.dashboard.7c639bc99b", { value1: displayValue(label(getQuoteStatusFrenchLabel(getQuoteStatus(label(quote.status, "crm"))), "crm")), value2: displayValue(screen.money(getQuoteTotal(quote))) }),
      badge: t("crm.dashboard.44c4105cc3"),
      tone: "warning" as const,
      tab: "quotes" as Tab,
      targetId: `quote-${quote.id}`
    }))
  ];

  const planningItems: DashboardItem[] = [
    activePlanning.length > 0 ? {
      id: "planning-active",
      title: t("crm.dashboard.970c1cc56c", { value1: displayValue(activePlanning.length) }),
      detail: activePlanning.slice(0, 2).map((entry) => entry.title).join(" · "),
      badge: t("crm.dashboard.797f5dcd02"),
      tone: "warning" as const,
      tab: "planning" as Tab
    } : null,
    blockingPlanning.length > 0 ? {
      id: "planning-blocking-count",
      title: t("crm.dashboard.4f158d2727", { value1: displayValue(blockingPlanning.length) }),
      detail: t("crm.dashboard.9ea83b55e2"),
      badge: t("crm.dashboard.d95dc51829"),
      tone: "danger" as const,
      tab: "planning" as Tab
    } : null,
    planningWithoutContact.length > 0 ? {
      id: "planning-no-contact",
      title: t("crm.dashboard.46195595dd", { value1: displayValue(planningWithoutContact.length) }),
      detail: t("crm.dashboard.41eb635b1a"),
      badge: t("crm.dashboard.6ef4db3c1d"),
      tone: "warning" as const,
      tab: "planning" as Tab
    } : null
  ].filter(Boolean) as DashboardItem[];

  const availabilityItems: DashboardItem[] = [
    {
      id: "availability-properties",
      title: t("crm.dashboard.b45d0882f1", { value1: displayValue(availableProperties.length) }),
      detail: availableProperties.slice(0, 3).map((property) => property.name).join(" · ") || t("crm.dashboard.ced203b87e"),
      badge: t("crm.dashboard.aead050ab9"),
      tone: availableProperties.length > 0 ? "success" : "neutral",
      tab: "properties" as Tab
    },
    {
      id: "availability-vehicles-boats",
      title: t("crm.dashboard.35b215bdc3", { value1: displayValue(availableVehicles.length + availableBoats.length) }),
      detail: t("crm.dashboard.911dcad3e9", { value1: displayValue(availableVehicles.length), value2: displayValue(availableBoats.length) }),
      badge: t("crm.dashboard.9eaa2a1e77"),
      tone: availableVehicles.length + availableBoats.length > 0 ? "success" : "neutral",
      action: () => onDashboardAction(availableVehicles.length > 0 ? "vehicles" : "boats")
    },
    assetsInMaintenance.length > 0 ? {
      id: "availability-maintenance",
      title: t("crm.dashboard.db891ae96c", { value1: displayValue(assetsInMaintenance.length) }),
      detail: assetsInMaintenance.slice(0, 3).join(" · "),
      badge: t("crm.dashboard.17ccfa5b68"),
      tone: "warning" as const,
      action: () => onDashboardAction("vehicles" as Tab)
    } : null
  ].filter(Boolean) as DashboardItem[];

  const dataQualityItems: DashboardItem[] = [
    contactsIncomplete.length > 0 ? {
      id: "quality-contacts",
      title: t("crm.dashboard.1888d14b10", { value1: displayValue(contactsIncomplete.length) }),
      detail: t("crm.dashboard.11dda8efb7"),
      badge: t("crm.dashboard.b450645deb"),
      tone: "warning" as const,
      tab: "contacts" as Tab
    } : null,
    leadsWithoutBudget.length > 0 ? {
      id: "quality-leads-budget",
      title: t("crm.dashboard.5f886080b0", { value1: displayValue(leadsWithoutBudget.length) }),
      detail: t("crm.dashboard.000e8b73ad"),
      badge: t("crm.dashboard.7bcb6fb014"),
      tone: "warning" as const,
      tab: "leads" as Tab
    } : null,
    documentsToCheck.length > 0 ? {
      id: "quality-documents",
      title: t("crm.dashboard.9f3e037119", { value1: displayValue(documentsToCheck.length) }),
      detail: documentsToCheck.slice(0, 3).map((document) => document.title).join(" · "),
      badge: t("crm.dashboard.7af023c430"),
      tone: "warning" as const,
      tab: "documents" as Tab
    } : null
  ].filter(Boolean) as DashboardItem[];

  return (
    <div className="stack dashboard-workspace dashboard-command-center">
      <div className="dashboard-command-hero">
        <section className="card dashboard-command-summary-card">
          <p className="eyebrow" data-semantic-text={"Vue rapide"}>{t("crm.dashboard.aa4b970347")}</p>
          <h3>{t("crm.dashboard.5da9dc9041")}</h3>
          <p className="muted-line">{t("crm.dashboard.894a73fb8c")}</p>
        </section>

        <div className="dashboard-command-kpis">
          <DashboardQuickTile moduleId="vendorInvoices" label={t("crm.dashboard.f8569bf0fb")} value={String(vendorInvoiceAlertItems.length)} caption={t("crm.dashboard.e3ba7d2e9c")} onClick={() => {
            const firstUrgent = vendorInvoiceAlertItems.find((item) => item.action || item.tab);
            if (firstUrgent?.action) firstUrgent.action();
            else if (firstUrgent?.tab) onDashboardAction(firstUrgent.tab, firstUrgent.targetId);
            else onDashboardAction("vendorInvoices" as Tab);
          }} />
          <DashboardQuickTile moduleId="planning" label={t("crm.dashboard.f2de9e072a")} value={String(todayPlanning.length)} caption={t("crm.dashboard.358029e806")} onClick={() => onDashboardAction("planning" as Tab)} />
          <DashboardQuickTile moduleId="houseTracking" label={t("crm.dashboard.3453f57f66")} value={screen.money(houseAmountToPay)} caption={t("crm.dashboard.d332e9d924")} onClick={() => onDashboardAction("houseTracking" as Tab)} />
          <DashboardQuickTile moduleId="bookings" label={t("crm.dashboard.dbdbf99dae")} value={screen.money(clientAmountToReceive)} caption={t("crm.dashboard.4e1ae32840")} onClick={() => onDashboardAction("bookings" as Tab)} />
        </div>
      </div>

      <div className="dashboard-command-grid dashboard-command-grid-priority">
        <DashboardCommandCard moduleIds={["vendorInvoices"]} eyebrow={t("crm.dashboard.e3ba7d2e9c")} title={t("crm.dashboard.f8569bf0fb")} summary={t("crm.counts.invoiceCount", { count: vendorInvoiceAlertItems.length })} tone={vendorInvoiceAlertItems.some((item) => item.tone === "danger") ? "danger" : vendorInvoiceAlertItems.length > 0 ? "warning" : "success"}>
          {renderDashboardList(vendorInvoiceAlertItems, t("crm.dashboard.2f1074767b"), 6)}
        </DashboardCommandCard>

        <DashboardCommandCard moduleIds={["planning"]} eyebrow={t("crm.dashboard.f2de9e072a")} title={t("crm.dashboard.acf6043014")} summary={t("crm.counts.itemCount", { count: todayPlanning.length })} tone={activePlanning.length > 0 ? "warning" : "neutral"}>
          {renderDashboardList(todayItems, t("crm.dashboard.70bb237063"), 6)}
        </DashboardCommandCard>

        <DashboardCommandCard moduleIds={["bookings", "vendorInvoices", "houseTracking"]} eyebrow={t("crm.dashboard.eb38f871c5")} title={t("crm.dashboard.8c4e895090")} summary={screen.euro(paymentsBalance)} tone={clientPaymentsLate.length > 0 || overdueVendorInvoices.length > 0 ? "danger" : "neutral"}>
          {renderDashboardList(moneyItems, t("crm.dashboard.1b97272abc"), 5)}
        </DashboardCommandCard>
      </div>

      <div className="dashboard-command-grid">
        <DashboardCommandCard moduleIds={["bookings"]} eyebrow={t("crm.dashboard.9cc256a335")} title={t("crm.dashboard.4e8718301a")} summary={t("crm.counts.upcomingCount", { count: upcomingBookings.length })}>
          {renderDashboardList(bookingItems, t("crm.dashboard.2c9b68e9f7"), 5)}
        </DashboardCommandCard>

        <DashboardCommandCard moduleIds={["leads", "quotes"]} eyebrow={t("crm.dashboard.ea7d0b7634")} title={t("crm.dashboard.2129f1f69e")} summary={t("crm.counts.topicCount", { count: commercialItems.length })}>
          {renderDashboardList(commercialItems, t("crm.dashboard.4d4e4cd211"), 6)}
          <div className="dashboard-command-actions">
            <BusinessButton disabled={Boolean(business&&!business.read("leads"))} className="secondary-button compact-button" type="button" onClick={onShowLeads} data-crm-auto-scroll="true">{t("crm.dashboard.9f95a9e15b")}</BusinessButton>
            <BusinessButton disabled={Boolean(business&&(!business.canWrite("contacts")||!business.canWrite("leads")))} className="secondary-button compact-button" type="button" onClick={onStartMessage} data-crm-auto-scroll="true">{t("crm.dashboard.b3b4c2ca9d")}</BusinessButton>
          </div>
        </DashboardCommandCard>
      </div>

      <div className="dashboard-command-grid dashboard-command-grid-control">
        <DashboardCommandCard moduleIds={["planning"]} eyebrow={t("crm.dashboard.21cc305095")} title={t("crm.dashboard.ac2064ecc2")} summary={t("crm.counts.pointCount", { count: planningItems.length })} tone={blockingPlanning.length > 0 ? "danger" : planningItems.length > 0 ? "warning" : "success"}>
          {renderDashboardList(planningItems, t("crm.dashboard.832931f7e2"), 5)}
        </DashboardCommandCard>

        <DashboardCommandCard moduleIds={["properties", "vehicles", "boats"]} eyebrow={t("crm.dashboard.f13a7f6816")} title={t("crm.dashboard.deeefa0dc4")} summary={t("crm.counts.assetCount", { count: availableProperties.length + availableVehicles.length + availableBoats.length })}>
          {renderDashboardList(availabilityItems, t("crm.dashboard.b45004cea7"), 5)}
        </DashboardCommandCard>

        <DashboardCommandCard moduleIds={[]} eyebrow={t("crm.dashboard.6ef4db3c1d")} title={t("crm.dashboard.3160128ee8")} summary={t("crm.counts.topicCount", { count: dataQualityItems.length })} tone={dataQualityItems.length > 0 ? "warning" : "success"}>
          {renderDashboardList(dataQualityItems, t("crm.dashboard.ee25f4bd34"), 5)}
        </DashboardCommandCard>
      </div>
    </div>
  );
}


function StatCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{caption}</p>
    </article>
  );
}

/** Every identity input stays mounted when the draft nature or UI language changes. */
function ContactIdentityFields({ contact, entityType, onEntityTypeChange, issue, onIssue, prefix }: {
  contact?: Contact;
  entityType: string;
  onEntityTypeChange: (value: string) => void;
  issue: ContactIdentityValidation | null;
  onIssue: (issue: ContactIdentityValidation | null) => void;
  prefix: "contact-create" | "contact-edit";
}) {
  const { t } = useI18n();
  const company = entityType === "company";
  const errorId = (field: ContactIdentityValidation["field"]) => `${prefix}-${field}-error`;
  const error = (field: ContactIdentityValidation["field"]) => issue?.field === field
    ? <span className="contact-field-error" id={errorId(field)} role="alert">{t(`crm.contacts.validation.${issue.code}`)}</span> : null;
  const invalid = (field: ContactIdentityValidation["field"], code: ContactIdentityValidation["code"]) => (event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement>) => {
    event.preventDefault(); onIssue({ field, code }); event.currentTarget.focus();
  };
  return <div className="contact-identity-fields" onChange={() => onIssue(null)}>
    <BusinessLabel className="full">{t("crm.contacts.entityType.label")}
      <select name="entityType" value={entityType} onChange={event => onEntityTypeChange(event.target.value)}
        required={!contact || contact.entityType !== undefined}
        aria-invalid={issue?.field === "entityType" || undefined} aria-describedby={issue?.field === "entityType" ? errorId("entityType") : undefined}
        onInvalid={invalid("entityType", "contact_entity_type_invalid")}>
        {contact && <option value="">{t("crm.contacts.entityType.unqualified")}</option>}
        <option value="person">{t("crm.contacts.entityType.person")}</option>
        <option value="company">{t("crm.contacts.entityType.company")}</option>
      </select>{error("entityType")}
    </BusinessLabel>
    <BusinessLabel className="full">{t(company ? "crm.contacts.identity.companyNameRequired" : "crm.contacts.identity.companyAffiliationOptional")}
      <input name="companyName" defaultValue={contact?.companyName ?? ""} required={company}
        aria-invalid={issue?.field === "companyName" || undefined} aria-describedby={issue?.field === "companyName" ? errorId("companyName") : undefined}
        onInvalid={invalid("companyName", "contact_company_name_required")} />{error("companyName")}
    </BusinessLabel>
    <p className="contact-person-heading full" hidden={!company}>{t("crm.contacts.identity.contactPersonOptional")}</p>
    <BusinessLabel>{t("crm.contacts.901ce24cca")}<select name="civility" defaultValue={contact?.civility ?? ""}>
      <option value="">—</option><option value="M">{t("crm.contacts.08f271887c")}</option><option value="MME">{t("crm.contacts.97c3250ed4")}</option>
    </select></BusinessLabel>
    <BusinessLabel>{t("crm.contacts.e325bf8f90")}<input name="firstName" defaultValue={contact?.firstName ?? ""} /></BusinessLabel>
    <BusinessLabel className="full">{t(entityType === "person" ? "crm.contacts.identity.lastNameRequired" : "crm.contacts.identity.lastNameOptional")}
      <input name="name" defaultValue={contact?.name ?? ""} required={entityType === "person"}
        aria-invalid={issue?.field === "name" || undefined} aria-describedby={issue?.field === "name" ? errorId("name") : undefined}
        onInvalid={invalid("name", "contact_name_required")} />{error("name")}
    </BusinessLabel>
  </div>;
}

function ContactsView({
  access,
  focusContactId,
  actor,
  contacts,
  query = "",
  leads,
  tasks,
  onAdd,
  onUpdate,
  onDelete,
  onCreateLead,
  onCreateTask,
  onDraftStateChange
}: {
  access?: AccessSnapshot;
  focusContactId?: string;
  actor: string;
  contacts: Contact[];
  query?: string;
  leads: Lead[];
  tasks: Task[];
  onAdd: (event: React.FormEvent<HTMLFormElement>) => FormSave;
  onUpdate: (contact: Pick<Contact, "id"> & Partial<Contact>) => FormSave;
  onDelete: (id: string) => void | Promise<void>;
  onCreateLead: (contactName: string) => void;
  onCreateTask: (contactName: string, contactId?: string) => void;
  onDraftStateChange?: (dirty: boolean) => void;
}) {
  const { t, label, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  function retainContactDraft() { business?.markDirty?.(); onDraftStateChange?.(true); }
  const creation = useConfirmedForm(retainContactDraft);
  const [creationRecordId,setCreationRecordId] = useState<string|null>(null);
  const edition = useConfirmedForm(retainContactDraft);
  const changedContactFields = useRef(new Set<string>());
  const [contactFilter, setContactFilter] = useState("Tous");
  const [supplierCategoryFilter, setSupplierCategoryFilter] = useState("Toutes");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(() => contacts.find(contact => contact.id === focusContactId) ?? null);
  const [newContactKind, setNewContactKind] = useState<ContactKind>("Client");
  const [editingContactKind, setEditingContactKind] = useState<ContactKind>("Client");
  const [newContactEntityType, setNewContactEntityType] = useState("person");
  const [editingContactEntityType, setEditingContactEntityType] = useState("");
  const [creationIdentityError, setCreationIdentityError] = useState<ContactIdentityValidation | null>(null);
  const [editingIdentityError, setEditingIdentityError] = useState<ContactIdentityValidation | null>(null);
  const creationForm = useRef<HTMLFormElement>(null);
  const editingForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (creationIdentityError && !creation.saving) creationForm.current?.querySelector<HTMLElement>(`[name="${creationIdentityError.field}"]`)?.focus();
  }, [creationIdentityError, creation.saving]);
  useEffect(() => {
    if (editingIdentityError && !edition.saving) editingForm.current?.querySelector<HTMLElement>(`[name="${editingIdentityError.field}"]`)?.focus();
  }, [editingIdentityError, edition.saving]);


  const filterOptions = ["Tous", "Clients", "Prestataires", "Propriétaires", "Membres de l’organisation"];
  const nonSupplierRelationshipStatuses = contactRelationshipStatuses.filter((status) => status !== "Prestataire");
  const supplierProfessionOptions = useMemo(() => {
    const legacyAssetCategories = new Set(["Villa", "Voiture", "Bateau"]);
    const savedProfessions = contacts
      .map((contact) => String(contact.supplierCategory || "").trim())
      .filter((profession) => Boolean(profession) && !legacyAssetCategories.has(profession));
    return Array.from(new Set([...supplierCategories, ...savedProfessions, ...(supplierCategoryFilter === "Toutes" ? [] : [supplierCategoryFilter])]));
  }, [contacts, supplierCategoryFilter]);

  function getContactDisplayName(contact: Contact) {
    return getContactLabel(contact);
  }

  function getContactActionLabel(contact: Contact) {
    return getContactLabel(contact, t("crm.contacts.576d508976"));
  }

  function normalizeKind(value: unknown): ContactKind {
    const raw = String(value || "Client");
    return raw === "Membre de l’organisation" ? raw : raw === "Partenaire" || raw === "Prestataire" ? "Prestataire" : raw === "Propriétaire" ? "Propriétaire" : "Client";
  }

  function normalizeContactLookupKey(value?: string | number | null) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function getContactLeads(contact: Contact) {
    const labels = [contact.name, getContactDisplayName(contact), getContactPersonName(contact), [contact.civility, contact.firstName, contact.name].filter(Boolean).join(" ").trim(), contact.companyName, contact.email, contact.phone]
      .map((value) => normalizeContactLookupKey(value))
      .filter(Boolean);

    return leads.filter((lead) => labels.includes(normalizeContactLookupKey(lead.contactName)));
  }

  function getContactTasks(contact: Contact) {
    const contactLeads = getContactLeads(contact);
    const leadIds = new Set(contactLeads.map((lead) => lead.id));

    return tasks.filter((task) => task.contactId === contact.id || leadIds.has(effectiveTaskLeadId(task)));
  }

  const filteredByCategory = useMemo(() => contacts.filter((contact) => {
    const supplier = isSupplierContact(contact);
    const matchesType =
      contactFilter === "Tous" ||
      (contactFilter === "Clients" && contact.kind === "Client" && !supplier) ||
      (contactFilter === "Prestataires" && supplier) ||
      (contactFilter === "Propriétaires" && contact.kind === "Propriétaire") ||
      (contactFilter === "Membres de l’organisation" && contact.kind === "Membre de l’organisation");

    const matchesSupplierCategory = supplierCategoryFilter === "Toutes" || getContactSupplierCategory(contact) === supplierCategoryFilter;

    return matchesType && (contactFilter === "Prestataires" ? matchesSupplierCategory : true);
  }), [contacts, contactFilter, supplierCategoryFilter]);
  const contactSearchIndex = useMemo(() => createContactSearchIndex(filteredByCategory), [filteredByCategory]);
  const { direct: visibleContacts, close: closeContacts } = useMemo(() => searchContactSuggestions(contactSearchIndex, query), [contactSearchIndex, query]);
  const searching = Boolean(normalizeContactSearch(query));
  const allContactSearchIndex = useMemo(() => createContactSearchIndex(contacts), [contacts]);
  const searchedContacts = useMemo(() => searchDirectContacts(allContactSearchIndex, query), [allContactSearchIndex, query]);

  const clientCount = searchedContacts.filter((contact) => contact.kind === "Client" && !isSupplierContact(contact)).length;
  const supplierCount = searchedContacts.filter(isSupplierContact).length;
  const ownerCount = searchedContacts.filter((contact) => contact.kind === "Propriétaire").length;
  const memberCount = searchedContacts.filter((contact) => contact.kind === "Membre de l’organisation").length;

  function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDraftStateChange?.(true);

    if (!editingContact) return;

    const form = new FormData(event.currentTarget);

    const nextKind = normalizeKind(form.get("kind"));
    const isPrestataire = nextKind === "Prestataire";
    const isOrganizationMember = nextKind === "Membre de l’organisation";

    const updatedContact: Contact = {
      ...editingContact,
      ...(changedContactFields.current.has("entityType") ? { entityType: String(form.get("entityType") ?? "") as Contact["entityType"] } : {}),
      name: form.has("name") ? String(form.get("name") ?? "").trim() : editingContact.name,
      firstName: form.has("firstName") ? String(form.get("firstName") ?? "").trim() : editingContact.firstName,
      civility: form.has("civility") ? String(form.get("civility") ?? "") as Contact["civility"] : editingContact.civility,
      companyName: form.has("companyName") ? String(form.get("companyName") ?? "").trim() : editingContact.companyName,
      kind: nextKind,
      organizationFunction: form.has("organizationFunction") ? String(form.get("organizationFunction") ?? "").trim() : editingContact.organizationFunction,
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      postalAddress: readPostalAddress(form, editingContact.postalAddress),
      budget: form.has("budget") ? safeNumber(form.get("budget")) : editingContact.budget,
      source: String(form.get("source") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      clientLevel: String(form.get("clientLevel") ?? getContactClientLevel(editingContact)) as NonNullable<Contact["clientLevel"]>,
      preferredLanguage: String(form.get("preferredLanguage") ?? getContactPreferredLanguage(editingContact)) as NonNullable<Contact["preferredLanguage"]>,
      relationshipStatus: (isOrganizationMember ? editingContact.relationshipStatus : isPrestataire ? "Prestataire" : String(form.get("relationshipStatus") ?? getContactRelationshipStatus(editingContact) ?? "Prospect")) as NonNullable<Contact["relationshipStatus"]>,
      preferences: form.has("preferences") ? String(form.get("preferences") ?? "").trim() : editingContact.preferences,
      importantNotes: form.has("importantNotes") ? String(form.get("importantNotes") ?? "").trim() : editingContact.importantNotes,
      supplierCategory: (isOrganizationMember ? editingContact.supplierCategory : isPrestataire ? getSupplierCategoryFromForm(form) : "") as Contact["supplierCategory"],
      supplierContactName: isOrganizationMember ? editingContact.supplierContactName : isPrestataire ? String(form.get("supplierContactName") ?? "").trim() : "",
      supplierZone: isOrganizationMember ? editingContact.supplierZone : isPrestataire ? String(form.get("supplierZone") ?? "").trim() : "",
      supplierQuality: (isOrganizationMember ? editingContact.supplierQuality : isPrestataire ? String(form.get("supplierQuality") ?? "Standard") : "Standard") as Contact["supplierQuality"],
      supplierReliability: (isOrganizationMember ? editingContact.supplierReliability : isPrestataire ? String(form.get("supplierReliability") ?? "À tester") : "") as Contact["supplierReliability"],
      supplierPriceNotes: isOrganizationMember ? editingContact.supplierPriceNotes : isPrestataire ? String(form.get("supplierPriceNotes") ?? "").trim() : "",
      supplierCommissionNotes: isOrganizationMember ? editingContact.supplierCommissionNotes : isPrestataire ? String(form.get("supplierCommissionNotes") ?? "").trim() : "",
      supplierStatus: (isOrganizationMember ? editingContact.supplierStatus : isPrestataire ? String(form.get("supplierStatus") ?? "Actif") : "") as Contact["supplierStatus"]
    };

    const identityFields = ["entityType", "name", "firstName", "civility", "companyName"];
    const identityError = validateContactIdentity(updatedContact, {
      allowUnqualifiedLegacy: editingContact.entityType === undefined && !identityFields.some(field => changedContactFields.current.has(field))
    });
    setEditingIdentityError(identityError);
    if (identityError) { event.currentTarget.querySelector<HTMLElement>(`[name="${identityError.field}"]`)?.focus(); return; }
    const update = getContactFormUpdate(updatedContact, changedContactFields.current);
    void edition.submit(event.currentTarget, async () => {
      const result = await onUpdate({ id: editingContact.id, ...update });
      if (result && !result.ok) setEditingIdentityError(getContactIdentityValidationError(result.message));
      return result;
    }, newerDraft => {
      onDraftStateChange?.(newerDraft);
      if(newerDraft)return;
      setEditingContact(null);
      setSelectedContact(mergeContactUpdate(contacts.find(contact => contact.id === editingContact.id) || editingContact, update));
    });
  }

  function openEdit(contact: Contact) {
    edition.changed();
    const latestContact = contacts.find(item => item.id === contact.id) || contact;
    setSelectedContact(null);
    changedContactFields.current.clear();
    setEditingContactKind(normalizeKind((latestContact as any).kind));
    setEditingContactEntityType(String(latestContact.entityType ?? ""));
    setEditingIdentityError(null);
    setEditingContact(latestContact);
  }

  function typeLabel(contact: Contact) {
    const kind = String((contact as any).kind || "Client");
    if (isSupplierContact(contact) || kind === "Partenaire") return t("crm.enums.supplier");
    return label(contact.kind, "crm");
  }

  return (
    <div className="stack contacts-workspace oar-contacts-workspace" data-crm-module="contacts">
      <section className="card contacts-toolbar contacts-toolbar-desktop-stable" data-contacts-desktop-version="stable-1">
        <div className="contacts-toolbar-stable-main">
          <div className="contacts-toolbar-stable-title">
            <p className="eyebrow" data-semantic-text={"Contacts"}>{t("crm.contacts.b450645deb")}</p>
            <div className="contacts-toolbar-stable-count">
              <strong data-contact-direct-count>{visibleContacts.length}</strong>
              <span>{t(searching ? "crm.counts.directLabel" : "crm.counts.contactLabel", { count: visibleContacts.length })}</span>
            </div>
            {searching && <p className="muted-line"><strong data-contact-suggestion-count>{closeContacts.length}</strong>{" "}{t("crm.counts.closeLabel", { count: closeContacts.length })}</p>}
            <p className="muted-line">{t("crm.contacts.2c10e7e39d")}</p>
          </div>

          <div className="contacts-toolbar-stable-metrics" aria-label={searching ? t("crm.contacts.373aae7fb9") : t("crm.contacts.876725d1b8")}>
            <div><span>{t("crm.contacts.65a7256542")}</span><strong>{clientCount}</strong></div>
            <div><span>{t("crm.contacts.5eb8027af2")}</span><strong>{supplierCount}</strong></div>
            <div><span>{t("crm.contacts.590bf7cbda")}</span><strong>{ownerCount}</strong></div>
            <div className="contact-organization-metric"><span>{t("crm.contacts.99f07df843")}</span><strong>{memberCount}</strong></div>
          </div>
        </div>

        <div className="contact-filter-row contacts-toolbar-stable-filters">
          {filterOptions.map((option) => (
            <BusinessButton
              key={option}
              type="button"
              className={contactFilter === option ? "primary-button" : "secondary-button"}
              onClick={() => setContactFilter(option)}
            >
              {label(option, "crm")}
            </BusinessButton>
          ))}
        </div>

        {contactFilter === "Prestataires" && (
          <div className="contacts-toolbar-stable-supplier-filter">
            <BusinessLabel>{t("crm.contacts.306854f806")}<select value={supplierCategoryFilter} onChange={(event) => setSupplierCategoryFilter(event.target.value)}>
                <option value="Toutes">{t("crm.contacts.42623b97b4")}</option>
                {supplierProfessionOptions.map((category) => (
                  <option key={category} value={category}>{screen.category(category)}</option>
                ))}
              </select>
            </BusinessLabel>
          </div>
        )}
      </section>

      <div className="contacts-layout oar-contacts-layout">
        <section className="card contacts-list-card oar-contacts-list-card">
          {visibleContacts.length === 0 ? (<p className="muted-line">{searching ? t("crm.contacts.157c5868b0") : t("crm.contacts.facc0b3cf5")}</p>) : (<div className="list-stack oar-contact-list-stack">
              {visibleContacts.map((contact) => (
                <article className="item-card contact-row oar-contact-row" key={contact.id}>
                  <div>
                    <p className="eyebrow" data-semantic-text={" · {value1}"}>
                      {typeLabel(contact)}{isSupplierContact(contact) ? t("crm.contacts.f6b53f9c8a", { value1: displayValue(screen.category(getContactSupplierCategory(contact))) }) : ""}
                    </p>
                    <h3>{getContactActionLabel(contact)}</h3>
                    {getContactSecondaryLabel(contact) && (
                      <p className="muted-line">{t(contact.entityType === "company" ? "crm.contacts.identity.contactPerson" : "crm.contacts.79671d846d")}{" "}{getContactSecondaryLabel(contact)}</p>
                    )}
                    <p className="muted-line">
                      {contact.city || getContactSupplierZone(contact) || t("crm.contacts.75f0592b2b")}
                    </p>
                    <p className="muted-line">
                      {contact.email || t("crm.contacts.4e96a0cfdb")} · {contact.phone || t("crm.contacts.321d88bc1d")}
                    </p>
                    <ActionMeta item={contact} />
                    {isSupplierContact(contact) ? (
                      <p className="muted-line">{t("crm.contacts.6b84e395fb")}{" "}{label(contact.supplierReliability, "crm") || t("crm.contacts.437f69fce9")}{" "}{t("crm.contacts.941ce89abc")}{" "}{label(contact.supplierStatus, "crm") || t("crm.contacts.ad26287ab6")}
                      </p>
                    ) : contact.kind === "Membre de l’organisation" ? (
                      <p className="muted-line">{t("crm.contacts.18eb36dd98")}{" "}{contact.organizationFunction || t("crm.contacts.831460cb02")}</p>
                    ) : (
                      <p className="muted-line">
                        {label(getContactClientLevel(contact), "crm")} · {label(getContactRelationshipStatus(contact), "crm")} · {t("crm.contacts.linkedEnquiries", { count: getContactLeads(contact).length })}
                      </p>
                    )}
                  </div>

                  <div className="item-actions contact-row-actions oar-contact-actions">
                    {contact.phone && <a className="secondary-button" href={`tel:${contact.phone}`}>{t("crm.contacts.16d93e3764")}</a>}
                    {contact.email && <a className="secondary-button" href={`mailto:${contact.email}`}>{t("crm.contacts.969ccbd3cf")}</a>}
                    <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => onCreateLead(getContactActionLabel(contact))} data-crm-auto-scroll="true">{t("crm.contacts.c6616d235d")}</BusinessButton>
                    <BusinessButton className="secondary-button" type="button" onClick={() => setSelectedContact(contact)} data-crm-auto-scroll="true" data-crm-action="details">{t("crm.contacts.17eaee489b")}</BusinessButton>
                    <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => openEdit(contact)} data-crm-auto-scroll="true">{t("crm.contacts.42e37604b6")}</BusinessButton>
                    <BusinessButton permission="remove"
                      className="danger-button"
                      type="button"
                      onClick={() => {
                        const confirmed = window.confirm(dialogT("crm.contacts.a451e23492", { value1: displayValue(getContactActionLabel(contact)) }));
                        if (confirmed) void onDelete(contact.id);
                      }}
                    >{t("crm.contacts.5e5d0216ce")}</BusinessButton>
                  </div>
                </article>
              ))}
            </div>)}
          {closeContacts.length > 0 && (
            <section className="stack" data-contact-suggestions aria-label={t("crm.contacts.7b679162fa")}>
              <h3>{t("crm.contacts.7b679162fa")}</h3>
              <div className="list-stack">
                {closeContacts.map((contact) => (
                  <article className="item-card contact-row" key={contact.id} data-contact-suggestion-id={contact.id}>
                    <div>
                      <p className="eyebrow" data-semantic-text={" · {value1}"}>{typeLabel(contact)}{isSupplierContact(contact) ? t("crm.contacts.f6b53f9c8a", { value1: displayValue(screen.category(getContactSupplierCategory(contact))) }) : ""}</p>
                      <h4>{getContactActionLabel(contact)}</h4>
                      {getContactSecondaryLabel(contact) && <p className="muted-line">{t(contact.entityType === "company" ? "crm.contacts.identity.contactPerson" : "crm.contacts.79671d846d")}{" "}{getContactSecondaryLabel(contact)}</p>}
                    </div>
                    <div className="item-actions">
                      <BusinessButton className="secondary-button" type="button" onClick={() => setSelectedContact(contact)} data-crm-auto-scroll="true">{t("crm.contacts.32cc83b005")}</BusinessButton>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </section>

        <section className="card form-card contacts-form-card oar-contacts-form-card">
          <p className="eyebrow" data-semantic-text={"Nouveau"}>{t("crm.contacts.c3634f2ede")}</p>
          <h3>{creationRecordId ? t("crm.contacts.869538c383") : t("crm.contacts.a57c9b5174")}</h3>

          <BusinessForm ref={creationForm} className="form-grid contact-create-form" data-saved-record-id={creationRecordId || undefined} pending={creation.saving} onChangeCapture={creation.changed}
            onReset={event => { delete event.currentTarget.dataset.contactDraftId; delete event.currentTarget.dataset.savedRecordId; setCreationRecordId(null); setNewContactEntityType("person"); setCreationIdentityError(null); }}
            onSubmit={event => {
              event.preventDefault(); onDraftStateChange?.(true);
              const form = event.currentTarget; const values = new FormData(form);
              const issue = validateContactIdentity({ entityType: values.get("entityType"), name: values.get("name"), companyName: values.get("companyName") });
              setCreationIdentityError(issue);
              if (issue) { form.querySelector<HTMLElement>(`[name="${issue.field}"]`)?.focus(); return; }
              void creation.submit(form, async () => {
                const result = await onAdd(event);
                if (result && !result.ok) setCreationIdentityError(getContactIdentityValidationError(result.message));
                return result;
              }, (newerDraft, result) => {
                onDraftStateChange?.(newerDraft);
                if (newerDraft) { setCreationRecordId(result?.recordId ?? null); return; }
                form.reset(); setCreationRecordId(null); setNewContactKind("Client");
              });
            }}>
            <ConfirmedFormMessage message={getContactIdentityValidationError(creation.message) ? "" : creation.message} />
            <ContactIdentityFields entityType={newContactEntityType} onEntityTypeChange={setNewContactEntityType} issue={creationIdentityError} onIssue={setCreationIdentityError} prefix="contact-create" />
            <BusinessLabel>{t("crm.contacts.baaddf70fb")}<select name="kind" value={newContactKind} onChange={(event) => setNewContactKind(event.target.value as ContactKind)}>
                {contactKinds.map((kind) => <option key={kind} value={kind}>{label(kind, "crm")}</option>)}
              </select>
            </BusinessLabel>
            <BusinessLabel>{t("crm.contacts.969ccbd3cf")}<input name="email" type="email" placeholder={t("crm.contacts.2a539d6520")} /></BusinessLabel>
            <BusinessLabel>{t("crm.contacts.cc4c424b57")}<input name="phone" placeholder="+33..." /></BusinessLabel>
            <ContactPostalAddressField />
            <BusinessLabel>{t("crm.contacts.4d7e0f0579")}<input name="city" placeholder={t("crm.contacts.897ebccda8")} /></BusinessLabel>
            <BusinessLabel>{t("crm.contacts.0e570ca6fa")}<input name="source" placeholder={t("crm.contacts.0ce7823851")} /></BusinessLabel>

            {newContactKind === "Membre de l’organisation" && (
              <BusinessLabel>{t("crm.contacts.222f9de9e7")}<input name="organizationFunction" placeholder={t("crm.contacts.60c9c50476")} /></BusinessLabel>
            )}

            {newContactKind !== "Prestataire" && newContactKind !== "Membre de l’organisation" && (
              <>
                <BusinessLabel>{t("crm.contacts.1367485dc3")}<select name="relationshipStatus" defaultValue="Prospect">
                    {nonSupplierRelationshipStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel>{t("crm.contacts.1c6225ec70")}<input name="budget" type="number" min="0" placeholder={t("crm.contacts.0a9be8ec89")} /></BusinessLabel>
              </>
            )}

            {newContactKind === "Client" && (
              <>
                <BusinessLabel>{t("crm.contacts.7f83d4d107")}<select name="clientLevel" defaultValue="Standard">
                    {contactLevels.map((level) => <option key={level} value={level}>{label(level, "crm")}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel>{t("crm.contacts.5f6baab4db")}<select name="preferredLanguage" defaultValue="Français">
                    {contactLanguages.map((language) => <option key={language} value={language}>{label(language, "crm")}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel className="full">{t("crm.contacts.2032603871")}<textarea name="preferences" placeholder={t("crm.contacts.57ecbc19c3")} />
                </BusinessLabel>
                <BusinessLabel className="full">{t("crm.contacts.ba2bb523cd")}<textarea name="importantNotes" placeholder={t("crm.contacts.62b07d0502")} />
                </BusinessLabel>
              </>
            )}

            {newContactKind === "Prestataire" && (
              <>
                <BusinessLabel>{t("crm.contacts.306854f806")}<select name="supplierCategory" defaultValue="">
                    <option value="">—</option>
                    {supplierProfessionOptions.map((category) => <option key={category} value={category}>{screen.category(category)}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel>{t("crm.contacts.89dd598794")}<input name="supplierCategoryCustom" placeholder={t("crm.contacts.84329bc858")} />
                </BusinessLabel>
                <BusinessLabel>{t("crm.contacts.10859b8dc3")}<select name="supplierReliability" defaultValue="À tester">
                    <option value="À tester">{t("crm.contacts.437f69fce9")}</option>
                    <option value="Fiable">{t("crm.contacts.26d5cdf018")}</option>
                    <option value="Très fiable">{t("crm.contacts.8508f22f87")}</option>
                    <option value="À éviter">{t("crm.contacts.9c5902593d")}</option>
                  </select>
                </BusinessLabel>
                <BusinessLabel>{t("crm.contacts.5459cc133f")}<input name="supplierContactName" placeholder={t("crm.contacts.67f8a52b44")} /></BusinessLabel>
                <BusinessLabel>{t("crm.contacts.8a8a8e1503")}<select name="supplierStatus" defaultValue="Actif">
                    <option value="Actif">{t("crm.contacts.ad26287ab6")}</option>
                    <option value="À vérifier">{t("crm.contacts.03a088312d")}</option>
                    <option value="Inactif">{t("crm.contacts.cdcf2ea348")}</option>
                  </select>
                </BusinessLabel>
                <BusinessLabel>{t("crm.contacts.8dce95eeb4")}<select name="supplierQuality" defaultValue="Standard">
                    <option value="Standard">{t("crm.contacts.ef6691545d")}</option>
                    <option value="Premium">{t("crm.contacts.de88c121a8")}</option>
                    <option value="Très premium">{t("crm.contacts.6e2c957724")}</option>
                  </select>
                </BusinessLabel>
                <BusinessLabel className="full">{t("crm.contacts.a9d3991563")}<textarea name="supplierPriceNotes" placeholder={t("crm.contacts.1b8f311310")} />
                </BusinessLabel>
                <BusinessLabel className="full">{t("crm.contacts.c5da356eca")}<textarea name="supplierCommissionNotes" placeholder={t("crm.contacts.0f07ee6d45")} />
                </BusinessLabel>
              </>
            )}

            <BusinessLabel className="full">{t("crm.contacts.8a7525b149")}<textarea name="notes" placeholder={t("crm.contacts.7e672331b2")} />
            </BusinessLabel>

            <BusinessButton permission="write" className="primary-button contact-form-submit" type="submit">{creationRecordId ? t("crm.contacts.45951f6ac1") : t("crm.contacts.00f9c53345")}</BusinessButton>
          </BusinessForm>
        </section>
      </div>

      {selectedContact && (
        <div className="confirm-backdrop">
          <div id="contact-detail-panel" className="confirm-dialog contact-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Fiche contact"}>{t("crm.contacts.9330008a8f")}</p>
            <h3>{getContactActionLabel(selectedContact)}</h3>

            {selectedContact.entityType === "company" && getContactPersonName(selectedContact) && <p className="muted-line">{t("crm.contacts.identity.contactPerson")}{" "}{getContactPersonName(selectedContact)}</p>}
            <div className="contact-detail-grid">
              <div><span>{t("crm.contacts.entityType.label")}</span><strong>{t(selectedContact.entityType === "person" ? "crm.contacts.entityType.person" : selectedContact.entityType === "company" ? "crm.contacts.entityType.company" : "crm.contacts.entityType.unqualified")}</strong></div>
              <div><span>{t("crm.contacts.baaddf70fb")}</span><strong>{typeLabel(selectedContact)}</strong></div>
              <div><span>{t("crm.contacts.901ce24cca")}</span><strong>{selectedContact.civility || t("crm.contacts.831460cb02")}</strong></div>
              <div><span>{t("crm.contacts.e325bf8f90")}</span><strong>{selectedContact.firstName || t("crm.contacts.cb6c1fb76c")}</strong></div>
              <div><span>{t("crm.contacts.e408c08c6b")}</span><strong>{selectedContact.companyName || t("crm.contacts.831460cb02")}</strong></div>
              <div><span>{t("crm.contacts.969ccbd3cf")}</span><strong>{selectedContact.email || t("crm.contacts.cb6c1fb76c")}</strong></div>
              <div><span>{t("crm.contacts.cc4c424b57")}</span><strong>{selectedContact.phone || t("crm.contacts.cb6c1fb76c")}</strong></div>
              <ContactPostalAddressDetails key={`${selectedContact.id}:${selectedContact.postalAddress ?? ""}`} address={selectedContact.postalAddress} />
              <div><span>{t("crm.contacts.4d7e0f0579")}</span><strong>{selectedContact.city || getContactSupplierZone(selectedContact) || t("crm.contacts.831460cb02")}</strong></div>
              <div><span>{t("crm.contacts.64cff1319d")}</span><strong>{screen.action(selectedContact)}</strong></div>

              {selectedContact.kind === "Membre de l’organisation" ? (
                <div><span>{t("crm.contacts.222f9de9e7")}</span><strong>{selectedContact.organizationFunction || t("crm.contacts.831460cb02")}</strong></div>
              ) : isSupplierContact(selectedContact) ? (
                <>
                  <div><span>{t("crm.contacts.13a150e3fd")}</span><strong>{screen.category(getContactSupplierCategory(selectedContact))}</strong></div>
                  <div><span>{t("crm.contacts.10859b8dc3")}</span><strong>{label(selectedContact.supplierReliability, "crm") || t("crm.contacts.437f69fce9")}</strong></div>
                  <div><span>{t("crm.contacts.8dce95eeb4")}</span><strong>{label(selectedContact.supplierQuality, "crm") || t("crm.contacts.ef6691545d")}</strong></div>
                  <div><span>{t("crm.contacts.dee377cfd8")}</span><strong>{label(selectedContact.supplierStatus, "crm") || t("crm.contacts.ad26287ab6")}</strong></div>
                  <div className="full"><span>{t("crm.contacts.301b704907")}</span><p>{selectedContact.supplierPriceNotes || t("crm.contacts.61979ef29a")}</p></div>
                  <div className="full"><span>{t("crm.contacts.c5da356eca")}</span><p>{selectedContact.supplierCommissionNotes || t("crm.contacts.cec2a1bbd3")}</p></div>
                </>
              ) : (
                <>
                  <div><span>{t("crm.contacts.1c6225ec70")}</span><strong>{selectedContact.budget ? screen.money(selectedContact.budget) : t("crm.contacts.cb6c1fb76c")}</strong></div>
                  <div><span>{t("crm.contacts.1367485dc3")}</span><strong>{label(getContactRelationshipStatus(selectedContact), "crm")}</strong></div>
                  <div><span>{t("crm.contacts.2b5104f5fc")}</span><strong>{label(getContactClientLevel(selectedContact), "crm")}</strong></div>
                  <div><span>{t("crm.contacts.5f6baab4db")}</span><strong>{label(getContactPreferredLanguage(selectedContact), "crm")}</strong></div>
                </>
              )}

              <div className="full"><span>{t("crm.contacts.8a7525b149")}</span><p>{selectedContact.notes || t("crm.contacts.7130e80de1")}</p></div>
            </div>

            {!business && (isSupplierContact(selectedContact) || Boolean(selectedContact.supplierBankAccounts?.length)) && <VendorBankAccounts contact={contacts.find(c => c.id === selectedContact.id) || selectedContact} actor={actor} onUpdate={onUpdate} />}

            {!isSupplierContact(selectedContact) && (
              <div className="contact-related-section">
                <p className="eyebrow" data-semantic-text={"Synthèse commerciale"}>{t("crm.contacts.ae151f73db")}</p>
                <div className="list-stack oar-contact-list-stack">
                  <article className="mini-row">
                    <div><strong>{t("crm.contacts.7a1b10d944")}</strong><span>{t("crm.contacts.linkedEnquiries", { count: getContactLeads(selectedContact).length })}</span></div>
                    <Badge>{getContactLeads(selectedContact).filter((lead) => lead.status !== "Perdu").length}</Badge>
                  </article>
                  <article className="mini-row">
                    <div><strong>{t("crm.contacts.ad3cb2195b")}</strong><span>{t("crm.contacts.c00de5a564")}</span></div>
                    <Badge>{getContactTasks(selectedContact).filter((task) => task.status !== "Terminé").length}</Badge>
                  </article>
                </div>
              </div>
            )}

            {access && <ContactDocuments key={selectedContact.id} contactId={selectedContact.id} access={access}/>}

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedContact(null)} data-crm-dismiss="true">{t("crm.contacts.711e5f2e19")}</BusinessButton>
              <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => { const name = getContactActionLabel(selectedContact); setSelectedContact(null); onCreateLead(name); }} data-crm-auto-scroll="true">{t("crm.contacts.b17ed17a3a")}</BusinessButton>
              <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => { const name = getContactActionLabel(selectedContact); const id = selectedContact.id; setSelectedContact(null); onCreateTask(name, id); }} data-crm-auto-scroll="true">{t("crm.contacts.502e6ba2e5")}</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedContact)} data-crm-auto-scroll="true">{t("crm.contacts.42e37604b6")}</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingContact && (
        <div className="confirm-backdrop">
          <div id="contact-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Modification"}>{t("crm.contacts.46889b43bc")}</p>
            <h3>{t("crm.contacts.b67e91e395")}</h3>

            <BusinessForm ref={editingForm} className="form-grid contact-edit-form" pending={edition.saving} onSubmit={submitEdit} onChangeCapture={edition.changed} onChange={(event) => {
              const target = event.target;
              if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
                changedContactFields.current.add(target.name);
              }
            }}>
              <ConfirmedFormMessage message={getContactIdentityValidationError(edition.message) ? "" : edition.message} />
              <ContactIdentityFields contact={editingContact} entityType={editingContactEntityType} onEntityTypeChange={setEditingContactEntityType} issue={editingIdentityError} onIssue={setEditingIdentityError} prefix="contact-edit" />

              <BusinessLabel>{t("crm.contacts.baaddf70fb")}<select name="kind" value={editingContactKind} onChange={(event) => setEditingContactKind(event.target.value as ContactKind)}>
                  {contactKinds.map((kind) => <option key={kind} value={kind}>{label(kind, "crm")}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>{t("crm.contacts.969ccbd3cf")}<input name="email" type="email" defaultValue={editingContact.email} /></BusinessLabel>
              <BusinessLabel>{t("crm.contacts.cc4c424b57")}<input name="phone" defaultValue={editingContact.phone} /></BusinessLabel>
              <ContactPostalAddressField value={editingContact.postalAddress} />
              <BusinessLabel>{t("crm.contacts.4d7e0f0579")}<input name="city" defaultValue={editingContact.city} /></BusinessLabel>
              <BusinessLabel>{t("crm.contacts.0e570ca6fa")}<input name="source" defaultValue={editingContact.source} /></BusinessLabel>

              {editingContactKind === "Membre de l’organisation" && (
                <BusinessLabel>{t("crm.contacts.222f9de9e7")}<input name="organizationFunction" defaultValue={editingContact.organizationFunction ?? ""} placeholder={t("crm.contacts.60c9c50476")} /></BusinessLabel>
              )}

              {editingContactKind !== "Prestataire" && editingContactKind !== "Membre de l’organisation" && (
                <>
                  <BusinessLabel>{t("crm.contacts.1367485dc3")}<select name="relationshipStatus" defaultValue={getContactRelationshipStatus(editingContact) === "Prestataire" ? "Prospect" : getContactRelationshipStatus(editingContact)}>
                      {nonSupplierRelationshipStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>{t("crm.contacts.1c6225ec70")}<input name="budget" type="number" min="0" defaultValue={editingContact.budget || ""} /></BusinessLabel>
                </>
              )}

              {editingContactKind === "Client" && (
                <>
                  <BusinessLabel>{t("crm.contacts.7f83d4d107")}<select name="clientLevel" defaultValue={getContactClientLevel(editingContact)}>
                      {contactLevels.map((level) => <option key={level} value={level}>{label(level, "crm")}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>{t("crm.contacts.5f6baab4db")}<select name="preferredLanguage" defaultValue={getContactPreferredLanguage(editingContact)}>
                      {contactLanguages.map((language) => <option key={language} value={language}>{label(language, "crm")}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel className="full">{t("crm.contacts.2032603871")}<textarea name="preferences" defaultValue={editingContact.preferences ?? ""} />
                  </BusinessLabel>
                  <BusinessLabel className="full">{t("crm.contacts.ba2bb523cd")}<textarea name="importantNotes" defaultValue={editingContact.importantNotes ?? ""} />
                  </BusinessLabel>
                </>
              )}

              {editingContactKind === "Prestataire" && (
                <>
                  <BusinessLabel>{t("crm.contacts.306854f806")}<select name="supplierCategory" defaultValue={editingContact.supplierCategory || ""}>
                      <option value="">—</option>
                      {supplierProfessionOptions.map((category) => <option key={category} value={category}>{screen.category(category)}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>{t("crm.contacts.89dd598794")}<input name="supplierCategoryCustom" placeholder={t("crm.contacts.ebe3278935")} />
                  </BusinessLabel>
                  <BusinessLabel>{t("crm.contacts.5459cc133f")}<input name="supplierContactName" defaultValue={editingContact.supplierContactName || ""} /></BusinessLabel>
                  <BusinessLabel>{t("crm.contacts.10859b8dc3")}<select name="supplierReliability" defaultValue={editingContact.supplierReliability || "À tester"}>
                      <option value="À tester">{t("crm.contacts.437f69fce9")}</option>
                      <option value="Fiable">{t("crm.contacts.26d5cdf018")}</option>
                      <option value="Très fiable">{t("crm.contacts.8508f22f87")}</option>
                      <option value="À éviter">{t("crm.contacts.9c5902593d")}</option>
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>{t("crm.contacts.8a8a8e1503")}<select name="supplierStatus" defaultValue={editingContact.supplierStatus || "Actif"}>
                      <option value="Actif">{t("crm.contacts.ad26287ab6")}</option>
                      <option value="À vérifier">{t("crm.contacts.03a088312d")}</option>
                      <option value="Inactif">{t("crm.contacts.cdcf2ea348")}</option>
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>{t("crm.contacts.8dce95eeb4")}<select name="supplierQuality" defaultValue={editingContact.supplierQuality || "Standard"}>
                      <option value="Standard">{t("crm.contacts.ef6691545d")}</option>
                      <option value="Premium">{t("crm.contacts.de88c121a8")}</option>
                      <option value="Très premium">{t("crm.contacts.6e2c957724")}</option>
                    </select>
                  </BusinessLabel>
                  <BusinessLabel className="full">{t("crm.contacts.301b704907")}<textarea name="supplierPriceNotes" defaultValue={editingContact.supplierPriceNotes || ""} />
                  </BusinessLabel>
                  <BusinessLabel className="full">{t("crm.contacts.c5da356eca")}<textarea name="supplierCommissionNotes" defaultValue={editingContact.supplierCommissionNotes || ""} />
                  </BusinessLabel>
                </>
              )}

              <BusinessLabel className="full">{t("crm.contacts.8a7525b149")}<textarea name="notes" defaultValue={editingContact.notes} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => {edition.changed();setEditingContact(null);}} data-crm-dismiss="true">{t("crm.contacts.46ad3916f6")}</BusinessButton>
                <BusinessButton permission="write" className="primary-button contact-form-submit" type="submit">{t("crm.contacts.71dc74873e")}</BusinessButton>
              </div>
            </BusinessForm>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadsView({
  leads,
  contacts,
  tasks,
  properties,
  vehicles,
  boats,
  preselectedContactName,
  onAdd,
  onUpdate,
  onStatusChange,
  onDelete,
  onCreateQuote,
  quotes = [],
  onCreateTask
}: {
  leads: Lead[];
  contacts: Contact[];
  tasks: Task[];
  properties: Property[];
  vehicles: Vehicle[];
  boats: Boat[];
  preselectedContactName?: string;
  onAdd: (event: React.FormEvent<HTMLFormElement>) => void;
  onUpdate: (lead: Lead) => void | Promise<FormSaveResult>;
  onStatusChange: (id: string, status: LeadStatus) => void;
  onDelete: (id: string) => void;
  onCreateQuote: (lead: Lead) => void;
  quotes?: QuoteRequest[];
  onCreateTask: (lead: Lead) => void;
}) {
  const { t, label, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadCategoryFilter, setLeadCategoryFilter] = useState<"Toutes" | Lead["category"]>("Toutes");
  const [leadStatusFilter, setLeadStatusFilter] = useState<"Tous" | LeadStatus>("Tous");
  const [leadPriorityFilter, setLeadPriorityFilter] = useState<"Toutes" | Lead["priority"]>("Toutes");
  const [leadDueFilter, setLeadDueFilter] = useState<"Tous" | "En retard" | "Aujourd'hui" | "À venir" | "Sans échéance">("Tous");
  const [leadActionFilter, setLeadActionFilter] = useState<"Tous" | "Sans prochaine action">("Tous");

  const editingContactName = editingLead?.contactName ?? "";
  const preserveEditingContact = editingContactName !== "" &&
    contacts.filter((contact) => getContactLabel(contact) === editingContactName).length !== 1;

  const assetOptions = [
    ...properties.map((property) => ({
      id: property.id,
      type: "Property" as const,
      label: `Villa / Bien • ${getPropertyDisplayName(property)}`
    })),
    ...vehicles.map((vehicle) => ({
      id: vehicle.id,
      type: "Vehicle" as const,
      label: `Voiture • ${vehicle.name}`
    })),
    ...boats.map((boat) => ({
      id: boat.id,
      type: "Boat" as const,
      label: `Bateau • ${boat.name}`
    }))
  ];

  function getLeadAssetLabel(lead: Lead) {
    if (!lead.assetType || !lead.assetId) return "";

    return assetOptions.find((asset) => asset.type === lead.assetType && asset.id === lead.assetId)?.label ?? "";
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingLead) return;

    const form = new FormData(event.currentTarget);
    const assetSelection = parseAssetKey(form.get("assetKey"));

    const selectedContactName = form.has("contactName")
      ? String(form.get("contactName") ?? "")
      : editingLead.contactName;

    const updatedLead: Lead = {
      ...editingLead,
      category: String(form.get("category") ?? "Villa") as Lead["category"],
      contactName: selectedContactName === editingLead.contactName
        ? editingLead.contactName
        : selectedContactName.trim(),
      assetType: assetSelection.assetType,
      assetId: assetSelection.assetId,
      status: String(form.get("status") ?? "Nouveau") as LeadStatus,
      value: safeNumber(form.get("value")),
      priority: String(form.get("priority") ?? "Moyenne") as Lead["priority"],
      dueDate: String(form.get("dueDate") ?? ""),
      rentalStartDate: String(form.get("rentalStartDate") ?? ""),
      rentalEndDate: String(form.get("rentalEndDate") ?? ""),
      nextAction: String(form.get("nextAction") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim()
    };

    if (!updatedLead.contactName) return;

    if (isOpenLead(updatedLead) && (!updatedLead.nextAction.trim() || !updatedLead.dueDate)) {
      window.alert(dialogT("crm.leads.49ed09dfc6"));
      return;
    }

    const result = await onUpdate(updatedLead);
    if (result && !result.ok) return;
    setEditingLead(null);
  }

  function getLeadTasks(lead: Lead) {
    return tasks.filter((task) => effectiveTaskLeadId(task) === lead.id);
  }

  function openEdit(lead: Lead) {
    setEditingLead(lead);

    setTimeout(() => {
      document.getElementById("lead-edit-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 50);
  }


const visibleLeads = leads.filter((lead) => {
    const dueStatus = getDueStatus(lead.dueDate);

    const categoryMatches = leadCategoryFilter === "Toutes" || lead.category === leadCategoryFilter;
    const statusMatches = leadStatusFilter === "Tous" ? lead.status !== "Perdu" : lead.status === leadStatusFilter;
    const priorityMatches = leadPriorityFilter === "Toutes" || lead.priority === leadPriorityFilter;

    const dueMatches =
      leadDueFilter === "Tous" ||
      (leadDueFilter === "En retard" && dueStatus === "overdue") ||
      (leadDueFilter === "Aujourd'hui" && dueStatus === "today") ||
      (leadDueFilter === "À venir" && dueStatus === "future") ||
      (leadDueFilter === "Sans échéance" && dueStatus === "none");

    const actionMatches =
      leadActionFilter === "Tous" ||
      !lead.nextAction?.trim();

    return categoryMatches && statusMatches && priorityMatches && dueMatches && actionMatches;
  });

  const filtersAreActive =
    leadCategoryFilter !== "Toutes" ||
    leadStatusFilter !== "Tous" ||
    leadPriorityFilter !== "Toutes" ||
    leadDueFilter !== "Tous" ||
    leadActionFilter !== "Tous";

  const [collapsedLeadStatuses, setCollapsedLeadStatuses] = useState<Partial<Record<LeadStatus, boolean>>>({});

  function toggleLeadColumn(status: LeadStatus) {
    setCollapsedLeadStatuses((current) => ({
      ...current,
      [status]: !current[status]
    }));
  }

  return (
    <div className="stack">
      <section id="lead-create-form" className="card form-card horizontal-form">
        <div>
          <p className="eyebrow" data-semantic-text={"Nouveau"}>{t("crm.leads.c3634f2ede")}</p>
          <h3>{t("crm.leads.c361479b7c")}</h3>
        </div>

        <BusinessForm className="lead-smart-form" onSubmit={onAdd}>
          <fieldset className="lead-form-block">
            <legend>{t("crm.leads.d75d2476f0")}</legend>

            <BusinessLabel>{t("crm.leads.68a5341fc6")}<select name="category" defaultValue="Villa">
                <option value="Villa">{t("crm.leads.afad4c579e")}</option>
                <option value="Voiture">{t("crm.leads.035004be54")}</option>
                <option value="Bateau">{t("crm.leads.d69c7210bc")}</option>
                <option value="Conciergerie">{t("crm.leads.6a4ce3246c")}</option>
              </select>
            </BusinessLabel>

            <BusinessLabel>{t("crm.leads.2b5c3d2672")}<input
                name="contactName"
                list="lead-contact-options"
                defaultValue={preselectedContactName || ""}
                placeholder={t("crm.leads.84c00400a6")}
              />
              <datalist id="lead-contact-options">
                {contacts.map((contact) => {
                  const label = getContactLabel(contact);
                  return <option key={contact.id} value={label}>{getContactSecondaryLabel(contact) ? t("crm.leads.7c639bc99b", { value1: displayValue(label), value2: displayValue(getContactSecondaryLabel(contact)) }) : label}</option>;
                })}
              </datalist>
            </BusinessLabel>

            <BusinessLabel>{t("crm.leads.0ad9d4fa0c")}<select name="assetKey" defaultValue="">
                <option value="">{t("crm.leads.1ceb66fe96")}</option>
                {assetOptions.map((asset) => (
                  <option key={`${asset.type}:${asset.id}`} value={`${asset.type}:${asset.id}`}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </BusinessLabel>
          </fieldset>

          <fieldset className="lead-form-block">
            <legend>{t("crm.leads.fa767df5cb")}</legend>

            <BusinessLabel>{t("crm.leads.d90f9c7025")}<input name="rentalStartDate" type="date" />
            </BusinessLabel>

            <BusinessLabel>{t("crm.leads.97fa488838")}<input name="rentalEndDate" type="date" />
            </BusinessLabel>

            <BusinessLabel>{t("crm.leads.6e8f3132d8")}<input name="value" type="number" min="0" placeholder="2500" />
            </BusinessLabel>
          </fieldset>

          <fieldset className="lead-form-block">
            <legend>{t("crm.leads.dc1e38fec8")}</legend>

            <BusinessLabel>{t("crm.leads.dee377cfd8")}<select name="status" defaultValue="Nouveau">
                
        {visibleLeads.length === 0 && (
          <div className="empty-state">
            <h3>{t("crm.leads.e395db00e1")}</h3>
            <p>{t("crm.leads.ac4e57ba21")}</p>
          </div>
        )}

{leadStatuses.map((status) => (
                  <option key={status} value={status}>{label(status, "crm")}</option>
                ))}
              </select>
            </BusinessLabel>

            <BusinessLabel>{t("crm.leads.26c18a313d")}<select name="priority" defaultValue="Moyenne">
                <option value="Basse">{t("crm.leads.2435a9bfbd")}</option>
                <option value="Moyenne">{t("crm.leads.2aefe19b76")}</option>
                <option value="Haute">{t("crm.leads.9c3e565aa2")}</option>
              </select>
            </BusinessLabel>

            <BusinessLabel>{t("crm.leads.40f31a1ecb")}<input name="dueDate" type="date" />
            </BusinessLabel>

            <BusinessLabel className="full">{t("crm.leads.a3596782a3")}<input name="nextAction" placeholder={t("crm.leads.9f95456376")} />
            </BusinessLabel>

            <BusinessLabel className="full">{t("crm.leads.d96ddd0984")}<textarea name="notes" placeholder={t("crm.leads.56d53a4278")} />
            </BusinessLabel>
          </fieldset>

          <div className="lead-form-actions">
            <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.leads.7fee0e9d89")}</BusinessButton>
          </div>
        </BusinessForm>
      </section>

      <section className="card lead-filter-card">
        <div>
          <p className="eyebrow" data-semantic-text={"Filtres rapides"}>{t("crm.leads.a81e92302e")}</p>
          <h3>{visibleLeads.length}{" "}{t("crm.leads.167c84a712")}</h3>
        </div>

        <div className="lead-filter-grid">
          <BusinessLabel>{t("crm.leads.68a5341fc6")}<select
              value={leadCategoryFilter}
              onChange={(event) => setLeadCategoryFilter(event.target.value as "Toutes" | Lead["category"])}
            >
              <option value="Toutes">{t("crm.leads.42623b97b4")}</option>
              <option value="Villa">{t("crm.leads.afad4c579e")}</option>
              <option value="Voiture">{t("crm.leads.035004be54")}</option>
              <option value="Bateau">{t("crm.leads.d69c7210bc")}</option>
              <option value="Conciergerie">{t("crm.leads.6a4ce3246c")}</option>
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.leads.dee377cfd8")}<select
              value={leadStatusFilter}
              onChange={(event) => setLeadStatusFilter(event.target.value as "Tous" | LeadStatus)}
            >
              <option value="Tous">{t("crm.leads.2ff5998143")}</option>
              {leadStatuses.map((status) => (
                <option key={status} value={status}>{label(status, "crm")}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.leads.26c18a313d")}<select
              value={leadPriorityFilter}
              onChange={(event) => setLeadPriorityFilter(event.target.value as "Toutes" | Lead["priority"])}
            >
              <option value="Toutes">{t("crm.leads.42623b97b4")}</option>
              <option value="Basse">{t("crm.leads.2435a9bfbd")}</option>
              <option value="Moyenne">{t("crm.leads.2aefe19b76")}</option>
              <option value="Haute">{t("crm.leads.9c3e565aa2")}</option>
            </select>
          </BusinessLabel>
        </div>
      </section>

      <section className="pipeline-grid compact-pipeline" aria-label={t("crm.leads.7bcb6fb014")}>
        {leadStatuses.map((status) => {
          const columnLeads = sortByUrgency(visibleLeads.filter((lead) => lead.status === status));




          const isCollapsed = Boolean(collapsedLeadStatuses[status]);

          return (
            <div className={`pipeline-column ${isCollapsed ? "is-collapsed" : ""}`} key={status}>
              <BusinessButton
                className="asset-reset-button pipeline-title pipeline-toggle"
                type="button"
                onClick={() => toggleLeadColumn(status)}
                aria-expanded={!isCollapsed}
              >
                <strong>{label(status, "crm")}</strong>
                <span>{columnLeads.length}</span>
                <em>{isCollapsed ? "▾" : "▴"}</em>
              </BusinessButton>

              {!isCollapsed && (
                <div className="list-stack oar-contact-list-stack">
                  {columnLeads.map((lead) => (
                    <article className={`lead-card ${getDueStatus(lead.dueDate)}`} key={lead.id} data-notification-target={`lead-${lead.id}`}>
                      <div className="lead-topline">
                        <Badge>{label(lead.priority, "crm")}</Badge>

                        <BusinessButton permission="remove"
                          className="icon-button"
                          type="button"
                          onClick={() => {
                            const confirmed = window.confirm(
                              dialogT("crm.leads.216e79a037", { value1: displayValue(lead.contactName) })
                            );

                            if (confirmed) {
                              onDelete(lead.id);
                            }
                          }}
                          aria-label={t("crm.leads.5e5d0216ce")}
                        >{t("crm.leads.8db71ed28b")}</BusinessButton>
                      </div>

                      <strong>{label(lead.category, "crm")}</strong>
                      <span>{lead.contactName}</span>
                      <small>{screen.reservation(lead.rentalStartDate, lead.rentalEndDate)}</small>

                      {getLeadAssetLabel(lead) && (
                        <small className="asset-linked-line">{getLeadAssetLabel(lead)}</small>
                      )}

                      <p>{lead.nextAction || t("crm.leads.c3990c21db")}</p>

                      {lead.notes && (
                        <p className="lead-note-preview">{lead.notes}</p>
                      )}

                      <div className="lead-footer">
                        <b>{screen.money(lead.value)}</b>
                        <small className={`due-label ${getDueStatus(lead.dueDate)}`}>
                          {screen.due(lead.dueDate)}
                        </small>
                      </div>

                      <BusinessSelect value={lead.status} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)}>
                        {leadStatuses.map((option) => <option key={option} value={option}>{label(option, "crm")}</option>)}
                      </BusinessSelect>

                      <div className="lead-card-actions">
                        <BusinessButton className="lead-detail-button" type="button" onClick={() => setSelectedLead(lead)} data-crm-auto-scroll="true" data-crm-action="details">{t("crm.leads.17eaee489b")}</BusinessButton>

                        <BusinessButton permission="write" className="lead-detail-button" type="button" onClick={() => onCreateTask(lead)}>{t("crm.leads.e4c05d29df")}</BusinessButton>

                        <BusinessButton permission="write" className="lead-detail-button" type="button" onClick={() => onCreateQuote(lead)} data-crm-auto-scroll="true">
                          {quotes.some((quote) => quote.leadId === lead.id) ? t("crm.leads.4d2edfdd47") : t("crm.leads.1b45a42c1e")}
                        </BusinessButton>

                        <BusinessButton permission="write" className="lead-edit-button" type="button" onClick={() => openEdit(lead)} data-crm-auto-scroll="true">{t("crm.leads.42e37604b6")}</BusinessButton>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {selectedLead && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog lead-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Fiche lead"}>{t("crm.leads.5730fbf554")}</p>
            <h3>{label(selectedLead.category, "crm")} • {selectedLead.contactName}</h3>

            <div className="lead-detail-grid">
              <div>
                <span>{t("crm.leads.dee377cfd8")}</span>
                <strong>{label(selectedLead.status, "crm")}</strong>
              </div>

              <div>
                <span>{t("crm.leads.26c18a313d")}</span>
                <strong>{label(selectedLead.priority, "crm")}</strong>
              </div>

              <div>
                <span>{t("crm.leads.6e8f3132d8")}</span>
                <strong>{screen.money(selectedLead.value)}</strong>
              </div>

              <div>
                <span>{t("crm.leads.40f31a1ecb")}</span>
                <strong>{selectedLead.dueDate ? screen.date(selectedLead.dueDate) : t("crm.leads.831460cb02")}</strong>
              </div>

              <div className="full">
                <span>{t("crm.leads.f8c31bb6c6")}</span>
                <strong>{screen.reservation(selectedLead.rentalStartDate, selectedLead.rentalEndDate)}</strong>
              </div>

              <div className="full">
                <span>{t("crm.leads.a3596782a3")}</span>
                <strong>{selectedLead.nextAction || t("crm.leads.c3990c21db")}</strong>
              </div>
              <div><span>{t("crm.leads.64cff1319d")}</span><strong>{screen.action(selectedLead)}</strong></div>

              <div className="full">
                <span>{t("crm.leads.d96ddd0984")}</span>
                <p>{selectedLead.notes || t("crm.leads.50f3acb1f1")}</p>
              </div>
            </div>

            <div className="lead-related-section">
              <p className="eyebrow" data-semantic-text={"Tâches liées à ce lead"}>{t("crm.leads.3eb5c16283")}</p>

              <div className="list-stack oar-contact-list-stack">
                {getLeadTasks(selectedLead).length === 0 && (
                  <p className="muted-line">{t("crm.leads.dc8b155594")}</p>
                )}

                {getLeadTasks(selectedLead).map((task) => (
                  <article className="mini-row" key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>
                        {task.owner || t("crm.leads.96a9c762f6")}
                        {" · "}
                        {task.dueDate ? t("crm.leads.f31959df8f", { value1: displayValue(screen.date(task.dueDate)) }) : t("crm.leads.5de50fae8b")}
                      </span>
                    </div>
                    <Badge>{label(task.status, "crm")}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedLead(null)} data-crm-dismiss="true">{t("crm.leads.711e5f2e19")}</BusinessButton>

                              <BusinessButton permission="write"
                className="secondary-button"
                type="button"
                onClick={() => {
                  const lead = selectedLead;
                  setSelectedLead(null);
                  onCreateTask(lead);
                }}
               data-crm-auto-scroll="true">{t("crm.leads.502e6ba2e5")}</BusinessButton>

              <BusinessButton permission="write"
                className="primary-button"
                type="button"
                onClick={() => {
                  const lead = selectedLead;
                  setSelectedLead(null);
                  openEdit(lead);
                }}
               data-crm-auto-scroll="true">{t("crm.leads.42e37604b6")}</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingLead && (
        <div className="confirm-backdrop">
          <div id="lead-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Modification"}>{t("crm.leads.46889b43bc")}</p>
            <h3>{t("crm.leads.cf4075f488")}</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>{t("crm.leads.68a5341fc6")}<select name="category" defaultValue={editingLead.category}>
                  <option value="Villa">{t("crm.leads.afad4c579e")}</option>
                  <option value="Voiture">{t("crm.leads.035004be54")}</option>
                  <option value="Bateau">{t("crm.leads.d69c7210bc")}</option>
                  <option value="Conciergerie">{t("crm.leads.6a4ce3246c")}</option>
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.leads.2b5c3d2672")}<select name="contactName" defaultValue={editingLead.contactName} required>
                  <option value="">{t("crm.leads.09a3bda6ca")}</option>
                  {preserveEditingContact && (
                    <option value={editingContactName}>
                      {t("crm.leads.historicalContact", { name: editingContactName })}
                    </option>
                  )}
                  {contacts.map((contact) => (
                    <option key={contact.id} value={getContactLabel(contact)}>
                      {getContactLabel(contact)}
                    </option>
                  ))}
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.leads.0ad9d4fa0c")}<select
                  name="assetKey"
                  defaultValue={editingLead.assetType && editingLead.assetId ? `${editingLead.assetType}:${editingLead.assetId}` : ""}
                >
                  <option value="">{t("crm.leads.1ceb66fe96")}</option>
                  {assetOptions.map((asset) => (
                    <option key={`${asset.type}:${asset.id}`} value={`${asset.type}:${asset.id}`}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.leads.dee377cfd8")}<select name="status" defaultValue={editingLead.status}>
                  {leadStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.leads.6e8f3132d8")}<input name="value" type="number" min="0" defaultValue={editingLead.value || ""} /></BusinessLabel>

              <BusinessLabel>{t("crm.leads.26c18a313d")}<select name="priority" defaultValue={editingLead.priority}>
                  <option value="Basse">{t("crm.leads.2435a9bfbd")}</option>
                  <option value="Moyenne">{t("crm.leads.2aefe19b76")}</option>
                  <option value="Haute">{t("crm.leads.9c3e565aa2")}</option>
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.leads.99c40ab405")}<input name="dueDate" type="date" defaultValue={editingLead.dueDate} /></BusinessLabel>
              <BusinessLabel>{t("crm.leads.d90f9c7025")}<input name="rentalStartDate" type="date" defaultValue={editingLead.rentalStartDate} /></BusinessLabel>
              <BusinessLabel>{t("crm.leads.97fa488838")}<input name="rentalEndDate" type="date" defaultValue={editingLead.rentalEndDate} /></BusinessLabel>

              <BusinessLabel className="full">{t("crm.leads.a3596782a3")}<input name="nextAction" defaultValue={editingLead.nextAction} />
              </BusinessLabel>

              <BusinessLabel className="full">{t("crm.leads.d96ddd0984")}<textarea name="notes" defaultValue={editingLead.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingLead(null)} data-crm-dismiss="true">{t("crm.leads.46ad3916f6")}</BusinessButton>

                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.leads.71dc74873e")}</BusinessButton>
              </div>
            </BusinessForm>
          </div>
        </div>
      )}
    </div>
  );
}


function PropertiesView({
  properties,
  leads,
  onAdd,
  onUpdate,
  onDelete
}: {
  properties: Property[];
  leads: Lead[];
  onAdd: (event: React.FormEvent<HTMLFormElement>) => void;
  onUpdate: (property: Property) => void;
  onDelete: (id: string) => void;
}) {
  const { t, label, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [propertyStatusFilter, setPropertyStatusFilter] = useState<"Tous" | PropertyStatus>("Tous");
  const [propertyCityFilter, setPropertyCityFilter] = useState("");

  const visibleProperties = properties.filter((property) => {
    const statusMatches = propertyStatusFilter === "Tous" || property.status === propertyStatusFilter;
    const cityMatches = property.city.toLowerCase().includes(propertyCityFilter.toLowerCase().trim());
    return statusMatches && cityMatches;
  });

  function getPropertyLeads(property: Property) {
    return leads.filter((lead) => lead.assetType === "Property" && lead.assetId === property.id);
  }

  function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProperty) return;

    const form = new FormData(event.currentTarget);

    const updatedProperty: Property = {
      ...editingProperty,
      name: String(form.get("name") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      price: safeNumber(form.get("price")),
      status: String(form.get("status") ?? "Disponible") as PropertyStatus,
      owner: String(form.get("owner") ?? "").trim(),
      bedrooms: safeNumber(form.get("bedrooms")),
      surface: safeNumber(form.get("surface")),
      notes: String(form.get("notes") ?? "").trim()
    };

    if (!updatedProperty.name) return;

    onUpdate(updatedProperty);
    setEditingProperty(null);
    setSelectedProperty(updatedProperty);
  }

  function openEdit(property: Property) {
    setEditingProperty(property);

    setTimeout(() => {
      document.getElementById("property-edit-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 50);
  }

  return (
    <div className="two-columns wide-left">
      <section className="property-grid">
        <div className="card asset-filter-card">
          <div>
            <p className="eyebrow" data-semantic-text={"Filtres biens"}>{t("crm.properties.8789b96118")}</p>
            <h3>{visibleProperties.length}{" "}{t("crm.properties.4e61e7a4d9")}</h3>
          </div>

          <div className="asset-filter-grid">
            <BusinessLabel>{t("crm.properties.dee377cfd8")}<select value={propertyStatusFilter} onChange={(event) => setPropertyStatusFilter(event.target.value as "Tous" | PropertyStatus)}>
                <option value="Tous">{t("crm.properties.2ff5998143")}</option>
                {propertyStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
              </select>
            </BusinessLabel>

            <BusinessLabel>{t("crm.properties.0ebd25a341")}<input value={propertyCityFilter} onChange={(event) => setPropertyCityFilter(event.target.value)} placeholder={t("crm.properties.4664cdd74b")} />
            </BusinessLabel>
          </div>
        </div>

        {visibleProperties.length === 0 && (
          <div className="empty-state">
            <h3>{t("crm.properties.d4456bde7c")}</h3>
            <p>{t("crm.properties.09cc57a0ec")}</p>
          </div>
        )}

        {visibleProperties.map((property) => (
          <article className="property-card" key={property.id}>
            <div className="property-visual">
              <span>{property.city || t("crm.properties.3d7ed1bfba")}</span>

              <BusinessButton permission="remove"
                className="asset-reset-button icon-button light"
                onClick={() => {
                  const confirmed = window.confirm(dialogT("crm.properties.a451e23492", { value1: displayValue(property.name) }));
                  if (confirmed) onDelete(property.id);
                }}
                aria-label={t("crm.properties.5e5d0216ce")}
              >{t("crm.properties.8db71ed28b")}</BusinessButton>
            </div>

            <div className="property-body">
              <div className="section-heading compact-heading">
                <div>
                  <h3>{property.name}</h3>
                  <p>{property.city || t("crm.properties.b9d4fe5d85")}</p>
                </div>
                <Badge>{label(property.status, "crm")}</Badge>
              </div>

              <dl className="property-meta">
                <div><dt>{t("crm.properties.54c324f6c1")}</dt><dd>{screen.money(property.price)}</dd></div>
                <div><dt>{t("crm.properties.6d76352164")}</dt><dd>{property.bedrooms || "—"}</dd></div>
                <div><dt>{t("crm.properties.0905f7f590")}</dt><dd>{property.surface ? t("crm.properties.7797793c45", { value1: displayValue(property.surface) }) : "—"}</dd></div>
                <div><dt>{t("crm.properties.4b1b8aa360")}</dt><dd>{property.owner || "—"}</dd></div>
              </dl>
              <ActionMeta item={property} />

              <div className="asset-card-actions">
                <BusinessButton className="asset-detail-button" type="button" onClick={() => setSelectedProperty(property)} data-crm-auto-scroll="true" data-crm-action="details">{t("crm.properties.17eaee489b")}</BusinessButton>

                <BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => openEdit(property)} data-crm-auto-scroll="true">{t("crm.properties.42e37604b6")}</BusinessButton>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card form-card">
        <p className="eyebrow" data-semantic-text={"Nouveau"}>{t("crm.properties.c3634f2ede")}</p>
        <h3>{t("crm.properties.930aa2c6c9")}</h3>

        <BusinessForm className="form-grid contact-create-form" onSubmit={onAdd}>
          <BusinessLabel>{t("crm.properties.b2c124536d")}<input name="name" placeholder={t("crm.properties.c64fa18415")} /></BusinessLabel>
          <BusinessLabel>{t("crm.properties.0ebd25a341")}<input name="city" placeholder={t("crm.properties.0d488ded44")} /></BusinessLabel>
          <BusinessLabel>{t("crm.properties.54c324f6c1")}<input name="price" type="number" min="0" placeholder="120000" /></BusinessLabel>

          <BusinessLabel>{t("crm.properties.dee377cfd8")}<select name="status">
              {propertyStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.properties.b406881e07")}<input name="owner" placeholder={t("crm.properties.516683c1f0")} /></BusinessLabel>
          <BusinessLabel>{t("crm.properties.6d76352164")}<input name="bedrooms" type="number" min="0" placeholder="6" /></BusinessLabel>
          <BusinessLabel>{t("crm.properties.da0708ff96")}<input name="surface" type="number" min="0" placeholder="420" /></BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.properties.00f9c53345")}</BusinessButton>
        </BusinessForm>
      </section>

      {selectedProperty && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog asset-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Fiche bien"}>{t("crm.properties.8acd64a7bf")}</p>
            <h3>{selectedProperty.name}</h3>

            <div className="asset-detail-grid">
              <div><span>{t("crm.properties.dee377cfd8")}</span><strong>{label(selectedProperty.status, "crm")}</strong></div>
              <div><span>{t("crm.properties.0ebd25a341")}</span><strong>{selectedProperty.city || t("crm.properties.831460cb02")}</strong></div>
              <div><span>{t("crm.properties.54c324f6c1")}</span><strong>{screen.money(selectedProperty.price)}</strong></div>
              <div><span>{t("crm.properties.4b1b8aa360")}</span><strong>{selectedProperty.owner || t("crm.properties.cb6c1fb76c")}</strong></div>
              <div><span>{t("crm.properties.6d76352164")}</span><strong>{selectedProperty.bedrooms || "—"}</strong></div>
              <div><span>{t("crm.properties.0905f7f590")}</span><strong>{selectedProperty.surface ? t("crm.properties.7797793c45", { value1: displayValue(selectedProperty.surface) }) : "—"}</strong></div>
              <div className="full"><span>{t("crm.properties.d96ddd0984")}</span><p>{selectedProperty.notes || t("crm.properties.164fc8c2e2")}</p></div>
            </div>

            <div className="asset-related-section">
              <p className="eyebrow" data-semantic-text={"Leads liés à ce bien"}>{t("crm.properties.593f35e206")}</p>

              <div className="list-stack oar-contact-list-stack">
                {getPropertyLeads(selectedProperty).length === 0 && (
                  <p className="muted-line">{t("crm.properties.837aafc0b2")}</p>
                )}

                {getPropertyLeads(selectedProperty).map((lead) => (
                  <article className="mini-row" key={lead.id}>
                    <div>
                      <strong>{lead.contactName}</strong>
                      <span>{label(lead.status, "crm")} · {screen.money(lead.value)}</span>
                    </div>
                    <Badge>{label(lead.priority, "crm")}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedProperty(null)} data-crm-dismiss="true">{t("crm.properties.711e5f2e19")}</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedProperty)} data-crm-auto-scroll="true">{t("crm.properties.42e37604b6")}</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingProperty && (
        <div className="confirm-backdrop">
          <div id="property-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Modification"}>{t("crm.properties.46889b43bc")}</p>
            <h3>{t("crm.properties.4180273030")}</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>{t("crm.properties.b2c124536d")}<input name="name" defaultValue={editingProperty.name} /></BusinessLabel>
              <BusinessLabel>{t("crm.properties.0ebd25a341")}<input name="city" defaultValue={editingProperty.city} /></BusinessLabel>
              <BusinessLabel>{t("crm.properties.54c324f6c1")}<input name="price" type="number" min="0" defaultValue={editingProperty.price || ""} /></BusinessLabel>

              <BusinessLabel>{t("crm.properties.dee377cfd8")}<select name="status" defaultValue={editingProperty.status}>
                  {propertyStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.properties.b406881e07")}<input name="owner" defaultValue={editingProperty.owner} /></BusinessLabel>
              <BusinessLabel>{t("crm.properties.6d76352164")}<input name="bedrooms" type="number" min="0" defaultValue={editingProperty.bedrooms || ""} /></BusinessLabel>
              <BusinessLabel>{t("crm.properties.da0708ff96")}<input name="surface" type="number" min="0" defaultValue={editingProperty.surface || ""} /></BusinessLabel>

              <BusinessLabel className="full">{t("crm.properties.d96ddd0984")}<textarea name="notes" defaultValue={editingProperty.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingProperty(null)} data-crm-dismiss="true">{t("crm.properties.46ad3916f6")}</BusinessButton>
                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.properties.71dc74873e")}</BusinessButton>
              </div>
            </BusinessForm>
          </div>
        </div>
      )}
    </div>
  );
}

function VehiclesView({
  vehicles,
  leads,
  onAdd,
  onUpdate,
  onDelete
}: {
  vehicles: Vehicle[];
  leads: Lead[];
  onAdd: (event: React.FormEvent<HTMLFormElement>) => void;
  onUpdate: (vehicle: Vehicle) => void;
  onDelete: (id: string) => void;
}) {
  const { t, label, locale, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState<"Tous" | VehicleStatus>("Tous");
  const [vehicleCityFilter, setVehicleCityFilter] = useState("");

  const visibleVehicles = vehicles.filter((vehicle) => {
    const statusMatches = vehicleStatusFilter === "Tous" || vehicle.status === vehicleStatusFilter;
    const cityMatches = vehicle.city.toLowerCase().includes(vehicleCityFilter.toLowerCase().trim());
    return statusMatches && cityMatches;
  });

  function getVehicleLeads(vehicle: Vehicle) {
    return leads.filter((lead) => lead.assetType === "Vehicle" && lead.assetId === vehicle.id);
  }

  function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingVehicle) return;

    const form = new FormData(event.currentTarget);

    const updatedVehicle: Vehicle = {
      ...editingVehicle,
      name: String(form.get("name") ?? "").trim(),
      brand: String(form.get("brand") ?? "").trim(),
      model: String(form.get("model") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      price: safeNumber(form.get("price")),
      status: String(form.get("status") ?? "Disponible") as VehicleStatus,
      owner: String(form.get("owner") ?? "").trim(),
      year: safeNumber(form.get("year")),
      mileage: safeNumber(form.get("mileage")),
      notes: String(form.get("notes") ?? "").trim()
    };

    if (!updatedVehicle.name) return;

    onUpdate(updatedVehicle);
    setEditingVehicle(null);
    setSelectedVehicle(updatedVehicle);
  }

  function openEdit(vehicle: Vehicle) {
    setEditingVehicle(vehicle);
    setTimeout(() => {
      document.getElementById("vehicle-edit-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  return (
    <div className="two-columns wide-left">
      <section className="property-grid">
        <div className="card asset-filter-card">
          <div>
            <p className="eyebrow" data-semantic-text={"Filtres voitures"}>{t("crm.vehicles.6308e08581")}</p>
            <h3>{visibleVehicles.length}{" "}{t("crm.vehicles.c2a733dba7")}</h3>
          </div>

          <div className="asset-filter-grid">
            <BusinessLabel>{t("crm.vehicles.dee377cfd8")}<select value={vehicleStatusFilter} onChange={(event) => setVehicleStatusFilter(event.target.value as "Tous" | VehicleStatus)}>
                <option value="Tous">{t("crm.vehicles.2ff5998143")}</option>
                {vehicleStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
              </select>
            </BusinessLabel>

            <BusinessLabel>{t("crm.vehicles.0ebd25a341")}<input value={vehicleCityFilter} onChange={(event) => setVehicleCityFilter(event.target.value)} placeholder={t("crm.vehicles.897ebccda8")} />
            </BusinessLabel>
          </div>
        </div>

        {visibleVehicles.length === 0 && (
          <div className="empty-state">
            <h3>{t("crm.vehicles.adb21e4c79")}</h3>
            <p>{t("crm.vehicles.09cc57a0ec")}</p>
          </div>
        )}

        {visibleVehicles.map((vehicle) => (
          <article className="property-card" key={vehicle.id}>
            <div className="property-visual">
              <span>{vehicle.brand || t("crm.vehicles.035004be54")}</span>
              <BusinessButton permission="remove" className="asset-reset-button icon-button light" onClick={() => {
                const confirmed = window.confirm(dialogT("crm.vehicles.a451e23492", { value1: displayValue(vehicle.name) }));
                if (confirmed) onDelete(vehicle.id);
              }} aria-label={t("crm.vehicles.5e5d0216ce")}>{t("crm.vehicles.8db71ed28b")}</BusinessButton>
            </div>

            <div className="property-body">
              <div className="section-heading compact-heading">
                <div>
                  <h3>{vehicle.name}</h3>
                  <p>{vehicle.city || t("crm.vehicles.b9d4fe5d85")}</p>
                </div>
                <Badge>{label(vehicle.status, "crm")}</Badge>
              </div>

              <dl className="property-meta">
                <div><dt>{t("crm.vehicles.6e55aff773")}</dt><dd>{screen.money(vehicle.price)}</dd></div>
                <div><dt>{t("crm.vehicles.561408ffca")}</dt><dd>{vehicle.year || "—"}</dd></div>
                <div><dt>{t("crm.vehicles.91166285d4")}</dt><dd>{vehicle.mileage ? t("crm.vehicles.9b0f0d8a88", { value1: displayValue(vehicle.mileage.toLocaleString(locale)) }) : "—"}</dd></div>
                <div><dt>{t("crm.vehicles.4b1b8aa360")}</dt><dd>{vehicle.owner || "—"}</dd></div>
              </dl>
              <ActionMeta item={vehicle} />

              <div className="asset-card-actions">
                <BusinessButton className="asset-detail-button" type="button" onClick={() => setSelectedVehicle(vehicle)} data-crm-auto-scroll="true" data-crm-action="details">{t("crm.vehicles.17eaee489b")}</BusinessButton>
                <BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => openEdit(vehicle)} data-crm-auto-scroll="true">{t("crm.vehicles.42e37604b6")}</BusinessButton>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card form-card">
        <p className="eyebrow" data-semantic-text={"Nouveau"}>{t("crm.vehicles.c3634f2ede")}</p>
        <h3>{t("crm.vehicles.8eea43262a")}</h3>

        <BusinessForm className="form-grid contact-create-form" onSubmit={onAdd}>
          <BusinessLabel>{t("crm.vehicles.b2c124536d")}<input name="name" placeholder={t("crm.vehicles.292d966641")} /></BusinessLabel>
          <BusinessLabel>{t("crm.vehicles.ee5745548b")}<input name="brand" placeholder={t("crm.vehicles.18e111af26")} /></BusinessLabel>
          <BusinessLabel>{t("crm.vehicles.e61bbb839e")}<input name="model" placeholder={t("crm.vehicles.5473d5ace1")} /></BusinessLabel>
          <BusinessLabel>{t("crm.vehicles.0ebd25a341")}<input name="city" placeholder={t("crm.vehicles.0d488ded44")} /></BusinessLabel>
          <BusinessLabel>{t("crm.vehicles.6e55aff773")}<input name="price" type="number" min="0" placeholder="900" /></BusinessLabel>

          <BusinessLabel>{t("crm.vehicles.dee377cfd8")}<select name="status">
              {vehicleStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.vehicles.b406881e07")}<input name="owner" placeholder={t("crm.vehicles.516683c1f0")} /></BusinessLabel>
          <BusinessLabel>{t("crm.vehicles.561408ffca")}<input name="year" type="number" min="1900" placeholder="2024" /></BusinessLabel>
          <BusinessLabel>{t("crm.vehicles.91166285d4")}<input name="mileage" type="number" min="0" placeholder="12000" /></BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.vehicles.00f9c53345")}</BusinessButton>
        </BusinessForm>
      </section>

      {selectedVehicle && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog asset-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Fiche voiture"}>{t("crm.vehicles.29196e9e1d")}</p>
            <h3>{selectedVehicle.name}</h3>

            <div className="asset-detail-grid">
              <div><span>{t("crm.vehicles.ee5745548b")}</span><strong>{selectedVehicle.brand || "—"}</strong></div>
              <div><span>{t("crm.vehicles.e61bbb839e")}</span><strong>{selectedVehicle.model || "—"}</strong></div>
              <div><span>{t("crm.vehicles.dee377cfd8")}</span><strong>{label(selectedVehicle.status, "crm")}</strong></div>
              <div><span>{t("crm.vehicles.0ebd25a341")}</span><strong>{selectedVehicle.city || "—"}</strong></div>
              <div><span>{t("crm.vehicles.6e55aff773")}</span><strong>{screen.money(selectedVehicle.price)}</strong></div>
              <div><span>{t("crm.vehicles.4b1b8aa360")}</span><strong>{selectedVehicle.owner || "—"}</strong></div>
              <div><span>{t("crm.vehicles.561408ffca")}</span><strong>{selectedVehicle.year || "—"}</strong></div>
              <div><span>{t("crm.vehicles.91166285d4")}</span><strong>{selectedVehicle.mileage ? t("crm.vehicles.9b0f0d8a88", { value1: displayValue(selectedVehicle.mileage.toLocaleString(locale)) }) : "—"}</strong></div>
              <div className="full"><span>{t("crm.vehicles.d96ddd0984")}</span><p>{selectedVehicle.notes || t("crm.vehicles.164fc8c2e2")}</p></div>
            </div>

            <div className="asset-related-section">
              <p className="eyebrow" data-semantic-text={"Leads liés à cette voiture"}>{t("crm.vehicles.d297b81657")}</p>

              <div className="list-stack oar-contact-list-stack">
                {getVehicleLeads(selectedVehicle).length === 0 && (
                  <p className="muted-line">{t("crm.vehicles.cb48ec30ef")}</p>
                )}

                {getVehicleLeads(selectedVehicle).map((lead) => (
                  <article className="mini-row" key={lead.id}>
                    <div>
                      <strong>{lead.contactName}</strong>
                      <span>{label(lead.status, "crm")} · {screen.money(lead.value)}</span>
                    </div>
                    <Badge>{label(lead.priority, "crm")}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedVehicle(null)} data-crm-dismiss="true">{t("crm.vehicles.711e5f2e19")}</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedVehicle)} data-crm-auto-scroll="true">{t("crm.vehicles.42e37604b6")}</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingVehicle && (
        <div className="confirm-backdrop">
          <div id="vehicle-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Modification"}>{t("crm.vehicles.46889b43bc")}</p>
            <h3>{t("crm.vehicles.5e17ed2a84")}</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>{t("crm.vehicles.b2c124536d")}<input name="name" defaultValue={editingVehicle.name} /></BusinessLabel>
              <BusinessLabel>{t("crm.vehicles.ee5745548b")}<input name="brand" defaultValue={editingVehicle.brand} /></BusinessLabel>
              <BusinessLabel>{t("crm.vehicles.e61bbb839e")}<input name="model" defaultValue={editingVehicle.model} /></BusinessLabel>
              <BusinessLabel>{t("crm.vehicles.0ebd25a341")}<input name="city" defaultValue={editingVehicle.city} /></BusinessLabel>
              <BusinessLabel>{t("crm.vehicles.6e55aff773")}<input name="price" type="number" min="0" defaultValue={editingVehicle.price || ""} /></BusinessLabel>

              <BusinessLabel>{t("crm.vehicles.dee377cfd8")}<select name="status" defaultValue={editingVehicle.status}>
                  {vehicleStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.vehicles.b406881e07")}<input name="owner" defaultValue={editingVehicle.owner} /></BusinessLabel>
              <BusinessLabel>{t("crm.vehicles.561408ffca")}<input name="year" type="number" min="1900" defaultValue={editingVehicle.year || ""} /></BusinessLabel>
              <BusinessLabel>{t("crm.vehicles.91166285d4")}<input name="mileage" type="number" min="0" defaultValue={editingVehicle.mileage || ""} /></BusinessLabel>

              <BusinessLabel className="full">{t("crm.vehicles.d96ddd0984")}<textarea name="notes" defaultValue={editingVehicle.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingVehicle(null)} data-crm-dismiss="true">{t("crm.vehicles.46ad3916f6")}</BusinessButton>
                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.vehicles.71dc74873e")}</BusinessButton>
              </div>
            </BusinessForm>
          </div>
        </div>
      )}
    </div>
  );
}

function BoatsView({
  boats,
  leads,
  onAdd,
  onUpdate,
  onDelete
}: {
  boats: Boat[];
  leads: Lead[];
  onAdd: (event: React.FormEvent<HTMLFormElement>) => void;
  onUpdate: (boat: Boat) => void;
  onDelete: (id: string) => void;
}) {
  const { t, label, screen, dialogT } = useCRMDisplay();

  const business = useBusinessPermissions();
  const [editingBoat, setEditingBoat] = useState<Boat | null>(null);
  const [selectedBoat, setSelectedBoat] = useState<Boat | null>(null);
  const [boatStatusFilter, setBoatStatusFilter] = useState<"Tous" | BoatStatus>("Tous");
  const [boatPortFilter, setBoatPortFilter] = useState("");

  const visibleBoats = boats.filter((boat) => {
    const statusMatches = boatStatusFilter === "Tous" || boat.status === boatStatusFilter;
    const portMatches = boat.port.toLowerCase().includes(boatPortFilter.toLowerCase().trim());
    return statusMatches && portMatches;
  });

  function getBoatLeads(boat: Boat) {
    return leads.filter((lead) => lead.assetType === "Boat" && lead.assetId === boat.id);
  }

  function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBoat) return;

    const form = new FormData(event.currentTarget);

    const updatedBoat: Boat = {
      ...editingBoat,
      name: String(form.get("name") ?? "").trim(),
      port: String(form.get("port") ?? "").trim(),
      type: String(form.get("type") ?? "").trim(),
      price: safeNumber(form.get("price")),
      status: String(form.get("status") ?? "Disponible") as BoatStatus,
      owner: String(form.get("owner") ?? "").trim(),
      year: safeNumber(form.get("year")),
      length: safeNumber(form.get("length")),
      notes: String(form.get("notes") ?? "").trim()
    };

    if (!updatedBoat.name) return;

    onUpdate(updatedBoat);
    setEditingBoat(null);
    setSelectedBoat(updatedBoat);
  }

  function openEdit(boat: Boat) {
    setEditingBoat(boat);
    setTimeout(() => {
      document.getElementById("boat-edit-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  return (
    <div className="two-columns wide-left">
      <section className="property-grid">
        <div className="card asset-filter-card">
          <div>
            <p className="eyebrow" data-semantic-text={"Filtres bateaux"}>{t("crm.boats.87063ae11b")}</p>
            <h3>{visibleBoats.length}{" "}{t("crm.boats.719ddbc457")}</h3>
          </div>

          <div className="asset-filter-grid">
            <BusinessLabel>{t("crm.boats.dee377cfd8")}<select value={boatStatusFilter} onChange={(event) => setBoatStatusFilter(event.target.value as "Tous" | BoatStatus)}>
                <option value="Tous">{t("crm.boats.2ff5998143")}</option>
                {boatStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
              </select>
            </BusinessLabel>

            <BusinessLabel>{t("crm.boats.72e9a59f5a")}<input value={boatPortFilter} onChange={(event) => setBoatPortFilter(event.target.value)} placeholder={t("crm.boats.d892911e3f")} />
            </BusinessLabel>
          </div>
        </div>

        {visibleBoats.length === 0 && (
          <div className="empty-state">
            <h3>{t("crm.boats.e8b5ea9fce")}</h3>
            <p>{t("crm.boats.09cc57a0ec")}</p>
          </div>
        )}

        {visibleBoats.map((boat) => (
          <article className="property-card" key={boat.id}>
            <div className="property-visual">
              <span>{boat.type || t("crm.boats.d69c7210bc")}</span>
              <BusinessButton permission="remove" className="icon-button light" onClick={() => {
                const confirmed = window.confirm(dialogT("crm.boats.a451e23492", { value1: displayValue(boat.name) }));
                if (confirmed) onDelete(boat.id);
              }} aria-label={t("crm.boats.5e5d0216ce")}>{t("crm.boats.8db71ed28b")}</BusinessButton>
            </div>

            <div className="property-body">
              <div className="section-heading compact-heading">
                <div>
                  <h3>{boat.name}</h3>
                  <p>{boat.port || t("crm.boats.9b60dbaa36")}</p>
                </div>
                <Badge>{label(boat.status, "crm")}</Badge>
              </div>

              <dl className="property-meta">
                <div><dt>{t("crm.boats.6e55aff773")}</dt><dd>{screen.money(boat.price)}</dd></div>
                <div><dt>{t("crm.boats.e912493ce5")}</dt><dd>{boat.length ? t("crm.boats.41c4388538", { value1: displayValue(boat.length) }) : "—"}</dd></div>
                <div><dt>{t("crm.boats.561408ffca")}</dt><dd>{boat.year || "—"}</dd></div>
                <div><dt>{t("crm.boats.4b1b8aa360")}</dt><dd>{boat.owner || "—"}</dd></div>
              </dl>
              <ActionMeta item={boat} />

              <div className="asset-card-actions">
                <BusinessButton className="asset-detail-button" type="button" onClick={() => setSelectedBoat(boat)} data-crm-auto-scroll="true" data-crm-action="details">{t("crm.boats.17eaee489b")}</BusinessButton>
                <BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => openEdit(boat)} data-crm-auto-scroll="true">{t("crm.boats.42e37604b6")}</BusinessButton>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card form-card">
        <p className="eyebrow" data-semantic-text={"Nouveau"}>{t("crm.boats.c3634f2ede")}</p>
        <h3>{t("crm.boats.c5e81fbab8")}</h3>

        <BusinessForm className="form-grid contact-create-form" onSubmit={onAdd}>
          <BusinessLabel>{t("crm.boats.b2c124536d")}<input name="name" placeholder={t("crm.boats.c5c47c66d5")} /></BusinessLabel>
          <BusinessLabel>{t("crm.boats.72e9a59f5a")}<input name="port" placeholder={t("crm.boats.0d488ded44")} /></BusinessLabel>
          <BusinessLabel>{t("crm.boats.baaddf70fb")}<input name="type" placeholder={t("crm.boats.f825d0aaa4")} /></BusinessLabel>
          <BusinessLabel>{t("crm.boats.6e55aff773")}<input name="price" type="number" min="0" placeholder="4500" /></BusinessLabel>

          <BusinessLabel>{t("crm.boats.dee377cfd8")}<select name="status">
              {boatStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
            </select>
          </BusinessLabel>

          <BusinessLabel>{t("crm.boats.b406881e07")}<input name="owner" placeholder={t("crm.boats.516683c1f0")} /></BusinessLabel>
          <BusinessLabel>{t("crm.boats.561408ffca")}<input name="year" type="number" min="1900" placeholder="2021" /></BusinessLabel>
          <BusinessLabel>{t("crm.boats.f2b9291c90")}<input name="length" type="number" min="0" placeholder="17" /></BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.boats.00f9c53345")}</BusinessButton>
        </BusinessForm>
      </section>

      {selectedBoat && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog asset-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Fiche bateau"}>{t("crm.boats.f92bc9bd5f")}</p>
            <h3>{selectedBoat.name}</h3>

            <div className="asset-detail-grid">
              <div><span>{t("crm.boats.baaddf70fb")}</span><strong>{selectedBoat.type || "—"}</strong></div>
              <div><span>{t("crm.boats.72e9a59f5a")}</span><strong>{selectedBoat.port || "—"}</strong></div>
              <div><span>{t("crm.boats.dee377cfd8")}</span><strong>{label(selectedBoat.status, "crm")}</strong></div>
              <div><span>{t("crm.boats.6e55aff773")}</span><strong>{screen.money(selectedBoat.price)}</strong></div>
              <div><span>{t("crm.boats.4b1b8aa360")}</span><strong>{selectedBoat.owner || "—"}</strong></div>
              <div><span>{t("crm.boats.561408ffca")}</span><strong>{selectedBoat.year || "—"}</strong></div>
              <div><span>{t("crm.boats.e912493ce5")}</span><strong>{selectedBoat.length ? t("crm.boats.41c4388538", { value1: displayValue(selectedBoat.length) }) : "—"}</strong></div>
              <div className="full"><span>{t("crm.boats.d96ddd0984")}</span><p>{selectedBoat.notes || t("crm.boats.164fc8c2e2")}</p></div>
            </div>

            <div className="asset-related-section">
              <p className="eyebrow" data-semantic-text={"Leads liés à ce bateau"}>{t("crm.boats.69bd4b39ce")}</p>

              <div className="list-stack oar-contact-list-stack">
                {getBoatLeads(selectedBoat).length === 0 && (
                  <p className="muted-line">{t("crm.boats.35bfc29f95")}</p>
                )}

                {getBoatLeads(selectedBoat).map((lead) => (
                  <article className="mini-row" key={lead.id}>
                    <div>
                      <strong>{lead.contactName}</strong>
                      <span>{label(lead.status, "crm")} · {screen.money(lead.value)}</span>
                    </div>
                    <Badge>{label(lead.priority, "crm")}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedBoat(null)} data-crm-dismiss="true">{t("crm.boats.711e5f2e19")}</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedBoat)} data-crm-auto-scroll="true">{t("crm.boats.42e37604b6")}</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingBoat && (
        <div className="confirm-backdrop">
          <div id="boat-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow" data-semantic-text={"Modification"}>{t("crm.boats.46889b43bc")}</p>
            <h3>{t("crm.boats.8367eb7edc")}</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>{t("crm.boats.b2c124536d")}<input name="name" defaultValue={editingBoat.name} /></BusinessLabel>
              <BusinessLabel>{t("crm.boats.72e9a59f5a")}<input name="port" defaultValue={editingBoat.port} /></BusinessLabel>
              <BusinessLabel>{t("crm.boats.baaddf70fb")}<input name="type" defaultValue={editingBoat.type} /></BusinessLabel>
              <BusinessLabel>{t("crm.boats.6e55aff773")}<input name="price" type="number" min="0" defaultValue={editingBoat.price || ""} /></BusinessLabel>

              <BusinessLabel>{t("crm.boats.dee377cfd8")}<select name="status" defaultValue={editingBoat.status}>
                  {boatStatuses.map((status) => <option key={status} value={status}>{label(status, "crm")}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>{t("crm.boats.b406881e07")}<input name="owner" defaultValue={editingBoat.owner} /></BusinessLabel>
              <BusinessLabel>{t("crm.boats.561408ffca")}<input name="year" type="number" min="1900" defaultValue={editingBoat.year || ""} /></BusinessLabel>
              <BusinessLabel>{t("crm.boats.f2b9291c90")}<input name="length" type="number" min="0" defaultValue={editingBoat.length || ""} /></BusinessLabel>

              <BusinessLabel className="full">{t("crm.boats.d96ddd0984")}<textarea name="notes" defaultValue={editingBoat.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingBoat(null)} data-crm-dismiss="true">{t("crm.boats.46ad3916f6")}</BusinessButton>
                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{t("crm.boats.71dc74873e")}</BusinessButton>
              </div>
            </BusinessForm>
          </div>
        </div>
      )}
    </div>
  );
}


function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

// Shared business views: importing these never mounts CRMApp or its global persistence.
export { QuotesView, BookingsView, HouseTrackingView, VendorInvoicesView, ContactsView, LeadsView, PropertiesView, VehiclesView, BoatsView, PlanningView, Dashboard, createDraftQuoteFromLead, safeNumber, parseAssetKey, normalizePlanningCategory, getPlanningCategoryFromAssetType, isValidPlanningDate, planningDateValue, getQuoteStatus, getQuoteTotal };
export type { QuoteRequest };
