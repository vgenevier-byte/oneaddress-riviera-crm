"use client";

import { BusinessForm, BusinessLabel, BusinessButton, BusinessSelect, useBusinessPermissions } from "./BusinessPermissions";
import { useConfirmedForm, type FormSave } from "@/lib/access/useConfirmedForm";
import QuickRepliesView from "./QuickRepliesView";
import { ContactPostalAddressField, ContactPostalAddressDetails } from "./ContactPostalAddress";
import { getContactFormUpdate, mergeContactUpdate, readPostalAddress } from "@/lib/contactEditing";
import SearchableBusinessContactPicker from "./SearchableBusinessContactPicker";
import vendorFinanceStyles from "./VendorFinanceDialogs.module.css";
import { VendorInvoiceDuplicateDialog } from "./VendorFinanceDialogs";
import VendorQuotesView from "./VendorQuotesView";
import MobileCRMHeader from "./MobileCRMHeader";
import UnifiedNavigation, { type UnifiedTab } from "./UnifiedNavigation";
import type { AccessSnapshot } from "@/lib/access/modules";
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

import { isCompletedTaskStatus, maintainCompletedTasks } from "@/lib/taskMaintenance";
import { crmCache } from "@/lib/access/crmCache";
import { useCommittedValue } from "@/lib/access/useCommittedValue";
import { WorkspaceSyncGuard, workspaceFingerprint } from "@/lib/access/workspaceSync";
import { supabase } from "@/lib/supabase";
import { fetchDriveAPI } from "@/lib/driveClient";
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
const taskStatuses: TaskStatus[] = ["À faire", "En cours", "Terminé"];

const contactKinds: ContactKind[] = ["Client", "Propriétaire", "Prestataire"];
const contactLevels = ["Standard", "VIP", "Ultra VIP"] as const;
const contactLanguages = ["Français", "Anglais", "Italien", "Autre"] as const;
const contactRelationshipStatuses = ["Prospect", "Actif", "Dormant", "Prestataire"] as const;
const supplierCategories = ["Chauffeur", "Chef", "Sécurité", "Conciergerie", "Paysagiste", "Gestion nuisibles", "Pisciniste", "Femme de ménage", "Nounou", "Artisan rénovation", "Technicien volets", "Lavage voiture", "Garage / mécanicien", "Jardinier", "Peinture", "Électricité", "Plomberie", "Autre"] as const;
const crmActors = ["Matteo", "Vincent"] as const;
type CRMActor = typeof crmActors[number];

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
  return contact.kind === "Prestataire" || Boolean(contact.supplierCategory);
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
    tasks: Array.isArray(payload?.tasks) ? payload.tasks : [],
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
  message: string;
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
  const hourlyRate = Number(raw.hourlyRate || 0);

  return {
    id: String(raw.id || makeId("worker")),
    contactId: String(raw.contactId || ""),
    contactName: String(raw.contactName || "Intervenant à compléter"),
    role: String(raw.role || "Intervenant"),
    hourlyRate: Number.isFinite(hourlyRate) ? hourlyRate : 0,
    documentUrl: String(raw.documentUrl || ""),
    documentStoragePath: String(raw.documentStoragePath || raw.storagePath || ""),
    documentFileName: String(raw.documentFileName || raw.fileName || ""),
    documentUploadedAt: String(raw.documentUploadedAt || raw.uploadedAt || ""),
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
  return value === "Matteo" || value === "Vincent";
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
  return <small className="action-meta">{getActionMetaLabel(item)}</small>;
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
    kind: (() => { const rawKind = String(row.kind || "Client"); return rawKind === "Partenaire" || rawKind === "Prestataire" ? "Prestataire" : rawKind === "Propriétaire" ? "Propriétaire" : "Client"; })() as ContactKind,
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
      headers: ["Nom", "Type", "Niveau client", "Langue", "Relation", "Email", "Téléphone", "Ville", "Adresse postale", "Budget", "Source", "Préférences", "Notes importantes", "Notes"],
      rows: data.contacts.map((contact) => [
        contact.name,
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
        contact.notes
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
      headers: ["Titre", "Responsable", "Statut", "Date", "Lead lié"],
      rows: data.tasks.map((task) => [
        task.title,
        task.owner,
        task.status,
        task.dueDate,
        task.linkedTo
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
      window.alert("Sélectionnez un client.");
      return;
    }

    if (selectedCategories.length === 0) {
      window.alert("Sélectionnez au moins une prestation.");
      return;
    }

    if (quoteItems.some((item) => item.unitPrice <= 0)) {
      window.alert("Renseignez un prix pour chaque prestation sélectionnée.");
      return;
    }

    if (!startDate || !endDate) {
      window.alert("Renseignez les dates demandées.");
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
            <p className="eyebrow">Devis</p>
            <h3>{visibleQuotes.length} devis affiché{visibleQuotes.length > 1 ? "s" : ""}{statusFilter !== "Tous" ? ` · ${quotes.length} total` : ""}</h3>
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
              {status === "Tous" ? "Tous" : getQuoteStatusFrenchLabel(status)}
            </BusinessButton>
          ))}
        </div>

        {visibleQuotes.length === 0 ? (
            <p className="muted-line">Aucun devis pour le moment. Créez d’abord un contact et un lead, puis générez un devis depuis le lead.</p>
          ) : (
            visibleQuotes.map((quote) => (
              <article className="quote-card" key={quote.id} data-notification-target={`quote-${quote.id}`}>
                <div>
                  <p className="eyebrow">{getQuoteItems(quote).map((item) => getQuoteCategoryFrenchLabel(item.category)).join(" · ")}</p>
                  <h3>{quote.title || quote.clientName}</h3>
                  <p>{quote.clientName}</p>
                  <p>Du {formatQuoteDate(quote.startDate)} au {formatQuoteDate(quote.endDate)}</p>
                  <strong>{formatQuotePrice(getQuoteSubtotal(quote))}</strong>

                  {getQuoteDepositTotal(quote) > 0 && (
                    <small>Caution : {formatQuotePrice(getQuoteDepositTotal(quote))}</small>
                  )}

                  <ul className="quote-line-preview">
                    {getQuoteItems(quote).map((item) => (
                      <li key={item.id}>
                        <span>{getQuoteCategoryFrenchLabel(item.category)}</span>
                        <strong>{formatQuotePrice(item.unitPrice)} {getQuoteUnitShortLabel(item.billingUnit)}</strong>
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
                    aria-label="Devis status"
                  >
                    {quoteStatuses.map((status) => (
                      <option key={status} value={status}>{getQuoteStatusFrenchLabel(status)}</option>
                    ))}
                  </BusinessSelect>

                  <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => fillQuoteForm(quote)}>
                    Modifier
                  </BusinessButton>

                  <BusinessButton permission="export" className="primary-button" type="button" onClick={async() => { if(business){try{await business.check();}catch{return;}} openQuotePdf(quote); }}>
                    Générer PDF
                  </BusinessButton>

                  <BusinessButton permission="remove"
                    className="danger-link"
                    type="button"
                    onClick={() => {
                      const confirmed = window.confirm("Supprimer ce devis ?");
                      if (!confirmed) return;
                      setQuotes((current) => current.filter((item) => item.id !== quote.id));
                    }}
                  >
                    Supprimer
                  </BusinessButton>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="card form-card">
        <p className="eyebrow">{editingQuoteId ? "Modification" : "Nouveau"}</p>
        <h3>{editingQuoteId ? "Modifier le devis" : "Créer un devis"}</h3>

        <BusinessForm className="form-grid" data-quote-form="true" onSubmit={addQuote} onChangeCapture={confirmation.changed} pending={confirmation.saving}>
          {confirmation.message&&<p role="alert">{confirmation.message}</p>}
          <input type="hidden" name="leadId" />
          <BusinessLabel>Client
            <input
              name="clientName"
              list="quote-client-options"
              required
              placeholder="Rechercher un client"
              autoComplete="off"
            />
            <datalist id="quote-client-options">
              {contacts.filter((contact) => !isSupplierContact(contact)).map((contact) => (
                <option
                  key={contact.id}
                  value={[contact.civility, contact.firstName, contact.name].filter(Boolean).join(" ") || contact.companyName || contact.email || contact.phone || "Client sans nom"}
                >
                  {[contact.companyName, contact.email, contact.phone, contact.city].filter(Boolean).join(" · ")}
                </option>
              ))}
            </datalist>
            <small className="quote-client-helper">Clients uniquement. Les prestataires sont exclus des devis.</small>
          </BusinessLabel>

          <BusinessLabel>Titre du devis
            <input name="title" placeholder="Séjour villa, location bateau, voiture, conciergerie..." />
          </BusinessLabel>

          <BusinessLabel>Lieu / destination
            <input name="location" placeholder="Cannes, Saint-Tropez, Monaco..." />
          </BusinessLabel>

          <BusinessLabel>Nombre de voyageurs
            <input name="guestCount" placeholder="Ex : 6 adultes, 2 enfants" />
          </BusinessLabel>

          <BusinessLabel>Date début demandée
            <input name="startDate" type="date" required />
          </BusinessLabel>

          <BusinessLabel>Date fin demandée
            <input name="endDate" type="date" required />
          </BusinessLabel>

          <BusinessLabel>Validité du devis
            <input name="validityDate" type="date" />
          </BusinessLabel>

          <fieldset className="full quote-category-box quote-lines-box">
            <legend>Prestations, prix et cautions</legend>

            {quoteCategories.map((category) => (
              <div className="quote-line-input" key={category}>
                <BusinessLabel>
                  <input type="checkbox" name="categories" value={category} />
                  {getQuoteCategoryFrenchLabel(category)}
                </BusinessLabel>

                <input name={`description${category}`} placeholder="Détail prestation" />

                <input name={`price${category}`} type="number" min="0" placeholder="Prix" />

                <select name={`unit${category}`} defaultValue="day">
                  <option value="day">Prix / jour</option>
                  <option value="week">Prix / semaine</option>
                  <option value="fixed">Forfait</option>
                </select>

                <input name={`deposit${category}`} type="number" min="0" placeholder="Caution" />
              </div>
            ))}
          </fieldset>

          <BusinessLabel className="full">Inclus
            <textarea name="included" placeholder="Ex : accueil, linge, ménage intermédiaire, skipper, livraison..." />
          </BusinessLabel>

          <BusinessLabel className="full">Non inclus
            <textarea name="excluded" placeholder="Ex : carburant, extras, transferts, repas, taxe de séjour..." />
          </BusinessLabel>

          <BusinessLabel className="full">Conditions de paiement
            <textarea name="paymentTerms" placeholder="Ex : 50 % à la réservation, solde 30 jours avant arrivée..." />
          </BusinessLabel>

          <BusinessLabel className="full">Conditions d’annulation
            <textarea name="cancellationTerms" placeholder="Conditions selon saison, disponibilité et prestataires..." />
          </BusinessLabel>

          <BusinessLabel className="full">Notes internes / détails client
            <textarea name="notes" placeholder="Informations utiles, préférences client, demandes spéciales..." />
          </BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">
            {editingQuoteId ? "Enregistrer les modifications" : "Créer le devis"}
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
            >
              Annuler la modification
            </BusinessButton>
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
      window.alert("Ajoutez au minimum le nom du prestataire.");
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
            <p className="eyebrow">Réseau privé</p>
            <h3>{visibleSuppliers.length} prestataire{visibleSuppliers.length > 1 ? "s" : ""}</h3>
          </div>
          <p className="muted-line">Partenaires et prestataires privés à activer rapidement.</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={categoryFilter === category ? "primary-button" : "secondary-button"}
              onClick={() => setCategoryFilter(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {visibleSuppliers.length === 0 ? (
          <p className="muted-line">Aucun prestataire dans cette catégorie.</p>
        ) : (
          <div className="list-stack oar-contact-list-stack">
            {visibleSuppliers.map((supplier) => (
              <article className="item-card" key={supplier.id}>
                <div>
                  <p className="eyebrow">{supplier.category} · {supplier.status}</p>
                  <h3>{supplier.name}</h3>
                  <p>{supplier.contactName || "Contact à compléter"}</p>
                  <p className="muted-line">{supplier.zone || "Zone non renseignée"}</p>
                  <p className="muted-line">
                    Qualité : {supplier.quality} · Fiabilité : {supplier.reliability}
                  </p>
                  {supplier.priceNotes && <p className="muted-line">Prix : {supplier.priceNotes}</p>}
                  {supplier.commissionNotes && <p className="muted-line">Commission : {supplier.commissionNotes}</p>}
                  {supplier.notes && <p>{supplier.notes}</p>}
                </div>

                <div className="item-actions contact-row-actions oar-contact-actions">
                  {supplier.phone && (
                    <a className="secondary-button" href={`tel:${supplier.phone}`}>
                      Appeler
                    </a>
                  )}
                  {supplier.email && (
                    <a className="secondary-button" href={`mailto:${supplier.email}`}>
                      Email
                    </a>
                  )}
                  <button className="secondary-button" type="button" onClick={() => setEditingSupplier(supplier)}>
                    Modifier
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      if (window.confirm("Supprimer ce prestataire ?")) {
                        onDelete(supplier.id);
                      }
                    }}
                  >
                    Supprimer
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <p className="eyebrow">{editingSupplier ? "Modification" : "Nouveau"}</p>
        <h3>{editingSupplier ? "Modifier le prestataire" : "Ajouter un prestataire"}</h3>

        <form className="form-grid" onSubmit={submitSupplier}>
          <label>Nom prestataire
            <input name="name" defaultValue={editingSupplier?.name ?? ""} placeholder="Ex : Riviera Chauffeur Premium" />
          </label>

          <label>Catégorie
            <select name="category" defaultValue={editingSupplier?.category ?? "Autre"}>
              {categories.filter((category) => category !== "Tous").map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>

          <label>Contact
            <input name="contactName" defaultValue={editingSupplier?.contactName ?? ""} placeholder="Nom du contact" />
          </label>

          <label>Email
            <input name="email" type="email" defaultValue={editingSupplier?.email ?? ""} placeholder="email@exemple.com" />
          </label>

          <label>Téléphone
            <input name="phone" defaultValue={editingSupplier?.phone ?? ""} placeholder="+33..." />
          </label>

          <label>Zone
            <input name="zone" defaultValue={editingSupplier?.zone ?? ""} placeholder="Cannes, Monaco, Saint-Tropez..." />
          </label>

          <label>Qualité
            <select name="quality" defaultValue={editingSupplier?.quality ?? "Standard"}>
              <option>Standard</option>
              <option>Premium</option>
              <option>Très premium</option>
            </select>
          </label>

          <label>Fiabilité
            <select name="reliability" defaultValue={editingSupplier?.reliability ?? "À tester"}>
              <option>À tester</option>
              <option>Fiable</option>
              <option>Très fiable</option>
              <option>À éviter</option>
            </select>
          </label>

          <label>Notes prix
            <textarea name="priceNotes" defaultValue={editingSupplier?.priceNotes ?? ""} placeholder="Tarifs, minimum spend, conditions..." />
          </label>

          <label>Commission / marge
            <textarea name="commissionNotes" defaultValue={editingSupplier?.commissionNotes ?? ""} placeholder="Commission, marge, accord partenaire..." />
          </label>

          <label>Notes internes
            <textarea name="notes" defaultValue={editingSupplier?.notes ?? ""} placeholder="Réactivité, points forts, points faibles..." />
          </label>

          <label>Statut
            <select name="status" defaultValue={editingSupplier?.status ?? "Actif"}>
              <option>Actif</option>
              <option>À vérifier</option>
              <option>Inactif</option>
            </select>
          </label>

          <button className="primary-button planning-entry-submit" type="submit">
            {editingSupplier ? "Enregistrer" : "Ajouter prestataire"}
          </button>

          {editingSupplier && (
            <button className="secondary-button" type="button" onClick={() => setEditingSupplier(null)}>
              Annuler modification
            </button>
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
    if (!business) window.alert("Réservation enregistrée.");
  }

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Services confirmés</p>
          <h3>{confirmedQuotes.length} réservation{confirmedQuotes.length > 1 ? "s" : ""}</h3>
        </div>
        <p className="muted-line">
          Suivez ici les devis gagnés, la marge estimée, les paiements reçus et la préparation opérationnelle.
        </p>
      </div>

      {confirmedQuotes.length === 0 ? (
        <p className="muted-line">Aucune réservation confirmée pour le moment.</p>
      ) : (
        <div className="list-stack oar-contact-list-stack">
          {confirmedQuotes.map((quote) => {
            const services = getQuoteItems(quote)
              .map((item) => getQuoteCategoryFrenchLabel(item.category))
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
                  <p className="eyebrow">{services || "Service confirmé"}</p>
                  <h3>{quote.clientName}</h3>
                  <p>{quote.title || "Réservation confirmée"}</p>
                  <p className="muted-line">
                    Du {formatQuoteDate(quote.startDate)} au {formatQuoteDate(quote.endDate)}
                  </p>

                  <div className="stats-grid oar-contacts-stats" style={{ marginTop: 18 }}>
                    <div className="mini-stat">
                      <span>Prix client</span>
                      <strong>{formatQuotePrice(clientPrice)}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Coût prestataire</span>
                      <strong>{formatQuotePrice(supplierCost)}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Marge estimée</span>
                      <strong>{formatQuotePrice(margin)}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Solde restant</span>
                      <strong>{formatQuotePrice(remainingBalance)}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Statut paiement</span>
                      <strong>{paymentStatus}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Acompte attendu</span>
                      <strong>{formatQuotePrice(Number(quote.expectedDeposit || 0))}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Marge %</span>
                      <strong>{marginPercent}%</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Limite paiement</span>
                      <strong>{quote.paymentDueDate ? formatQuoteDate(quote.paymentDueDate) : "—"}</strong>
                    </div>
                  </div>

                  {assignedProvider && (
                    <div className="asset-detail-grid" style={{ marginTop: 18 }}>
                      <div>
                        <span>Prestataire affecté</span>
                        <strong>{assignedProvider.name}</strong>
                      </div>
                      <div>
                        <span>Profession</span>
                        <strong>{getContactSupplierCategory(assignedProvider)}</strong>
                      </div>
                      <div>
                        <span>Téléphone</span>
                        <strong>{assignedProvider.phone || "—"}</strong>
                      </div>
                      <div>
                        <span>Email</span>
                        <strong>{assignedProvider.email || "—"}</strong>
                      </div>
                    </div>
                  )}

                  <BusinessForm className="form-grid" onSubmit={(event) => updateBookingFinance(event, quote)} style={{ marginTop: 20 }}>
                    <BusinessLabel>Statut paiement
                      <select name="paymentStatus" defaultValue={quote.paymentStatus || getPaymentStatus(quote)}>
                        <option>Non payé</option>
                        <option>Acompte reçu</option>
                        <option>Partiel</option>
                        <option>Payé</option>
                        <option>Annulé / remboursé</option>
                      </select>
                    </BusinessLabel>

                    <BusinessLabel>Acompte attendu
                      <input name="expectedDeposit" type="number" min="0" step="1" defaultValue={quote.expectedDeposit || ""} placeholder="Ex : 1000" />
                    </BusinessLabel>

                    <BusinessLabel>Date limite paiement
                      <input name="paymentDueDate" type="date" defaultValue={quote.paymentDueDate || ""} />
                    </BusinessLabel>

                    <BusinessLabel>Coût prestataire
                      <input name="supplierCost" type="number" min="0" step="1" defaultValue={quote.supplierCost || ""} placeholder="Ex : 2500" />
                    </BusinessLabel>

                    <BusinessLabel>Acompte reçu
                      <input name="depositReceived" type="number" min="0" step="1" defaultValue={quote.depositReceived || ""} placeholder="Ex : 1000" />
                    </BusinessLabel>

                    <BusinessLabel>Solde reçu
                      <input name="balanceReceived" type="number" min="0" step="1" defaultValue={quote.balanceReceived || ""} placeholder="Ex : 3000" />
                    </BusinessLabel>

                    <BusinessLabel>Notes paiement
                      <textarea name="paymentNotes" defaultValue={quote.paymentNotes || ""} placeholder="Ex : acompte reçu par virement, solde attendu avant arrivée" />
                    </BusinessLabel>

                    <BusinessLabel>Prestataire affecté
                      <select name="assignedContactId" defaultValue={quote.assignedContactId || ""}>
                        <option value="">Non affecté</option>
                        {providerContacts.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name} · {getContactSupplierCategory(contact)}{getContactSupplierZone(contact) ? ` · ${getContactSupplierZone(contact)}` : ""}
                          </option>
                        ))}
                      </select>
                    </BusinessLabel>

                    <BusinessLabel>Statut opérationnel
                      <select name="bookingStatus" defaultValue={quote.bookingStatus || "À préparer"}>
                        <option>À préparer</option>
                        <option>Prestataire à confirmer</option>
                        <option>Confirmé</option>
                        <option>En cours</option>
                        <option>Terminé</option>
                        <option>Annulé</option>
                      </select>
                    </BusinessLabel>

                    <div className="card" style={{ boxShadow: "none", padding: 16 }}>
                      <p className="eyebrow">Checklist opérationnelle</p>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="clientConfirmed" type="checkbox" defaultChecked={Boolean(quote.clientConfirmed)} />
                        Client confirmé
                      </BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="depositConfirmed" type="checkbox" defaultChecked={Boolean(quote.depositConfirmed)} />
                        Acompte reçu
                      </BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="supplierConfirmed" type="checkbox" defaultChecked={Boolean(quote.supplierConfirmed)} />
                        Prestataire confirmé
                      </BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="balanceConfirmed" type="checkbox" defaultChecked={Boolean(quote.balanceConfirmed)} />
                        Solde reçu
                      </BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="detailsSent" type="checkbox" defaultChecked={Boolean(quote.detailsSent)} />
                        Détails envoyés au client
                      </BusinessLabel>

                      <BusinessLabel style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input name="serviceCompleted" type="checkbox" defaultChecked={Boolean(quote.serviceCompleted)} />
                        Service terminé
                      </BusinessLabel>
                    </div>

                    <BusinessLabel>Notes opérationnelles
                      <textarea name="operationNotes" defaultValue={quote.operationNotes || ""} placeholder="Horaires, adresse, contact sur place, contraintes, préférences client..." />
                    </BusinessLabel>

                    <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">
                      Enregistrer réservation
                    </BusinessButton>
                  </BusinessForm>
                </div>

                <div className="item-actions contact-row-actions oar-contact-actions">
                  <span className="status-pill">{quote.bookingStatus || "À préparer"}</span>
                  <BusinessButton permission="export" className="secondary-button" type="button" onClick={async() => { if(business){try{await business.check();}catch{return;}} openQuotePdf(quote); }}>
                    Ouvrir devis
                  </BusinessButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
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
  onDelete
}: {
  documents: CRMDocument[];
  activeActor: "Matteo" | "Vincent";
  onAdd: (crmDocument: CRMDocument) => void;
  onUpdate: (crmDocument: CRMDocument) => void;
  onDelete: (id: string) => void;
}) {
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
      window.alert(error instanceof Error ? error.message : "Aperçu Google Drive impossible.");
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
      window.alert(error instanceof Error ? error.message : "Téléchargement Google Drive impossible.");
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
      window.alert("Seuls Matteo et Vincent peuvent créer des dossiers.");
      return;
    }

    const name = folderName.trim();
    if (!name) {
      window.alert("Ajoutez un nom de dossier.");
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
      window.alert(`Dossier non créé : ${error instanceof Error ? error.message : "erreur inconnue"}`);
    } finally {
      setCreatingFolder(false);
    }
  }

  async function uploadFilesToFolder(fileList: FileList | File[], targetFolderId = currentFolderId, targetDriveFolderId = currentDriveFolderId) {
    const selectedFiles = Array.from(fileList || []).filter((file) => file.size > 0);

    if (!selectedFiles.length) return;

    if (!canManageDocuments) {
      window.alert("Seuls Matteo et Vincent peuvent importer des documents.");
      return;
    }

    if (!targetDriveFolderId) {
      window.alert("Ouvrez d'abord un dossier avant d'importer un document. Règle CRM : un document doit toujours être rangé dans un dossier.");
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
      window.alert(`Document non importé dans Google Drive : ${error instanceof Error ? error.message : "erreur inconnue"}`);
    } finally {
      setUploadingDocument(false);
      setDragActive(false);
    }
  }

  async function deleteDriveBackedDocument(crmDocument: CRMDocument) {
    if (crmDocument.isFolder) {
      const hasChildren = documents.some((item) => (item.folderId || item.parentFolderId || "") === crmDocument.id);
      if (hasChildren) {
        window.alert("Ce dossier contient encore des éléments. Déplacez ou supprimez son contenu avant de supprimer le dossier.");
        return;
      }
    }

    const message = crmDocument.isFolder
      ? "Supprimer ce dossier du CRM et de Google Drive ?"
      : "Supprimer ce document du CRM et de Google Drive ?";

    if (!window.confirm(message)) return;

    const driveId = crmDocument.isFolder ? crmDocument.driveFolderId : crmDocument.driveFileId;

    if (driveId) {
      try {
        const response = await fetchDriveAPI("/api/drive/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId: driveId })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Suppression Drive impossible.");
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Suppression Google Drive impossible.");
        return;
      }
    }

    onDelete(crmDocument.id);
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
            <p className="eyebrow">Drive CRM</p>
            <h3>{folders.length} dossier{folders.length > 1 ? "s" : ""} · {files.length} document{files.length > 1 ? "s" : ""}</h3>
          </div>
          <div>
            <p className="eyebrow">À vérifier</p>
            <h3>{documentsToCheck.length}</h3>
          </div>
        </div>

        <div className="document-breadcrumbs">
          <button type="button" className={!currentFolderId ? "primary-button" : "secondary-button"} onClick={() => setCurrentFolderId("")}>CRM Documents</button>
          {folderPath.map((folder) => (
            <button key={folder.id} type="button" className="secondary-button" onClick={() => setCurrentFolderId(folder.id)}>
              {folder.title}
            </button>
          ))}
        </div>

        <div className="document-current-folder-note">
          {currentFolder ? (
            <span>Dossier ouvert : <strong>{currentFolder.title}</strong></span>
          ) : (
            <span>Aucun dossier ouvert. Créez ou ouvrez un dossier avant d’importer.</span>
          )}
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
          <strong>{uploadingDocument ? "Import en cours..." : currentFolder ? `Importer dans : ${currentFolder.title}` : "Ouvrez un dossier avant d'importer"}</strong>
          <span>{currentFolder ? "Glissez vos fichiers ici. Ils seront stockés dans ce dossier Google Drive." : "Sélectionnez ou créez un dossier. Les documents ne doivent plus être importés à la racine."}</span>
          <label className={`secondary-button document-upload-button ${!currentFolder ? "is-disabled" : ""}`}>
            Choisir des fichiers
            <input type="file" multiple disabled={!currentFolder} onChange={(event) => event.currentTarget.files && void uploadFilesToFolder(event.currentTarget.files)} />
          </label>
        </div>

        {visibleFolders.length === 0 && visibleDocuments.length === 0 ? (
          <p className="muted-line">{currentFolder ? "Aucun document dans ce dossier." : "Aucun dossier à ce niveau."}</p>
        ) : (
          <div className="documents-grid drive-documents-grid">
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
                  <p className="eyebrow">Dossier</p>
                  <h3>📁 {folder.title}</h3>
                  <p className="muted-line">Ouvrez-le pour importer ou glissez un fichier directement dessus.</p>
                </div>
                <div className="item-actions contact-row-actions oar-contact-actions">
                  <button className="primary-button compact-button" type="button" onClick={() => setCurrentFolderId(folder.id)}>Ouvrir</button>
                  {folder.driveWebViewLink && <a className="secondary-button compact-button" href={folder.driveWebViewLink} target="_blank" rel="noreferrer">Drive</a>}
                  {canManageDocuments && <button className="danger-link compact-danger" type="button" onClick={() => void deleteDriveBackedDocument(folder)}>Supprimer</button>}
                </div>
              </article>
            ))}

            {visibleDocuments.map((crmDocument) => {
              const needsCheck = crmDocument.status !== "À jour";
              const hasDriveFile = Boolean(crmDocument.driveFileId);

              return (
                <article className={`item-card document-card document-file-card ${needsCheck ? "document-card-warning" : ""}`} key={crmDocument.id} id={`document-${crmDocument.id}`}>
                  <div>
                    <p className="eyebrow">Document · {crmDocument.status}</p>
                    <h3>{crmDocument.title}</h3>
                    <p className="muted-line">
                      Ajouté le {new Date(crmDocument.addedAt).toLocaleDateString("fr-FR")} par {crmDocument.addedBy}
                    </p>
                    {crmDocument.expiryDate && (
                      <p className="muted-line">Date : {new Date(`${crmDocument.expiryDate}T12:00:00`).toLocaleDateString("fr-FR")}</p>
                    )}
                    {crmDocument.fileName && <p className="muted-line">Fichier : {crmDocument.fileName}</p>}
                    {crmDocument.size ? <p className="muted-line">Taille : {formatDocumentSize(crmDocument.size)}</p> : null}
                    {crmDocument.location && <p>{crmDocument.location}</p>}
                    {crmDocument.notes && <p className="muted-line">{crmDocument.notes}</p>}
                  </div>

                  <div className="item-actions contact-row-actions document-file-actions">
                    {hasDriveFile && (
                      <button className="secondary-button compact-button" type="button" disabled={previewingDocument} onClick={() => void openDrivePreview(crmDocument)}>
                        {previewingDocument ? "Ouverture..." : "Voir"}
                      </button>
                    )}

                    {hasDriveFile && (
                      <button className="secondary-button compact-button" type="button" onClick={() => void downloadDriveDocument(crmDocument)}>
                        Télécharger
                      </button>
                    )}

                    {crmDocument.driveWebViewLink && (
                      <a className="secondary-button compact-button" href={crmDocument.driveWebViewLink} target="_blank" rel="noreferrer">
                        Drive
                      </a>
                    )}

                    {canManageDocuments && (
                      <>
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => {
                            setEditingDocument(crmDocument);
                            window.setTimeout(() => {
                              window.globalThis.document.querySelector(".documents-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 80);
                          }}
                        >
                          Modifier
                        </button>

                        <button className="danger-link compact-danger" type="button" onClick={() => void deleteDriveBackedDocument(crmDocument)}>
                          Supprimer
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card form-card documents-form-card">
        <p className="eyebrow">Gestion Drive</p>
        <h3>{editingDocument ? "Modifier document" : "Créer un dossier"}</h3>
        <p className="document-storage-note">Structure simple : dossiers uniquement. Les anciennes catégories sont supprimées.</p>

        {!canManageDocuments && <p className="muted-line">Lecture seule. Seuls Matteo et Vincent peuvent modifier les documents.</p>}

        {canManageDocuments && !editingDocument && (
          <>
            <form className="form-grid document-folder-form" onSubmit={createDriveFolder}>
              <label>Créer un dossier dans {currentFolder?.title || "CRM Documents"}
                <input value={folderName} onChange={(event) => setFolderName(event.currentTarget.value)} placeholder="Ex : Villa LADIVA, Assurance 2026..." />
              </label>
              <button className="primary-button" type="submit" disabled={creatingFolder}>{creatingFolder ? "Création..." : "Créer dossier"}</button>
            </form>

            <div className="document-drive-rules">
              <strong>Règle propre</strong>
              <span>Un document doit toujours être rangé dans un dossier. Plus de catégories multiples, plus de filtres inutiles.</span>
            </div>
          </>
        )}

        {canManageDocuments && editingDocument && (
          <form key={editingDocument.id} className="form-grid" onSubmit={submitDocumentMetadata}>
            <label>Nom du document
              <input name="title" defaultValue={editingDocument.title} placeholder="Ex : Assurance villa, logo OAR, contrat..." />
            </label>

            <label>Statut
              <select name="status" defaultValue={editingDocument.status || "À jour"}>
                <option>À jour</option>
                <option>À vérifier</option>
                <option>Expiré</option>
              </select>
            </label>

            <label>Emplacement / description
              <input name="location" defaultValue={editingDocument.location || ""} placeholder="Ex : Villa LADIVA / Assurance" />
            </label>

            <label>Date
              <input name="expiryDate" type="date" defaultValue={editingDocument.expiryDate || ""} />
            </label>

            <label>Notes
              <textarea name="notes" defaultValue={editingDocument.notes || ""} placeholder="Détails, version, remarque..." />
            </label>

            <button className="primary-button" type="submit">Enregistrer</button>
            <button className="secondary-button" type="button" onClick={() => setEditingDocument(null)}>Annuler</button>
          </form>
        )}
      </section>

      {previewDocument && (
        <div className="document-preview-overlay" role="dialog" aria-modal="true">
          <div className="document-preview-modal">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Aperçu document</p>
                <h3>{previewDocument.title}</h3>
              </div>
              <button className="secondary-button" type="button" onClick={closeDrivePreview}>Fermer</button>
            </div>
            {previewDocumentUrl ? (
              <iframe title={previewDocument.title} src={previewDocumentUrl} className="document-preview-frame" />
            ) : (
              <p className="muted-line">Aucun aperçu disponible.</p>
            )}
            <div className="item-actions">
              {previewDocument.driveWebViewLink && <a className="secondary-button" href={previewDocument.driveWebViewLink} target="_blank" rel="noreferrer">Ouvrir dans Drive</a>}
              {previewDocument.driveFileId && <button className="primary-button" type="button" onClick={() => void downloadDriveDocument(previewDocument)}>Télécharger</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HouseTrackingView({
  contacts,
  houses,
  workers,
  timeEntries,
  payments,
  onAddHouse,
  onDeleteHouse,
  onAddWorker,
  onArchiveWorker,
  onReactivateWorker,
  onPermanentlyDeleteWorker,
  onAddTimeEntry,
  onDeleteTimeEntry,
  onAddPayment,
  onDeletePayment
}: {
  contacts: Contact[];
  houses: HouseTrackingHouse[];
  workers: HouseTrackingWorker[];
  timeEntries: HouseTimeEntry[];
  payments: HousePayment[];
  onAddHouse: (house: HouseTrackingHouse) => void;
  onDeleteHouse: (id: string) => void;
  onAddWorker: (worker: HouseTrackingWorker) => void;
  onArchiveWorker: (id: string) => void;
  onReactivateWorker: (id: string) => void;
  onPermanentlyDeleteWorker: (id: string) => void;
  onAddTimeEntry: (entry: HouseTimeEntry) => void;
  onDeleteTimeEntry: (id: string) => void;
  onAddPayment: (payment: HousePayment) => void;
  onDeletePayment: (id: string) => void;
}) {
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
    hourlyRate: initialActiveWorker?.hourlyRate ? String(initialActiveWorker.hourlyRate) : "",
    note: ""
  });
  const [showAllHoursHistory, setShowAllHoursHistory] = useState(false);
  const [showAllPaymentsHistory, setShowAllPaymentsHistory] = useState(false);
  const [uploadingWorkerDocument, setUploadingWorkerDocument] = useState(false);
  const [houseSection, setHouseSection] = useState<"today" | "hours" | "payments" | "settings">("today");
  const [showArchivedWorkerPicker, setShowArchivedWorkerPicker] = useState(false);
  const [archivedWorkerSearch, setArchivedWorkerSearch] = useState("");

  if (!activeWorkers.some(worker => worker.id === hourDraft.workerId)) {
    const firstActiveWorker = activeWorkers[0];
    const workerId = firstActiveWorker?.id || "";
    const hourlyRate = firstActiveWorker?.hourlyRate ? String(firstActiveWorker.hourlyRate) : "";
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
    return [contact.civility, contact.firstName, contact.name].filter(Boolean).join(" ").trim() || contact.name || contact.companyName || "Contact";
  }

  function getHouseContactSearchLabel(contact: Contact) {
    const displayName = getHouseContactDisplayName(contact);
    const company = contact.companyName ? ` · ${contact.companyName}` : "";
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

  const selectedWorker = activeWorkers.find((worker) => worker.id === hourDraft.workerId);
  const currentRate = parseEuroAmount(hourDraft.hourlyRate || selectedWorker?.hourlyRate || 0);
  const previewEntry = {
    startTime: hourDraft.startTime,
    endTime: hourDraft.endTime,
    breakMinutes: Number(hourDraft.breakMinutes || 0),
    hourlyRate: currentRate
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

    if (!name) return window.alert("Ajoutez le nom de la maison.");

    onAddHouse({
      id: makeId("house"),
      name,
      address: String(form.get("address") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      createdAt: new Date().toISOString()
    });

    event.currentTarget.reset();
  }

  async function uploadHouseWorkerDocument(file: File, workerId: string) {
    if (business) return {documentStoragePath:await business.upload("houseTrackingWorkers",workerId,file),documentFileName:file.name,documentUploadedAt:new Date().toISOString()};
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw new Error("Utilisateur Supabase non connecté.");
    }

    const safeName = file.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "document";

    const storagePath = `${SHARED_WORKSPACE_ID}/house-workers/${workerId}/${Date.now()}-${safeName}`;

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
      documentStoragePath: storagePath,
      documentFileName: file.name,
      documentUploadedAt: new Date().toISOString()
    };
  }

  async function downloadHouseWorkerDocument(worker: HouseTrackingWorker) {
    if (business) return business.download(worker.documentStoragePath || "",worker.documentFileName || "document");
    if (!worker.documentStoragePath) return;

    const { data: fileData, error } = await supabase.storage
      .from(CRM_DOCUMENTS_BUCKET)
      .download(worker.documentStoragePath);

    if (error || !fileData) {
      window.alert(`Téléchargement impossible : ${error?.message || "fichier introuvable"}`);
      return;
    }

    const url = URL.createObjectURL(fileData);
    const link = document.createElement("a");
    link.href = url;
    link.download = worker.documentFileName || `${worker.contactName || "intervenant"}-document`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submitWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const contactInput = String(form.get("contactSearch") ?? "").trim();
    const contact = findHouseTrackingContact(contactInput);

    if (!contact) return window.alert("Choisissez un contact CRM existant. Créez-le d’abord dans Contacts si besoin.");

    const workerId = makeId("worker");
    const file = form.get("documentFile");
    let uploadedDocument: Partial<HouseTrackingWorker> = {};

    if (file instanceof File && file.size > 0) {
      try {
        setUploadingWorkerDocument(true);
        uploadedDocument = await uploadHouseWorkerDocument(file, workerId);
        if (business) await business.check();
      } catch (error) {
        window.alert(`Document non chargé dans Supabase Storage : ${error instanceof Error ? error.message : "erreur inconnue"}`);
        setUploadingWorkerDocument(false);
        return;
      } finally {
        setUploadingWorkerDocument(false);
      }
    }

    onAddWorker({
      id: workerId,
      contactId: contact.id,
      contactName: getHouseContactDisplayName(contact),
      role: contact.supplierCategory || contact.kind || "Prestataire",
      hourlyRate: safeNumber(form.get("hourlyRate")),
      documentUrl: "",
      documentStoragePath: uploadedDocument.documentStoragePath || "",
      documentFileName: uploadedDocument.documentFileName || "",
      documentUploadedAt: uploadedDocument.documentUploadedAt || "",
      status: "Actif",
      notes: String(form.get("notes") ?? "").trim(),
      createdAt: new Date().toISOString()
    });

    formElement.reset();
  }

  function submitTimeEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isQuarterHourTime(hourDraft.startTime) || !isQuarterHourTime(hourDraft.endTime)) {
      return window.alert("Les heures de début et de fin doivent être saisies par quart d’heure.");
    }

    const house = houses.find((item) => item.id === hourDraft.houseId);
    const worker = activeWorkers.find((item) => item.id === hourDraft.workerId);

    if (!house) return window.alert("Choisissez une maison.");
    if (!worker) return window.alert("Choisissez un intervenant actif.");
    if (previewHours <= 0) return window.alert("Vérifiez les heures de début et de fin.");

    onAddTimeEntry({
      id: makeId("hours"),
      houseId: house.id,
      houseName: house.name,
      workerId: worker.id,
      workerName: worker.contactName,
      date: hourDraft.date,
      startTime: hourDraft.startTime,
      endTime: hourDraft.endTime,
      breakMinutes: Number(hourDraft.breakMinutes || 0),
      hourlyRate: parseEuroAmount(currentRate),
      note: hourDraft.note.trim(),
      createdAt: new Date().toISOString()
    });

    setHourDraft((current) => ({ ...current, note: "" }));
  }

  function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const house = houses.find((item) => item.id === String(form.get("houseId") ?? ""));
    const worker = activeWorkers.find((item) => item.id === String(form.get("workerId") ?? ""));
    const amount = safeNumber(form.get("amount"));

    if (!house) return window.alert("Choisissez une maison.");
    if (!worker) return window.alert("Choisissez un intervenant actif.");
    if (amount <= 0) return window.alert("Ajoutez un montant payé.");

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
            <p className="eyebrow">Suivi maison</p>
            <h3>Gestion simple des heures et paiements</h3>
          </div>
          <BusinessButton permission="export" className="secondary-button" type="button" onClick={exportHouseCsv}>Export CSV</BusinessButton>
        </div>

        <div className="stats-grid house-summary-grid">
          <StatCard label="Heures" value={formatHours(totalHours)} caption="Période sélectionnée" />
          <StatCard label="À payer" value={currency.format(totalDue)} caption="Dette créée" />
          <StatCard label="Payé" value={currency.format(totalPaid)} caption="Paiements imputés" />
          <StatCard label="Solde" value={formatHouseBalanceLabel(totalBalance)} caption="Delta réel" />
        </div>

        <div className="house-filter-row">
          <BusinessLabel>Date début
            <input
              type="date"
              value={dateRange.start}
              onChange={(event) => setDateRange((current) => ({ ...current, start: event.target.value }))}
            />
          </BusinessLabel>

          <BusinessLabel>Date fin
            <input
              type="date"
              value={dateRange.end}
              onChange={(event) => setDateRange((current) => ({ ...current, end: event.target.value }))}
            />
          </BusinessLabel>

          <BusinessLabel>Maison
            <select value={houseFilter} onChange={(event) => setHouseFilter(event.target.value)}>
              <option value="Tous">Toutes les maisons</option>
              {houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}
            </select>
          </BusinessLabel>

          <div className="house-worker-filter">
            <span className="house-worker-filter-label">Intervenant</span>
            <div className="house-worker-filter-controls">
              <div className="house-worker-filter-scroll" role="group" aria-label="Filtrer par intervenant">
                <BusinessButton
                  className={workerFilter === "Tous" ? "house-worker-filter-button active" : "house-worker-filter-button"}
                  type="button"
                  aria-pressed={workerFilter === "Tous"}
                  onClick={() => setWorkerFilter("Tous")}
                >
                  Tous
                </BusinessButton>
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
                >
                  Archives ({archivedWorkers.length})
                </BusinessButton>
              )}
            </div>
          </div>
        </div>
      </section>

      <nav className="house-tabs" aria-label="Navigation suivi maison">
        <BusinessButton className={houseSection === "today" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("today")}>Aujourd’hui</BusinessButton>
        <BusinessButton className={houseSection === "hours" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("hours")}>Heures</BusinessButton>
        <BusinessButton className={houseSection === "payments" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("payments")}>Paiements</BusinessButton>
        <BusinessButton className={houseSection === "settings" ? "primary-button house-tab active" : "secondary-button house-tab"} type="button" onClick={() => changeHouseSection("settings")}>Réglages</BusinessButton>
      </nav>

      {selectedArchivedWorker && selectedArchivedWorkerHistory && houseSection !== "today" && (
        <section className="house-archived-filter-banner" aria-label={`Historique de ${selectedArchivedWorker.contactName}`}>
          <div>
            <div className="house-archived-filter-title">
              <strong>Historique de {selectedArchivedWorker.contactName}</strong>
              <span className="status-pill house-archived-badge">Archivé</span>
            </div>
            <span>Intervenant archivé · {selectedArchivedWorker.role}</span>
            <small>
              {selectedArchivedWorkerHistory.timeEntries} ligne(s) · {formatHours(selectedArchivedWorkerHistory.hours)} · {selectedArchivedWorkerHistory.payments} paiement(s) · {currency.format(selectedArchivedWorkerHistory.paid)} payé · Delta {formatHouseBalanceLabel(selectedArchivedWorkerHistory.balance)}
            </small>
          </div>
          <div className="house-archived-filter-actions">
            {houseSection !== "settings" && (
              <BusinessButton className="secondary-button" type="button" onClick={() => changeHouseSection("settings")}>Voir dans Réglages</BusinessButton>
            )}
            <BusinessButton className="secondary-button" type="button" onClick={() => setWorkerFilter("Tous")}>Effacer le filtre</BusinessButton>
          </div>
        </section>
      )}

      {houseSection === "today" && (
        <section className="card house-tab-panel">
          <div className="section-heading house-section-heading">
            <div>
              <p className="eyebrow">Vue rapide</p>
              <h3>Aujourd’hui</h3>
            </div>
            <div className="house-quick-actions">
              <BusinessButton className="primary-button" type="button" onClick={() => changeHouseSection("hours")}>Ajouter heures</BusinessButton>
              <BusinessButton className="secondary-button" type="button" onClick={() => changeHouseSection("payments")}>Ajouter paiement</BusinessButton>
              <BusinessButton className="secondary-button" type="button" onClick={() => changeHouseSection("settings")}>Réglages</BusinessButton>
            </div>
          </div>

          <div className="house-today-grid">
            <div className="house-mini-panel">
              <p className="eyebrow">À payer</p>
              {balanceRows.filter((row) => row.balance > 0 && activeWorkerIds.has(row.worker.id)).length === 0 ? (
                <p className="muted-line">Aucun solde à payer sur la période.</p>
              ) : balanceRows.filter((row) => row.balance > 0 && activeWorkerIds.has(row.worker.id)).slice(0, 6).map((row) => (
                <article className="mini-row house-compact-row" key={row.worker.id} data-notification-target={`house-worker-${row.worker.id}`}>
                  <div>
                    <strong>{row.worker.contactName}</strong>
                    <span>{formatHours(row.hours)} · {currency.format(row.due)} dû · {currency.format(row.paid)} payé</span>
                  </div>
                  <strong className="house-balance-positive">{formatHouseBalanceLabel(row.balance)}</strong>
                </article>
              ))}
            </div>

            <div className="house-mini-panel">
              <p className="eyebrow">Heures du jour</p>
              {filteredEntries.filter((entry) => normalizeHouseDateValue(entry.date) === today && activeWorkerIds.has(entry.workerId)).length === 0 ? (
                <p className="muted-line">Aucune heure saisie aujourd’hui.</p>
              ) : filteredEntries.filter((entry) => normalizeHouseDateValue(entry.date) === today && activeWorkerIds.has(entry.workerId)).slice(0, 6).map((entry) => (
                <article className="mini-row house-compact-row" key={entry.id}>
                  <div>
                    <strong>{entry.workerName}</strong>
                    <span>{entry.houseName} · {entry.startTime} à {entry.endTime}</span>
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
            <p className="eyebrow">Saisie</p>
            <h3>Ajouter des heures</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitTimeEntry}>
              <BusinessLabel>Date
                <input type="date" value={hourDraft.date} onChange={(event) => setHourDraft((current) => ({ ...current, date: event.target.value }))} />
              </BusinessLabel>
              <BusinessLabel>Maison
                <select value={hourDraft.houseId} onChange={(event) => setHourDraft((current) => ({ ...current, houseId: event.target.value }))}>
                  <option value="">Choisir</option>
                  {houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>Intervenant
                <select value={hourDraft.workerId} onChange={(event) => {
                  const worker = activeWorkers.find((item) => item.id === event.target.value);
                  setHourDraft((current) => ({ ...current, workerId: event.target.value, hourlyRate: worker?.hourlyRate ? String(worker.hourlyRate) : current.hourlyRate }));
                }}>
                  <option value="">Choisir</option>
                  {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.contactName}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>Début
                <select value={hourDraft.startTime} onChange={(event) => setHourDraft((current) => ({ ...current, startTime: event.target.value }))}>
                  {QUARTER_HOUR_TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>Fin
                <select value={hourDraft.endTime} onChange={(event) => setHourDraft((current) => ({ ...current, endTime: event.target.value }))}>
                  {QUARTER_HOUR_TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>Pause minutes
                <input type="number" min="0" value={hourDraft.breakMinutes} onChange={(event) => setHourDraft((current) => ({ ...current, breakMinutes: event.target.value }))} />
              </BusinessLabel>
              <BusinessLabel>Taux horaire
                <input type="number" min="0" step="0.5" value={hourDraft.hourlyRate} onChange={(event) => setHourDraft((current) => ({ ...current, hourlyRate: event.target.value }))} />
              </BusinessLabel>
              <BusinessLabel>Note
                <input value={hourDraft.note} onChange={(event) => setHourDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Ex : ménage complet" />
              </BusinessLabel>
              <div className="full house-calculation-line">
                Calcul immédiat : <strong>{formatHours(previewHours)}</strong> — <strong>{currency.format(previewAmount)}</strong>
              </div>
              <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter les heures</BusinessButton>
            </BusinessForm>
          </section>

          <section className="card house-tab-panel">
            <p className="eyebrow">Historique</p>
            <h3>Heures saisies</h3>
            <div className="list-stack house-history-list">
              {filteredEntries.length === 0 ? <p className="muted-line">Aucune heure saisie.</p> : visibleHourEntries.map((entry) => (
                <article className="mini-row house-compact-row" key={entry.id}>
                  <div>
                    <strong>{entry.workerName}</strong>
                    {isArchivedWorker(entry.workerId) && <span className="status-pill house-archived-badge">Archivé</span>}
                    <span>{entry.date} · {entry.houseName} · {entry.startTime} à {entry.endTime} · {formatHours(getHouseTimeHours(entry))} · {currency.format(getHouseTimeAmount(entry))}</span>
                  </div>
                  <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => window.confirm("Supprimer ces heures ?") && onDeleteTimeEntry(entry.id)}>Suppr.</BusinessButton>
                </article>
              ))}
            </div>
            {filteredEntries.length > 7 && (
              <BusinessButton className="secondary-button" type="button" onClick={() => setShowAllHoursHistory((current) => !current)}>
                {showAllHoursHistory ? "Réduire à 7 lignes" : `Afficher tout (${filteredEntries.length})`}
              </BusinessButton>
            )}
          </section>
        </div>
      )}

      {houseSection === "payments" && (
        <div className="house-two-columns">
          <section className="card house-tab-panel">
            <p className="eyebrow">Paiements</p>
            <h3>Ajouter un paiement</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitPayment}>
              <BusinessLabel>Date
                <input name="date" type="date" defaultValue={today} />
              </BusinessLabel>
              <BusinessLabel>Maison
                <select name="houseId" defaultValue={houses[0]?.id || ""}>
                  <option value="">Choisir</option>
                  {houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>Intervenant
                <select name="workerId" defaultValue={initialActiveWorker?.id || ""}>
                  <option value="">Choisir</option>
                  {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.contactName}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>Montant
                <input name="amount" type="text" inputMode="decimal" min="0" step="1" placeholder="Ex : 150" />
              </BusinessLabel>
              <BusinessLabel>Moyen
                <select name="method" defaultValue="Virement">
                  <option>Virement</option>
                  <option>Espèces</option>
                  <option>CB</option>
                  <option>Chèque</option>
                  <option>Autre</option>
                </select>
              </BusinessLabel>
              <BusinessLabel>Note
                <input name="note" placeholder="Paiement semaine..." />
              </BusinessLabel>
              <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter le paiement</BusinessButton>
            </BusinessForm>
          </section>

          <section className="card house-tab-panel">
            <p className="eyebrow">Historique</p>
            <h3>Paiements saisis</h3>
            <div className="list-stack house-history-list">
              {filteredPayments.length === 0 ? <p className="muted-line">Aucun paiement saisi.</p> : visiblePaymentEntries.map((payment) => (
                <article className="mini-row house-compact-row" key={payment.id}>
                  <div>
                    <strong>{payment.workerName}</strong>
                    {isArchivedWorker(payment.workerId) && <span className="status-pill house-archived-badge">Archivé</span>}
                    <span>{payment.date} · {payment.houseName} · {currency.format(payment.amount)} · {payment.method}</span>
                  </div>
                  <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => window.confirm("Supprimer ce paiement ?") && onDeletePayment(payment.id)}>Suppr.</BusinessButton>
                </article>
              ))}
            </div>
            {filteredPayments.length > 7 && (
              <BusinessButton className="secondary-button" type="button" onClick={() => setShowAllPaymentsHistory((current) => !current)}>
                {showAllPaymentsHistory ? "Réduire à 7 lignes" : `Afficher tout (${filteredPayments.length})`}
              </BusinessButton>
            )}
          </section>
        </div>
      )}

      {houseSection === "settings" && (
        <div className="house-two-columns">
          <section className="card house-tab-panel">
            <p className="eyebrow">Réglages</p>
            <h3>Maisons</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitHouse}>
              <BusinessLabel>Nom
                <input name="name" placeholder="Maison principale" />
              </BusinessLabel>
              <BusinessLabel>Adresse
                <input name="address" placeholder="Adresse" />
              </BusinessLabel>
              <BusinessLabel>Notes
                <textarea name="notes" placeholder="Accès, alarmes, consignes..." />
              </BusinessLabel>
              <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter la maison</BusinessButton>
            </BusinessForm>
            <div className="list-stack house-history-list">
              {houses.length === 0 ? <p className="muted-line">Aucune maison.</p> : houses.map((house) => (
                <article className="mini-row house-compact-row" key={house.id}>
                  <div>
                    <strong>{house.name}</strong>
                    <span>{house.address || "Adresse à compléter"}</span>
                  </div>
                  <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => window.confirm("Supprimer cette maison ?") && onDeleteHouse(house.id)}>Suppr.</BusinessButton>
                </article>
              ))}
            </div>
          </section>

          <section className="card house-tab-panel">
            <p className="eyebrow">Réglages</p>
            <h3>Intervenants actifs</h3>
            <BusinessForm className="form-grid house-compact-form" onSubmit={submitWorker}>
              <BusinessLabel>Contact CRM
                <input name="contactSearch" list="house-contact-options" placeholder="Nom, société, email ou téléphone" autoComplete="off" />
                <datalist id="house-contact-options">
                  {sortedHouseContacts.map((contact) => <option key={contact.id} value={getHouseContactSearchLabel(contact)} />)}
                </datalist>
              </BusinessLabel>
              <BusinessLabel>Taux horaire
                <input name="hourlyRate" type="number" min="0" step="0.5" placeholder="Ex : 18" />
              </BusinessLabel>
              <BusinessLabel>Document
                <input name="documentFile" type="file" />
              </BusinessLabel>
              <BusinessLabel>Notes
                <textarea name="notes" placeholder="Disponibilités, conditions, préférences..." />
              </BusinessLabel>
              <BusinessButton permission="write" className="primary-button" type="submit" disabled={uploadingWorkerDocument}>
                {uploadingWorkerDocument ? "Chargement..." : "Ajouter l’intervenant"}
              </BusinessButton>
            </BusinessForm>

            <div className="list-stack house-history-list">
              {activeWorkers.length === 0 ? <p className="muted-line">Aucun intervenant actif.</p> : activeWorkers.map((worker) => {
                const hasHistory = houseTrackingWorkerHasHistory(worker.id, timeEntries, payments);

                return (
                  <article className="mini-row house-compact-row" key={worker.id} data-notification-target={`house-worker-${worker.id}`}>
                    <div>
                      <strong>{worker.contactName}</strong>
                      <span>{worker.role} · {currency.format(worker.hourlyRate)}/h</span>
                      {worker.documentFileName && <span>Document : {worker.documentFileName}</span>}
                      {worker.documentStoragePath && (
                        <BusinessButton permission="export" className="secondary-link" type="button" onClick={() => void downloadHouseWorkerDocument(worker)}>Télécharger document</BusinessButton>
                      )}
                    </div>
                    <div className="house-worker-actions">
                      <BusinessButton permission="write"
                        className="secondary-button"
                        type="button"
                        onClick={() => window.confirm(`Archiver ${worker.contactName} ?\n\nSa fiche, ses documents, ses heures et ses paiements seront intégralement conservés.`) && onArchiveWorker(worker.id)}
                      >
                        Archiver
                      </BusinessButton>
                      {!hasHistory && (
                        <BusinessButton permission="remove"
                          className="danger-link"
                          type="button"
                          onClick={() => window.confirm(`Supprimer définitivement ${worker.contactName} ?\n\nCette action supprimera uniquement sa fiche d’intervenant et ne pourra pas être annulée.`) && onPermanentlyDeleteWorker(worker.id)}
                        >
                          Supprimer définitivement
                        </BusinessButton>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <details className="house-archived-workers">
              <summary>Intervenants archivés ({archivedWorkers.length})</summary>
              <div className="list-stack house-history-list">
                {archivedWorkers.length === 0 ? <p className="muted-line">Aucun intervenant archivé.</p> : archivedWorkers.map((worker) => {
                  const history = getHouseTrackingWorkerHistorySummary(worker.id, timeEntries, payments);
                  const hasHistory = history.timeEntries > 0 || history.payments > 0;

                  return (
                    <article className="mini-row house-compact-row house-archived-worker-row" key={worker.id} data-notification-target={`house-worker-${worker.id}`}>
                      <div>
                        <strong>{worker.contactName} <span className="status-pill house-archived-badge">Archivé</span></strong>
                        <span>{worker.role} · {currency.format(worker.hourlyRate)}/h</span>
                        <span>{history.timeEntries} ligne(s) · {formatHours(history.hours)} · {history.payments} paiement(s) · {currency.format(history.paid)} payé</span>
                        <span>Coût {currency.format(history.due)} · Delta {formatHouseBalanceLabel(history.balance)}</span>
                        {worker.documentFileName && <span>Document : {worker.documentFileName}</span>}
                        {worker.documentStoragePath && (
                          <BusinessButton permission="export" className="secondary-link" type="button" onClick={() => void downloadHouseWorkerDocument(worker)}>Télécharger document</BusinessButton>
                        )}
                      </div>
                      <div className="house-worker-actions">
                        <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => onReactivateWorker(worker.id)}>Réactiver</BusinessButton>
                        {!hasHistory && (
                          <BusinessButton permission="remove"
                            className="danger-link"
                            type="button"
                            onClick={() => window.confirm(`Supprimer définitivement ${worker.contactName} ?\n\nCette action supprimera uniquement sa fiche d’intervenant et ne pourra pas être annulée.`) && onPermanentlyDeleteWorker(worker.id)}
                          >
                            Supprimer définitivement
                          </BusinessButton>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </details>
          </section>

          <section className="card house-tab-panel full">
            <p className="eyebrow">Soldes</p>
            <h3>Delta réel par intervenant</h3>
            {balanceRows.length === 0 ? (
              <p className="muted-line">Aucun delta sur la période sélectionnée.</p>
            ) : (
              <div className="table-wrapper">
                <table className="mobile-card-table house-balance-table">
                  <thead>
                    <tr>
                      <th>Intervenant</th>
                      <th>Heures</th>
                      <th>Dette créée</th>
                      <th>Payé</th>
                      <th>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balanceRows.map((row) => (
                      <tr key={row.worker.id}>
                        <td data-label="Intervenant">
                          <strong>{row.worker.contactName}</strong>{!isHouseTrackingWorkerActive(row.worker) && <span className="status-pill house-archived-badge">Archivé</span>}
                          <br /><span className="muted-line">{row.worker.role}</span>
                        </td>
                        <td data-label="Heures">{formatHours(row.hours)}</td>
                        <td data-label="Dette créée">{currency.format(row.due)}</td>
                        <td data-label="Payé">{currency.format(row.paid)}</td>
                        <td data-label="Delta"><strong className={row.balance > 0 ? "house-balance-positive" : row.balance < 0 ? "house-balance-negative" : "house-balance-zero"}>{formatHouseBalanceLabel(row.balance)}</strong></td>
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
                <p className="eyebrow">Archives</p>
                <h3 id="house-archive-picker-title">Intervenants archivés</h3>
              </div>
              <BusinessButton className="secondary-button house-archive-picker-close" type="button" aria-label="Fermer" onClick={closeArchivedWorkerPicker}>×</BusinessButton>
            </div>

            {archivedWorkers.length > 1 && (
              <BusinessLabel className="house-archive-search">Rechercher
                <input
                  autoFocus
                  type="search"
                  value={archivedWorkerSearch}
                  placeholder="Nom ou rôle"
                  onChange={(event) => setArchivedWorkerSearch(event.target.value)}
                />
              </BusinessLabel>
            )}

            <div className="house-archive-picker-list">
              {visibleArchivedWorkers.length === 0 ? (
                <p className="muted-line">Aucun intervenant archivé ne correspond à cette recherche.</p>
              ) : visibleArchivedWorkers.map((worker) => {
                const history = getHouseTrackingWorkerHistorySummary(worker.id, timeEntries, payments);

                return (
                  <BusinessButton className="house-archive-worker-button" key={worker.id} type="button" onClick={() => selectArchivedWorker(worker.id)}>
                    <span className="house-archive-worker-name">
                      <strong>{worker.contactName}</strong>
                      <span className="status-pill house-archived-badge">Archivé</span>
                    </span>
                    <span>{worker.role} · {formatHours(history.hours)} · {currency.format(history.paid)} payé</span>
                    <small>{history.timeEntries} ligne(s) d’heures · {history.payments} paiement(s) · Delta {formatHouseBalanceLabel(history.balance)}</small>
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
  onOpenQuote
}: {
  actor: string;
  onUpdateContact: (contact: Contact) => void;
  contacts: Contact[];
  documents: CRMDocument[];
  invoices: VendorInvoice[];
  quotes: VendorQuote[];
  onDeleteOrphan: (id: string) => void;
  onAdd: (invoice: VendorInvoice) => void;
  onUpdate: (invoice: VendorInvoice) => void;
  onDelete: (id: string) => void;
  onOpenQuote: (quoteId: string) => void;
}) {
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
      contactName: resolvedContact
        ? getVendorBusinessName(resolvedContact)
        : String(invoice.contactName || "").trim(),
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
          window.alert(`Aperçu impossible : ${error?.message || "fichier introuvable"}`);
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

    window.alert("Aucune facture importée sur cette ligne.");
  }

  async function downloadVendorInvoiceDocument(invoice: VendorInvoice) {
    if (business) return business.download(invoice.invoiceDocumentStoragePath || "",invoice.invoiceDocumentName || "facture.pdf");
    const { storagePath, externalUrl, fileName } = getVendorInvoiceDocumentSource(invoice);

    if (storagePath) {
      const { data: fileData, error } = await supabase.storage
        .from(CRM_DOCUMENTS_BUCKET)
        .download(storagePath);

      if (error || !fileData) {
        window.alert(`Téléchargement impossible : ${error?.message || "fichier introuvable"}`);
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

    window.alert("Aucune facture importée sur cette ligne.");
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
        window.alert(`Facture non importée : ${error instanceof Error ? error.message : "erreur inconnue"}`);
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
      window.alert("Importez la facture réelle avant d’enregistrer un paiement.");
      return;
    }

    const invoice: VendorInvoice = {
      ...editingInvoice,
      id: invoiceId,
      contactId,
      contactName: contact
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
      window.alert("Le prestataire ne peut pas changer après sélection d’un compte bancaire."); return;
    }
    if (!invoice.contactName && (!business || business.read("contacts") || !editingInvoice)) return window.alert("Choisissez un contact prestataire.");
    if (!invoice.amount || invoice.amount <= 0) return window.alert("Ajoutez un montant de facture.");

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
            <p className="eyebrow">Factures prestataires</p>
            <h3>{visibleInvoices.length} facture{visibleInvoices.length > 1 ? "s" : ""}</h3>
          </div>
          <div>
            <p className="eyebrow">Reste à payer</p>
            <h3>{formatEuroAmount(totalToPay)}</h3>
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
              {status}
            </BusinessButton>
          ))}
        </div>

        {visibleInvoices.length === 0 ? (
          <p className="muted-line">Aucune facture prestataire pour ce filtre.</p>
        ) : (
          <div className="list-stack oar-contact-list-stack">
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
                  <p className={`eyebrow ${invoice.status === "Payé" ? "invoice-eyebrow-paid" : invoice.status === "En attente de facture" ? "" : "invoice-eyebrow-danger"}`}>{profession} · {invoice.status}</p>
                  <h3>{businessName}</h3>
                  {contactPersonName && contactPersonName !== businessName ? (
                    <p className="muted-line">Référent : {contactPersonName}</p>
                  ) : null}
                  <p>{invoice.title}</p>
                  {orphan && <p className={`status-pill semantic-danger ${vendorFinanceStyles.orphanNotice}`}>Facture automatique orpheline · Devis d’origine introuvable</p>}
                  <p className="muted-line">Référence : {invoice.invoiceReference || "Non renseignée"}</p>
                  <p className="muted-line">Date facture : {invoice.invoiceDate || "À compléter"} · Créée le : {invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString("fr-FR") : "Non renseignée"}</p>
                  <p className="muted-line">
                    {invoice.status === "En attente de facture"
                      ? "Facture réelle attendue avant mise en paiement"
                      : `Date de paiement prévue : ${invoice.dueDate || "À compléter"}`}
                  </p>
                  <p className="muted-line">Devis d’origine : {invoice.sourceQuoteReference || invoice.sourceQuoteId || "Non renseigné"}</p>

                  {!business && <VendorInvoicePayment invoice={invoice} contact={contacts.find(c => c.id === invoice.contactId)} onUpdate={onUpdate} onOpenContact={() => setBankContactId(invoice.contactId)} />}
                  <div className="stats-grid vendor-invoice-stats">
                    <div className="mini-stat">
                      <span>Montant</span>
                      <strong>{formatEuroAmount(invoice.amount)}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Payé</span>
                      <strong>{formatEuroAmount(invoice.paidAmount)}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Reste</span>
                      <strong>{formatEuroAmount(getVendorInvoiceRemaining(invoice))}</strong>
                    </div>
                  </div>
                </div>

                <div className="item-actions contact-row-actions oar-contact-actions">
                  <span className={`status-pill vendor-invoice-status ${invoice.status === "Payé" ? "semantic-success invoice-status-paid" : invoice.status === "En attente de facture" ? "semantic-pending" : "semantic-danger invoice-status-danger"}`}>{invoice.status}</span>
                  {invoice.sourceQuoteId && (
                    <BusinessButton className="secondary-button" type="button" onClick={() => onOpenQuote(invoice.sourceQuoteId || "")}>
                      Voir devis
                    </BusinessButton>
                  )}
                  {(invoice.invoiceDocumentStoragePath || invoice.invoiceDocumentUrl || documents.find((crmDocument) => crmDocument.id === invoice.linkedDocumentId)?.storagePath || documents.find((crmDocument) => crmDocument.id === invoice.linkedDocumentId)?.url) && (
                    <>
                      <BusinessButton
                        className="secondary-button vendor-invoice-document-button"
                        type="button"
                        disabled={previewingInvoiceDocument}
                        onClick={() => void openVendorInvoicePreview(invoice)}
                      >
                        {previewingInvoiceDocument ? "Ouverture..." : "Voir facture"}
                      </BusinessButton>
                      <BusinessButton permission="export"
                        className="secondary-button vendor-invoice-document-button"
                        type="button"
                        onClick={() => void downloadVendorInvoiceDocument(invoice)}
                      >
                        Télécharger facture
                      </BusinessButton>
                    </>
                  )}
                  <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => startEditInvoice(invoice)}>
                    Modifier
                  </BusinessButton>
                  {orphan ? <BusinessButton permission="remove" className="danger-link" type="button" onClick={() => {
                    if (window.confirm("Supprimer la facture automatique orpheline ? Les liens, documents et paiements seront vérifiés à nouveau.")) onDeleteOrphan(invoice.id);
                  }}>Supprimer la facture orpheline</BusinessButton> : !isAutomaticVendorInvoice(invoice) && <BusinessButton permission="remove"
                    className="danger-link" type="button" onClick={() => {
                      if (window.confirm("Supprimer cette facture prestataire ?")) onDelete(invoice.id);
                    }}>Supprimer</BusinessButton>}
                </div>
              </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card form-card vendor-invoices-form-card">
        <p className="eyebrow">{editingInvoice ? "Modification" : "Nouvelle"}</p>
        <h3>{editingInvoice ? "Modifier facture" : "Ajouter une facture prestataire"}</h3>
        {editingInvoice?.sourceQuoteReference && (
          <div className="card" style={{ boxShadow: "none", marginBottom: 16, padding: 14 }}>
            <p className="eyebrow">Créée depuis le devis</p>
            <strong>{editingInvoice.sourceQuoteReference}</strong>
            <p className="muted-line">Importez la facture réelle avant tout paiement.</p>
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

          <BusinessLabel>Objet facture
            <input name="title" defaultValue={editingInvoice?.title || ""} placeholder="Ex : Entretien jardin juin" />
          </BusinessLabel>

          <BusinessLabel>Référence facture<input name="invoiceReference" defaultValue={editingInvoice?.invoiceReference || ""} placeholder="Ex : 001 (facultatif)" /></BusinessLabel>

          <BusinessLabel>Date facture
            <input name="invoiceDate" type="date" defaultValue={editingInvoice?.invoiceDate || ""} />
          </BusinessLabel>

          <BusinessLabel>Date paiement
            <input name="dueDate" type="date" defaultValue={editingInvoice?.dueDate || ""} />
          </BusinessLabel>

          <BusinessLabel>Montant facture
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={editingInvoice ? formatEuroInput(editingInvoice.amount) : ""}
              placeholder="Ex : 1 023,70"
              required
            />
          </BusinessLabel>

          <BusinessLabel>Montant payé
            <input
              name="paidAmount"
              type="text"
              inputMode="decimal"
              defaultValue={editingInvoice ? formatEuroInput(editingInvoice.paidAmount) : ""}
              placeholder="Ex : 0,00"
            />
            <span className="field-help">Paiement impossible sans facture réelle importée.</span>
          </BusinessLabel>

          <BusinessLabel>Moyen de paiement
            <input name="paymentMethod" defaultValue={editingInvoice?.paymentMethod || ""} placeholder="Virement, espèces, CB..." />
          </BusinessLabel>

          <BusinessLabel className="vendor-invoice-file-field">Importer la facture
            <input name="invoiceFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx" />
            <span className="field-help">
              {editingInvoice?.invoiceDocumentName ? `Fichier actuel : ${editingInvoice.invoiceDocumentName}` : "PDF, image ou document depuis l’ordinateur"}
            </span>
          </BusinessLabel>

          <BusinessLabel className="planning-entry-notes">Notes
            <textarea name="notes" defaultValue={editingInvoice?.notes || ""} placeholder="Détails, facture reçue, remarque..." />
          </BusinessLabel>

          <div className="mobile-form-actions">
            <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit" disabled={uploadingInvoiceDocument}>
              {uploadingInvoiceDocument ? "Import en cours..." : editingInvoice ? "Enregistrer" : "Ajouter facture"}
            </BusinessButton>
            {editingInvoice && (
              <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => setEditingInvoice(null)}>
                Annuler
              </BusinessButton>
            )}
          </div>
        </BusinessForm>
      </section>

      {invoicePreview && (
        <div className="confirm-backdrop vendor-invoice-preview-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-dialog vendor-invoice-preview-dialog">
            <div className="section-heading vendor-invoice-preview-heading">
              <div>
                <p className="eyebrow">Aperçu facture</p>
                <h3>{invoicePreview.fileName}</h3>
                <p className="muted-line">{invoicePreview.invoice.contactName} · {invoicePreview.invoice.title}</p>
              </div>
              <BusinessButton className="secondary-button" type="button" onClick={closeVendorInvoicePreview}>
                Fermer
              </BusinessButton>
            </div>

            {isVendorInvoicePreviewable(invoicePreview.fileName, invoicePreview.mimeType) ? (
              invoicePreview.mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(invoicePreview.fileName) ? (
                <div className="vendor-invoice-preview-frame vendor-invoice-preview-image-frame">
                  <img src={invoicePreview.url} alt={`Facture ${invoicePreview.fileName}`} />
                </div>
              ) : (
                <iframe
                  className="vendor-invoice-preview-frame"
                  src={invoicePreview.url}
                  title={`Facture ${invoicePreview.fileName}`}
                />
              )
            ) : (
              <div className="vendor-invoice-preview-frame vendor-invoice-preview-unavailable">
                <h4>Aperçu non disponible pour ce format.</h4>
                <p>Les PDF et images peuvent être visualisés directement. Pour ce fichier, utilisez le téléchargement.</p>
              </div>
            )}

            <div className="form-actions vendor-invoice-preview-actions">
              <BusinessButton className="secondary-button" type="button" onClick={() => window.open(invoicePreview.url, "_blank", "noopener,noreferrer")}>
                Ouvrir dans un onglet
              </BusinessButton>
              <BusinessButton permission="export" className="primary-button" type="button" onClick={() => void downloadVendorInvoiceDocument(invoicePreview.invoice)}>
                Télécharger
              </BusinessButton>
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
  eyebrow,
  title,
  summary,
  children,
  tone = "neutral"
}: {
  eyebrow: string;
  title: string;
  summary?: string;
  children: any;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  const access=useBusinessPermissions();
  const modules:Record<string,import('@/lib/access/modules').ModuleId[]>={'Factures prestataires':['vendorInvoices'],'Aujourd’hui':['planning'],'Argent':['bookings','vendorInvoices','houseTracking'],'Réservations':['bookings'],'Commercial':['leads','quotes'],'Planning':['planning'],'Disponibilités':['properties','vehicles','boats']};
  if(access&&modules[eyebrow]&&!modules[eyebrow].some(access.read))return null;
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
  label,
  value,
  caption,
  onClick
}: {
  label: string;
  value: string;
  caption: string;
  onClick: () => void;
}) {
  const access=useBusinessPermissions();
  const moduleByCaption:Record<string,import("@/lib/access/modules").ModuleId>={"Factures prestataires":"vendorInvoices","Interventions du jour":"planning","Suivi maison":"houseTracking","Paiements clients":"bookings"};
  if(access&&moduleByCaption[caption]&&!access.read(moduleByCaption[caption]))return null;
  return (
    <button className="stat-card dashboard-command-kpi-tile" type="button" onClick={onClick} title="Ouvrir le module concerné">
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

  function confirmDuplicateContactIn(contacts: Contact[], contact: Contact) {
    const candidateName = normalizeDuplicateKey(contact.name);
    const candidateEmail = normalizeDuplicateKey(contact.email);

    const duplicate = contacts.find((existing) => {
      const sameName = candidateName && normalizeDuplicateKey(existing.name) === candidateName;
      const sameEmail = candidateEmail && normalizeDuplicateKey(existing.email) === candidateEmail;

      return sameName || sameEmail;
    });

    if (!duplicate) return true;

    return window.confirm(
      `Doublon possible détecté.\n\nContact existant : ${duplicate.name}${duplicate.email ? ` (${duplicate.email})` : ""}\nNouveau contact : ${contact.name}${contact.email ? ` (${contact.email})` : ""}\n\nCréer quand même ?`
    );
  }

  function confirmDuplicateLeadIn(leads: Lead[], lead: Lead) {
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
      `Lead similaire déjà existant.\n\nContact : ${duplicate.contactName}\nCatégorie : ${duplicate.category}\nDates : ${duplicate.rentalStartDate || "?"} → ${duplicate.rentalEndDate || "?"}\n\nCréer quand même ?`
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
  function createQuickEntryRecords(rawText: string, contacts: Contact[], leads: Lead[]) {
    const cleanedText = rawText.trim();

    if (!cleanedText) {
      window.alert("Colle d’abord un message client.");
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
      window.alert("Créer depuis message refusé : ce texte ressemble à du code ou à une commande terminal, pas à une demande client.");
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
        "Nom du client non détecté clairement. Indique le nom complet du client avant de créer la fiche :",
        draft.email ? draft.email.split("@")[0] : ""
      );

      if (!manualName?.trim()) {
        window.alert("Création annulée : nom client obligatoire.");
        return;
      }

      draft.contactName = manualName.trim();
    }

    const confirmed = window.confirm(
      `Créer un contact + lead pour : ${draft.contactName} ?\n\nEmail : ${draft.email || "À compléter"}\nCatégorie : ${draft.category || "À compléter"}\nDestination / actif : ${draft.destination || "À compléter"}\nDates : ${draft.rentalStartDate || "À compléter"} → ${draft.rentalEndDate || "À compléter"}\nBudget : ${draft.budget ? draft.budget.toLocaleString("fr-FR") + " €" : "À compléter"}\n\nProchaine action :\n${draft.nextAction || "À compléter"}`
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

    if (!confirmDuplicateContactIn(contacts, newContact as Contact)) return;
    if (!confirmDuplicateLeadIn(leads, newLead as Lead)) return;

    return {newContact, newLead};
  }
  function promptQuickEntryText(savedText = "") {
    const choice = window.prompt(
      "Choisis un modèle :\n\n1 = Villa\n2 = Bateau / Yacht\n3 = Voiture\n4 = Conciergerie\n5 = Texte libre",
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
      "Complète le modèle puis valide :",
      savedText || selectedTemplate
    );

    if (!text) return;

    return text;
  }


export {createQuickEntryRecords, promptQuickEntryText};

export default function CRMApp({ access, initialTab = "dashboard", onExternalNavigate, sessionUserId, sessionAccessToken, sessionEmail, onLogout, onUnsavedChange }: { access: AccessSnapshot; initialTab?: Tab; onExternalNavigate: (tab: UnifiedTab) => void; sessionUserId: string; sessionAccessToken: string; sessionEmail: string; onLogout: () => void; onUnsavedChange?: (dirty: boolean) => void }) {
  const currentAccessToken = useCommittedValue(sessionAccessToken);
  const identityLifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    identityLifetime.current = controller;
    return () => controller.abort();
  }, []);

  const [formDirty, setFormDirty] = useState(false);
  const [activeActor, setActiveActor] = useState<CRMActor>(() => {
    const savedActor = crmCache.getItem(ACTOR_STORAGE_KEY);
    return isCRMActor(savedActor) ? savedActor : "Matteo";
  });

  const [activeTab, setActiveTabState] = useState<Tab>(initialTab);
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

      const label = button.textContent?.trim().toLowerCase() ?? "";

      if (label !== "détails" && label !== "details") return;

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

      const label = button.textContent?.trim().toLowerCase() ?? "";

      if (label !== "détails" && label !== "details") return;

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
  const [quoteDraftFromLead, setQuoteDraftFromLead] = useState<QuoteLeadDraft | null>(null);
  const [query, setQuery] = useState("");
  const [initialLocalState] = useState(() => {
    try {
      const raw = crmCache.getItem(STORAGE_KEY);
      const payload = raw ? normalizeSharedCRMData(JSON.parse(raw)) : emptyData;
      return { data: { ...payload, tasks: maintainCompletedTasks(payload.tasks, Date.now()) }, unreadable: false };
    } catch {
      return { data: emptyData, unreadable: true };
    }
  });
  const [data, setDataState] = useState<CRMData>(initialLocalState.data);
  const setData = useCallback((update: SetStateAction<CRMData>) => {
    const now = Date.now();
    setDataState(current => {
      const next = typeof update === "function" ? update(current) : update;
      if (next.tasks === current.tasks) return next;
      const tasks = maintainCompletedTasks(next.tasks, now);
      return tasks === next.tasks ? next : { ...next, tasks };
    });
  }, []);
  const currentBusinessData = useCommittedValue(data);
  const [sharedWorkspaceReady, setSharedWorkspaceReady] = useState(false);
  const [sharedWorkspaceStatus, setSharedWorkspaceStatus] = useState<"loading" | "connected" | "local" | "error">("loading");
  const [sharedWorkspaceMessage, setSharedWorkspaceMessage] = useState("Chargement de la base partagée...");
  const [sharedWorkspaceUpdatedAt, setSharedWorkspaceUpdatedAt] = useState("");
  const [toast, setToast] = useState<Toast | null>(() => initialLocalState.unreadable
    ? { message: "Impossible de lire la sauvegarde locale.", tone: "warning" } : null);
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
    setSharedWorkspaceMessage("Base partagée modifiée ailleurs. Vos modifications restent en mémoire : exportez-les, puis rechargez le cloud.");
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
        setSharedWorkspaceMessage("Sauvegarde impossible : utilisateur Supabase non connecté.");
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
        setSharedWorkspaceMessage(`Base partagée non sauvegardée : ${error.message}`);
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
      setSharedWorkspaceMessage("Base partagée synchronisée.");
      setSharedWorkspaceUpdatedAt(String(row.updated_at));
      return true;
    } finally {
      workspaceBusy.current = false;
      if (!saved && !signal.aborted) failedSaveFingerprint.current = write.fingerprint;
      if (!identityLifetime.current.signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
    }
  }, [sessionUserId, showWorkspaceConflict]);


  function setActiveTab(tab: Tab) {
    if ((hasUnsavedChanges || formDirty) && tab !== activeTab && !window.confirm("Une saisie est en cours. Quitter ce module ?")) return;
    setFormDirty(false);
    setQuery("");
    setActiveTabState(tab);
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
        .find((button) => /^(fermer|annuler)$/i.test(button.textContent?.trim() ?? ""));

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

      if (!lockedActor) return;

      setActiveActor(lockedActor as "Matteo" | "Vincent");
      crmCache.setItem(ACTOR_STORAGE_KEY, lockedActor);

      const enforce = () => {
        const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];

        selects.forEach((select) => {
          const options = Array.from(select.options).map((option) => `${option.value} ${option.textContent || ""}`.toLowerCase());
          const isActorSelect = options.some((option) => option.includes("matteo")) && options.some((option) => option.includes("vincent"));

          if (!isActorSelect) return;

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

      const tone = getSemanticToneFromText(element.textContent || "");

      if (tone) {
        element.classList.add(`semantic-${tone}`);
      }
    });
  }, [activeTab, data, sharedWorkspaceStatus, sharedWorkspaceMessage]);



  useEffect(() => {
    function normalizeCrmButtonLabel(value: string) {
      return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

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

      const rawLabel = button.textContent || button.getAttribute("aria-label") || "";
      const label = normalizeCrmButtonLabel(rawLabel);
      const type = (button.getAttribute("type") || "").toLowerCase();

      if (!label) return false;
      if (type === "submit") return false;

      const skipWords = [
        "supprimer",
        "deconnexion",
        "connexion",
        "export",
        "import",
        "sauvegarde",
        "recharger cloud",
        "forcer synchro",
        "annuler",
        "reset",
        "reinitialiser"
      ];

      if (skipWords.some((word) => label.includes(word))) return false;

      const triggerWords = [
        "modifier",
        "details",
        "detail",
        "ouvrir",
        "creer",
        "nouveau",
        "traiter",
        "voir",
        "gerer",
        "relancer"
      ];

      return triggerWords.some((word) => label.includes(word));
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
        window.alert("Base CRM partagée non chargée : utilisateur Supabase non connecté.");
        setSharedWorkspaceReady(false);
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage("Base partagée non chargée : utilisateur Supabase non connecté.");
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
        window.alert(`Base CRM partagée non chargée : ${error.message}`);
        setSharedWorkspaceReady(false);
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage(`Base partagée non chargée : ${error.message}`);
        return;
      }

      const sharedData = normalizeSharedCRMData(row?.payload);
      const sharedUpdatedAt = String(row?.updated_at || "");

      if (crmDataHasContent(sharedData)) {
        acceptSharedWorkspace(sharedData, sharedUpdatedAt);
        setSharedWorkspaceReady(true);
        setSharedWorkspaceStatus("connected");
        setSharedWorkspaceMessage("Base partagée chargée depuis Supabase.");
        setSharedWorkspaceUpdatedAt(sharedUpdatedAt);
        return;
      }

      const localData = readLocalCRMDataSafely();

      if (!crmDataHasContent(localData)) {
        acceptSharedWorkspace(emptyData, sharedUpdatedAt);
        setSharedWorkspaceReady(true);
        setSharedWorkspaceStatus("connected");
        setSharedWorkspaceMessage("Base partagée connectée, mais encore vide.");
        setSharedWorkspaceUpdatedAt(sharedUpdatedAt);
        return;
      }

      const shouldSeedSharedWorkspace = window.confirm(
        "La base CRM partagée est vide.\n\nCopier CETTE version locale dans la base commune pour toi et Vincent ?\n\nClique OK uniquement si les données visibles dans TON CRM sont les bonnes. Si tu vois une démo, clique Annuler."
      );

      if (!shouldSeedSharedWorkspace) {
        acceptSharedWorkspace(emptyData, sharedUpdatedAt);
        setSharedWorkspaceReady(true);
        setSharedWorkspaceStatus("local");
        setSharedWorkspaceMessage("Base partagée vide. Données locales non copiées.");
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
      setSharedWorkspaceMessage("Base partagée initialisée depuis les données locales.");

    }

    const timer = window.setTimeout(() => {
      void loadSharedWorkspaceState();
    }, 700);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [sessionUserId, acceptSharedWorkspace, writeSharedWorkspace, currentAccessToken, setData]);

  useEffect(() => {
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
  }, [data, sharedWorkspaceReady, sessionUserId, workspaceSyncEpoch, writeSharedWorkspace, currentAccessToken]);

  const stats = useMemo(() => {
    const pipeline = data.leads
      .filter((lead) => lead.status !== "Perdu")
      .reduce((sum, lead) => sum + lead.value, 0);
    const won = data.leads.filter((lead) => lead.status === "Gagné").reduce((sum, lead) => sum + lead.value, 0);
    const openTasks = data.tasks.filter((task) => task.status !== "Terminé").length;
    const availableProperties = data.properties.filter((property) => property.status === "Disponible").length;
    return { pipeline, won, openTasks, availableProperties };
  }, [data]);


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

    data.tasks
      .filter((task) => task.status !== "Terminé")
      .forEach((task) => {
        const days = daysUntil(task.dueDate);

        if (days === null) {
          items.push({
            id: `task-missing-date-${task.id}`,
            title: "Tâche sans échéance",
            detail: task.title || "Tâche à compléter",
            tab: "tasks" as Tab,
            tone: "warning",
            targetId: `task-${task.id}`
          });
          return;
        }

        if (days < 0) {
          items.push({
            id: `task-late-${task.id}`,
            title: "Tâche en retard",
            detail: `${task.title} · ${task.dueDate}`,
            tab: "tasks" as Tab,
            tone: "danger",
            targetId: `task-${task.id}`
          });
          return;
        }

        if (days === 0) {
          items.push({
            id: `task-today-${task.id}`,
            title: "Date aujourd’hui",
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
            title: "Date proche",
            detail: `${task.title} · dans ${days} jour${days > 1 ? "s" : ""}`,
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
            title: "Lead incomplet",
            detail: `${lead.contactName} · prochaine action ou échéance manquante`,
            tab: "leads" as Tab,
            tone: "warning",
            targetId: `lead-${lead.id}`
          });
        }

        const days = daysUntil(lead.dueDate);

        if (days !== null && days < 0) {
          items.push({
            id: `lead-late-${lead.id}`,
            title: "Lead en retard",
            detail: `${lead.contactName} · ${lead.nextAction || "Action à faire"}`,
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
          title: ageDays >= 3 ? "Relance devis 72h" : "Relance devis 24h",
          detail: `${quote.clientName} · ${formatQuotePrice(getQuoteTotal(quote))}`,
          tab: "quotes" as Tab,
          tone: ageDays >= 3 ? "danger" : "warning",
          targetId: `quote-${quote.id}`
        });
      }

      if (status === "Negotiation") {
        items.push({
          id: `quote-negotiation-${quote.id}`,
          title: "Négociation à suivre",
          detail: `${quote.clientName} · devis en négociation`,
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
              title: "Prestataire à confirmer",
              detail: `${quote.clientName} · ${quote.title || "Réservation"}`,
              tab: "bookings" as Tab,
              tone: "warning",
              targetId: `booking-${quote.id}`
            });
          }

          if (!quote.detailsSent) {
            items.push({
              id: `booking-details-${quote.id}`,
              title: "Détails client à envoyer",
              detail: `${quote.clientName} · réservation confirmée`,
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
            title: days !== null && days < 0 ? "Paiement en retard" : "Paiement à suivre",
            detail: `${quote.clientName} · ${formatQuotePrice(remaining)} restant`,
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
          title: "Intervenant à payer",
          detail: `${worker.contactName} · ${currency.format(balance)} à payer`,
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
          title: "Devis prestataire à valider",
          detail: `${quote.contactName} · ${formatEuroAmount(quote.amount)}`,
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
          title: "Facture prestataire attendue",
          detail: `${invoice.contactName} · ${invoice.sourceQuoteReference || invoice.title}`,
          tab: "vendorInvoices" as Tab,
          tone: "warning",
          targetId: `vendor-invoice-${invoice.id}`
        });
        return;
      }

      const days = daysUntil(invoice.dueDate);

      items.push({
        id: `vendor-invoice-payment-${invoice.id}`,
        title: days !== null && days < 0 ? "Facture prestataire en retard" : "Facture prestataire à payer",
        detail: `${invoice.contactName} · ${formatEuroAmount(remaining)} restant`,
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
        title: isExpired ? "Document expiré" : "Document à vérifier",
        detail: `${crmDocument.title} · ${crmDocument.category}`,
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
  }, [data]);

  const filteredContacts = useMemo(() => {
    return data.contacts.filter((contact) => searchMatch(query, [contact.name, contact.firstName ?? "", contact.companyName ?? "", contact.kind, contact.email, contact.phone, contact.city, contact.postalAddress ?? "", contact.supplierCategory ?? "", contact.supplierZone ?? "", contact.supplierReliability ?? ""]));
  }, [data.contacts, query]);

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

  const filteredTasks = useMemo(() => {
    const matchingTasks = data.tasks.filter((task) => {
      const linkedLead = data.leads.find((lead) => lead.id === task.linkedTo);
      const linkedLeadLabel = linkedLead ? `${linkedLead.category} ${linkedLead.contactName}` : task.linkedTo;

      return searchMatch(query, [task.title, task.owner, task.status, linkedLeadLabel]);
    });

    return [
      ...sortByUrgency(matchingTasks.filter((task) => task.status !== "Terminé")),
      ...sortByUrgency(matchingTasks.filter((task) => task.status === "Terminé"))
    ];
  }, [data.tasks, data.leads, query]);

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

    setActiveTab(targetTab);
    window.setTimeout(() => runScroll(), activeTab === targetTab ? 80 : 180);
  }

  function notify(message: string, tone: Toast["tone"] = "success") {
    setToast({ message, tone });
  }

  function confirmDuplicateContact(contact: Contact) { return confirmDuplicateContactIn(data.contacts, contact); }
  function confirmDuplicateLead(lead: Lead) { return confirmDuplicateLeadIn(data.leads, lead); }

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
      `Doublon possible détecté.\n\n${kind.charAt(0).toUpperCase() + kind.slice(1)} existant : ${duplicate.name}\nNouveau : ${item.name}\n\nCréer quand même ?`
    );
  }






  function saveQuickEntryText(rawText: string) {
    const records = createQuickEntryRecords(rawText, data.contacts, data.leads);
    if (!records) return;
    const {newContact, newLead} = records;
    setData((current: any) => ({
      ...current,
      contacts: [newContact, ...(current.contacts ?? [])],
      leads: [newLead, ...(current.leads ?? [])]
    }));

    setQuickEntryText("");
    setQuickEntryOpen(false);

    notify("Contact et lead créés depuis la saisie rapide.");
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
      "Import sécurisé :\n\n1 = Contacts complets\n2 = Leads complets\n3 = Biens\n4 = Voitures\n5 = Bateaux\n\nChaque ligne doit utiliser le séparateur |.\nAucune donnée existante ne sera écrasée.",
      "1"
    );

    if (!choice) return;

    const type = choice.trim();

    const examples: Record<string, string> = {
      "1": "Nom | Type | Niveau client | Langue préférée | Relation | Email | Téléphone | Ville | Adresse postale | Budget | Source | Préférences | Notes importantes | Notes",
      "2": "Catégorie | Contact | Actif proposé | Début réservation | Fin réservation | Valeur | Statut | Priorité | Date réponse | Prochaine action | Notes internes",
      "3": "Nom | Type | Ville | Prix | Statut | Propriétaire | Notes",
      "4": "Nom | Marque | Modèle | Ville | Prix/jour | Statut | Propriétaire | Notes",
      "5": "Nom | Port | Type | Prix/jour | Statut | Propriétaire | Notes"
    };

    const raw = window.prompt(
      `Colle les lignes à importer.\n\nFormat attendu :\n${examples[type] || examples["1"]}\n\nTu peux coller plusieurs lignes, une par ligne.`,
      ""
    );

    if (!raw) return;

    const lines = raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && line.includes("|"));

    if (lines.length === 0) {
      window.alert("Import refusé : aucune ligne valide avec séparateur |.");
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
          notes
        ] = parts;

        return {
          id: crypto.randomUUID(),
          name: cleanImportValue(name),
          kind: cleanImportValue(kind) || "Client",
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
      window.alert("Import refusé : aucune donnée exploitable trouvée.");
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
        `${safeImportDuplicateCount} doublon(s) possible(s) détecté(s) dans cet import.\\n\\nContinuer quand même ?`
      );

      if (!continueWithDuplicates) return;
    }

    const confirmed = window.confirm(
      `Aperçu import sécurisé\n\nLignes valides : ${payload.length}\n\n${preview}\n\nConfirmer l’ajout ?\n\nAucune donnée existante ne sera écrasée.`
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

    notify(`${payload.length} ligne(s) importée(s) sans écrasement.`);
  }

  function openQuickContactLeadPrompt() {
    const choice = window.prompt(
      "Ajouter rapidement :\n\n1 = Contact complet\n2 = Lead complet\n\nContact : Nom | Type | Niveau client | Langue préférée | Relation | Email | Téléphone | Ville | Adresse postale | Budget | Source | Préférences | Notes importantes | Notes\n\nLead : Catégorie | Contact | Actif proposé | Début réservation | Fin réservation | Valeur | Statut | Priorité | Date réponse | Prochaine action | Notes internes",
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
        ? "Lead complet : Catégorie | Contact | Actif proposé | Début réservation | Fin réservation | Valeur | Statut | Priorité | Date réponse | Prochaine action | Notes internes"
        : "Contact complet : Nom | Type | Niveau client | Langue préférée | Relation | Email | Téléphone | Ville | Adresse postale | Budget | Source | Préférences | Notes importantes | Notes",
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
        window.alert("Ajout refusé : nom du contact manquant.");
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

      notify("Contact complet ajouté en express.");
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
        window.alert("Ajout refusé : nom du contact manquant.");
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

      notify("Lead complet ajouté en express.");
      return;
    }

    window.alert("Choix invalide. Utilise 1 pour Contact ou 2 pour Lead.");
  }

  function openQuickInventoryPrompt() {
    const choice = window.prompt(
      "Ajouter rapidement :\n\n1 = Bien / Villa\n2 = Voiture\n3 = Bateau / Yacht",
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
      `${labels[type] || labels["1"]}\n\nTu peux coller une seule ligne :`,
      examples[type] || examples["1"]
    );

    if (!raw) return;

    const parts = parseInventoryLine(raw);

    if (parts.length < 3) {
      window.alert("Ajout refusé : il manque des informations. Utilise les séparateurs |");
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
        window.alert("Ajout refusé : nom du bien manquant.");
        return;
      }

      if (!confirmDuplicateAsset("bien", property)) return;

      setData((current: any) => ({
        ...current,
        properties: [property, ...(current.properties ?? [])]
      }));

      notify("Bien ajouté en express.");
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
        window.alert("Ajout refusé : nom de la voiture manquant.");
        return;
      }

      if (!confirmDuplicateAsset("voiture", vehicle)) return;

      setData((current: any) => ({
        ...current,
        vehicles: [vehicle, ...(current.vehicles ?? [])]
      }));

      notify("Voiture ajoutée en express.");
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
        window.alert("Ajout refusé : nom du bateau manquant.");
        return;
      }

      if (!confirmDuplicateAsset("bateau", boat)) return;

      setData((current: any) => ({
        ...current,
        boats: [boat, ...(current.boats ?? [])]
      }));

      notify("Bateau ajouté en express.");
      return;
    }

    window.alert("Choix invalide. Utilise 1, 2 ou 3.");
  }

  function openQuickEntryPrompt() {
    const text = promptQuickEntryText(quickEntryText);
    if (text) saveQuickEntryText(text);
  }

  function createQuickEntry() {
    saveQuickEntryText(quickEntryText);
  }


  async function getCurrentCrmUserId() {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      notify("Contact cloud non synchronisé : utilisateur Supabase non connecté.", "warning");
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
      notify(`Contact non sauvegardé dans Supabase : ${error.message}`, "warning");
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
      notify(`Contact non supprimé dans Supabase : ${error.message}`, "warning");
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
      notify(`Contacts cloud non chargés : ${error.message}`, "warning");
      return;
    }

    const cloudContacts = Array.isArray(rows) ? rows.map(contactFromSupabaseRow).filter((contact) => contact.id) : [];

    if (cloudContacts.length > 0) {
      setData((current) => ({
        ...current,
        contacts: cloudContacts
      }));

      notify("Contacts chargés depuis Supabase.");
      return;
    }

    const raw = crmCache.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const localContacts = Array.isArray(parsed?.contacts) ? parsed.contacts as Contact[] : [];

    if (localContacts.length === 0) return;

    const confirmed = window.confirm(
      `La table Contacts Supabase est vide.\n\nCopier ${localContacts.length} contact(s) locaux vers Supabase maintenant ?\n\nClique OK seulement si les contacts affichés dans le CRM sont les bons.`
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
      notify(`Migration contacts impossible : ${upsertError.message}`, "warning");
      return;
    }

    notify(`${payload.length} contact(s) copiés dans Supabase.`);
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
    if (hasUnsavedChanges && !window.confirm("Des modifications ne sont pas sauvegardées. Exportez-les avant de recharger. Remplacer la version en mémoire par la version cloud ?")) return;
    const requestedFingerprint = workspaceFingerprint(data);
    const signal = identityLifetime.current.signal;
    const token = currentAccessToken.current;
    workspaceBusy.current = true;
    try {
      setSharedWorkspaceStatus("loading");
      setSharedWorkspaceMessage("Rechargement depuis Supabase...");

      const { data: userData, error: userError } = await supabase.auth.getUser(token);

      if (signal.aborted) return;
      if (userError || !userData.user || userData.user.id !== sessionUserId) {
        setSharedWorkspaceStatus("error");
        setSharedWorkspaceMessage("Rechargement impossible : utilisateur Supabase non connecté.");
        notify("Rechargement cloud impossible : non connecté.", "warning");
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
        setSharedWorkspaceMessage(`Rechargement cloud impossible : ${error.message}`);
        notify("Rechargement cloud impossible.", "warning");
        return;
      }

      if (workspaceFingerprint(currentBusinessData.current) !== requestedFingerprint) {
        setSharedWorkspaceStatus("local");
        setSharedWorkspaceMessage("Rechargement annulé : des modifications ont été faites pendant la lecture du cloud.");
        return;
      }
      const sharedData = normalizeSharedCRMData(row?.payload);

      acceptSharedWorkspace(sharedData, String(row?.updated_at || ""));
      setSharedWorkspaceReady(true);
      setSharedWorkspaceStatus("connected");
      setSharedWorkspaceMessage("Données rechargées depuis la base partagée.");

      notify("CRM rechargé depuis Supabase.");
    } finally {
      workspaceBusy.current = false;
      if (!signal.aborted) setWorkspaceSyncEpoch(value => value + 1);
    }
  }

  async function forceSaveSharedWorkspaceNow() {
    const signal = identityLifetime.current.signal;
    const token = currentAccessToken.current;
    if (await writeSharedWorkspace(data, signal, token)) notify("Base partagée synchronisée.");
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
      window.alert("Sauvegarde refusée : le CRM est vide.");
      return;
    }

    const confirmed = window.confirm(
      `Créer une sauvegarde Supabase ?\n\nContacts: ${contactsCount}\nLeads: ${leadsCount}\nBiens: ${propertiesCount}\nVoitures: ${vehiclesCount}\nBateaux: ${boatsCount}\nTâches: ${tasksCount}\nDevis: ${quotesCount}`
    );

    if (!confirmed || signal.aborted) return;

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (signal.aborted) return;
    if (userError || !userData.user || userData.user.id !== sessionUserId) {
      window.alert("Sauvegarde impossible : utilisateur Supabase non connecté.");
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
      window.alert(`Erreur sauvegarde Supabase : ${error.message}`);
      return;
    }

    window.alert("Sauvegarde Supabase créée.");
  }

  function exportJson() {
    const exportPayload = {
      ...data,
      quotes: mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `oneaddress-riviera-crm-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Export JSON téléchargé.");
  }

  

  function addHouseTrackingHouse(house: HouseTrackingHouse) {
    setData((current) => ({
      ...current,
      houseTrackingHouses: [stampCreated(house, activeActor), ...(((current as any).houseTrackingHouses ?? []) as HouseTrackingHouse[])]
    }));

    notify("Maison ajoutée au suivi.");
  }

  function deleteHouseTrackingHouse(id: string) {
    setData((current) => ({
      ...current,
      houseTrackingHouses: (((current as any).houseTrackingHouses ?? []) as HouseTrackingHouse[]).filter((house) => house.id !== id),
      houseTimeEntries: (((current as any).houseTimeEntries ?? []) as HouseTimeEntry[]).filter((entry) => entry.houseId !== id),
      housePayments: (((current as any).housePayments ?? []) as HousePayment[]).filter((payment) => payment.houseId !== id)
    }));

    notify("Maison supprimée du suivi.");
  }

  function addHouseTrackingWorker(worker: HouseTrackingWorker) {
    setData((current) => ({
      ...current,
      houseTrackingWorkers: [stampCreated(worker, activeActor), ...(((current as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[])]
    }));

    notify("Intervenant ajouté.");
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

    notify("Intervenant archivé. Son historique est conservé.");
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

    notify("Intervenant réactivé.");
  }

  function permanentlyDeleteHouseTrackingWorkerSafely(id: string) {
    const currentWorkers = (((data as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[]);
    const currentEntries = (((data as any).houseTimeEntries ?? []) as HouseTimeEntry[]);
    const currentPayments = (((data as any).housePayments ?? []) as HousePayment[]);
    const initialCheck = permanentlyDeleteHouseTrackingWorker(currentWorkers, currentEntries, currentPayments, id);

    if (initialCheck.blocked) {
      notify("Suppression bloquée : archivez cet intervenant pour conserver son historique.", "warning");
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

    notify("Fiche d’intervenant supprimée définitivement.");
  }

  function addHouseTimeEntry(entry: HouseTimeEntry) {
    setData((current) => ({
      ...current,
      houseTimeEntries: [stampCreated(entry, activeActor), ...(((current as any).houseTimeEntries ?? []) as HouseTimeEntry[])]
    }));

    notify("Heures ajoutées.");
  }

  function deleteHouseTimeEntry(id: string) {
    setData((current) => ({
      ...current,
      houseTimeEntries: (((current as any).houseTimeEntries ?? []) as HouseTimeEntry[]).filter((entry) => entry.id !== id)
    }));

    notify("Heures supprimées.");
  }

  function addHousePayment(payment: HousePayment) {
    setData((current) => ({
      ...current,
      housePayments: [stampCreated(payment, activeActor), ...(((current as any).housePayments ?? []) as HousePayment[])]
    }));

    notify("Paiement ajouté.");
  }

  function deleteHousePayment(id: string) {
    setData((current) => ({
      ...current,
      housePayments: (((current as any).housePayments ?? []) as HousePayment[]).filter((payment) => payment.id !== id)
    }));

    notify("Paiement supprimé.");
  }

  function addCRMDocument(crmDocument: CRMDocument) {
    setData((current) => ({
      ...current,
      documents: [crmDocument, ...(((current as any).documents ?? []) as CRMDocument[])]
    }));

    notify("Document ajouté.");
  }

  function updateCRMDocument(updatedDocument: CRMDocument) {
    setData((current) => ({
      ...current,
      documents: (((current as any).documents ?? []) as CRMDocument[]).map((crmDocument) =>
        crmDocument.id === updatedDocument.id ? updatedDocument : crmDocument
      )
    }));

    notify("Document mis à jour.");
  }

  function deleteCRMDocument(id: string) {
    setData((current) => ({
      ...current,
      documents: (((current as any).documents ?? []) as CRMDocument[]).filter((crmDocument) => crmDocument.id !== id)
    }));

    notify("Document supprimé.");
  }


  function addVendorQuote(quote: VendorQuote) {
    const createdQuote = normalizeVendorQuoteFinancials(
      stampCreated(quote, activeActor) as VendorQuote
    );

    setData((current) => ({
      ...current,
      vendorQuotes: [createdQuote, ...(((current as any).vendorQuotes ?? []) as VendorQuote[])]
    }));

    notify("Devis prestataire ajouté.");
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

    notify("Devis prestataire mis à jour.");
  }

  function validateVendorQuote(id: string) {
    const invoiceId = makeId("invoice");
    try { validateVendorQuoteIdempotently(data, id, invoiceId); }
    catch (error) { notify((error as Error).message); return; }
    setData(current => {
      try {
        const next = validateVendorQuoteIdempotently(current, id, invoiceId);
        return { ...next, vendorQuotes: next.vendorQuotes?.map(quote => quote.id === id
          ? stampUpdated(quote, activeActor) as VendorQuote : quote) };
      } catch { return current; }
    });
    notify("Devis validé. Facture liée réutilisée ou créée si nécessaire.");
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

    notify("Devis prestataire refusé.");
  }

  function deleteVendorQuote(id: string, choice?: VendorQuoteDeletionChoice) {
    try { deleteVendorQuoteWithDecision(data, id, choice); }
    catch (error) { window.alert((error as Error).message); return; }
    setData(current => {
      try { return deleteVendorQuoteWithDecision(current, id, choice); }
      catch { return current; }
    });
    notify(choice === "delete-both" ? "Devis et facture automatique supprimés." : "Devis prestataire supprimé.");
  }

  function deleteOrphanVendorInvoice(id: string) {
    try { deleteOrphanAutomaticVendorInvoice(data, id); }
    catch (error) { window.alert((error as Error).message); return; }
    setData(current => {
      try { return deleteOrphanAutomaticVendorInvoice(current, id); }
      catch { return current; }
    });
    notify("Facture automatique orpheline supprimée.");
  }

  function addVendorInvoice(invoice: VendorInvoice) {
    const normalizedInvoice = normalizeVendorInvoiceFinancials(invoice);

    setData((current) => ({
      ...current,
      vendorInvoices: [normalizedInvoice, ...(((current as any).vendorInvoices ?? []) as VendorInvoice[])]
    }));

    notify("Facture prestataire ajoutée.");
  }

  function updateVendorInvoice(updatedInvoice: VendorInvoice) {
    const existing = (data.vendorInvoices || []).find(invoice => invoice.id === updatedInvoice.id);
    if (existing?.paymentBankAccountId && existing.contactId !== updatedInvoice.contactId) {
      notify("Le prestataire ne peut pas changer après sélection d’un compte bancaire."); return;
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

    notify("Facture prestataire mise à jour.");
  }

  function deleteVendorInvoice(id: string) {
    setData((current) => ({
      ...current,
      vendorInvoices: (((current as any).vendorInvoices ?? []) as VendorInvoice[]).filter((invoice) => invoice.id !== id)
    }));

    notify("Facture prestataire supprimée.");
  }

  function addSupplier(supplier: Supplier) {
    setData((current) => ({
      ...current,
      suppliers: [supplier, ...(((current as any).suppliers ?? []) as Supplier[])]
    }));
    notify("Prestataire ajouté.");
  }

  function updateSupplier(updatedSupplier: Supplier) {
    setData((current) => ({
      ...current,
      suppliers: (((current as any).suppliers ?? []) as Supplier[]).map((supplier) =>
        supplier.id === updatedSupplier.id ? updatedSupplier : supplier
      )
    }));
    notify("Prestataire mis à jour.");
  }

  function deleteSupplier(id: string) {
    setData((current) => ({
      ...current,
      suppliers: (((current as any).suppliers ?? []) as Supplier[]).filter((supplier) => supplier.id !== id)
    }));
    notify("Prestataire supprimé.");
  }

function addContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const contactKind = String(form.get("kind") ?? "Client") as ContactKind;
    const isPrestataire = contactKind === "Prestataire";
    const contact: Contact = stampCreated({
      id: makeId("c"),
      name: String(form.get("name") ?? "").trim(),
      firstName: String(form.get("firstName") ?? "").trim(),
      civility: String(form.get("civility") ?? "") as Contact["civility"],
      companyName: String(form.get("companyName") ?? "").trim(),
      kind: contactKind,
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
    if (!confirmDuplicateContact(contact)) return;
    setData((current) => ({ ...current, contacts: [contact, ...current.contacts] }));
    // Ancienne synchro contact désactivée : crm_workspace_state sauvegarde tout le CRM.
    event.currentTarget.reset();
    notify("Contact ajouté.");

    window.setTimeout(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }, 80);
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

    if (!lead.contactName) return notify("Sélectionnez un contact pour ce lead.", "warning");

    if (isOpenLead(lead) && (!lead.nextAction.trim() || !lead.dueDate)) {
      return notify("Un lead ouvert doit avoir une prochaine action et une échéance.", "warning");
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
    notify("Lead ajouté au pipeline.");
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
    if (!property.name) return notify("Ajoutez au minimum un nom de bien.", "warning");
    if (!confirmDuplicateAsset("bien", property)) return;
    setData((current) => ({ ...current, properties: [property, ...current.properties] }));
    event.currentTarget.reset();
    notify("Bien ajouté.");
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
    if (!vehicle.name) return notify("Ajoutez au minimum un nom de voiture.", "warning");
    if (!confirmDuplicateAsset("voiture", vehicle)) return;
    setData((current) => ({ ...current, vehicles: [vehicle, ...(current.vehicles ?? [])] }));
    event.currentTarget.reset();
    notify("Voiture ajoutée.");
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
    if (!boat.name) return notify("Ajoutez au minimum un nom de bateau.", "warning");
    if (!confirmDuplicateAsset("bateau", boat)) return;
    setData((current) => ({ ...current, boats: [boat, ...(current.boats ?? [])] }));
    event.currentTarget.reset();
    notify("Bateau ajouté.");
  }

  function updateProperty(updatedProperty: Property) {
    setData((current) => ({
      ...current,
      properties: current.properties.map((property) =>
        property.id === updatedProperty.id ? stampUpdated(updatedProperty, activeActor) as Property : property
      )
    }));

    notify("Bien mis à jour.");
  }

  function updateVehicle(updatedVehicle: Vehicle) {
    setData((current) => ({
      ...current,
      vehicles: (current.vehicles ?? []).map((vehicle) =>
        vehicle.id === updatedVehicle.id ? stampUpdated(updatedVehicle, activeActor) as Vehicle : vehicle
      )
    }));

    notify("Voiture mise à jour.");
  }

  function updateBoat(updatedBoat: Boat) {
    setData((current) => ({
      ...current,
      boats: (current.boats ?? []).map((boat) =>
        boat.id === updatedBoat.id ? stampUpdated(updatedBoat, activeActor) as Boat : boat
      )
    }));

    notify("Bateau mis à jour.");
  }

  function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const task: Task = stampCreated({
      id: makeId("t"),
      title: String(form.get("title") ?? "").trim(),
      owner: String(form.get("owner") ?? "").trim() || activeActor,
      status: String(form.get("status") ?? "À faire") as TaskStatus,
      dueDate: String(form.get("dueDate") ?? ""),
      linkedTo: String(form.get("linkedTo") ?? "").trim(),
      completedAt: isCompletedTaskStatus(String(form.get("status") ?? "À faire")) ? new Date().toISOString() : ""
    }, activeActor) as Task;
    if (!task.title) return notify("Ajoutez au minimum un titre de tâche.", "warning");
    setData((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    event.currentTarget.reset();
    setTaskDraftLeadId("");
    setTaskDraftTitle("");
    notify("Tâche ajoutée.");
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

    if (!entry.title) return notify("Ajoutez au minimum un titre planning.", "warning");
    if (!isValidPlanningDate(entry.startDate)) return notify("Ajoutez une date de début valide.", "warning");
    if (!isValidPlanningDate(entry.endDate)) return notify("Ajoutez une date de fin valide.", "warning");
    if (planningDateValue(entry.endDate) < planningDateValue(entry.startDate)) {
      return notify("La date de fin ne peut pas être avant la date de début.", "warning");
    }

    setData((current) => ({
      ...current,
      planningEntries: [entry, ...(((current as any).planningEntries ?? []) as PlanningEntry[])]
    }));

    event.currentTarget.reset();
    notify("Événement ajouté au planning.");
  }

  function deletePlanningEntry(id: string) {
    const confirmed = window.confirm("Supprimer cette entrée du planning ?");

    if (!confirmed) return;

    setData((current) => ({
      ...current,
      planningEntries: (((current as any).planningEntries ?? []) as PlanningEntry[]).filter((entry) => entry.id !== id)
    }));

    notify("Entrée planning supprimée.");
  }

  function patchPlanningEntry(id: string, patch: Partial<PlanningEntry>) {
    setData((current) => ({
      ...current,
      planningEntries: (((current as any).planningEntries ?? []) as PlanningEntry[]).map((entry) =>
        entry.id === id ? stampUpdated({ ...entry, ...patch }, activeActor) as PlanningEntry : entry
      )
    }));

    notify("Planning mis à jour.");
  }


  function patchLeadReservationDates(id: string, startDate: string, endDate: string) {
    if (!isValidPlanningDate(startDate) || !isValidPlanningDate(endDate)) {
      notify("Dates invalides pour déplacer la réservation.", "warning");
      return;
    }

    if (planningDateValue(endDate) < planningDateValue(startDate)) {
      notify("La date de fin ne peut pas être avant la date de début.", "warning");
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

    notify("Réservation déplacée dans le planning.");
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
      notify("Ajoutez au minimum un titre planning.", "warning");
      return false;
    }

    if (!isValidPlanningDate(nextEntry.startDate)) {
      notify("Ajoutez une date de début valide.", "warning");
      return false;
    }

    if (!isValidPlanningDate(nextEntry.endDate)) {
      notify("Ajoutez une date de fin valide.", "warning");
      return false;
    }

    if (planningDateValue(nextEntry.endDate) < planningDateValue(nextEntry.startDate)) {
      notify("La date de fin ne peut pas être avant la date de début.", "warning");
      return false;
    }

    setData((current) => ({
      ...current,
      planningEntries: (((current as any).planningEntries ?? []) as PlanningEntry[]).map((entry) =>
        entry.id === id ? stampUpdated({ ...entry, ...nextEntry }, activeActor) as PlanningEntry : entry
      )
    }));

    notify("Entrée planning mise à jour.");
    return true;
  }

  function updateLead(updatedLead: Lead) {
    setData((current) => ({
      ...current,
      leads: current.leads.map((lead) =>
        lead.id === updatedLead.id ? stampUpdated(updatedLead, activeActor) as Lead : lead
      )
    }));

    notify("Lead mis à jour.");
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

      notify(`Devis existant ouvert pour ${lead.contactName}.`);
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

    notify(`Devis prêt pour ${lead.contactName}.`);
  }


  function createTaskDraftFromFollowUp(recommendation: FollowUpRecommendation) {
    setTaskDraftLeadId(recommendation.leadId ?? "");
    setTaskDraftTitle(recommendation.title);
    setActiveTab("tasks");

    window.setTimeout(() => {
      document.getElementById("task-create-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 120);

    notify("Tâche de relance prête.");
  }


  function updateTask(updatedTask: Task) {
    const taskToSave = isCompletedTaskStatus(updatedTask.status)
      ? {
          ...updatedTask,
          completedAt: updatedTask.completedAt || new Date().toISOString()
        }
      : {
          ...updatedTask,
          completedAt: ""
        };

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === updatedTask.id ? stampUpdated(taskToSave, activeActor) as Task : task
      )
    }));

    notify("Tâche mise à jour.");
  }

  function updateTaskStatus(id: string, status: TaskStatus) {
    const nowIso = new Date().toISOString();

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) => {
        if (task.id !== id) return task;

        const nextTask = isCompletedTaskStatus(status)
          ? {
              ...task,
              status,
              completedAt: task.completedAt || nowIso
            }
          : {
              ...task,
              status,
              completedAt: ""
            };

        return stampUpdated(nextTask, activeActor) as Task;
      })
    }));
  }

  function updateContact(updatedContact: Pick<Contact, "id"> & Partial<Contact>) {
    setData((current) => ({
      ...current,
      contacts: current.contacts.map((contact) =>
        contact.id === updatedContact.id ? stampUpdated(mergeContactUpdate(contact, updatedContact), activeActor) as Contact : contact
      )
    }));

    // Ancienne synchro contact désactivée : crm_workspace_state sauvegarde tout le CRM.

    notify("Contact mis à jour.");
  }

  function deleteContact(id: string) {
    if (data.contacts.find(c => c.id === id)?.supplierBankAccounts?.length) {
      notify("Ce contact possède des RIB : archivez le prestataire pour conserver l’historique."); return;
    }
    setData((current) => ({ ...current, contacts: current.contacts.filter((contact) => contact.id !== id) }));
    // Ancienne suppression contact désactivée : crm_workspace_state sauvegarde tout le CRM.

    notify("Contact supprimé.");
  }

  function deleteLead(id: string) {
    setData((current) => ({ ...current, leads: current.leads.filter((lead) => lead.id !== id) }));
    notify("Lead supprimé.");
  }

  function deleteProperty(id: string) {
    const property = data.properties.find((item) => item.id === id);
    const label = property ? getPropertyDisplayName(property) : "ce bien";
    const confirmed = window.confirm(`Supprimer définitivement "${label}" ?`);

    if (!confirmed) return;

    setData((current) => ({ ...current, properties: current.properties.filter((property) => property.id !== id) }));
    notify("Bien supprimé.");
  }

  function deleteVehicle(id: string) {
    const vehicle = (data.vehicles ?? []).find((item) => item.id === id);
    const label = vehicle?.name || "cette voiture";
    const confirmed = window.confirm(`Supprimer définitivement "${label}" ?`);

    if (!confirmed) return;

    setData((current) => ({ ...current, vehicles: (current.vehicles ?? []).filter((vehicle) => vehicle.id !== id) }));
    notify("Voiture supprimée.");
  }

  function deleteBoat(id: string) {
    const boat = (data.boats ?? []).find((item) => item.id === id);
    const label = boat?.name || "ce bateau";
    const confirmed = window.confirm(`Supprimer définitivement "${label}" ?`);

    if (!confirmed) return;

    setData((current) => ({ ...current, boats: (current.boats ?? []).filter((boat) => boat.id !== id) }));
    notify("Bateau supprimé.");
  }

  function deleteTask(id: string) {
    setData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) }));
    notify("Tâche supprimée.");
  }


  function handleImportJson(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) return;

    const confirmed = window.confirm(
      "Importer ce fichier JSON va remplacer/compléter les données actuelles du CRM. Continuer ?"
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

        const knownKeys = ["contacts", "leads", "properties", "vehicles", "boats", "tasks", "suppliers", "quotes", "vendorQuotes", "vendorInvoices", "houseTrackingHouses", "houseTrackingWorkers", "houseTimeEntries", "housePayments"];
        const hasKnownData = knownKeys.some((key) => Array.isArray((parsed as Record<string, unknown>)[key]));

        if (!hasKnownData) {
          throw new Error("Ce fichier ne ressemble pas à une sauvegarde CRM.");
        }

        const nextData = {
          ...data,
          ...(parsed as Partial<CRMData>)
        } as CRMData;

        setData(nextData);

        if (Array.isArray((parsed as { quotes?: unknown }).quotes)) {
          const importedDeviss = ((parsed as { quotes?: unknown }).quotes as unknown[])
            .map(normalizeQuoteRequest)
            .filter((quote): quote is QuoteRequest => Boolean(quote));

          saveQuotesToBrowser(importedDeviss);
        }

        window.alert("Import JSON réussi. Recharge la page pour afficher les devis restaurés.");
      } catch (error) {
        window.alert("Import impossible : le fichier JSON n’est pas valide.");
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

  const sidebarTaskCount = (data.tasks ?? []).filter((task) => {
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
    { label: "Import sécurisé", onClick: openSafeCsvImportPrompt },
    { label: "Backup fichier", onClick: exportJson },
    { label: "Sauvegarde cloud", onClick: saveCrmBackupToSupabase },
    { label: "Recharger cloud", onClick: reloadSharedWorkspaceFromCloud },
    { label: "Forcer synchro", onClick: forceSaveSharedWorkspaceNow },
    {
      label: "Export CSV",
      onClick: () => {
        exportCRMAsCsv(data);
        notify("Export CSV téléchargé.");
      }
    },
    { label: "Déconnexion", onClick: onLogout, tone: "danger" }
  ];

  function navigateToTab(tab: Tab) {
    setActiveTab(tab);
    setMobileMoreOpen(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }
  // === SMART SIDEBAR BADGES END ===



  return (
    <main className="crm-shell crm-readable-redesign" onChangeCapture={event=>{if((event.target as HTMLElement).closest("form"))setFormDirty(true);}} onSubmitCapture={()=>setFormDirty(false)}>
      <UnifiedNavigation access={access} active={activeTab} badges={sidebarBadgeCounts} onLogout={onLogout} onNavigate={tab => {
        if (tab === "izord" || tab === "admin") onExternalNavigate(tab); else setActiveTab(tab);
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
            <p className="eyebrow">CRM interne</p>
            <h2>{getCRMTabTitle(activeTab)}</h2>
          </div>
          <div className="topbar-actions crm-topbar-actions-compact">
            {isCRMTabSearchable(activeTab) ? (
              <input
                className="search-input crm-topbar-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={getCRMTabSearchPlaceholder(activeTab)}
                aria-label="Recherche"
              />
            ) : null}
            <span className="muted-line crm-session-email">Connecté : {sessionEmail}</span>
            <label className="actor-select-label crm-actor-select-label">
              <span>Actions par</span>
              <select value={activeActor} onChange={(event) => setActiveActor(event.target.value as CRMActor)}>
                {crmActors.map((actor) => <option key={actor}>{actor}</option>)}
              </select>
            </label>
            <details className="crm-topbar-menu">
              <summary className="secondary-button crm-topbar-menu-button">Actions</summary>
              <div className="crm-topbar-menu-panel">
                <button type="button" onClick={onLogout}>Déconnexion</button>
                <button type="button" onClick={openSafeCsvImportPrompt}>Import sécurisé</button>
                <button type="button" onClick={exportJson}>Backup fichier</button>
                <button type="button" onClick={saveCrmBackupToSupabase}>Sauvegarde cloud</button>
                <button type="button" onClick={reloadSharedWorkspaceFromCloud}>Recharger cloud</button>
                <button type="button" onClick={forceSaveSharedWorkspaceNow}>Forcer synchro</button>
                <button type="button" onClick={() => {
                  exportCRMAsCsv(data);
                  notify("Export CSV téléchargé.");
                }}>Export CSV</button>
              </div>
            </details>
          </div>
        </header>

        <section className={`shared-db-status-panel shared-db-status-desktop ${sharedWorkspaceStatus}`}>
          <div>
            <p className="eyebrow">Base partagée</p>
            <strong>
              {sharedWorkspaceStatus === "connected" ? "Connectée" : sharedWorkspaceStatus === "loading" ? "Synchronisation..." : sharedWorkspaceStatus === "local" ? "Mode local / à vérifier" : "Erreur"}
            </strong>
            <span>{sharedWorkspaceMessage}</span>
            {sharedWorkspaceUpdatedAt && (
              <small>Dernière mise à jour cloud : {new Date(sharedWorkspaceUpdatedAt).toLocaleString("fr-FR")}</small>
            )}
          </div>

          <div>
            <button className="secondary-button" type="button" onClick={reloadSharedWorkspaceFromCloud}>
              Recharger cloud
            </button>
            <button className="primary-button" type="button" onClick={forceSaveSharedWorkspaceNow}>
              Forcer synchro
            </button>
          </div>
        </section>

        <details className={`mobile-shared-db-status ${sharedWorkspaceStatus}`}>
          <summary>
            <span className="mobile-status-dot" aria-hidden="true" />
            <span>Base partagée</span>
            <strong>
              {sharedWorkspaceStatus === "connected" ? "Connectée" : sharedWorkspaceStatus === "loading" ? "Synchronisation…" : sharedWorkspaceStatus === "local" ? "Mode local" : "Erreur"}
            </strong>
            <span className="mobile-status-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="mobile-shared-db-details">
            <p>{sharedWorkspaceMessage}</p>
            {sharedWorkspaceUpdatedAt ? (
              <small>Dernière mise à jour cloud : {new Date(sharedWorkspaceUpdatedAt).toLocaleString("fr-FR")}</small>
            ) : null}
            <div>
              <button className="secondary-button" type="button" onClick={reloadSharedWorkspaceFromCloud}>Recharger cloud</button>
              <button className="primary-button" type="button" onClick={forceSaveSharedWorkspaceNow}>Forcer synchro</button>
            </div>
          </div>
        </details>

        {activeTab === "dashboard" && actionNotifications.length > 0 && (
          <section className="crm-notification-panel">
            <div className="crm-notification-heading">
              <div>
                <p className="eyebrow">Notifications</p>
                <h3>{actionNotifications.length} action{actionNotifications.length > 1 ? "s" : ""} à traiter</h3>
              </div>

              <button
                className="secondary-button"
                type="button"
                onClick={() => handleNotificationAction()}
              >
                Traiter maintenant
              </button>
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
              data={data}
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
              tasks={data.tasks}
              quotes={mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())}
              onCreateTask={createTaskDraftFromFollowUp}
            />
          </>
        )}

        {activeTab === "contacts" && (
          <ContactsView actor={activeActor} contacts={filteredContacts} leads={data.leads} tasks={data.tasks} onAdd={addContact} onUpdate={updateContact} onDelete={deleteContact} onCreateLead={(contactName) => {
                  setLeadDraftContactName(contactName);
                  setActiveTab("leads");

                  window.setTimeout(() => {
                    document.getElementById("lead-create-form")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 120);

                  notify(`Lead prêt pour ${contactName}.`);
                }} onCreateTask={(contactName) => {
                  setTaskDraftLeadId("");
                  setTaskDraftTitle(`Relancer ${contactName}`);
                  setActiveTab("tasks");

                  window.setTimeout(() => {
                    document.getElementById("task-create-form")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 120);

                  notify(`Tâche prête pour ${contactName}.`);
                }} />
        )}

        {activeTab === "documents" && (
          <DocumentsView
            documents={(((data as any).documents ?? []) as CRMDocument[])}
            activeActor={activeActor}
            onAdd={addCRMDocument}
            onUpdate={updateCRMDocument}
            onDelete={deleteCRMDocument}
          />
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
            contacts={data.contacts}
            houses={(((data as any).houseTrackingHouses ?? []) as HouseTrackingHouse[])}
            workers={(((data as any).houseTrackingWorkers ?? []) as HouseTrackingWorker[])}
            timeEntries={(((data as any).houseTimeEntries ?? []) as HouseTimeEntry[])}
            payments={(((data as any).housePayments ?? []) as HousePayment[])}
            onAddHouse={addHouseTrackingHouse}
            onDeleteHouse={deleteHouseTrackingHouse}
            onAddWorker={addHouseTrackingWorker}
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
          <LeadsView leads={filteredLeads} contacts={data.contacts} tasks={data.tasks} quotes={mergeQuoteRequests((data as any).quotes ?? [], loadSavedQuotes())} properties={data.properties} vehicles={data.vehicles ?? []} boats={data.boats ?? []} preselectedContactName={leadDraftContactName} onAdd={addLead} onUpdate={updateLead} onStatusChange={updateLeadStatus} onDelete={deleteLead} onCreateQuote={createQuoteDraftFromLead} onCreateTask={(lead: Lead) => {
                  setTaskDraftLeadId(lead.id);
                  setTaskDraftTitle(lead.nextAction || `Relancer ${lead.contactName}`);
                  setActiveTab("tasks");

                  window.setTimeout(() => {
                    document.getElementById("task-create-form")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }, 120);

                  notify(`Tâche prête pour ${lead.contactName}.`);
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
          <TasksView tasks={filteredTasks} leads={data.leads} preselectedLeadId={taskDraftLeadId} prefilledTitle={taskDraftTitle} onAdd={addTask} onUpdate={updateTask} onStatusChange={updateTaskStatus} onDelete={deleteTask} />
        )}
      </section>

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
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

function getPlanningCalendarDaySegmentStatus(event: any, dayIso?: string): { status: PlanningEntryStatus; label: string; explanation: string } {
  const rawStatus = String(event?.status || "Prévu");
  const normalizedStatus = getPlanningStatusClass(rawStatus);

  if (normalizedStatus === "annule") {
    return { status: "Annulé", label: "Annulé", explanation: "Intervention annulée." };
  }

  if (normalizedStatus === "termine") {
    return { status: "Terminé", label: "Terminé", explanation: "Intervention marquée terminée." };
  }

  const startDate = String(event?.startDate || "");
  const endDate = String(event?.endDate || event?.startDate || "");
  const day = String(dayIso || startDate || "");

  if (!isValidPlanningDate(startDate) || !isValidPlanningDate(endDate) || !isValidPlanningDate(day)) {
    return { status: getPlanningEventOperationalStatus(event), label: getPlanningEventOperationalStatus(event), explanation: "Date à compléter." };
  }

  // Les leads / réservations restent gérés comme des plages de séjour continues.
  if (event?.source !== "planning") {
    const status = getPlanningEventOperationalStatus(event);
    return { status, label: status, explanation: status === "À confirmer" ? "Demande ou option à confirmer." : `Statut réservation : ${status}.` };
  }

  const todayIso = formatPlanningDateValue(new Date());
  const dayValue = planningDateValue(day);
  const todayValue = planningDateValue(todayIso);
  const dayCount = getPlanningInclusiveDayCount(startDate, endDate);
  const dayNumber = getPlanningDayNumberInRange(startDate, day);
  const startMinutes = parsePlanningTimeToMinutes(event?.startTime);
  const endMinutes = parsePlanningTimeToMinutes(event?.endTime);
  const rangeLabel = event?.startTime || event?.endTime
    ? formatPlanningTimeRange(event?.startTime, event?.endTime)
    : "journée";
  const dayPrefix = dayCount > 1 ? `J${dayNumber}/${dayCount}` : "Intervention";

  if (dayValue < todayValue) {
    return {
      status: "Terminé",
      label: "Terminé",
      explanation: `${dayPrefix} terminé : cette journée d’intervention est passée.`
    };
  }

  if (dayValue > todayValue) {
    return {
      status: "Prévu",
      label: "À faire",
      explanation: `${dayPrefix} à faire : cette journée d’intervention n’a pas encore eu lieu.`
    };
  }

  const nowMinutes = getPlanningNowMinutes();

  if (startMinutes !== null && nowMinutes < startMinutes) {
    return {
      status: "Prévu",
      label: "À faire",
      explanation: `${dayPrefix} à faire aujourd’hui · début prévu à ${event.startTime}.`
    };
  }

  if (endMinutes !== null && nowMinutes > endMinutes) {
    return {
      status: "Terminé",
      label: "Terminé",
      explanation: `${dayPrefix} terminé aujourd’hui · heure de fin ${event.endTime} dépassée.`
    };
  }

  if (startMinutes !== null || endMinutes !== null) {
    return {
      status: "En cours",
      label: "En cours",
      explanation: `${dayPrefix} en cours maintenant · créneau ${rangeLabel}.`
    };
  }

  return {
    status: "En cours",
    label: "En cours",
    explanation: `${dayPrefix} en cours aujourd’hui · aucune heure de fin renseignée.`
  };
}

function getPlanningTimingExplanation(item: any) {
  const startDate = String(item?.startDate || "");
  const endDate = String(item?.endDate || item?.startDate || "");
  const dayCount = getPlanningInclusiveDayCount(startDate, endDate);

  if (!isValidPlanningDate(startDate)) return "Dates à compléter.";

  if (dayCount > 1) {
    const todayIso = formatPlanningDateValue(new Date());
    const todayInsideRange = planningRangesOverlap(todayIso, todayIso, startDate, endDate);
    const todaySegment = todayInsideRange ? getPlanningCalendarDaySegmentStatus(item, todayIso) : null;
    const endLabel = `${formatPlanningShortDate(endDate)}${item?.endTime ? ` à ${item.endTime}` : ""}`;

    if (todaySegment) {
      return `${todaySegment.explanation} Intervention totale sur ${dayCount} jours · fin globale ${endLabel}.`;
    }

    return `Intervention sur ${dayCount} jours · du ${formatPlanningShortDate(startDate)} au ${endLabel}. Chaque journée a son propre statut dans le calendrier.`;
  }

  return getPlanningCalendarDaySegmentStatus(item, startDate).explanation;
}

function getPlanningCalendarEventLabel(event: any, dayIso?: string) {
  const startDate = String(event?.startDate || "");
  const endDate = String(event?.endDate || event?.startDate || "");
  const dayCount = getPlanningInclusiveDayCount(startDate, endDate);
  const dayNumber = getPlanningDayNumberInRange(startDate, dayIso || startDate);
  const segment = getPlanningCalendarDaySegmentStatus(event, dayIso || startDate);
  const title = event?.source === "planning" ? event?.title : event?.contactName;
  const owner = event?.source === "planning" ? event?.contactName : event?.assetLabel;
  const asset = event?.source === "planning" ? event?.assetLabel : "";
  const timeLabel = formatPlanningTimeRange(event?.startTime, event?.endTime) || "journée";
  const dayPrefix = event?.source === "planning" && dayCount > 1 ? `J${dayNumber}/${dayCount}` : "";

  const firstLine = [dayPrefix, timeLabel, segment.label].filter(Boolean).join(" · ");
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
    .replace(/\s*[·•-]\s*(terminée|terminé|à faire|a faire|en cours|à confirmer|a confirmer)\b/gi, "")
    .replace(/\b(terminée|terminé|à faire|a faire|en cours|à confirmer|a confirmer)\s*[·•-]?\s*/gi, "")
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
      label: `${asset.label} · ${getAssetPlanningCategory(asset) || asset.category}`,
      planningCategory: getAssetPlanningCategory(asset)
    }));
  }, [assets]);


  function getPlanningContactDisplayName(contact: Contact) {
    return [contact.civility, contact.firstName, contact.name].filter(Boolean).join(" ").trim()
      || contact.companyName
      || contact.email
      || contact.phone
      || "Contact sans nom";
  }

  const planningContactOptions = useMemo(() => {
    return contacts
      .map((contact) => {
        const displayName = getPlanningContactDisplayName(contact);
        const meta = [
          contact.kind,
          contact.supplierCategory,
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
  }, [contacts]);

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
    const confirmed = window.confirm("Annuler cette intervention ? Elle restera dans l'historique.");
    if (!confirmed) return;
    patchPlanningEntryFromView(entry, { status: "Annulé" });
  }

  function postponePlanningEntry(entry: PlanningEntry) {
    const nextStartDate = window.prompt("Nouvelle date de début (AAAA-MM-JJ)", entry.startDate || formatPlanningDateValue(new Date()));
    if (!nextStartDate) return;
    if (!isValidPlanningDate(nextStartDate)) {
      window.alert("Date invalide. Utilisez le format AAAA-MM-JJ.");
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
        <BusinessButton permission="write" className="asset-edit-button planning-edit-main" type="button" onClick={() => startPlanningEntryEdit(entry)}>Modifier</BusinessButton>
        <details className="planning-entry-more planning-entry-more-clean">
          <summary aria-label="Plus d'actions">•••</summary>
          <div className="planning-entry-more-menu">
            {!isClosed ? (
              <>
                <BusinessButton type="button" onClick={() => markPlanningEntryDone(entry)}>Terminer</BusinessButton>
                <BusinessButton type="button" onClick={() => postponePlanningEntry(entry)}>Reporter</BusinessButton>
                <BusinessButton type="button" onClick={() => cancelPlanningEntryOperationally(entry)}>Annuler</BusinessButton>
              </>
            ) : null}
            <BusinessButton permission="remove"
              className="planning-delete-button"
              type="button"
              onClick={() => {
                if (editingPlanningEntry?.id === entry.id) {
                  setEditingPlanningEntry(null);
                }
                onDeletePlanningEntry(entry.id);
              }}
            >Supprimer définitivement</BusinessButton>
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
          firstDates: `${formatDateFR(first.startDate)} → ${formatDateFR(first.endDate)}`,
          secondDates: `${formatDateFR(second.startDate)} → ${formatDateFR(second.endDate)}`,
          severity: hasConfirmed ? "Conflit confirmé" : "Conflit option"
        });
      }
    }

    return conflicts;
  }, [leads, assets]);

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
        dayLabel: new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(date),
        dateLabel: formatDateFR(iso),
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
    return String(event.contactName || event.assetLabel || event.title || "Intervention").trim();
  }

  function getPlanningAgendaSecondary(event: any) {
    return [
      event.source === "planning" ? event.title : event.assetLabel,
      event.source === "planning" ? event.assetLabel : event.contactName,
      event.planningLabel
    ].filter(Boolean).join(" · ");
  }

  function renderPlanningAgendaItem(event: any) {
    const matchingPlanningEntry = event.source === "planning"
      ? planningEntries.find((entry) => entry.id === event.id)
      : null;

    return (
      <article className={`planning-agenda-item ${event.blocksAvailability ? "is-blocking" : "is-option"} status-${getPlanningStatusClass(getPlanningEventOperationalStatus(event))}`} key={`${event.source}-${event.id}-${event.startDate}`}>
        <div className="planning-agenda-time">
          <strong>{formatDateFR(event.startDate)}</strong>
          <span>{formatPlanningTimeRange(event.startTime, event.endTime) || "Toute la journée"}</span>
        </div>

        <div className="planning-agenda-main">
          <strong>{getPlanningAgendaPrimary(event)}</strong>
          <span>{getPlanningAgendaSecondary(event)}</span>
          <span className="planning-agenda-explanation">{getPlanningTimingExplanation(event)}</span>
        </div>

        <div className="planning-agenda-actions">
          <Badge>{getPlanningEventOperationalStatus(event)}</Badge>
          {matchingPlanningEntry ? (
            <BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => startPlanningEntryEdit(matchingPlanningEntry)}>Modifier</BusinessButton>
          ) : null}
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
            <p className="eyebrow">Planning</p>
            <h3>Disponibilités, réservations & interventions</h3>
          </div>
        </div>

        <BusinessForm className="form-grid compact">
          <BusinessLabel>Planning
            <select value={categoryFilter} onChange={(event) => {
              setCategoryFilter(event.target.value);
              setAssetFilter("Tous");
            }}>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>Actif précis
            <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
              <option value="Tous">Tous les actifs</option>
              {assetFilterOptions.map((asset) => (
                <option key={asset.key} value={asset.key}>{asset.label}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>Date début
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </BusinessLabel>

          <BusinessLabel>Date fin
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
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
          >
            Réinitialiser les filtres
          </BusinessButton>
        </BusinessForm>

        <div className="planning-scope-notice">
          <strong>Planning actuel : {categoryFilter === "Tous" ? "Vue globale" : categoryFilter}</strong>
          <span>{categoryFilter === "Tous" ? "Vue globale : choisissez un planning dans le formulaire si vous ajoutez une intervention." : `Les nouveaux événements seront rangés dans le planning ${categoryFilter}.`}</span>
        </div>
      </section>

      <section className="card planning-agenda-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vue opérationnelle</p>
            <h3>Aujourd’hui / 7 prochains jours</h3>
          </div>
        </div>

        <div className="planning-agenda-grid">
          <div className="planning-agenda-column">
            <div className="planning-agenda-column-heading">
              <span>Aujourd’hui</span>
              <strong>{todayPlanningAgendaItems.length}</strong>
            </div>

            <div className="planning-agenda-list">
              {todayPlanningAgendaItems.length === 0 ? (
                <p className="muted-line">Aucune intervention prévue aujourd’hui.</p>
              ) : (
                todayPlanningAgendaItems.map((event) => renderPlanningAgendaItem(event))
              )}
            </div>
          </div>

          <div className="planning-agenda-column">
            <div className="planning-agenda-column-heading">
              <span>7 prochains jours</span>
              <strong>{nextPlanningAgendaItems.length}</strong>
            </div>

            <div className="planning-agenda-list">
              {nextPlanningAgendaItems.length === 0 ? (
                <p className="muted-line">Aucune intervention prévue sur les 7 prochains jours.</p>
              ) : (
                nextPlanningAgendaItems.map((event) => renderPlanningAgendaItem(event))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card planning-priority-cockpit-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Priorité planning</p>
            <h3>Prochaines interventions importantes</h3>
          </div>
        </div>

        <div className="planning-priority-cockpit-list">
          {importantPlanningEntries.length === 0 ? (
            <p className="muted-line">Aucune intervention prioritaire à traiter dans ce planning.</p>
          ) : (
            importantPlanningEntries.map((entry) => {
              const asset = assets.find((item) => item.type === entry.assetType && item.id === entry.assetId);
              const missing = getPlanningEntryMissingFields(entry);

              return (
                <article className={`mini-row planning-priority-cockpit-row status-${getPlanningStatusClass(getPlanningEntryStatus(entry))}`} key={`priority-${entry.id}`}>
                  <div>
                    <strong>{entry.title}</strong>
                    <span>{formatPlanningDateTimeRange(entry)} · {entry.contactName || "Aucun contact lié"}{asset ? ` · ${asset.label}` : ""}</span>
                    <span>{entry.priority || "Normal"}{missing.length ? ` · À compléter : ${missing.join(", ")}` : ""}</span>
                  </div>
                  {renderPlanningQuickActions(entry)}
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="card planning-completion-alerts-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Qualité données</p>
            <h3>{incompletePlanningEntries.length} intervention{incompletePlanningEntries.length > 1 ? "s" : ""} à compléter</h3>
          </div>
        </div>

        {incompletePlanningEntries.length === 0 ? (
          <p className="muted-line">Aucune alerte : les prochaines interventions ont contact, actif et heure renseignés.</p>
        ) : (
          <div className="list-stack planning-alert-list">
            {incompletePlanningEntries.map(({ entry, missing }) => (
              <article className="mini-row planning-alert-row" key={`missing-${entry.id}`}>
                <div>
                  <strong>{entry.title}</strong>
                  <span>{formatDateFR(entry.startDate)} · manque : {missing.join(", ")}</span>
                </div>
                <BusinessButton className="asset-edit-button" type="button" onClick={() => startPlanningEntryEdit(entry)}>Compléter</BusinessButton>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="planning-entry-form" className={`card planning-entry-form-card ${editingPlanningEntry ? "is-editing" : ""}`} data-planning-entry-form="true">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Planning interne</p>
            <h3>{editingPlanningEntry ? "Modifier une intervention" : "Ajouter une intervention ou une maintenance"}</h3>
          </div>
        </div>

        {quickPlanningDate && !editingPlanningEntry && (
          <div className="planning-quick-add-banner">
            <strong>Création rapide</strong>
            <span>{formatDateFR(quickPlanningDate)} · complétez le titre, l’heure et l’actif si nécessaire.</span>
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
          <BusinessLabel>Titre
            <input name="title" defaultValue={editingPlanningEntry?.title ?? (quickPlanningDate ? "Rendez-vous" : "")} placeholder="Gardens Jardinier · entretien jardin" required />
          </BusinessLabel>

          <BusinessLabel>Type
            <select name="type" defaultValue={editingPlanningEntry?.type ?? (quickPlanningDate ? "Autre" : "Intervention prestataire")}>
              {planningEntryTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>Planning
            <select name="planningCategory" defaultValue={editingPlanningCategory}>
              {planningCategoryOptions.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>Statut
            <select name="status" defaultValue={editingPlanningEntry ? getPlanningEntryStatus(editingPlanningEntry) : "Prévu"}>
              {planningEntryStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>Contact lié
            <input
              name="contactName"
              list="planning-contact-options"
              defaultValue={editingPlanningEntry?.contactName ?? ""}
              placeholder="Nom, société ou email"
              autoComplete="off"
            />
            <datalist id="planning-contact-options">
              {planningContactOptions.map((contact) => (
                <option key={contact.id} value={contact.value}>{contact.label}</option>
              ))}
            </datalist>
          </BusinessLabel>

          <BusinessLabel>Actif lié
            <select name="assetKey" defaultValue={editingPlanningAssetKey}>
              <option value="">Aucun actif lié</option>
              {visibleAssetOptions.map((asset) => (
                <option key={asset.key} value={asset.key}>{asset.label}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>Date début
            <input type="date" name="startDate" defaultValue={editingPlanningEntry?.startDate ?? quickPlanningDate} required />
          </BusinessLabel>

          <BusinessLabel>Date fin
            <input type="date" name="endDate" defaultValue={editingPlanningEntry?.endDate ?? quickPlanningDate} />
          </BusinessLabel>

          <BusinessLabel>Heure arrivée
            <input type="time" name="startTime" defaultValue={editingPlanningEntry?.startTime ?? ""} />
          </BusinessLabel>

          <BusinessLabel>Heure départ
            <input type="time" name="endTime" defaultValue={editingPlanningEntry?.endTime ?? ""} />
          </BusinessLabel>

          <BusinessLabel>Bloque la disponibilité
            <select name="blocksAvailability" defaultValue={editingPlanningEntry?.blocksAvailability ? "true" : "false"}>
              <option value="false">Non</option>
              <option value="true">Oui</option>
            </select>
          </BusinessLabel>

          <BusinessLabel className="planning-entry-notes">Notes
            <textarea name="notes" defaultValue={editingPlanningEntry?.notes ?? ""} placeholder="Détails internes, horaires, consignes..." />
          </BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">
            {editingPlanningEntry ? "Enregistrer les modifications" : "Ajouter au planning"}
          </BusinessButton>

          {editingPlanningEntry && (
            <BusinessButton className="ghost-button" type="button" onClick={cancelPlanningEntryEdit}>
              Annuler
            </BusinessButton>
          )}
        </BusinessForm>

        <div className="planning-legend">
          <span><i className="legend-dot status-finished" /> Vert = terminé</span>
          <span><i className="legend-dot status-active" /> Jaune = en cours / à confirmer</span>
          <span><i className="legend-dot status-upcoming" /> Rouge = à venir</span>
        </div>

        <div className="planning-list-summary">
          <div>
            <strong>{activePlanningEntries.length} intervention{activePlanningEntries.length > 1 ? "s" : ""} à venir / en cours</strong>
            <span>{completedPlanningEntries.length} terminée{completedPlanningEntries.length > 1 ? "s" : ""} ou annulée{completedPlanningEntries.length > 1 ? "s" : ""} masquée{completedPlanningEntries.length > 1 ? "s" : ""} par défaut.</span>
          </div>

          <div className="planning-list-summary-actions">
            {activePlanningEntries.length > 7 ? (
              <BusinessButton className="ghost-button" type="button" onClick={() => setShowAllUpcomingPlanningEntries((value) => !value)}>
                {showAllUpcomingPlanningEntries ? "Réduire aux 7 prochaines" : `Afficher toutes les à venir (${activePlanningEntries.length})`}
              </BusinessButton>
            ) : null}

            {completedPlanningEntries.length > 0 ? (
              <BusinessButton className="ghost-button muted-action-button" type="button" onClick={() => setShowCompletedPlanningEntries((value) => !value)}>
                {showCompletedPlanningEntries ? "Masquer les terminées" : `Afficher les terminées (${completedPlanningEntries.length})`}
              </BusinessButton>
            ) : null}
          </div>
        </div>

        <div className="list-stack planning-priority-list">
          {planningEntriesToDisplay.length === 0 ? (
            <p className="muted-line">Aucune intervention à venir dans ce planning. Les interventions terminées sont masquées par défaut.</p>
          ) : (
            planningEntriesToDisplay
              .map((entry) => {
                const asset = assets.find((item) => item.type === entry.assetType && item.id === entry.assetId);

                return (
                  <article className={`mini-row planning-entry-compact-row planning-entry-line-clean status-${getPlanningStatusClass(getPlanningEntryStatus(entry))}`} key={entry.id} data-notification-target={`planning-${entry.id}`}>
                    <div className="planning-entry-info-clean">
                      <strong>{entry.title}</strong>
                      <span className="planning-entry-main-line">
                        {formatPlanningDateTimeRange(entry)} · {entry.contactName || "Aucun contact lié"}{asset ? ` · ${asset.label}` : ""}
                      </span>
                      <span className="planning-entry-secondary-line">{entry.type}{entry.notes ? ` · ${entry.notes}` : ""}</span>
                      <span className="planning-entry-timing-explanation">{getPlanningTimingExplanation(entry)}</span>
                      <ActionMeta item={entry} />
                    </div>
                    <div className="planning-entry-side-clean">
                      <div className="planning-entry-badges-clean">
                        <Badge>{getPlanningEntryStatus(entry)}</Badge>
                        {getPlanningInclusiveDayCount(entry.startDate, entry.endDate || entry.startDate) > 1 ? (
                          <Badge>{`Sur ${getPlanningInclusiveDayCount(entry.startDate, entry.endDate || entry.startDate)} jours`}</Badge>
                        ) : null}
                        <Badge>{entry.blocksAvailability ? "Bloquant" : "Non bloquant"}</Badge>
                        {entry.priority && entry.priority !== "Normal" ? <Badge>{entry.priority}</Badge> : null}
                      </div>
                      {renderPlanningQuickActions(entry)}
                    </div>
                  </article>
                );
              })
          )}
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Conflits planning</p>
            <h3>{planningConflicts.length} conflit{planningConflicts.length > 1 ? "s" : ""} détecté{planningConflicts.length > 1 ? "s" : ""}</h3>
          </div>
        </div>

        <div className="list-stack oar-contact-list-stack">
          {planningConflicts.length === 0 ? (
            <p className="muted-line">Aucun conflit détecté sur les actifs liés aux leads.</p>
          ) : (
            planningConflicts.map((conflict) => (
              <article className="mini-row" key={conflict.key}>
                <div>
                  <strong>{conflict.assetLabel}</strong>
                  <span>{conflict.firstContact} · {conflict.firstDates} · {conflict.firstStatus}</span>
                  <span>{conflict.secondContact} · {conflict.secondDates} · {conflict.secondStatus}</span>
                </div>
                <Badge>{conflict.severity}</Badge>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="card planning-calendar-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Calendrier mensuel</p>
            <h3>{getPlanningMonthTitle(calendarMonth)}</h3>
          </div>

          <div className="quote-actions">
            <BusinessButton className="ghost-button" type="button" onClick={() => moveCalendarMonth(-1)}>
              Mois précédent
            </BusinessButton>

            <BusinessButton className="ghost-button" type="button" onClick={() => moveCalendarMonth(1)}>
              Mois suivant
            </BusinessButton>
          </div>
        </div>

        <BusinessForm className="form-grid compact planning-view-controls">
          <BusinessLabel>Vue
            <select value={planningViewMode} onChange={(event) => setPlanningViewMode(event.target.value as "month" | "week")}>
              <option value="month">Mois</option>
              <option value="week">Semaine</option>
            </select>
          </BusinessLabel>

          {planningViewMode === "month" ? (
            <BusinessLabel>Mois
              <input type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)} />
            </BusinessLabel>
          ) : (
            <BusinessLabel>Semaine du
              <input type="date" value={planningWeekStart} onChange={(event) => setPlanningWeekStart(event.target.value)} />
            </BusinessLabel>
          )}
        </BusinessForm>

        {planningViewMode === "month" ? (
          <div className="table-wrap planning-month-table-wrap">
            <table className="planning-month-table">
            <thead>
              <tr>
                {calendarWeekDays.map((day) => (
                  <th key={day}>{day}</th>
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
                                const eventLabel = getPlanningCalendarEventLabel(event, day.iso);
                                const eventSegment = getPlanningCalendarDaySegmentStatus(event, day.iso);
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
                              <small>+ {events.length - 4} autre{events.length - 4 > 1 ? "s" : ""}</small>
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
          </div>
        ) : (
          <div className="planning-week-view">
            <div className="planning-week-toolbar">
              <BusinessButton className="ghost-button" type="button" onClick={() => movePlanningWeek(-1)}>Semaine précédente</BusinessButton>
              <strong>{formatDateFR(planningWeekDays[0]?.iso)} → {formatDateFR(planningWeekDays[6]?.iso)}</strong>
              <BusinessButton className="ghost-button" type="button" onClick={() => movePlanningWeek(1)}>Semaine suivante</BusinessButton>
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
                      <span className="planning-week-empty">Libre</span>
                    ) : (
                      day.events.map((event) => {
                        const matchingPlanningEntry = event.source === "planning"
                          ? planningEntries.find((entry) => entry.id === event.id)
                          : null;
                        const eventLabel = getPlanningCalendarEventLabel(event, day.iso);
                        const eventSegment = getPlanningCalendarDaySegmentStatus(event, day.iso);
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
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Disponibilités</p>
            <h3>{visibleAssets.length} actif{visibleAssets.length > 1 ? "s" : ""}</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="mobile-card-table planning-availability-table">
            <thead>
              <tr>
                <th>Actif</th>
                <th>Catégorie</th>
                <th>Lieu</th>
                <th>Statut période</th>
                <th>Prochaines locations</th>
              </tr>
            </thead>

            <tbody>
              {visibleAssets.map((asset) => {
                const bookings = getBookingsForAsset(asset);
                const options = getOptionsForAsset(asset);

                return (
                  <tr key={`${asset.type}-${asset.id}`}>
                    <td data-label="Actif">
                      <strong>{asset.label}</strong>
                      <small>
                        {bookings.length} confirmée{bookings.length > 1 ? "s" : ""} · {options.length} option{options.length > 1 ? "s" : ""}
                      </small>
                    </td>
                    <td data-label="Catégorie">{asset.category}</td>
                    <td data-label="Lieu">{asset.location}</td>
                    <td data-label="Statut période">
                      <Badge>{getAvailabilityLabel(asset)}</Badge>
                    </td>
                    <td data-label="Prochaines locations">
                      {bookings.length === 0 ? (
                        <span className="muted-line">Aucune location confirmée</span>
                      ) : (
                        bookings.slice(0, 3).map((booking) => (
                          <span className="muted-line" key={booking.id}>
                            {formatDateFR(booking.startDate)} → {formatDateFR(booking.endDate)} · {booking.contactName}
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
            <p className="eyebrow">Options / demandes en cours</p>
            <h3>{visiblePendingBookings.length} demande{visiblePendingBookings.length > 1 ? "s" : ""}</h3>
          </div>
        </div>

        <div className="list-stack oar-contact-list-stack">
          {visiblePendingBookings.length === 0 ? (
            <p className="muted-line">Aucune option en cours. Ajoutez un lead avec dates, actif lié et statut Contacté / Devis / Négociation pour le voir ici.</p>
          ) : (
            visiblePendingBookings.map((booking) => (
              <article className="mini-row" key={booking.id}>
                <div>
                  <strong>{booking.assetLabel}</strong>
                  <span>{booking.contactName} · {formatDateFR(booking.startDate)} → {formatDateFR(booking.endDate)}</span>
                  <span>{booking.assetCategory} · {currency.format(booking.value)}</span>
                  {booking.nextAction && <span>{booking.nextAction}</span>}
                </div>
                <Badge>{booking.status}</Badge>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Locations confirmées</p>
            <h3>{visibleConfirmedBookings.length} réservation{visibleConfirmedBookings.length > 1 ? "s" : ""}</h3>
          </div>
        </div>

        <div className="list-stack oar-contact-list-stack">
          {visibleConfirmedBookings.length === 0 ? (
            <p className="muted-line">Aucune location confirmée pour le moment. Quand un lead est gagné avec dates et actif lié, il apparaîtra ici.</p>
          ) : (
            visibleConfirmedBookings.map((booking) => (
              <article className="mini-row" key={booking.id}>
                <div>
                  <strong>{booking.assetLabel}</strong>
                  <span>{booking.contactName} · {formatDateFR(booking.startDate)} → {formatDateFR(booking.endDate)}</span>
                  <span>{booking.assetCategory} · {currency.format(booking.value)}</span>
                </div>
                <Badge>Confirmé</Badge>
              </article>
            ))
          )}
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
  const recommendations = useMemo<FollowUpRecommendation[]>(() => {
    const items: FollowUpRecommendation[] = [];

    const openTaskLeadIds = new Set(
      tasks
        .filter((task) => task.status !== "Terminé" && task.linkedTo)
        .map((task) => task.linkedTo)
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
          <p className="eyebrow">Relances recommandées</p>
          <h3>{recommendations.length} action{recommendations.length > 1 ? "s" : ""} à traiter</h3>
        </div>
      </div>

      <div className="list-stack oar-contact-list-stack">
        {recommendations.length === 0 ? (
          <p className="muted-line">Aucune relance urgente pour le moment. Les leads en retard, sans action ou les devis à suivre apparaîtront ici.</p>
        ) : (
          recommendations.map((recommendation) => (
            <article className="mini-row" key={recommendation.id}>
              <div>
                <strong>{recommendation.title}</strong>
                <span>{recommendation.detail}</span>
              </div>

              <div className="quote-actions">
                <Badge>{recommendation.priority}</Badge>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onCreateTask(recommendation)}
                >
                  Créer tâche
                </button>
              </div>
            </article>
          ))
        )}
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
              title="Ouvrir le module concerné"
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
      title: "Facture prestataire en retard",
      detail: `${invoice.contactName || invoice.title} · ${formatEuroAmount(getVendorInvoiceRemaining(invoice))} restant`,
      badge: "Retard",
      tone: "danger" as const,
      tab: "vendorInvoices" as Tab,
      targetId: `vendor-invoice-${invoice.id}`
    })),
    ...clientPaymentsLate.slice(0, 2).map((quote) => ({
      id: `client-payment-late-${quote.id}`,
      title: "Paiement client en retard",
      detail: `${quote.clientName} · ${currency.format(paymentRemaining(quote))} restant`,
      badge: "Client",
      tone: "danger" as const,
      tab: "bookings" as Tab,
      targetId: `booking-${quote.id}`
    })),
    ...blockingPlanning.slice(0, 2).map((entry) => ({
      id: `planning-blocking-${entry.id}`,
      title: "Intervention bloquante",
      detail: `${entry.title} · ${entry.startDate || "Date à compléter"}`,
      badge: getPlanningEntryStatus(entry),
      tone: "warning" as const,
      tab: "planning" as Tab,
      targetId: `planning-${entry.id}`
    })),
    ...houseDueItems.slice(0, 2).map((item, index) => ({
      id: `house-due-${index}-${item.workerName}`,
      title: "Intervenant à payer",
      detail: `${item.workerName} · ${currency.format(item.due)}`,
      badge: "À payer",
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
        title: isLate ? "Facture prestataire en retard" : "Facture prestataire à payer",
        detail: `${invoice.contactName || invoice.title} · ${formatEuroAmount(getVendorInvoiceRemaining(invoice))} restant`,
        badge: isLate ? "Retard" : "À payer",
        tone: isLate ? "danger" as const : "warning" as const,
        tab: "vendorInvoices" as Tab,
        targetId: `vendor-invoice-${invoice.id}`
      };
    });
const todayItems: DashboardItem[] = todayPlanning.map((entry) => ({
    id: `today-${entry.id}`,
    title: `${entry.startTime || "journée"}${entry.endTime ? ` → ${entry.endTime}` : ""} · ${entry.title}`,
    detail: `${entry.contactName || "Aucun contact lié"}${entry.notes ? ` · ${entry.notes}` : ""}`,
    badge: getPlanningEntryStatus(entry),
    tone: getPlanningEntryStatus(entry) === "En cours" ? "warning" : getPlanningEntryStatus(entry) === "Terminé" ? "success" : "neutral",
    tab: "planning" as Tab,
    targetId: `planning-${entry.id}`
  }));

  const moneyItems: DashboardItem[] = [
    supplierAmountToPay > 0 ? {
      id: "money-supplier-payments",
      title: `${formatEuroAmount(supplierAmountToPay)} à payer`,
      detail: `${unpaidVendorInvoices.length} facture(s) prestataire · ${houseDueItems.length} intervenant(s) maison`,
      badge: "Sortie",
      tone: supplierAmountToPay > 0 ? "warning" as const : "neutral" as const,
      action: () => onDashboardAction(vendorAmountToPay > 0 ? "vendorInvoices" : "houseTracking")
    } : null,
    clientAmountToReceive > 0 ? {
      id: "money-client-payments",
      title: `${currency.format(clientAmountToReceive)} à recevoir`,
      detail: `${clientPaymentsToFollow.length} paiement(s) client à suivre`,
      badge: "Entrée",
      tone: clientPaymentsLate.length > 0 ? "danger" as const : "warning" as const,
      tab: "bookings" as Tab
    } : null,
    {
      id: "money-confirmed-margin",
      title: `${currency.format(estimatedMargin)} de marge estimée`,
      detail: `${currency.format(confirmedRevenue)} de chiffre confirmé`,
      badge: "Confirmé",
      tone: confirmedRevenue > 0 ? "success" as const : "neutral" as const,
      tab: "bookings" as Tab
    }
  ].filter(Boolean) as DashboardItem[];

  const bookingItems: DashboardItem[] = upcomingBookings.map((quote) => ({
    id: `booking-upcoming-${quote.id}`,
    title: `${quote.clientName} · ${quote.title || "Réservation"}`,
    detail: `${shortDate(quote.startDate)} → ${shortDate(quote.endDate)} · ${quote.bookingStatus || "À préparer"}`,
    badge: paymentRemaining(quote) > 0 ? "Paiement" : "OK",
    tone: paymentRemaining(quote) > 0 ? "warning" as const : "success" as const,
    tab: "bookings" as Tab,
    targetId: `booking-${quote.id}`
  }));

  const commercialItems: DashboardItem[] = [
    ...leadsToTreat.slice(0, 3).map((lead) => ({
      id: `lead-treat-${lead.id}`,
      title: `${lead.contactName || "Lead sans contact"} · ${lead.category}`,
      detail: `${lead.nextAction || "Action à définir"} · ${currency.format(Number(lead.value || 0))}`,
      badge: lead.priority,
      tone: lead.priority === "Haute" ? "danger" as const : "warning" as const,
      tab: "leads" as Tab,
      targetId: `lead-${lead.id}`
    })),
    ...quotesToFollow.slice(0, 3).map((quote) => ({
      id: `quote-follow-${quote.id}`,
      title: `${quote.clientName} · devis à relancer`,
      detail: `${getQuoteStatusFrenchLabel(getQuoteStatus(quote.status))} · ${currency.format(getQuoteTotal(quote))}`,
      badge: "Devis",
      tone: "warning" as const,
      tab: "quotes" as Tab,
      targetId: `quote-${quote.id}`
    }))
  ];

  const planningItems: DashboardItem[] = [
    activePlanning.length > 0 ? {
      id: "planning-active",
      title: `${activePlanning.length} intervention(s) en cours`,
      detail: activePlanning.slice(0, 2).map((entry) => entry.title).join(" · "),
      badge: "En cours",
      tone: "warning" as const,
      tab: "planning" as Tab
    } : null,
    blockingPlanning.length > 0 ? {
      id: "planning-blocking-count",
      title: `${blockingPlanning.length} intervention(s) bloquante(s)`,
      detail: "Contrôle des disponibilités à vérifier.",
      badge: "Bloquant",
      tone: "danger" as const,
      tab: "planning" as Tab
    } : null,
    planningWithoutContact.length > 0 ? {
      id: "planning-no-contact",
      title: `${planningWithoutContact.length} intervention(s) sans contact lié`,
      detail: "À compléter pour éviter les pertes d’information.",
      badge: "Données",
      tone: "warning" as const,
      tab: "planning" as Tab
    } : null
  ].filter(Boolean) as DashboardItem[];

  const availabilityItems: DashboardItem[] = [
    {
      id: "availability-properties",
      title: `${availableProperties.length} villa(s) disponible(s)`,
      detail: availableProperties.slice(0, 3).map((property) => property.name).join(" · ") || "Aucune villa disponible renseignée.",
      badge: "Villas",
      tone: availableProperties.length > 0 ? "success" : "neutral",
      tab: "properties" as Tab
    },
    {
      id: "availability-vehicles-boats",
      title: `${availableVehicles.length + availableBoats.length} véhicule(s) / bateau(x) disponible(s)`,
      detail: `${availableVehicles.length} voiture(s) · ${availableBoats.length} bateau(x)`,
      badge: "Actifs",
      tone: availableVehicles.length + availableBoats.length > 0 ? "success" : "neutral",
      action: () => onDashboardAction(availableVehicles.length > 0 ? "vehicles" : "boats")
    },
    assetsInMaintenance.length > 0 ? {
      id: "availability-maintenance",
      title: `${assetsInMaintenance.length} actif(s) en maintenance`,
      detail: assetsInMaintenance.slice(0, 3).join(" · "),
      badge: "Maintenance",
      tone: "warning" as const,
      action: () => onDashboardAction("vehicles" as Tab)
    } : null
  ].filter(Boolean) as DashboardItem[];

  const dataQualityItems: DashboardItem[] = [
    contactsIncomplete.length > 0 ? {
      id: "quality-contacts",
      title: `${contactsIncomplete.length} contact(s) incomplet(s)`,
      detail: "Email ou téléphone manquant.",
      badge: "Contacts",
      tone: "warning" as const,
      tab: "contacts" as Tab
    } : null,
    leadsWithoutBudget.length > 0 ? {
      id: "quality-leads-budget",
      title: `${leadsWithoutBudget.length} lead(s) sans budget`,
      detail: "Valeur commerciale à compléter.",
      badge: "Leads",
      tone: "warning" as const,
      tab: "leads" as Tab
    } : null,
    documentsToCheck.length > 0 ? {
      id: "quality-documents",
      title: `${documentsToCheck.length} document(s) à vérifier`,
      detail: documentsToCheck.slice(0, 3).map((document) => document.title).join(" · "),
      badge: "Docs",
      tone: "warning" as const,
      tab: "documents" as Tab
    } : null
  ].filter(Boolean) as DashboardItem[];

  return (
    <div className="stack dashboard-workspace dashboard-command-center">
      <div className="dashboard-command-hero">
        <section className="card dashboard-command-summary-card">
          <p className="eyebrow">Vue rapide</p>
          <h3>Centre de commandement</h3>
          <p className="muted-line">Ce tableau affiche uniquement ce qui aide à décider, relancer, payer, préparer ou compléter.</p>
        </section>

        <div className="dashboard-command-kpis">
          <DashboardQuickTile label="À traiter" value={String(vendorInvoiceAlertItems.length)} caption="Factures prestataires" onClick={() => {
            const firstUrgent = vendorInvoiceAlertItems.find((item) => item.action || item.tab);
            if (firstUrgent?.action) firstUrgent.action();
            else if (firstUrgent?.tab) onDashboardAction(firstUrgent.tab, firstUrgent.targetId);
            else onDashboardAction("vendorInvoices" as Tab);
          }} />
          <DashboardQuickTile label="Aujourd’hui" value={String(todayPlanning.length)} caption="Interventions du jour" onClick={() => onDashboardAction("planning" as Tab)} />
          <DashboardQuickTile label="Maison à payer" value={currency.format(houseAmountToPay)} caption="Suivi maison" onClick={() => onDashboardAction("houseTracking" as Tab)} />
          <DashboardQuickTile label="À recevoir" value={currency.format(clientAmountToReceive)} caption="Paiements clients" onClick={() => onDashboardAction("bookings" as Tab)} />
        </div>
      </div>

      <div className="dashboard-command-grid dashboard-command-grid-priority">
        <DashboardCommandCard eyebrow="Factures prestataires" title="À traiter" summary={`${vendorInvoiceAlertItems.length} facture${vendorInvoiceAlertItems.length > 1 ? "s" : ""}`} tone={vendorInvoiceAlertItems.some((item) => item.tone === "danger") ? "danger" : vendorInvoiceAlertItems.length > 0 ? "warning" : "success"}>
          {renderDashboardList(vendorInvoiceAlertItems, "Aucune alerte urgente pour le moment.", 6)}
        </DashboardCommandCard>

        <DashboardCommandCard eyebrow="Aujourd’hui" title="Planning du jour" summary={`${todayPlanning.length} élément${todayPlanning.length > 1 ? "s" : ""}`} tone={activePlanning.length > 0 ? "warning" : "neutral"}>
          {renderDashboardList(todayItems, "Aucune intervention active aujourd’hui.", 6)}
        </DashboardCommandCard>

        <DashboardCommandCard eyebrow="Argent" title="Paiements à suivre" summary={formatEuroAmount(paymentsBalance)} tone={clientPaymentsLate.length > 0 || overdueVendorInvoices.length > 0 ? "danger" : "neutral"}>
          {renderDashboardList(moneyItems, "Aucun paiement urgent à suivre.", 5)}
        </DashboardCommandCard>
      </div>

      <div className="dashboard-command-grid">
        <DashboardCommandCard eyebrow="Réservations" title="À préparer" summary={`${upcomingBookings.length} proche${upcomingBookings.length > 1 ? "s" : ""}`}>
          {renderDashboardList(bookingItems, "Aucune réservation confirmée à préparer dans les 14 prochains jours.", 5)}
        </DashboardCommandCard>

        <DashboardCommandCard eyebrow="Commercial" title="Leads et devis" summary={`${commercialItems.length} sujet${commercialItems.length > 1 ? "s" : ""}`}>
          {renderDashboardList(commercialItems, "Aucun lead ou devis urgent à relancer.", 6)}
          <div className="dashboard-command-actions">
            <BusinessButton disabled={Boolean(business&&!business.read("leads"))} className="secondary-button compact-button" type="button" onClick={onShowLeads}>Voir les leads</BusinessButton>
            <BusinessButton disabled={Boolean(business&&(!business.canWrite("contacts")||!business.canWrite("leads")))} className="secondary-button compact-button" type="button" onClick={onStartMessage}>Créer depuis message</BusinessButton>
          </div>
        </DashboardCommandCard>
      </div>

      <div className="dashboard-command-grid dashboard-command-grid-control">
        <DashboardCommandCard eyebrow="Planning" title="Anomalies" summary={`${planningItems.length} point${planningItems.length > 1 ? "s" : ""}`} tone={blockingPlanning.length > 0 ? "danger" : planningItems.length > 0 ? "warning" : "success"}>
          {renderDashboardList(planningItems, "Aucune anomalie planning détectée.", 5)}
        </DashboardCommandCard>

        <DashboardCommandCard eyebrow="Disponibilités" title="Biens proposables" summary={`${availableProperties.length + availableVehicles.length + availableBoats.length} actif${availableProperties.length + availableVehicles.length + availableBoats.length > 1 ? "s" : ""}`}>
          {renderDashboardList(availabilityItems, "Aucun actif disponible renseigné.", 5)}
        </DashboardCommandCard>

        <DashboardCommandCard eyebrow="Données" title="À compléter" summary={`${dataQualityItems.length} sujet${dataQualityItems.length > 1 ? "s" : ""}`} tone={dataQualityItems.length > 0 ? "warning" : "success"}>
          {renderDashboardList(dataQualityItems, "Les données essentielles sont propres.", 5)}
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

function ContactsView({
  actor,
  contacts,
  leads,
  tasks,
  onAdd,
  onUpdate,
  onDelete,
  onCreateLead,
  onCreateTask
}: {
  actor: string;
  contacts: Contact[];
  leads: Lead[];
  tasks: Task[];
  onAdd: (event: React.FormEvent<HTMLFormElement>) => FormSave;
  onUpdate: (contact: Pick<Contact, "id"> & Partial<Contact>) => FormSave;
  onDelete: (id: string) => void;
  onCreateLead: (contactName: string) => void;
  onCreateTask: (contactName: string) => void;
}) {
  const business = useBusinessPermissions();
  const creation = useConfirmedForm(business?.markDirty);
  const [creationRecordId,setCreationRecordId] = useState<string|null>(null);
  const edition = useConfirmedForm(business?.markDirty);
  const changedContactFields = useRef(new Set<string>());
  const [contactFilter, setContactFilter] = useState("Tous");
  const [supplierCategoryFilter, setSupplierCategoryFilter] = useState("Toutes");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [newContactKind, setNewContactKind] = useState<ContactKind>("Client");
  const [editingContactKind, setEditingContactKind] = useState<ContactKind>("Client");

  const filterOptions = ["Tous", "Clients", "Prestataires", "Propriétaires"];
  const nonSupplierRelationshipStatuses = contactRelationshipStatuses.filter((status) => status !== "Prestataire");
  const supplierProfessionOptions = useMemo(() => {
    const legacyAssetCategories = new Set(["Villa", "Voiture", "Bateau"]);
    const savedProfessions = contacts
      .map((contact) => String(contact.supplierCategory || "").trim())
      .filter((profession) => Boolean(profession) && !legacyAssetCategories.has(profession));
    return Array.from(new Set([...supplierCategories, ...savedProfessions]));
  }, [contacts]);

  function getContactDisplayName(contact: Contact) {
    return [contact.civility, contact.firstName, contact.name].filter(Boolean).join(" ").trim();
  }

  function getContactActionLabel(contact: Contact) {
    return getContactDisplayName(contact) || contact.companyName || contact.email || contact.phone || "Contact sans nom";
  }

  function normalizeKind(value: unknown): ContactKind {
    const raw = String(value || "Client");
    return raw === "Partenaire" || raw === "Prestataire" ? "Prestataire" : raw === "Propriétaire" ? "Propriétaire" : "Client";
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
    const labels = [contact.name, getContactDisplayName(contact), contact.companyName, contact.email, contact.phone]
      .map((value) => normalizeContactLookupKey(value))
      .filter(Boolean);

    return leads.filter((lead) => labels.includes(normalizeContactLookupKey(lead.contactName)));
  }

  function getContactTasks(contact: Contact) {
    const contactLeads = getContactLeads(contact);
    const leadIds = new Set(contactLeads.map((lead) => lead.id));

    return tasks.filter((task) => leadIds.has(task.linkedTo));
  }

  const visibleContacts = contacts.filter((contact) => {
    const supplier = isSupplierContact(contact);
    const matchesType =
      contactFilter === "Tous" ||
      (contactFilter === "Clients" && contact.kind === "Client" && !supplier) ||
      (contactFilter === "Prestataires" && supplier) ||
      (contactFilter === "Propriétaires" && contact.kind === "Propriétaire");

    const matchesSupplierCategory = supplierCategoryFilter === "Toutes" || getContactSupplierCategory(contact) === supplierCategoryFilter;

    return matchesType && (contactFilter === "Prestataires" ? matchesSupplierCategory : true);
  });

  const clientCount = contacts.filter((contact) => contact.kind === "Client" && !isSupplierContact(contact)).length;
  const supplierCount = contacts.filter(isSupplierContact).length;
  const ownerCount = contacts.filter((contact) => contact.kind === "Propriétaire").length;

  function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingContact) return;

    const form = new FormData(event.currentTarget);

    const nextKind = normalizeKind(form.get("kind"));
    const isPrestataire = nextKind === "Prestataire";

    const updatedContact: Contact = {
      ...editingContact,
      name: String(form.get("name") ?? "").trim(),
      firstName: String(form.get("firstName") ?? "").trim(),
      civility: String(form.get("civility") ?? "") as Contact["civility"],
      companyName: String(form.get("companyName") ?? "").trim(),
      kind: nextKind,
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      postalAddress: readPostalAddress(form, editingContact.postalAddress),
      budget: safeNumber(form.get("budget")),
      source: String(form.get("source") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      clientLevel: String(form.get("clientLevel") ?? getContactClientLevel(editingContact)) as NonNullable<Contact["clientLevel"]>,
      preferredLanguage: String(form.get("preferredLanguage") ?? getContactPreferredLanguage(editingContact)) as NonNullable<Contact["preferredLanguage"]>,
      relationshipStatus: (isPrestataire ? "Prestataire" : String(form.get("relationshipStatus") ?? getContactRelationshipStatus(editingContact) ?? "Prospect")) as NonNullable<Contact["relationshipStatus"]>,
      preferences: String(form.get("preferences") ?? "").trim(),
      importantNotes: String(form.get("importantNotes") ?? "").trim(),
      supplierCategory: (isPrestataire ? getSupplierCategoryFromForm(form) : "") as Contact["supplierCategory"],
      supplierContactName: isPrestataire ? String(form.get("supplierContactName") ?? "").trim() : "",
      supplierZone: isPrestataire ? String(form.get("supplierZone") ?? "").trim() : "",
      supplierQuality: (isPrestataire ? String(form.get("supplierQuality") ?? "Standard") : "Standard") as Contact["supplierQuality"],
      supplierReliability: (isPrestataire ? String(form.get("supplierReliability") ?? "À tester") : "") as Contact["supplierReliability"],
      supplierPriceNotes: isPrestataire ? String(form.get("supplierPriceNotes") ?? "").trim() : "",
      supplierCommissionNotes: isPrestataire ? String(form.get("supplierCommissionNotes") ?? "").trim() : "",
      supplierStatus: (isPrestataire ? String(form.get("supplierStatus") ?? "Actif") : "") as Contact["supplierStatus"]
    };

    const update = getContactFormUpdate(updatedContact, changedContactFields.current);
    void edition.submit(event.currentTarget, () => onUpdate({ id: editingContact.id, ...update }), newerDraft => {
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
    setEditingContact(latestContact);
  }

  function typeLabel(contact: Contact) {
    const kind = String((contact as any).kind || "Client");
    if (isSupplierContact(contact) || kind === "Partenaire") return "Prestataire";
    return contact.kind;
  }

  return (
    <div className="stack contacts-workspace oar-contacts-workspace">
      <section className="card contacts-toolbar contacts-toolbar-desktop-stable" data-contacts-desktop-version="stable-1">
        <div className="contacts-toolbar-stable-main">
          <div className="contacts-toolbar-stable-title">
            <p className="eyebrow">Contacts</p>
            <div className="contacts-toolbar-stable-count">
              <strong>{visibleContacts.length}</strong>
              <span>contact{visibleContacts.length > 1 ? "s" : ""}</span>
            </div>
            <p className="muted-line">Clients, prestataires et propriétaires. Lecture rapide, action uniquement si nécessaire.</p>
          </div>

          <div className="contacts-toolbar-stable-metrics" aria-label="Synthèse contacts">
            <div><span>Clients</span><strong>{clientCount}</strong></div>
            <div><span>Prestataires</span><strong>{supplierCount}</strong></div>
            <div><span>Propriétaires</span><strong>{ownerCount}</strong></div>
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
              {option}
            </BusinessButton>
          ))}
        </div>

        {contactFilter === "Prestataires" && (
          <div className="contacts-toolbar-stable-supplier-filter">
            <BusinessLabel>Profession / activité
              <select value={supplierCategoryFilter} onChange={(event) => setSupplierCategoryFilter(event.target.value)}>
                <option>Toutes</option>
                {supplierProfessionOptions.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </BusinessLabel>
          </div>
        )}
      </section>

      <div className="contacts-layout oar-contacts-layout">
        <section className="card contacts-list-card oar-contacts-list-card">
          {visibleContacts.length === 0 ? (
            <p className="muted-line">Aucun contact dans ce filtre.</p>
          ) : (
            <div className="list-stack oar-contact-list-stack">
              {visibleContacts.map((contact) => (
                <article className="item-card contact-row oar-contact-row" key={contact.id}>
                  <div>
                    <p className="eyebrow">
                      {typeLabel(contact)}{isSupplierContact(contact) ? ` · ${getContactSupplierCategory(contact)}` : ""}
                    </p>
                    <h3>{getContactActionLabel(contact)}</h3>
                    {contact.companyName && (
                      <p className="muted-line">Société : {contact.companyName}</p>
                    )}
                    <p className="muted-line">
                      {contact.city || getContactSupplierZone(contact) || "Ville / zone à compléter"}
                    </p>
                    <p className="muted-line">
                      {contact.email || "Email à compléter"} · {contact.phone || "Téléphone à compléter"}
                    </p>
                    <ActionMeta item={contact} />
                    {isSupplierContact(contact) ? (
                      <p className="muted-line">
                        Fiabilité : {contact.supplierReliability || "À tester"} · Statut : {contact.supplierStatus || "Actif"}
                      </p>
                    ) : (
                      <p className="muted-line">
                        {getContactClientLevel(contact)} · {getContactRelationshipStatus(contact)} · {getContactLeads(contact).length} lead{getContactLeads(contact).length > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>

                  <div className="item-actions contact-row-actions oar-contact-actions">
                    {contact.phone && <a className="secondary-button" href={`tel:${contact.phone}`}>Appeler</a>}
                    {contact.email && <a className="secondary-button" href={`mailto:${contact.email}`}>Email</a>}
                    <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => onCreateLead(getContactActionLabel(contact))}>
                      Créer lead
                    </BusinessButton>
                    <BusinessButton className="secondary-button" type="button" onClick={() => setSelectedContact(contact)}>
                      Détails
                    </BusinessButton>
                    <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => openEdit(contact)}>
                      Modifier
                    </BusinessButton>
                    <BusinessButton permission="remove"
                      className="danger-button"
                      type="button"
                      onClick={() => {
                        const confirmed = window.confirm(`Supprimer "${contact.name}" ?`);
                        if (confirmed) onDelete(contact.id);
                      }}
                    >
                      Supprimer
                    </BusinessButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="card form-card contacts-form-card oar-contacts-form-card">
          <p className="eyebrow">Nouveau</p>
          <h3>{creationRecordId?"Modifier le contact créé":"Ajouter un contact"}</h3>

          <BusinessForm className="form-grid contact-create-form" data-saved-record-id={creationRecordId||undefined} pending={creation.saving} onChangeCapture={creation.changed} onSubmit={event=>{
            if(!business){void onAdd(event);return;}
            event.preventDefault();const form=event.currentTarget;
            void creation.submit(form,()=>onAdd(event),(newerDraft,result)=>{if(newerDraft){setCreationRecordId(result?.recordId??null);return;}form.reset();setCreationRecordId(null);setNewContactKind("Client");});
          }}>
            {creation.message&&<p role="alert">{creation.message}</p>}
            <BusinessLabel>Civilité
              <select name="civility" defaultValue="">
                <option value="">—</option>
                <option value="M">M</option>
                <option value="MME">MME</option>
              </select>
            </BusinessLabel>
            <BusinessLabel>Prénom<input name="firstName" placeholder="Prénom" /></BusinessLabel>
            <BusinessLabel>Nom<input name="name" placeholder="Nom" /></BusinessLabel>
            <BusinessLabel>Société<input name="companyName" placeholder="Nom de la société" /></BusinessLabel>
            <BusinessLabel>Type
              <select name="kind" value={newContactKind} onChange={(event) => setNewContactKind(event.target.value as ContactKind)}>
                {contactKinds.map((kind) => <option key={kind}>{kind}</option>)}
              </select>
            </BusinessLabel>
            <BusinessLabel>Email<input name="email" type="email" placeholder="email@example.com" /></BusinessLabel>
            <BusinessLabel>Téléphone<input name="phone" placeholder="+33..." /></BusinessLabel>
            <ContactPostalAddressField />
            <BusinessLabel>Ville / zone<input name="city" placeholder="Cannes, Monaco..." /></BusinessLabel>
            <BusinessLabel>Source<input name="source" placeholder="Site, recommandation, réseau..." /></BusinessLabel>

            {newContactKind !== "Prestataire" && (
              <>
                <BusinessLabel>Relation
                  <select name="relationshipStatus" defaultValue="Prospect">
                    {nonSupplierRelationshipStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel>Budget<input name="budget" type="number" min="0" placeholder="Si client" /></BusinessLabel>
              </>
            )}

            {newContactKind === "Client" && (
              <>
                <BusinessLabel>Niveau client
                  <select name="clientLevel" defaultValue="Standard">
                    {contactLevels.map((level) => <option key={level}>{level}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel>Langue
                  <select name="preferredLanguage" defaultValue="Français">
                    {contactLanguages.map((language) => <option key={language}>{language}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel className="full">Préférences
                  <textarea name="preferences" placeholder="Villa, voiture, yacht, dates, habitudes..." />
                </BusinessLabel>
                <BusinessLabel className="full">Notes importantes
                  <textarea name="importantNotes" placeholder="À savoir avant de proposer quelque chose" />
                </BusinessLabel>
              </>
            )}

            {newContactKind === "Prestataire" && (
              <>
                <BusinessLabel>Profession / activité
                  <select name="supplierCategory" defaultValue="">
                    <option value="">—</option>
                    {supplierProfessionOptions.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </BusinessLabel>
                <BusinessLabel>Ajouter une profession
                  <input name="supplierCategoryCustom" placeholder="Ex : Technicien volets" />
                </BusinessLabel>
                <BusinessLabel>Fiabilité
                  <select name="supplierReliability" defaultValue="À tester">
                    <option>À tester</option>
                    <option>Fiable</option>
                    <option>Très fiable</option>
                    <option>À éviter</option>
                  </select>
                </BusinessLabel>
                <BusinessLabel>Contact référent<input name="supplierContactName" placeholder="Nom du contact" /></BusinessLabel>
                <BusinessLabel>Statut prestataire
                  <select name="supplierStatus" defaultValue="Actif">
                    <option>Actif</option>
                    <option>À vérifier</option>
                    <option>Inactif</option>
                  </select>
                </BusinessLabel>
                <BusinessLabel>Qualité
                  <select name="supplierQuality" defaultValue="Standard">
                    <option>Standard</option>
                    <option>Premium</option>
                    <option>Très premium</option>
                  </select>
                </BusinessLabel>
                <BusinessLabel className="full">Notes prix / accord prestataire
                  <textarea name="supplierPriceNotes" placeholder="Tarifs, minimum spend, conditions..." />
                </BusinessLabel>
                <BusinessLabel className="full">Commission / marge
                  <textarea name="supplierCommissionNotes" placeholder="Commission, marge, accord commercial..." />
                </BusinessLabel>
              </>
            )}

            <BusinessLabel className="full">Notes
              <textarea name="notes" placeholder="Contexte, préférences, infos utiles" />
            </BusinessLabel>

            <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">{creationRecordId?"Enregistrer les modifications":"Ajouter"}</BusinessButton>
          </BusinessForm>
        </section>
      </div>

      {selectedContact && (
        <div className="confirm-backdrop">
          <div id="contact-detail-panel" className="confirm-dialog contact-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Fiche contact</p>
            <h3>{[selectedContact.civility, selectedContact.firstName, selectedContact.name].filter(Boolean).join(" ") || selectedContact.companyName || "Contact sans nom"}</h3>

            <div className="contact-detail-grid">
              <div><span>Type</span><strong>{typeLabel(selectedContact)}</strong></div>
              <div><span>Civilité</span><strong>{selectedContact.civility || "Non renseignée"}</strong></div>
              <div><span>Prénom</span><strong>{selectedContact.firstName || "Non renseigné"}</strong></div>
              <div><span>Société</span><strong>{selectedContact.companyName || "Non renseignée"}</strong></div>
              <div><span>Email</span><strong>{selectedContact.email || "Non renseigné"}</strong></div>
              <div><span>Téléphone</span><strong>{selectedContact.phone || "Non renseigné"}</strong></div>
              <ContactPostalAddressDetails key={`${selectedContact.id}:${selectedContact.postalAddress ?? ""}`} address={selectedContact.postalAddress} />
              <div><span>Ville / zone</span><strong>{selectedContact.city || getContactSupplierZone(selectedContact) || "Non renseignée"}</strong></div>
              <div><span>Action</span><strong>{getActionMetaLabel(selectedContact)}</strong></div>

              {isSupplierContact(selectedContact) ? (
                <>
                  <div><span>Profession</span><strong>{getContactSupplierCategory(selectedContact)}</strong></div>
                  <div><span>Fiabilité</span><strong>{selectedContact.supplierReliability || "À tester"}</strong></div>
                  <div><span>Qualité</span><strong>{selectedContact.supplierQuality || "Standard"}</strong></div>
                  <div><span>Statut</span><strong>{selectedContact.supplierStatus || "Actif"}</strong></div>
                  <div className="full"><span>Notes prix</span><p>{selectedContact.supplierPriceNotes || "Aucune note prix."}</p></div>
                  <div className="full"><span>Commission / marge</span><p>{selectedContact.supplierCommissionNotes || "Aucune note commission."}</p></div>
                </>
              ) : (
                <>
                  <div><span>Budget</span><strong>{selectedContact.budget ? currency.format(selectedContact.budget) : "Non renseigné"}</strong></div>
                  <div><span>Relation</span><strong>{getContactRelationshipStatus(selectedContact)}</strong></div>
                  <div><span>Niveau</span><strong>{getContactClientLevel(selectedContact)}</strong></div>
                  <div><span>Langue</span><strong>{getContactPreferredLanguage(selectedContact)}</strong></div>
                </>
              )}

              <div className="full"><span>Notes</span><p>{selectedContact.notes || "Aucune note."}</p></div>
            </div>

            {!business && isSupplierContact(selectedContact) && <VendorBankAccounts contact={contacts.find(c => c.id === selectedContact.id) || selectedContact} actor={actor} onUpdate={onUpdate} />}

            {!isSupplierContact(selectedContact) && (
              <div className="contact-related-section">
                <p className="eyebrow">Synthèse commerciale</p>
                <div className="list-stack oar-contact-list-stack">
                  <article className="mini-row">
                    <div><strong>Leads liés</strong><span>{getContactLeads(selectedContact).length} lead{getContactLeads(selectedContact).length > 1 ? "s" : ""}</span></div>
                    <Badge>{getContactLeads(selectedContact).filter((lead) => lead.status !== "Perdu").length}</Badge>
                  </article>
                  <article className="mini-row">
                    <div><strong>Tâches ouvertes</strong><span>Actions restantes</span></div>
                    <Badge>{getContactTasks(selectedContact).filter((task) => task.status !== "Terminé").length}</Badge>
                  </article>
                </div>
              </div>
            )}

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedContact(null)}>Fermer</BusinessButton>
              <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => { const name = getContactActionLabel(selectedContact); setSelectedContact(null); onCreateLead(name); }}>Créer un lead</BusinessButton>
              <BusinessButton permission="write" className="secondary-button" type="button" onClick={() => { const name = selectedContact.name; setSelectedContact(null); onCreateTask(name); }}>Créer une tâche</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedContact)}>Modifier</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingContact && (
        <div className="confirm-backdrop">
          <div id="contact-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Modification</p>
            <h3>Modifier le contact</h3>

            <BusinessForm className="form-grid contact-edit-form" pending={edition.saving} onSubmit={submitEdit} onChangeCapture={edition.changed} onChange={(event) => {
              const target = event.target;
              if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
                changedContactFields.current.add(target.name);
              }
            }}>
              {edition.message&&<p role="alert">{edition.message}</p>}
              <BusinessLabel>Civilité
                <select name="civility" defaultValue={editingContact.civility ?? ""}>
                  <option value="">—</option>
                  <option value="M">M</option>
                  <option value="MME">MME</option>
                </select>
              </BusinessLabel>
              <BusinessLabel>Prénom<input name="firstName" defaultValue={editingContact.firstName ?? ""} /></BusinessLabel>
              <BusinessLabel>Nom<input name="name" defaultValue={editingContact.name} /></BusinessLabel>
              <BusinessLabel>Société<input name="companyName" defaultValue={editingContact.companyName ?? ""} /></BusinessLabel>

              <BusinessLabel>Type
                <select name="kind" value={editingContactKind} onChange={(event) => setEditingContactKind(event.target.value as ContactKind)}>
                  {contactKinds.map((kind) => <option key={kind}>{kind}</option>)}
                </select>
              </BusinessLabel>
              <BusinessLabel>Email<input name="email" type="email" defaultValue={editingContact.email} /></BusinessLabel>
              <BusinessLabel>Téléphone<input name="phone" defaultValue={editingContact.phone} /></BusinessLabel>
              <ContactPostalAddressField value={editingContact.postalAddress} />
              <BusinessLabel>Ville / zone<input name="city" defaultValue={editingContact.city} /></BusinessLabel>
              <BusinessLabel>Source<input name="source" defaultValue={editingContact.source} /></BusinessLabel>

              {editingContactKind !== "Prestataire" && (
                <>
                  <BusinessLabel>Relation
                    <select name="relationshipStatus" defaultValue={getContactRelationshipStatus(editingContact) === "Prestataire" ? "Prospect" : getContactRelationshipStatus(editingContact)}>
                      {nonSupplierRelationshipStatuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>Budget<input name="budget" type="number" min="0" defaultValue={editingContact.budget || ""} /></BusinessLabel>
                </>
              )}

              {editingContactKind === "Client" && (
                <>
                  <BusinessLabel>Niveau client
                    <select name="clientLevel" defaultValue={getContactClientLevel(editingContact)}>
                      {contactLevels.map((level) => <option key={level}>{level}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>Langue
                    <select name="preferredLanguage" defaultValue={getContactPreferredLanguage(editingContact)}>
                      {contactLanguages.map((language) => <option key={language}>{language}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel className="full">Préférences
                    <textarea name="preferences" defaultValue={editingContact.preferences ?? ""} />
                  </BusinessLabel>
                  <BusinessLabel className="full">Notes importantes
                    <textarea name="importantNotes" defaultValue={editingContact.importantNotes ?? ""} />
                  </BusinessLabel>
                </>
              )}

              {editingContactKind === "Prestataire" && (
                <>
                  <BusinessLabel>Profession / activité
                    <select name="supplierCategory" defaultValue={editingContact.supplierCategory || ""}>
                      <option value="">—</option>
                      {supplierProfessionOptions.map((category) => <option key={category}>{category}</option>)}
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>Ajouter une profession
                    <input name="supplierCategoryCustom" placeholder="Nouvelle profession si absente de la liste" />
                  </BusinessLabel>
                  <BusinessLabel>Contact référent<input name="supplierContactName" defaultValue={editingContact.supplierContactName || ""} /></BusinessLabel>
                  <BusinessLabel>Fiabilité
                    <select name="supplierReliability" defaultValue={editingContact.supplierReliability || "À tester"}>
                      <option>À tester</option>
                      <option>Fiable</option>
                      <option>Très fiable</option>
                      <option>À éviter</option>
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>Statut prestataire
                    <select name="supplierStatus" defaultValue={editingContact.supplierStatus || "Actif"}>
                      <option>Actif</option>
                      <option>À vérifier</option>
                      <option>Inactif</option>
                    </select>
                  </BusinessLabel>
                  <BusinessLabel>Qualité
                    <select name="supplierQuality" defaultValue={editingContact.supplierQuality || "Standard"}>
                      <option>Standard</option>
                      <option>Premium</option>
                      <option>Très premium</option>
                    </select>
                  </BusinessLabel>
                  <BusinessLabel className="full">Notes prix
                    <textarea name="supplierPriceNotes" defaultValue={editingContact.supplierPriceNotes || ""} />
                  </BusinessLabel>
                  <BusinessLabel className="full">Commission / marge
                    <textarea name="supplierCommissionNotes" defaultValue={editingContact.supplierCommissionNotes || ""} />
                  </BusinessLabel>
                </>
              )}

              <BusinessLabel className="full">Notes
                <textarea name="notes" defaultValue={editingContact.notes} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => {edition.changed();setEditingContact(null);}}>Annuler</BusinessButton>
                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Enregistrer</BusinessButton>
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
  onUpdate: (lead: Lead) => void;
  onStatusChange: (id: string, status: LeadStatus) => void;
  onDelete: (id: string) => void;
  onCreateQuote: (lead: Lead) => void;
  quotes?: QuoteRequest[];
  onCreateTask: (lead: Lead) => void;
}) {
  const business = useBusinessPermissions();
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadCategoryFilter, setLeadCategoryFilter] = useState<"Toutes" | Lead["category"]>("Toutes");
  const [leadStatusFilter, setLeadStatusFilter] = useState<"Tous" | LeadStatus>("Tous");
  const [leadPriorityFilter, setLeadPriorityFilter] = useState<"Toutes" | Lead["priority"]>("Toutes");
  const [leadDueFilter, setLeadDueFilter] = useState<"Tous" | "En retard" | "Aujourd'hui" | "À venir" | "Sans échéance">("Tous");
  const [leadActionFilter, setLeadActionFilter] = useState<"Tous" | "Sans prochaine action">("Tous");

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

  function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingLead) return;

    const form = new FormData(event.currentTarget);
    const assetSelection = parseAssetKey(form.get("assetKey"));

    const updatedLead: Lead = {
      ...editingLead,
      category: String(form.get("category") ?? "Villa") as Lead["category"],
      contactName: String(form.get("contactName") ?? "").trim(),
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
      window.alert("Un lead ouvert doit avoir une prochaine action et une échéance.");
      return;
    }

    onUpdate(updatedLead);
    setEditingLead(null);
  }

  function getLeadTasks(lead: Lead) {
    return tasks.filter((task) => task.linkedTo === lead.id);
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
          <p className="eyebrow">Nouveau</p>
          <h3>Ajouter un lead</h3>
        </div>

        <BusinessForm className="lead-smart-form" onSubmit={onAdd}>
          <fieldset className="lead-form-block">
            <legend>1 · Client & demande</legend>

            <BusinessLabel>Catégorie
              <select name="category" defaultValue="Villa">
                <option value="Villa">Villa</option>
                <option value="Voiture">Voiture</option>
                <option value="Bateau">Bateau</option>
                <option value="Conciergerie">Conciergerie</option>
              </select>
            </BusinessLabel>

            <BusinessLabel>Contact
              <input
                name="contactName"
                list="lead-contact-options"
                defaultValue={preselectedContactName || ""}
                placeholder="Tapez un nom, société, email ou téléphone..."
              />
              <datalist id="lead-contact-options">
                {contacts.map((contact) => {
                  const label = [contact.civility, contact.firstName, contact.name].filter(Boolean).join(" ").trim() || contact.companyName || contact.email || contact.phone || "Contact sans nom";
                  return <option key={contact.id} value={label}>{contact.companyName ? `${label} · ${contact.companyName}` : label}</option>;
                })}
              </datalist>
            </BusinessLabel>

            <BusinessLabel>Actif proposé
              <select name="assetKey" defaultValue="">
                <option value="">Aucun actif lié</option>
                {assetOptions.map((asset) => (
                  <option key={`${asset.type}:${asset.id}`} value={`${asset.type}:${asset.id}`}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </BusinessLabel>
          </fieldset>

          <fieldset className="lead-form-block">
            <legend>2 · Planning & budget</legend>

            <BusinessLabel>Début réservation
              <input name="rentalStartDate" type="date" />
            </BusinessLabel>

            <BusinessLabel>Fin réservation
              <input name="rentalEndDate" type="date" />
            </BusinessLabel>

            <BusinessLabel>Valeur
              <input name="value" type="number" min="0" placeholder="2500" />
            </BusinessLabel>
          </fieldset>

          <fieldset className="lead-form-block">
            <legend>3 · Suivi commercial</legend>

            <BusinessLabel>Statut
              <select name="status" defaultValue="Nouveau">
                
        {visibleLeads.length === 0 && (
          <div className="empty-state">
            <h3>Aucun lead affiché</h3>
            <p>
              Ajoutez un lead avec “Ajouter contact / lead” ou modifiez les filtres si vous cherchez une demande existante.
            </p>
          </div>
        )}

{leadStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </BusinessLabel>

            <BusinessLabel>Priorité
              <select name="priority" defaultValue="Moyenne">
                <option>Basse</option>
                <option>Moyenne</option>
                <option>Haute</option>
              </select>
            </BusinessLabel>

            <BusinessLabel>Date réponse
              <input name="dueDate" type="date" />
            </BusinessLabel>

            <BusinessLabel className="full">Prochaine action
              <input name="nextAction" placeholder="Appeler, envoyer proposition, relancer..." />
            </BusinessLabel>

            <BusinessLabel className="full">Notes internes
              <textarea name="notes" placeholder="Préférences client, contraintes, détails importants..." />
            </BusinessLabel>
          </fieldset>

          <div className="lead-form-actions">
            <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter le lead</BusinessButton>
          </div>
        </BusinessForm>
      </section>

      <section className="card lead-filter-card">
        <div>
          <p className="eyebrow">Filtres rapides</p>
          <h3>{visibleLeads.length} leads affichés</h3>
        </div>

        <div className="lead-filter-grid">
          <BusinessLabel>Catégorie
            <select
              value={leadCategoryFilter}
              onChange={(event) => setLeadCategoryFilter(event.target.value as "Toutes" | Lead["category"])}
            >
              <option value="Toutes">Toutes</option>
              <option value="Villa">Villa</option>
              <option value="Voiture">Voiture</option>
              <option value="Bateau">Bateau</option>
              <option value="Conciergerie">Conciergerie</option>
            </select>
          </BusinessLabel>

          <BusinessLabel>Statut
            <select
              value={leadStatusFilter}
              onChange={(event) => setLeadStatusFilter(event.target.value as "Tous" | LeadStatus)}
            >
              <option value="Tous">Tous</option>
              {leadStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessLabel>Priorité
            <select
              value={leadPriorityFilter}
              onChange={(event) => setLeadPriorityFilter(event.target.value as "Toutes" | Lead["priority"])}
            >
              <option value="Toutes">Toutes</option>
              <option value="Basse">Basse</option>
              <option value="Moyenne">Moyenne</option>
              <option value="Haute">Haute</option>
            </select>
          </BusinessLabel>
        </div>
      </section>

      <section className="pipeline-grid compact-pipeline" aria-label="Pipeline leads">
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
                <strong>{status}</strong>
                <span>{columnLeads.length}</span>
                <em>{isCollapsed ? "▾" : "▴"}</em>
              </BusinessButton>

              {!isCollapsed && (
                <div className="list-stack oar-contact-list-stack">
                  {columnLeads.map((lead) => (
                    <article className={`lead-card ${getDueStatus(lead.dueDate)}`} key={lead.id} data-notification-target={`lead-${lead.id}`}>
                      <div className="lead-topline">
                        <Badge>{lead.priority}</Badge>

                        <BusinessButton permission="remove"
                          className="icon-button"
                          type="button"
                          onClick={() => {
                            const confirmed = window.confirm(
                              `Supprimer ce lead pour "${lead.contactName}" ?`
                            );

                            if (confirmed) {
                              onDelete(lead.id);
                            }
                          }}
                          aria-label="Supprimer"
                        >
                          ×
                        </BusinessButton>
                      </div>

                      <strong>{lead.category}</strong>
                      <span>{lead.contactName}</span>
                      <small>{formatReservationPeriod(lead.rentalStartDate, lead.rentalEndDate)}</small>

                      {getLeadAssetLabel(lead) && (
                        <small className="asset-linked-line">{getLeadAssetLabel(lead)}</small>
                      )}

                      <p>{lead.nextAction || "Aucune prochaine action"}</p>

                      {lead.notes && (
                        <p className="lead-note-preview">{lead.notes}</p>
                      )}

                      <div className="lead-footer">
                        <b>{currency.format(lead.value)}</b>
                        <small className={`due-label ${getDueStatus(lead.dueDate)}`}>
                          {getDueLabel(lead.dueDate)}
                        </small>
                      </div>

                      <BusinessSelect value={lead.status} onChange={(event) => onStatusChange(lead.id, event.target.value as LeadStatus)}>
                        {leadStatuses.map((option) => <option key={option}>{option}</option>)}
                      </BusinessSelect>

                      <div className="lead-card-actions">
                        <BusinessButton className="lead-detail-button" type="button" onClick={() => setSelectedLead(lead)}>
                          Détails
                        </BusinessButton>

                        <BusinessButton permission="write" className="lead-detail-button" type="button" onClick={() => onCreateTask(lead)}>
                          Tâche
                        </BusinessButton>

                        <BusinessButton permission="write" className="lead-detail-button" type="button" onClick={() => onCreateQuote(lead)}>
                          {quotes.some((quote) => quote.leadId === lead.id) ? "Ouvrir devis lié" : "Créer devis"}
                        </BusinessButton>

                        <BusinessButton permission="write" className="lead-edit-button" type="button" onClick={() => openEdit(lead)}>
                          Modifier
                        </BusinessButton>
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
            <p className="eyebrow">Fiche lead</p>
            <h3>{selectedLead.category} • {selectedLead.contactName}</h3>

            <div className="lead-detail-grid">
              <div>
                <span>Statut</span>
                <strong>{selectedLead.status}</strong>
              </div>

              <div>
                <span>Priorité</span>
                <strong>{selectedLead.priority}</strong>
              </div>

              <div>
                <span>Valeur</span>
                <strong>{currency.format(selectedLead.value)}</strong>
              </div>

              <div>
                <span>Date réponse</span>
                <strong>{selectedLead.dueDate ? formatDateFR(selectedLead.dueDate) : "Non renseignée"}</strong>
              </div>

              <div className="full">
                <span>Date de réservation</span>
                <strong>{formatReservationPeriod(selectedLead.rentalStartDate, selectedLead.rentalEndDate)}</strong>
              </div>

              <div className="full">
                <span>Prochaine action</span>
                <strong>{selectedLead.nextAction || "Aucune prochaine action"}</strong>
              </div>
              <div><span>Action</span><strong>{getActionMetaLabel(selectedLead)}</strong></div>

              <div className="full">
                <span>Notes internes</span>
                <p>{selectedLead.notes || "Aucune note interne pour le moment."}</p>
              </div>
            </div>

            <div className="lead-related-section">
              <p className="eyebrow">Tâches liées à ce lead</p>

              <div className="list-stack oar-contact-list-stack">
                {getLeadTasks(selectedLead).length === 0 && (
                  <p className="muted-line">Aucune tâche liée pour le moment.</p>
                )}

                {getLeadTasks(selectedLead).map((task) => (
                  <article className="mini-row" key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>
                        {task.owner || "Responsable non renseigné"}
                        {" · "}
                        {task.dueDate ? `Date ${formatDateFR(task.dueDate)}` : "Sans échéance"}
                      </span>
                    </div>
                    <Badge>{task.status}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedLead(null)}>
                Fermer
              </BusinessButton>

                              <BusinessButton permission="write"
                className="secondary-button"
                type="button"
                onClick={() => {
                  const lead = selectedLead;
                  setSelectedLead(null);
                  onCreateTask(lead);
                }}
              >
                Créer une tâche
              </BusinessButton>

              <BusinessButton permission="write"
                className="primary-button"
                type="button"
                onClick={() => {
                  const lead = selectedLead;
                  setSelectedLead(null);
                  openEdit(lead);
                }}
              >
                Modifier
              </BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingLead && (
        <div className="confirm-backdrop">
          <div id="lead-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Modification</p>
            <h3>Modifier le lead</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>Catégorie
                <select name="category" defaultValue={editingLead.category}>
                  <option value="Villa">Villa</option>
                  <option value="Voiture">Voiture</option>
                  <option value="Bateau">Bateau</option>
                  <option value="Conciergerie">Conciergerie</option>
                </select>
              </BusinessLabel>

              <BusinessLabel>Contact
                <select name="contactName" defaultValue={editingLead.contactName} required>
                  <option value="">Sélectionner un contact</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.name}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </BusinessLabel>

              <BusinessLabel>Actif proposé
                <select
                  name="assetKey"
                  defaultValue={editingLead.assetType && editingLead.assetId ? `${editingLead.assetType}:${editingLead.assetId}` : ""}
                >
                  <option value="">Aucun actif lié</option>
                  {assetOptions.map((asset) => (
                    <option key={`${asset.type}:${asset.id}`} value={`${asset.type}:${asset.id}`}>
                      {asset.label}
                    </option>
                  ))}
                </select>
              </BusinessLabel>

              <BusinessLabel>Statut
                <select name="status" defaultValue={editingLead.status}>
                  {leadStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>Valeur<input name="value" type="number" min="0" defaultValue={editingLead.value || ""} /></BusinessLabel>

              <BusinessLabel>Priorité
                <select name="priority" defaultValue={editingLead.priority}>
                  <option>Basse</option>
                  <option>Moyenne</option>
                  <option>Haute</option>
                </select>
              </BusinessLabel>

              <BusinessLabel>Date<input name="dueDate" type="date" defaultValue={editingLead.dueDate} /></BusinessLabel>
              <BusinessLabel>Début réservation<input name="rentalStartDate" type="date" defaultValue={editingLead.rentalStartDate} /></BusinessLabel>
              <BusinessLabel>Fin réservation<input name="rentalEndDate" type="date" defaultValue={editingLead.rentalEndDate} /></BusinessLabel>

              <BusinessLabel className="full">Prochaine action
                <input name="nextAction" defaultValue={editingLead.nextAction} />
              </BusinessLabel>

              <BusinessLabel className="full">Notes internes
                <textarea name="notes" defaultValue={editingLead.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingLead(null)}>
                  Annuler
                </BusinessButton>

                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">
                  Enregistrer
                </BusinessButton>
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
            <p className="eyebrow">Filtres biens</p>
            <h3>{visibleProperties.length} biens affichés</h3>
          </div>

          <div className="asset-filter-grid">
            <BusinessLabel>Statut
              <select value={propertyStatusFilter} onChange={(event) => setPropertyStatusFilter(event.target.value as "Tous" | PropertyStatus)}>
                <option value="Tous">Tous</option>
                {propertyStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </BusinessLabel>

            <BusinessLabel>Ville
              <input value={propertyCityFilter} onChange={(event) => setPropertyCityFilter(event.target.value)} placeholder="Cannes, Nice..." />
            </BusinessLabel>
          </div>
        </div>

        {visibleProperties.length === 0 && (
          <div className="empty-state">
            <h3>Aucun bien trouvé</h3>
            <p>Ajoutez un bien avec “Ajouter bien / voiture / bateau” ou modifiez les filtres.</p>
          </div>
        )}

        {visibleProperties.map((property) => (
          <article className="property-card" key={property.id}>
            <div className="property-visual">
              <span>{property.city || "Bien"}</span>

              <BusinessButton permission="remove"
                className="asset-reset-button icon-button light"
                onClick={() => {
                  const confirmed = window.confirm(`Supprimer "${property.name}" ?`);
                  if (confirmed) onDelete(property.id);
                }}
                aria-label="Supprimer"
              >
                ×
              </BusinessButton>
            </div>

            <div className="property-body">
              <div className="section-heading compact-heading">
                <div>
                  <h3>{property.name}</h3>
                  <p>{property.city || "Ville non renseignée"}</p>
                </div>
                <Badge>{property.status}</Badge>
              </div>

              <dl className="property-meta">
                <div><dt>Prix</dt><dd>{currency.format(property.price)}</dd></div>
                <div><dt>Chambres</dt><dd>{property.bedrooms || "—"}</dd></div>
                <div><dt>Surface</dt><dd>{property.surface ? `${property.surface} m²` : "—"}</dd></div>
                <div><dt>Owner</dt><dd>{property.owner || "—"}</dd></div>
              </dl>
              <ActionMeta item={property} />

              <div className="asset-card-actions">
                <BusinessButton className="asset-detail-button" type="button" onClick={() => setSelectedProperty(property)}>
                  Détails
                </BusinessButton>

                <BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => openEdit(property)}>
                  Modifier
                </BusinessButton>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card form-card">
        <p className="eyebrow">Nouveau</p>
        <h3>Ajouter un bien</h3>

        <BusinessForm className="form-grid contact-create-form" onSubmit={onAdd}>
          <BusinessLabel>Nom<input name="name" placeholder="Villa Belle Époque" /></BusinessLabel>
          <BusinessLabel>Ville<input name="city" placeholder="Cannes" /></BusinessLabel>
          <BusinessLabel>Prix<input name="price" type="number" min="0" placeholder="120000" /></BusinessLabel>

          <BusinessLabel>Statut
            <select name="status">
              {propertyStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </BusinessLabel>

          <BusinessLabel>Propriétaire<input name="owner" placeholder="Nom owner" /></BusinessLabel>
          <BusinessLabel>Chambres<input name="bedrooms" type="number" min="0" placeholder="6" /></BusinessLabel>
          <BusinessLabel>Surface m²<input name="surface" type="number" min="0" placeholder="420" /></BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter</BusinessButton>
        </BusinessForm>
      </section>

      {selectedProperty && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog asset-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Fiche bien</p>
            <h3>{selectedProperty.name}</h3>

            <div className="asset-detail-grid">
              <div><span>Statut</span><strong>{selectedProperty.status}</strong></div>
              <div><span>Ville</span><strong>{selectedProperty.city || "Non renseignée"}</strong></div>
              <div><span>Prix</span><strong>{currency.format(selectedProperty.price)}</strong></div>
              <div><span>Owner</span><strong>{selectedProperty.owner || "Non renseigné"}</strong></div>
              <div><span>Chambres</span><strong>{selectedProperty.bedrooms || "—"}</strong></div>
              <div><span>Surface</span><strong>{selectedProperty.surface ? `${selectedProperty.surface} m²` : "—"}</strong></div>
              <div className="full"><span>Notes internes</span><p>{selectedProperty.notes || "Aucune note interne."}</p></div>
            </div>

            <div className="asset-related-section">
              <p className="eyebrow">Leads liés à ce bien</p>

              <div className="list-stack oar-contact-list-stack">
                {getPropertyLeads(selectedProperty).length === 0 && (
                  <p className="muted-line">Aucun lead lié à ce bien.</p>
                )}

                {getPropertyLeads(selectedProperty).map((lead) => (
                  <article className="mini-row" key={lead.id}>
                    <div>
                      <strong>{lead.contactName}</strong>
                      <span>{lead.status} · {currency.format(lead.value)}</span>
                    </div>
                    <Badge>{lead.priority}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedProperty(null)}>Fermer</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedProperty)}>Modifier</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingProperty && (
        <div className="confirm-backdrop">
          <div id="property-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Modification</p>
            <h3>Modifier le bien</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>Nom<input name="name" defaultValue={editingProperty.name} /></BusinessLabel>
              <BusinessLabel>Ville<input name="city" defaultValue={editingProperty.city} /></BusinessLabel>
              <BusinessLabel>Prix<input name="price" type="number" min="0" defaultValue={editingProperty.price || ""} /></BusinessLabel>

              <BusinessLabel>Statut
                <select name="status" defaultValue={editingProperty.status}>
                  {propertyStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>Propriétaire<input name="owner" defaultValue={editingProperty.owner} /></BusinessLabel>
              <BusinessLabel>Chambres<input name="bedrooms" type="number" min="0" defaultValue={editingProperty.bedrooms || ""} /></BusinessLabel>
              <BusinessLabel>Surface m²<input name="surface" type="number" min="0" defaultValue={editingProperty.surface || ""} /></BusinessLabel>

              <BusinessLabel className="full">Notes internes
                <textarea name="notes" defaultValue={editingProperty.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingProperty(null)}>Annuler</BusinessButton>
                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Enregistrer</BusinessButton>
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
            <p className="eyebrow">Filtres voitures</p>
            <h3>{visibleVehicles.length} voitures affichées</h3>
          </div>

          <div className="asset-filter-grid">
            <BusinessLabel>Statut
              <select value={vehicleStatusFilter} onChange={(event) => setVehicleStatusFilter(event.target.value as "Tous" | VehicleStatus)}>
                <option value="Tous">Tous</option>
                {vehicleStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </BusinessLabel>

            <BusinessLabel>Ville
              <input value={vehicleCityFilter} onChange={(event) => setVehicleCityFilter(event.target.value)} placeholder="Cannes, Monaco..." />
            </BusinessLabel>
          </div>
        </div>

        {visibleVehicles.length === 0 && (
          <div className="empty-state">
            <h3>Aucune voiture trouvée</h3>
            <p>Ajoutez un bien avec “Ajouter bien / voiture / bateau” ou modifiez les filtres.</p>
          </div>
        )}

        {visibleVehicles.map((vehicle) => (
          <article className="property-card" key={vehicle.id}>
            <div className="property-visual">
              <span>{vehicle.brand || "Voiture"}</span>
              <BusinessButton permission="remove" className="asset-reset-button icon-button light" onClick={() => {
                const confirmed = window.confirm(`Supprimer "${vehicle.name}" ?`);
                if (confirmed) onDelete(vehicle.id);
              }} aria-label="Supprimer">×</BusinessButton>
            </div>

            <div className="property-body">
              <div className="section-heading compact-heading">
                <div>
                  <h3>{vehicle.name}</h3>
                  <p>{vehicle.city || "Ville non renseignée"}</p>
                </div>
                <Badge>{vehicle.status}</Badge>
              </div>

              <dl className="property-meta">
                <div><dt>Prix / jour</dt><dd>{currency.format(vehicle.price)}</dd></div>
                <div><dt>Année</dt><dd>{vehicle.year || "—"}</dd></div>
                <div><dt>Kilométrage</dt><dd>{vehicle.mileage ? `${vehicle.mileage.toLocaleString("fr-FR")} km` : "—"}</dd></div>
                <div><dt>Owner</dt><dd>{vehicle.owner || "—"}</dd></div>
              </dl>
              <ActionMeta item={vehicle} />

              <div className="asset-card-actions">
                <BusinessButton className="asset-detail-button" type="button" onClick={() => setSelectedVehicle(vehicle)}>Détails</BusinessButton>
                <BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => openEdit(vehicle)}>Modifier</BusinessButton>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card form-card">
        <p className="eyebrow">Nouveau</p>
        <h3>Ajouter une voiture</h3>

        <BusinessForm className="form-grid contact-create-form" onSubmit={onAdd}>
          <BusinessLabel>Nom<input name="name" placeholder="Range Rover Autobiography" /></BusinessLabel>
          <BusinessLabel>Marque<input name="brand" placeholder="Land Rover" /></BusinessLabel>
          <BusinessLabel>Modèle<input name="model" placeholder="Range Rover" /></BusinessLabel>
          <BusinessLabel>Ville<input name="city" placeholder="Cannes" /></BusinessLabel>
          <BusinessLabel>Prix / jour<input name="price" type="number" min="0" placeholder="900" /></BusinessLabel>

          <BusinessLabel>Statut
            <select name="status">
              {vehicleStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </BusinessLabel>

          <BusinessLabel>Propriétaire<input name="owner" placeholder="Nom owner" /></BusinessLabel>
          <BusinessLabel>Année<input name="year" type="number" min="1900" placeholder="2024" /></BusinessLabel>
          <BusinessLabel>Kilométrage<input name="mileage" type="number" min="0" placeholder="12000" /></BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter</BusinessButton>
        </BusinessForm>
      </section>

      {selectedVehicle && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog asset-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Fiche voiture</p>
            <h3>{selectedVehicle.name}</h3>

            <div className="asset-detail-grid">
              <div><span>Marque</span><strong>{selectedVehicle.brand || "—"}</strong></div>
              <div><span>Modèle</span><strong>{selectedVehicle.model || "—"}</strong></div>
              <div><span>Statut</span><strong>{selectedVehicle.status}</strong></div>
              <div><span>Ville</span><strong>{selectedVehicle.city || "—"}</strong></div>
              <div><span>Prix / jour</span><strong>{currency.format(selectedVehicle.price)}</strong></div>
              <div><span>Owner</span><strong>{selectedVehicle.owner || "—"}</strong></div>
              <div><span>Année</span><strong>{selectedVehicle.year || "—"}</strong></div>
              <div><span>Kilométrage</span><strong>{selectedVehicle.mileage ? `${selectedVehicle.mileage.toLocaleString("fr-FR")} km` : "—"}</strong></div>
              <div className="full"><span>Notes internes</span><p>{selectedVehicle.notes || "Aucune note interne."}</p></div>
            </div>

            <div className="asset-related-section">
              <p className="eyebrow">Leads liés à cette voiture</p>

              <div className="list-stack oar-contact-list-stack">
                {getVehicleLeads(selectedVehicle).length === 0 && (
                  <p className="muted-line">Aucun lead lié à cette voiture.</p>
                )}

                {getVehicleLeads(selectedVehicle).map((lead) => (
                  <article className="mini-row" key={lead.id}>
                    <div>
                      <strong>{lead.contactName}</strong>
                      <span>{lead.status} · {currency.format(lead.value)}</span>
                    </div>
                    <Badge>{lead.priority}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedVehicle(null)}>Fermer</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedVehicle)}>Modifier</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingVehicle && (
        <div className="confirm-backdrop">
          <div id="vehicle-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Modification</p>
            <h3>Modifier la voiture</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>Nom<input name="name" defaultValue={editingVehicle.name} /></BusinessLabel>
              <BusinessLabel>Marque<input name="brand" defaultValue={editingVehicle.brand} /></BusinessLabel>
              <BusinessLabel>Modèle<input name="model" defaultValue={editingVehicle.model} /></BusinessLabel>
              <BusinessLabel>Ville<input name="city" defaultValue={editingVehicle.city} /></BusinessLabel>
              <BusinessLabel>Prix / jour<input name="price" type="number" min="0" defaultValue={editingVehicle.price || ""} /></BusinessLabel>

              <BusinessLabel>Statut
                <select name="status" defaultValue={editingVehicle.status}>
                  {vehicleStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>Propriétaire<input name="owner" defaultValue={editingVehicle.owner} /></BusinessLabel>
              <BusinessLabel>Année<input name="year" type="number" min="1900" defaultValue={editingVehicle.year || ""} /></BusinessLabel>
              <BusinessLabel>Kilométrage<input name="mileage" type="number" min="0" defaultValue={editingVehicle.mileage || ""} /></BusinessLabel>

              <BusinessLabel className="full">Notes internes
                <textarea name="notes" defaultValue={editingVehicle.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingVehicle(null)}>Annuler</BusinessButton>
                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Enregistrer</BusinessButton>
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
            <p className="eyebrow">Filtres bateaux</p>
            <h3>{visibleBoats.length} bateaux affichés</h3>
          </div>

          <div className="asset-filter-grid">
            <BusinessLabel>Statut
              <select value={boatStatusFilter} onChange={(event) => setBoatStatusFilter(event.target.value as "Tous" | BoatStatus)}>
                <option value="Tous">Tous</option>
                {boatStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </BusinessLabel>

            <BusinessLabel>Port
              <input value={boatPortFilter} onChange={(event) => setBoatPortFilter(event.target.value)} placeholder="Cannes, Antibes..." />
            </BusinessLabel>
          </div>
        </div>

        {visibleBoats.length === 0 && (
          <div className="empty-state">
            <h3>Aucun bateau trouvé</h3>
            <p>Ajoutez un bien avec “Ajouter bien / voiture / bateau” ou modifiez les filtres.</p>
          </div>
        )}

        {visibleBoats.map((boat) => (
          <article className="property-card" key={boat.id}>
            <div className="property-visual">
              <span>{boat.type || "Bateau"}</span>
              <BusinessButton permission="remove" className="icon-button light" onClick={() => {
                const confirmed = window.confirm(`Supprimer "${boat.name}" ?`);
                if (confirmed) onDelete(boat.id);
              }} aria-label="Supprimer">×</BusinessButton>
            </div>

            <div className="property-body">
              <div className="section-heading compact-heading">
                <div>
                  <h3>{boat.name}</h3>
                  <p>{boat.port || "Port non renseigné"}</p>
                </div>
                <Badge>{boat.status}</Badge>
              </div>

              <dl className="property-meta">
                <div><dt>Prix / jour</dt><dd>{currency.format(boat.price)}</dd></div>
                <div><dt>Longueur</dt><dd>{boat.length ? `${boat.length} m` : "—"}</dd></div>
                <div><dt>Année</dt><dd>{boat.year || "—"}</dd></div>
                <div><dt>Owner</dt><dd>{boat.owner || "—"}</dd></div>
              </dl>
              <ActionMeta item={boat} />

              <div className="asset-card-actions">
                <BusinessButton className="asset-detail-button" type="button" onClick={() => setSelectedBoat(boat)}>Détails</BusinessButton>
                <BusinessButton permission="write" className="asset-edit-button" type="button" onClick={() => openEdit(boat)}>Modifier</BusinessButton>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="card form-card">
        <p className="eyebrow">Nouveau</p>
        <h3>Ajouter un bateau</h3>

        <BusinessForm className="form-grid contact-create-form" onSubmit={onAdd}>
          <BusinessLabel>Nom<input name="name" placeholder="Sunseeker Manhattan 55" /></BusinessLabel>
          <BusinessLabel>Port<input name="port" placeholder="Cannes" /></BusinessLabel>
          <BusinessLabel>Type<input name="type" placeholder="Yacht, day boat..." /></BusinessLabel>
          <BusinessLabel>Prix / jour<input name="price" type="number" min="0" placeholder="4500" /></BusinessLabel>

          <BusinessLabel>Statut
            <select name="status">
              {boatStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </BusinessLabel>

          <BusinessLabel>Propriétaire<input name="owner" placeholder="Nom owner" /></BusinessLabel>
          <BusinessLabel>Année<input name="year" type="number" min="1900" placeholder="2021" /></BusinessLabel>
          <BusinessLabel>Longueur m<input name="length" type="number" min="0" placeholder="17" /></BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter</BusinessButton>
        </BusinessForm>
      </section>

      {selectedBoat && (
        <div className="confirm-backdrop">
          <div className="confirm-dialog asset-detail-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Fiche bateau</p>
            <h3>{selectedBoat.name}</h3>

            <div className="asset-detail-grid">
              <div><span>Type</span><strong>{selectedBoat.type || "—"}</strong></div>
              <div><span>Port</span><strong>{selectedBoat.port || "—"}</strong></div>
              <div><span>Statut</span><strong>{selectedBoat.status}</strong></div>
              <div><span>Prix / jour</span><strong>{currency.format(selectedBoat.price)}</strong></div>
              <div><span>Owner</span><strong>{selectedBoat.owner || "—"}</strong></div>
              <div><span>Année</span><strong>{selectedBoat.year || "—"}</strong></div>
              <div><span>Longueur</span><strong>{selectedBoat.length ? `${selectedBoat.length} m` : "—"}</strong></div>
              <div className="full"><span>Notes internes</span><p>{selectedBoat.notes || "Aucune note interne."}</p></div>
            </div>

            <div className="asset-related-section">
              <p className="eyebrow">Leads liés à ce bateau</p>

              <div className="list-stack oar-contact-list-stack">
                {getBoatLeads(selectedBoat).length === 0 && (
                  <p className="muted-line">Aucun lead lié à ce bateau.</p>
                )}

                {getBoatLeads(selectedBoat).map((lead) => (
                  <article className="mini-row" key={lead.id}>
                    <div>
                      <strong>{lead.contactName}</strong>
                      <span>{lead.status} · {currency.format(lead.value)}</span>
                    </div>
                    <Badge>{lead.priority}</Badge>
                  </article>
                ))}
              </div>
            </div>

            <div className="confirm-actions">
              <BusinessButton className="ghost-button" type="button" onClick={() => setSelectedBoat(null)}>Fermer</BusinessButton>
              <BusinessButton permission="write" className="primary-button" type="button" onClick={() => openEdit(selectedBoat)}>Modifier</BusinessButton>
            </div>
          </div>
        </div>
      )}

      {editingBoat && (
        <div className="confirm-backdrop">
          <div id="boat-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Modification</p>
            <h3>Modifier le bateau</h3>

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>Nom<input name="name" defaultValue={editingBoat.name} /></BusinessLabel>
              <BusinessLabel>Port<input name="port" defaultValue={editingBoat.port} /></BusinessLabel>
              <BusinessLabel>Type<input name="type" defaultValue={editingBoat.type} /></BusinessLabel>
              <BusinessLabel>Prix / jour<input name="price" type="number" min="0" defaultValue={editingBoat.price || ""} /></BusinessLabel>

              <BusinessLabel>Statut
                <select name="status" defaultValue={editingBoat.status}>
                  {boatStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>Propriétaire<input name="owner" defaultValue={editingBoat.owner} /></BusinessLabel>
              <BusinessLabel>Année<input name="year" type="number" min="1900" defaultValue={editingBoat.year || ""} /></BusinessLabel>
              <BusinessLabel>Longueur m<input name="length" type="number" min="0" defaultValue={editingBoat.length || ""} /></BusinessLabel>

              <BusinessLabel className="full">Notes internes
                <textarea name="notes" defaultValue={editingBoat.notes ?? ""} />
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingBoat(null)}>Annuler</BusinessButton>
                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Enregistrer</BusinessButton>
              </div>
            </BusinessForm>
          </div>
        </div>
      )}
    </div>
  );
}


function TasksView({
  tasks,
  leads,
  preselectedLeadId,
  prefilledTitle,
  onAdd,
  onUpdate,
  onStatusChange,
  onDelete
}: {
  tasks: Task[];
  leads: Lead[];
  preselectedLeadId?: string;
  prefilledTitle?: string;
  onAdd: (event: React.FormEvent<HTMLFormElement>) => void;
  onUpdate: (task: Task) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
}) {
  const business = useBusinessPermissions();
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  function getLinkedLeadLabel(linkedTo: string) {
    if (!linkedTo) return "Aucun lead lié";

    const lead = leads.find((item) => item.id === linkedTo);

    if (!lead) return linkedTo;

    return `${lead.category} • ${lead.contactName}`;
  }

  function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingTask) return;

    const form = new FormData(event.currentTarget);

    const updatedTask: Task = {
      ...editingTask,
      title: String(form.get("title") ?? "").trim(),
      owner: String(form.get("owner") ?? "").trim(),
      status: String(form.get("status") ?? "À faire") as TaskStatus,
      dueDate: String(form.get("dueDate") ?? ""),
      linkedTo: String(form.get("linkedTo") ?? "").trim(),
      completedAt: isCompletedTaskStatus(String(form.get("status") ?? "À faire")) ? editingTask.completedAt || new Date().toISOString() : ""
    };

    if (!updatedTask.title) return;

    onUpdate(updatedTask);
    setEditingTask(null);
  }

  function openEdit(task: Task) {
    setEditingTask(task);

    setTimeout(() => {
      document.getElementById("task-edit-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 50);
  }

  return (
    <div className="two-columns wide-left">
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Suivi</p>
            <h3>{tasks.length} tâche{tasks.length > 1 ? "s" : ""}</h3>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="empty-state">
            <h3>Aucune tâche pour le moment</h3>
            <p>Ajoutez une tâche depuis un lead, un contact, ou utilisez le formulaire de création.</p>
          </div>
        ) : (
          <div className="pipeline-grid task-pipeline-grid">
            {taskStatuses.map((status) => {
              const columnTasks = tasks.filter((task) => task.status === status);

              return (
                <div className="pipeline-column task-column" key={status}>
                  <div className="pipeline-title">
                    <strong>{status}</strong>
                    <span>{columnTasks.length}</span>
                  </div>

                  <div className="list-stack oar-contact-list-stack">
                    {columnTasks.length === 0 ? (
                      <p className="muted-line">Aucune tâche.</p>
                    ) : (
                      columnTasks.map((task) => {
                        const linkedLead = leads.find((lead) => lead.id === task.linkedTo);

                        return (
                          <article className={`task-row ${isCompletedTaskStatus(task.status) ? "task-row-completed" : ""}`} key={task.id} data-notification-target={`task-${task.id}`}>
                            <div>
                              <strong>{task.title}</strong>
                              <small>
                                {task.owner || "Responsable non renseigné"} ·{" "}
                                <span className={`due-label ${getDueStatus(task.dueDate)}`}>
                                  {getDueLabel(task.dueDate)}
                                </span>
                              </small>

                              {linkedLead && (
                                <small>
                                  Lead lié : {linkedLead.category} · {linkedLead.contactName}
                                </small>
                              )}

                              <ActionMeta item={task} />

                              {isCompletedTaskStatus(task.status) && (
                                <small className="task-completed-hint">Disparaît automatiquement après 3 jours</small>
                              )}

                              <BusinessButton permission="write"
                                className="task-edit-button"
                                type="button"
                                onClick={() => openEdit(task)}
                              >
                                Modifier
                              </BusinessButton>
                            </div>

                            <div className="task-actions">
                              <BusinessSelect value={task.status} onChange={(event) => onStatusChange(task.id, event.target.value as TaskStatus)}>
                                {taskStatuses.map((option) => <option key={option}>{option}</option>)}
                              </BusinessSelect>

                              <BusinessButton permission="remove"
                                className="icon-button"
                                type="button"
                                onClick={() => {
                                  const confirmed = window.confirm(`Supprimer la tâche "${task.title}" ?`);

                                  if (confirmed) {
                                    onDelete(task.id);
                                  }
                                }}
                                aria-label="Supprimer"
                              >
                                ×
                              </BusinessButton>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="task-create-form" className="card form-card">
        <p className="eyebrow">Nouvelle</p>
        <h3>Ajouter une tâche</h3>

        <BusinessForm className="form-grid contact-create-form" onSubmit={onAdd}>
          <BusinessLabel>Titre<input name="title" placeholder="Envoyer proposition" defaultValue={prefilledTitle || ""} /></BusinessLabel>
          <BusinessLabel>Responsable<input name="owner" placeholder="Matteo" /></BusinessLabel>

          <BusinessLabel>Statut
            <select name="status">
              {taskStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </BusinessLabel>

          <BusinessLabel>Date<input name="dueDate" type="date" /></BusinessLabel>

          <BusinessLabel className="full">Lead lié
            <select name="linkedTo" defaultValue={preselectedLeadId || ""}>
              <option value="">Aucun lead lié</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.category} • {lead.contactName}
                </option>
              ))}
            </select>
          </BusinessLabel>

          <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">Ajouter</BusinessButton>
        </BusinessForm>
      </section>

      {editingTask && (
        <div className="confirm-backdrop">
          <div id="task-edit-panel" className="confirm-dialog edit-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">Modification</p>
            <h3>Modifier la tâche</h3>
            <ActionMeta item={editingTask} />

            <BusinessForm className="form-grid contact-edit-form" onSubmit={submitEdit}>
              <BusinessLabel>Titre<input name="title" defaultValue={editingTask.title} /></BusinessLabel>
              <BusinessLabel>Responsable<input name="owner" defaultValue={editingTask.owner} /></BusinessLabel>

              <BusinessLabel>Statut
                <select name="status" defaultValue={editingTask.status}>
                  {taskStatuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </BusinessLabel>

              <BusinessLabel>Date<input name="dueDate" type="date" defaultValue={editingTask.dueDate} /></BusinessLabel>

              <BusinessLabel className="full">Lead lié
                <select name="linkedTo" defaultValue={editingTask.linkedTo}>
                  <option value="">Aucun lead lié</option>
                  {leads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.category} • {lead.contactName}
                    </option>
                  ))}
                </select>
              </BusinessLabel>

              <div className="confirm-actions full">
                <BusinessButton permission="write" className="ghost-button" type="button" onClick={() => setEditingTask(null)}>
                  Annuler
                </BusinessButton>

                <BusinessButton permission="write" className="primary-button planning-entry-submit" type="submit">
                  Enregistrer
                </BusinessButton>
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
export { QuotesView, BookingsView, HouseTrackingView, VendorInvoicesView, ContactsView, LeadsView, PropertiesView, VehiclesView, BoatsView, TasksView, PlanningView, Dashboard, createDraftQuoteFromLead, safeNumber, parseAssetKey, normalizePlanningCategory, getPlanningCategoryFromAssetType, isValidPlanningDate, planningDateValue, getQuoteStatus, getQuoteTotal };
export type { QuoteRequest };
