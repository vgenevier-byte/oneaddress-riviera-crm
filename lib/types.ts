export type ContactKind = "Client" | "Propriétaire" | "Prestataire";
export type SupplierCategory = string;
export type SupplierQuality = "Standard" | "Premium" | "Très premium";
export type SupplierReliability = "À tester" | "Fiable" | "Très fiable" | "À éviter";
export type SupplierStatus = "Actif" | "À vérifier" | "Inactif";
export type VendorQuoteStatus = "À valider" | "Validé" | "Refusé";
export type ContactLevel = "Standard" | "VIP" | "Ultra VIP";
export type ContactLanguage = "Français" | "Anglais" | "Italien" | "Autre";
export type ContactRelationshipStatus = "Prospect" | "Actif" | "Dormant" | "Prestataire";
export type LeadStatus = "Nouveau" | "Contacté" | "Devis" | "Négociation" | "Gagné" | "Perdu";
export type PropertyStatus = "Disponible" | "Mandat en cours" | "Loué" | "Vendu";
export type VehicleStatus = "Disponible" | "En location" | "En maintenance" | "Vendu";
export type BoatStatus = "Disponible" | "En charter" | "En maintenance" | "Vendu";
export type TaskStatus = "À faire" | "En cours" | "Terminé";
export type PlanningEntryType = "Réservation" | "Intervention prestataire" | "Maintenance" | "Tâche interne" | "Autre";
export type PlanningEntryStatus = "Prévu" | "À confirmer" | "En cours" | "Terminé" | "Annulé";
export type PlanningPriority = "Normal" | "Important" | "Critique";
export type PlanningCategory = "Villa" | "Bateau" | "Voiture" | "Conciergerie";

export type ActionAuditFields = {
  createdBy?: string;
  updatedBy?: string;
  completedAt?: string;
  updatedAt?: string;
};

export type VendorBankAccount = {
  id: string;
  label?: string;
  accountHolder: string;
  iban: string;
  bic: string;
  bankName?: string;
  status: "À vérifier" | "Vérifié" | "Archivé";
  isPrimary: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
  documentProvider?: "google-drive";
  driveFileId?: string;
  driveFolderId?: string;
  driveFileName?: string;
  driveOriginalFileName?: string;
  driveWebViewLink?: string;
  driveMimeType?: string;
  driveSize?: number;
  driveUploadedAt?: string;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type Contact = {
  supplierBankAccounts?: VendorBankAccount[];
  id: string;
  name: string;
  firstName?: string;
  civility?: "M" | "MME" | "";
  companyName?: string;
  kind: ContactKind;
  email: string;
  phone: string;
  city: string;
  postalAddress: string;
  budget: number;
  source: string;
  notes: string;
  clientLevel?: ContactLevel;
  preferredLanguage?: ContactLanguage;
  relationshipStatus?: ContactRelationshipStatus;
  preferences?: string;
  importantNotes?: string;
  supplierCategory?: SupplierCategory;
  supplierContactName?: string;
  supplierZone?: string;
  supplierQuality?: SupplierQuality;
  supplierReliability?: SupplierReliability;
  supplierPriceNotes?: string;
  supplierCommissionNotes?: string;
  supplierStatus?: SupplierStatus;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type Lead = {
  id: string;
  category: "Villa" | "Voiture" | "Bateau" | "Conciergerie";
  contactName: string;
  assetType?: "" | "Property" | "Vehicle" | "Boat";
  assetId?: string;
  status: LeadStatus;
  value: number;
  priority: "Basse" | "Moyenne" | "Haute";
  nextAction: string;
  notes: string;
  dueDate: string;
  rentalStartDate: string;
  rentalEndDate: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type Property = {
  id: string;
  name: string;
  city: string;
  type: string;
  price: number;
  status: PropertyStatus;
  owner: string;
  bedrooms: number;
  surface: number;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type Vehicle = {
  id: string;
  name: string;
  brand: string;
  model: string;
  city: string;
  price: number;
  status: VehicleStatus;
  owner: string;
  year: number;
  mileage: number;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type Boat = {
  id: string;
  name: string;
  port: string;
  type: string;
  price: number;
  status: BoatStatus;
  owner: string;
  year: number;
  length: number;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};


export type Task = {
  id: string;
  title: string;
  owner: string;
  status: TaskStatus;
  dueDate: string;
  linkedTo: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
  completedAt?: string;
};


export type PlanningEntry = {
  id: string;
  title: string;
  type: PlanningEntryType;
  planningCategory?: PlanningCategory;
  status?: PlanningEntryStatus;
  priority?: PlanningPriority;
  contactName: string;
  assetType?: "" | "Property" | "Vehicle" | "Boat";
  assetId?: string;
  startDate: string;
  startTime?: string;
  endDate: string;
  endTime?: string;
  blocksAvailability: boolean;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type Supplier = {
  id: string;
  name: string;
  category: SupplierCategory;
  contactName: string;
  email: string;
  phone: string;
  zone: string;
  quality: SupplierQuality;
  reliability: SupplierReliability;
  priceNotes: string;
  commissionNotes: string;
  notes: string;
  status: SupplierStatus;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type HouseTrackingHouse = {
  id: string;
  name: string;
  address: string;
  notes?: string;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type HouseTrackingWorker = {
  id: string;
  contactId: string;
  contactName: string;
  role: string;
  hourlyRate?: number;
  documentUrl?: string;
  documentStoragePath?: string;
  documentFileName?: string;
  documentUploadedAt?: string;
  status: "Actif" | "Inactif";
  notes?: string;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type HouseTimeEntry = {
  id: string;
  houseId: string;
  houseName: string;
  workerId: string;
  workerName: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  hourlyRate: number;
  note?: string;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type HousePayment = {
  id: string;
  houseId: string;
  houseName: string;
  workerId: string;
  workerName: string;
  date: string;
  amount: number;
  method: "Virement" | "Espèces" | "CB" | "Chèque" | "Autre";
  note?: string;
  createdAt: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};


export type VendorQuote = {
  id: string;
  contactId: string;
  contactName: string;
  contactPersonName?: string;
  category: string;
  title: string;
  quoteReference: string;
  quoteDate: string;
  validUntil: string;
  amount: number;
  status: VendorQuoteStatus;
  quoteDocumentUrl?: string;
  quoteDocumentStoragePath?: string;
  quoteDocumentName?: string;
  linkedInvoiceId?: string;
  notes?: string;
  createdAt: string;
  validatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type VendorInvoice = {
  invoiceReference?: string;
  paymentBankAccountId?: string;
  id: string;
  contactId: string;
  contactName: string;
  contactPersonName?: string;
  category: string;
  title: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  status: "En attente de facture" | "À payer" | "Partiellement payé" | "Payé" | "En retard" | "Annulé";
  sourceQuoteId?: string;
  sourceQuoteReference?: string;
  invoiceReceivedAt?: string;
  linkedDocumentId?: string;
  invoiceDocumentUrl?: string;
  invoiceDocumentStoragePath?: string;
  invoiceDocumentName?: string;
  paymentMethod?: string;
  notes?: string;
  createdAt: string;
};

export type CRMData = {
  contacts: Contact[];
  leads: Lead[];
  properties: Property[];
  vehicles: Vehicle[];
  boats: Boat[];
  tasks: Task[];
  suppliers?: Supplier[];
  planningEntries?: PlanningEntry[];
  quotes?: any[];
  vendorQuotes?: VendorQuote[];
  vendorInvoices?: VendorInvoice[];
  houseTrackingHouses?: HouseTrackingHouse[];
  houseTrackingWorkers?: HouseTrackingWorker[];
  houseTimeEntries?: HouseTimeEntry[];
  housePayments?: HousePayment[];
  documents?: any[];
};
