/** Safe, source-only projections; payments, notes and documents never belong here. */
export type MonthlyChargeSource = "invoice" | "hours";
export type MonthlyPersonRule = { source: MonthlyChargeSource; personId: string; included: true };
export type MonthlyChargeException = { source: MonthlyChargeSource; sourceId: string; included: boolean; reason?: string };
export type MonthlyChargeAttachment = { source: "invoice"; sourceId: string } & (
  | { mode: "month"; month: string }
  | { mode: "spread"; startMonth: string; endMonth: string }
);
export type MonthlyChargesConfig = {
  personRules: MonthlyPersonRule[];
  exceptions: MonthlyChargeException[];
  attachments: MonthlyChargeAttachment[];
};
export type MonthlyChargesPatch = {
  personRules?: { source: MonthlyChargeSource; personId: string; included: boolean }[];
  exceptions?: { source: MonthlyChargeSource; sourceId: string; included: boolean | null; reason?: string }[];
  attachments?: ({ source: "invoice"; sourceId: string; mode: "default" } | MonthlyChargeAttachment)[];
};
export type MonthlyInvoiceSource = {
  id: string; personId: string; personLabel: string; title: string;
  invoiceReference?: string; invoiceDate?: string; amount?: unknown; status?: string;
};
export type MonthlyTimeSource = {
  id: string; personId: string; personLabel: string; houseId?: string; houseName?: string;
  date?: string; startTime?: string; endTime?: string; breakMinutes?: unknown; hourlyRate?: unknown;
};
export type MonthlyChargesSnapshot = {
  revision: string;
  sourceRevision: string;
  config: MonthlyChargesConfig;
  sources: {
    invoices: MonthlyInvoiceSource[];
    timeEntries: MonthlyTimeSource[];
    suppliers: { id: string; label: string }[];
    workers: { id: string; label: string; status?: string }[];
    houses: { id: string; name: string }[];
  };
  permissions: {
    canContribute: boolean;
    readableSources: MonthlyChargeSource[];
    exportableSources: MonthlyChargeSource[];
    contactsVisible: boolean;
  };
};
