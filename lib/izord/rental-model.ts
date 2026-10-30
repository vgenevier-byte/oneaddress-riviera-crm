import type { ImportMeta, JsonValue, ProjectData, ProjectState } from './model';
import { validateRentalPlan, rentalComparisonText, type RentalPlan } from '../fonciere/rentals';

/** The source snapshot is immutable provenance. Edits belong to this presentation. */
export function presentationRentalPlan(meta: ImportMeta | null | undefined, allowIssues = false): RentalPlan | null {
  const snapshot = meta?.fonciereSnapshot;
  const original = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot.rentalPlan : null;
  return validateRentalPlan(meta && Object.hasOwn(meta, 'presentationRentalPlan') ? meta.presentationRentalPlan : original, allowIssues);
}
export function rentalFinancialState(state: ProjectState, plan: RentalPlan): ProjectState {
  const value = (n: number | null) => n === null ? '' : String(n);
  return { ...state, acq: value(plan.cost.acquisition), notaryQuote: value(plan.cost.acquisitionFees), works: value(plan.cost.works), otherCosts: value(plan.cost.other), regime: 'other', notaryRate: '', monthly: '', weekly: '', rentedMonths: '', weeks: '' };
}
/** Recognize only the exact automatically appended text from the initial release. */
export function presentationPersonalNotes(data: ProjectData): string {
  const snapshot = data.importMeta?.fonciereSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.mappedStateVersion === 2) return String(data.state.decisionNotes || '');
  const mapped = snapshot.mappedState;
  const plan = validateRentalPlan(snapshot.rentalPlan);
  if (!plan || !mapped || typeof mapped !== 'object' || Array.isArray(mapped)) return String(data.state.decisionNotes || '');
  const notes = String(mapped.decisionNotes || '');
  const generated = [notes, rentalComparisonText(plan)].filter(Boolean).join('\n').slice(0, 1000);
  const fields=snapshot.fields;
  const original=fields&&typeof fields==='object'&&!Array.isArray(fields)&&typeof fields.notes==='string'?fields.notes:notes;
  return data.state.decisionNotes === generated || data.state.decisionNotes === notes ? original.slice(0,1000) : String(data.state.decisionNotes || '');
}
export function normalizePresentationRentals(data: ProjectData, allowIssues = false): ProjectData {
  const plan = presentationRentalPlan(data.importMeta, allowIssues);
  return plan ? { ...data, state: { ...rentalFinancialState(data.state, plan), decisionNotes: presentationPersonalNotes(data) } } : data;
}
export function withPresentationRentalPlan(data: ProjectData, plan: RentalPlan): ProjectData {
  const own = validateRentalPlan(plan, true)!;
  return normalizePresentationRentals({ ...data, importMeta: { ...data.importMeta, presentationRentalPlan: own as unknown as JsonValue } }, true);
}
