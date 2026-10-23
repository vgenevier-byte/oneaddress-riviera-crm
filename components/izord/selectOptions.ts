import type { ProjectState } from "@/lib/izord/model";
import { sortSelectOptions } from "@/lib/selectOptions";

export type IzordFieldOption = { value: string; label: string };
export type IzordFieldSpec = { key: keyof ProjectState; label: string; kind: string; numeric?: boolean; maxLength?: number; options?: readonly IzordFieldOption[]; optionOrder?: "alphabetical" | "business" };

// The field metadata classifies every select. In particular, regime=other is
// the holding-company regime, not an "Other — specify" supplement.
export function izordFieldOptions(spec: IzordFieldSpec, language: string, getLabel: (option: IzordFieldOption) => string): IzordFieldOption[] {
  return spec.optionOrder === "alphabetical" ? sortSelectOptions(spec.options || [], getLabel, language) : [...(spec.options || [])];
}
