import type { ScopedOperation } from "@/lib/access/operations";
import type { MonthlyChargesPatch, MonthlyChargesSnapshot, MonthlyChargeSource } from "./types";

/** These calls always retain the captured Auth identity and fresh access checks. */
export async function readMonthlyCharges(operation: ScopedOperation, options: { export?: boolean; sources?: MonthlyChargeSource[] } = {}) {
  const result = await operation.run(() => operation.client.rpc("crm_read_monthly_charges", {
    p_export: options.export ?? false,
    p_sources: options.sources ?? ["invoice", "hours"]
  }));
  if (result.error) throw new Error(result.error.message);
  return result.data as MonthlyChargesSnapshot;
}

export async function patchMonthlyCharges(operation: ScopedOperation, revision: string, patch: MonthlyChargesPatch, requestId: string) {
  const result = await operation.run(() => operation.client.rpc("crm_patch_monthly_charges", {
    p_revision: revision,
    p_patch: patch,
    p_request_id: requestId
  }));
  if (result.error) throw new Error(result.error.message);
  return result.data as MonthlyChargesSnapshot;
}
